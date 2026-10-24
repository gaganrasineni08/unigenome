// Domain logic: custody, histories, arrival estimates, verdicts, alerts and recall analysis.
import { toHex, randomBytes } from "../shared/bytes";
import { sha256Hex } from "../shared/crypto";
import { decodePayload, dnaOf, payloadFromScan, signerOf, verifyUnit, type SignedUnit } from "../shared/identity";
import { haversineKm, impliedSpeedKmh, roundForPrivacy } from "../shared/geo";
import { BinaryHeap, kWayMerge } from "../shared/dsa/heap";
import { Graph, bfs, dijkstra } from "../shared/dsa/graph";
import { greedyAllocate, knapsack2D, type Candidate } from "../shared/dsa/knapsack";
import { ancestors, dfsCollect } from "../shared/dsa/tree";
import { db } from "./db";
import { indexes } from "./indexes";

export const newId = (prefix: string, bytes = 3) => `${prefix}-${toHex(randomBytes(bytes)).toUpperCase()}`;
export const now = () => Date.now();

export const MAX_SPEED_KMH = 900; // faster than an airliner: one physical item cannot do this
export const SHELF_RADIUS_KM = 50;
export const MAX_DEVICES = 5;

// ---------------------------------------------------------------- units and the packaging tree

export async function getUnit(id: string) {
  const d = await db();
  return (await d.query("SELECT * FROM units WHERE id = $1", [id]))[0] ?? null;
}

/** Topmost container a unit currently sits in (itself when unpacked). Walks parent pointers: O(depth). */
export async function topOf(unit: any) {
  let u = unit;
  while (u.parent_id) u = await getUnit(u.parent_id);
  return u;
}

/** Who holds a unit right now: the holder of its topmost container. */
export async function effectiveCustody(unit: any) {
  const top = await topOf(unit);
  return { top, custodian: top.custodian as string | null, inTransitTo: top.in_transit_to as string | null };
}

export async function childrenOf(id: string): Promise<string[]> {
  const d = await db();
  return (await d.query("SELECT id FROM units WHERE parent_id = $1 ORDER BY id", [id])).map((r) => r.id);
}

/** DFS below a container: every carton and item inside it (topic 6). */
export async function subtree(id: string) {
  const d = await db();
  const rows = await d.query(
    `WITH RECURSIVE t AS (SELECT id, parent_id, kind FROM units WHERE id = $1
       UNION ALL SELECT u.id, u.parent_id, u.kind FROM units u JOIN t ON u.parent_id = t.id)
     SELECT id, parent_id, kind FROM t`,
    [id],
  );
  const kids = new Map<string, string[]>();
  const kind = new Map<string, string>();
  for (const r of rows) {
    kind.set(r.id, r.kind);
    if (r.parent_id && r.id !== id) {
      if (!kids.has(r.parent_id)) kids.set(r.parent_id, []);
      kids.get(r.parent_id)!.push(r.id);
    }
  }
  for (const l of kids.values()) l.sort();
  const order = dfsCollect(id, (x) => kids.get(x) ?? []);
  return { order, items: order.filter((x) => kind.get(x) === "item"), kind, kids };
}

export async function ancestorIds(id: string): Promise<string[]> {
  const cache = new Map<string, string | null>();
  const parentOf = async (x: string) => {
    if (!cache.has(x)) cache.set(x, (await getUnit(x))?.parent_id ?? null);
    return cache.get(x)!;
  };
  // Pre-load the chain, then use the pure helper.
  let cur: string | null = id;
  while (cur) cur = await parentOf(cur);
  return ancestors(id, (x) => cache.get(x) ?? null);
}

// ---------------------------------------------------------------- histories (topics 4, 6, 9)

export interface HistoryEntry {
  hash: string;
  unit: string;
  via: string | null; // container the record was made on, when inherited
  type: string;
  actor: string;
  actorName: string;
  ts: number;
  lat: number | null;
  lng: number | null;
  site: string | null;
  siteName: string | null;
  data: any;
  flags: string[];
}

async function eventsOf(unitId: string, from: number, to: number) {
  const d = await db();
  return d.query("SELECT * FROM events WHERE unit_id = $1 AND ts >= $2 AND ts <= $3 ORDER BY seq", [unitId, from, to]);
}

/** Sorted lists: the unit's own records plus each container's records while the unit was inside it. */
async function historyLists(unitId: string, from: number, to: number, via: string | null): Promise<any[][]> {
  const d = await db();
  const own = (await eventsOf(unitId, from, to)).map((e) => ({ ...e, via }));
  const lists = [own];
  for (const link of await d.query("SELECT * FROM pack_links WHERE child = $1", [unitId])) {
    const lo = Math.max(from, Number(link.from_ts));
    const hi = Math.min(to, link.to_ts == null ? Infinity : Number(link.to_ts));
    if (lo <= hi) lists.push(...(await historyLists(link.parent, lo, hi, link.parent)));
  }
  return lists;
}

export async function history(unitId: string): Promise<HistoryEntry[]> {
  const d = await db();
  const ix = await indexes();
  const lists = await historyLists(unitId, 0, Number.MAX_SAFE_INTEGER, null);
  const merged = kWayMerge(lists, (e) => Number(e.ts)); // O(N log k) merge with a heap
  const sites = new Map((await d.query("SELECT id, name FROM sites")).map((s) => [s.id, s.name]));
  return merged.map((e) => ({
    hash: e.hash,
    unit: e.unit_id,
    via: e.via,
    type: e.type,
    actor: e.actor,
    actorName: ix.parties.get(e.actor)?.name ?? e.actor,
    ts: Number(e.ts),
    lat: e.body.lat,
    lng: e.body.lng,
    site: e.body.site,
    siteName: e.body.site ? sites.get(e.body.site) ?? null : null,
    data: e.body.data,
    flags: e.flags ?? [],
  }));
}

export async function chainOf(unitId: string) {
  const d = await db();
  return (await d.query("SELECT body, sig, hash FROM events WHERE unit_id = $1 ORDER BY seq", [unitId])).map((r) => ({
    body: r.body,
    sig: r.sig,
    hash: r.hash,
  }));
}

// ---------------------------------------------------------------- sites and parties

export async function sitesOf(partyId: string) {
  const d = await db();
  return d.query("SELECT * FROM sites WHERE party_id = $1 ORDER BY name", [partyId]);
}

export async function mainSite(partyId: string) {
  return (await sitesOf(partyId))[0] ?? null;
}

// ---------------------------------------------------------------- arrival estimates (topic 8)

/** Route graph learned from completed deliveries: edge weight = average measured transit hours. */
export async function routeGraph() {
  const d = await db();
  const rows = await d.query(
    `SELECT from_party, to_party, AVG((received_ts - dispatched_ts) / 3600000.0) AS hours,
            STDDEV_SAMP((received_ts - dispatched_ts) / 3600000.0) AS sd, COUNT(*) AS n
       FROM shipments WHERE status = 'received' AND received_by = to_party GROUP BY from_party, to_party`,
  );
  const g = new Graph();
  for (const r of rows) g.addEdge(r.from_party, r.to_party, Number(r.hours));
  return { g, rows };
}

export async function estimateArrival(from: string, to: string) {
  const { g, rows } = await routeGraph();
  if (g.adj.has(from)) {
    const r = dijkstra(g, from);
    const hours = r.dist[to];
    if (Number.isFinite(hours)) {
      const path = r.pathTo(to);
      // Margin from the spread actually seen on the direct route, or half the estimate.
      const direct = rows.find((x) => x.from_party === from && x.to_party === to);
      const margin = direct && Number(direct.n) >= 3 && direct.sd ? 2 * Number(direct.sd) : Math.max(6, hours * 0.5);
      return { hours, path, method: "dijkstra" as const, marginHours: margin };
    }
  }
  const a = await mainSite(from);
  const b = await mainSite(to);
  const km = a && b ? haversineKm(a, b) : 300;
  const hours = 12 + km / 40; // handling time plus an average road speed
  return { hours, path: [from, to], method: "distance" as const, marginHours: Math.max(6, hours * 0.5) };
}

// ---------------------------------------------------------------- alerts (topic 9)

export async function raiseAlert(a: {
  kind: string;
  severity: number;
  message: string;
  unit?: string | null;
  batch?: string | null;
  party?: string | null;
  dedupe?: string;
}) {
  const d = await db();
  await d.query(
    `INSERT INTO alerts (id, kind, severity, unit_id, batch_id, party_id, message, ts, status, dedupe)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'open',$9) ON CONFLICT (dedupe) DO NOTHING`,
    [newId("AL", 4), a.kind, a.severity, a.unit ?? null, a.batch ?? null, a.party ?? null, a.message, now(), a.dedupe ?? null],
  );
}

/** Raise "overdue" alerts for shipments past their estimate plus margin. */
export async function sweepOverdue() {
  const d = await db();
  for (const s of await d.query("SELECT * FROM shipments WHERE status = 'in_transit' AND eta_ts < $1", [now()])) {
    await raiseAlert({
      kind: "overdue",
      severity: 3,
      unit: s.unit_id,
      party: s.to_party,
      message: `Shipment ${s.id} of ${s.unit_id} is overdue (expected by ${new Date(Number(s.eta_ts)).toLocaleString("en-IN")})`,
      dedupe: "overdue:" + s.id,
    });
  }
}

/** Open alerts in a max-priority heap: highest severity first, then oldest. */
export async function alertHeap(filter?: (a: any) => boolean) {
  await sweepOverdue();
  const d = await db();
  const heap = new BinaryHeap<any>((x, y) => x.severity > y.severity || (x.severity === y.severity && Number(x.ts) < Number(y.ts)));
  for (const a of await d.query("SELECT * FROM alerts WHERE status = 'open'")) if (!filter || filter(a)) heap.push(a);
  const array = heap.toArray();
  const ordered: any[] = [];
  while (heap.size) ordered.push(heap.pop());
  return { ordered, array };
}

// ---------------------------------------------------------------- buyer verification (T0 + T1)

export type Verdict = "GENUINE" | "CONDITION_COMPROMISED" | "COUNTERFEIT" | "SUSPICIOUS_CLONE" | "RECALLED";

export interface Check {
  tier: "T0" | "T1" | "T2" | "info";
  ok: boolean;
  label: string;
  detail?: string;
}

export async function verifyScan(text: string, ctx: { device: string; lat?: number | null; lng?: number | null; record: boolean }) {
  const ix = await indexes();
  const d = await db();
  const checks: Check[] = [];
  let unit: SignedUnit;
  try {
    unit = decodePayload(payloadFromScan(text));
  } catch {
    return { verdict: "COUNTERFEIT" as Verdict, checks: [{ tier: "T0", ok: false, label: "Not a UniGenome code" } as Check], unit: null };
  }
  const f = unit.f;
  const signer = ix.parties.get(signerOf(f));
  checks.push({ tier: "T0", ok: !!signer, label: "Signer is a registered party", detail: signer?.name });
  const sigOk = !!signer && verifyUnit(unit, signer.publicKey);
  checks.push({ tier: "T0", ok: sigOk, label: "Signature matches the printed details" });
  const row = await getUnit(f.id);
  const registered = !!row && row.dna === dnaOf(f);
  checks.push({ tier: "T0", ok: registered, label: "Code is in the issuance log", detail: registered ? undefined : "valid-looking codes that were never registered are rejected" });
  const revoked = !!signer && ix.revoked.has(signer.id);
  if (revoked) checks.push({ tier: "T0", ok: false, label: "Signer's key has been revoked" });

  let batch: any = null;
  if (f.kind === "item") {
    batch = (await d.query("SELECT * FROM batches WHERE id = $1", [f.batch]))[0] ?? null;
    checks.push({ tier: "T0", ok: !!batch?.qa_sig, label: "Batch approved by a second manager" });
  }

  let verdict: Verdict = "GENUINE";
  if (!sigOk || !registered || revoked || (f.kind === "item" && !batch?.qa_sig)) verdict = "COUNTERFEIT";

  const reasons: string[] = [];
  if (verdict !== "COUNTERFEIT" && row) {
    // ---- recall and condition
    if (batch?.status === "recalled") {
      verdict = "RECALLED";
      checks.push({ tier: "T2", ok: false, label: "This batch has been recalled" });
    }
    const chain = [row, ...(await Promise.all((await ancestorIds(row.id)).map(getUnit)))];
    const condBad = chain.some((u) => u?.condition_bad);
    const expired = f.kind === "item" && !!f.exp && f.exp < new Date().toISOString().slice(0, 10);
    checks.push({ tier: "info", ok: !condBad, label: "Storage and handling checks passed" });
    if (f.kind === "item" && f.exp) checks.push({ tier: "info", ok: !expired, label: `Expiry date ${f.exp}` });
    if (verdict === "GENUINE" && (condBad || expired)) verdict = "CONDITION_COMPROMISED";

    // ---- T1 clone checks
    const here = ctx.lat != null && ctx.lng != null ? { lat: ctx.lat, lng: ctx.lng, ts: now() } : null;
    let clone = false;
    if (row.claimed_ts && row.claimed_device !== ctx.device) {
      clone = true;
      reasons.push(`already claimed by a buyer on ${new Date(Number(row.claimed_ts)).toLocaleDateString("en-IN")}`);
    }
    const last = ix.lastSeen.get(row.id);
    if (here && last) {
      const speed = impliedSpeedKmh(last, here);
      const ok = speed <= MAX_SPEED_KMH;
      checks.push({ tier: "T1", ok, label: "Travel since last scan is physically possible", detail: `${Math.round(haversineKm(last, here))} km, ${Number.isFinite(speed) ? Math.round(speed) + " km/h" : "no time between scans"}` });
      if (!ok) {
        clone = true;
        reasons.push("scanned too far from its last scan in too little time");
      }
    }
    if (here && f.kind === "item" && !row.sold_ts) {
      const { custodian } = await effectiveCustody(row);
      const holder = custodian ? ix.parties.get(custodian) : null;
      if (holder?.role === "retailer") {
        const s = await mainSite(holder.id);
        if (s) {
          const km = haversineKm(s, here);
          const ok = km <= SHELF_RADIUS_KM;
          checks.push({ tier: "T1", ok, label: `Scanned near where it should be (${holder.name})`, detail: `${Math.round(km)} km away` });
          if (!ok) {
            clone = true;
            reasons.push(`records say it is still at ${holder.name}, ${Math.round(km)} km from here`);
          }
        }
      }
    }
    const devices = (await d.query("SELECT COUNT(DISTINCT device) AS n FROM scans WHERE unit_id = $1 AND device <> $2", [row.id, ctx.device]))[0];
    const nDev = Number(devices?.n ?? 0) + 1;
    const devOk = nDev <= MAX_DEVICES;
    checks.push({ tier: "T1", ok: devOk, label: "Scanned by a normal number of phones", detail: `${nDev} device${nDev > 1 ? "s" : ""}` });
    if (!devOk) {
      clone = true;
      reasons.push(`scanned by ${nDev} different phones`);
    }
    if (clone && verdict !== "RECALLED") verdict = "SUSPICIOUS_CLONE";
  }

  if (ctx.record) {
    const p = ctx.lat != null && ctx.lng != null ? roundForPrivacy({ lat: ctx.lat, lng: ctx.lng }) : null;
    await d.query("INSERT INTO scans (unit_id, device, lat, lng, ts, verdict, reasons) VALUES ($1,$2,$3,$4,$5,$6,$7)", [
      f.id, ctx.device, p?.lat ?? null, p?.lng ?? null, now(), verdict, JSON.stringify(reasons),
    ]);
    if (p) ix.lastSeen.set(f.id, { ...p, ts: now(), source: "buyer" });
    if (verdict === "COUNTERFEIT")
      await raiseAlert({ kind: "counterfeit", severity: 5, unit: f.id, batch: f.kind === "item" ? f.batch : null, party: signerOf(f), message: `Counterfeit code scanned claiming to be ${f.id}`, dedupe: `cf:${f.id}:${ctx.device}` });
    if (verdict === "SUSPICIOUS_CLONE")
      await raiseAlert({ kind: "clone", severity: 4, unit: f.id, batch: f.kind === "item" ? f.batch : null, party: signerOf(f), message: `Possible copied code ${f.id}: ${reasons.join("; ")}`, dedupe: `cl:${f.id}:${ctx.device}` });
  }
  return { verdict, checks, reasons, unit, row, batch };
}

export const hashClaim = (unitId: string, code: string) => sha256Hex("claim:" + unitId + ":" + code.replace(/[^0-9a-z]/gi, "").toUpperCase());

// ---------------------------------------------------------------- recall (topics 7 and 10)

export async function recallAnalysis(batchId: string, budget: number, staff: number) {
  const d = await db();
  const ix = await indexes();
  const batch = (await d.query("SELECT * FROM batches WHERE id = $1", [batchId]))[0];
  if (!batch) throw new Error("unknown batch");
  const items: string[] = (await d.query("SELECT id FROM units WHERE batch_id = $1", [batchId])).map((r) => r.id);
  // Every container that ever held an item of this batch, found by walking pack links upward.
  const touched = new Set(items);
  let frontier = [...items];
  while (frontier.length) {
    const rows = await d.query("SELECT DISTINCT parent FROM pack_links WHERE child = ANY($1)", [frontier]);
    frontier = rows.map((r) => r.parent).filter((p) => !touched.has(p));
    frontier.forEach((p) => touched.add(p));
  }
  const ships = await d.query("SELECT * FROM shipments WHERE unit_id = ANY($1)", [[...touched]]);
  const g = new Graph();
  g.addNode(batch.mfr);
  for (const s of ships) g.addEdge(s.from_party, s.received_by ?? s.to_party);
  const result = bfs(g, batch.mfr);

  // Units of the batch each reached party still holds, and its risk signals.
  const held = new Map<string, number>();
  for (const id of items) {
    const u = await getUnit(id);
    const { custodian } = await effectiveCustody(u);
    const at = u.sold_ts ? "sold" : custodian;
    if (at) held.set(at, (held.get(at) ?? 0) + 1);
  }
  const complaints = await d.query("SELECT unit_id FROM complaints WHERE batch_id = $1 AND status <> 'rejected'", [batchId]);
  const alerts = await d.query("SELECT party_id, unit_id FROM alerts WHERE batch_id = $1", [batchId]);
  const base = (await d.query("SELECT * FROM sites s JOIN parties p ON p.id = s.party_id WHERE p.role = 'regulator' LIMIT 1"))[0];

  const candidates: Array<Candidate & { name: string; role: string; km: number; held: number; complaints: number; alerts: number }> = [];
  for (const pid of result.order) {
    const p = ix.parties.get(pid);
    if (!p || p.role === "manufacturer") continue;
    const site = await mainSite(pid);
    const nHeld = held.get(pid) ?? 0;
    const nAlerts = alerts.filter((a) => a.party_id === pid).length;
    let nComplaints = 0;
    for (const c of complaints) {
      const u = c.unit_id ? await getUnit(c.unit_id) : null;
      if (u?.sold_at_site && site && u.sold_at_site === site.id) nComplaints++;
    }
    const km = site && base ? haversineKm(base, site) : 100;
    candidates.push({
      id: pid,
      name: p.name,
      role: p.role,
      km: Math.round(km),
      held: nHeld,
      complaints: nComplaints,
      alerts: nAlerts,
      cost: 1 + Math.round(km / 50), // thousands of rupees: a visit plus travel
      staff: nHeld > 20 ? 2 : 1,
      risk: 10 * nComplaints + 5 * nAlerts + nHeld + 1,
    });
  }
  const dp = knapsack2D(candidates, budget, staff);
  const greedy = greedyAllocate(candidates, budget, staff);
  return {
    batch,
    graph: { nodes: g.nodes.map((id) => ({ id, name: ix.parties.get(id)?.name ?? id, role: ix.parties.get(id)?.role })), edges: g.edges },
    bfs: result,
    candidates,
    dp: dp.result,
    dpTable: dp.table,
    dpCells: dp.cells,
    greedy,
    soldUnits: held.get("sold") ?? 0,
  };
}
