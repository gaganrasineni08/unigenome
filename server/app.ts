// HTTP API. Every write is checked here: signature, chain link, permissions, and custody.
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { randomBytes, toB64url, toHex } from "../shared/bytes";
import { hashOf, verifyMessage } from "../shared/crypto";
import { dnaOf, encodePayload, verifyUnit, type ContainerFields, type ItemFields, type SignedUnit } from "../shared/identity";
import { EVENT_TYPES, eventHash, verifyEvent, type EventBody } from "../shared/events";
import { merkleProof, merkleRoot, buildLevels } from "../shared/dsa/merkle";
import { haversineKm } from "../shared/geo";
import { checkGstin } from "../shared/gstin";
import { verifyChain } from "../shared/events";
import { Graph, dijkstra } from "../shared/dsa/graph";
import { db } from "./db";
import { indexes } from "./indexes";
import {
  alertHeap, chainOf, effectiveCustody, estimateArrival, getUnit, hashClaim, history, mainSite, newId, now,
  raiseAlert, recallAnalysis, routeGraph, sitesOf, subtree, topOf, verifyScan,
} from "./logic";

/** The demo seeder replays past days, so it switches off the clock-skew check while it runs. */
export const clock = { trustDeviceTime: false };

type Env = { Variables: { party: { id: string; role: string; name: string; org: string | null } } };
export const app = new Hono<Env>().basePath("/api");

const bad = (msg: string, status: 400 | 401 | 403 | 404 | 409 = 400): never => {
  throw new HTTPException(status, { message: msg });
};

app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
  console.error(err);
  return c.json({ error: "Server error: " + (err as Error).message }, 500);
});

const ROLES = ["regulator", "manufacturer", "qa", "warehouse", "retailer"] as const;

// ------------------------------------------------------------------ public reads

app.get("/health", (c) => c.json({ ok: true }));

/** Public keys for offline verification on the buyer's phone. */
app.get("/keys", async (c) => {
  const ix = await indexes();
  const out: any[] = [];
  for (const [, p] of ix.parties.entries()) out.push({ id: p.id, name: p.name, role: p.role, publicKey: p.publicKey, status: p.status });
  return c.json({ parties: out, revoked: out.filter((p) => p.status === "revoked").map((p) => p.id), at: now() });
});

app.get("/parties", async (c) => {
  const d = await db();
  const rows = await d.query("SELECT id, handle, name, role, org, status, public_key FROM parties ORDER BY role, name");
  const sites = await d.query("SELECT * FROM sites");
  return c.json(rows.map((p) => ({ ...p, sites: sites.filter((s) => s.party_id === p.id) })));
});

// ------------------------------------------------------------------ registration and sign-in

app.post("/register", async (c) => {
  const b = await c.req.json();
  if (!ROLES.includes(b.role) || b.role === "regulator") bad("Choose manufacturer, quality approver, warehouse or retailer");
  if (!/^[a-z0-9._-]{3,32}$/.test(b.handle ?? "")) bad("Username: 3 to 32 lowercase letters, digits, dot, dash or underscore");
  if (!b.name?.trim()) bad("Name is required");
  if (!/^[0-9a-f]{64}$/.test(b.publicKey ?? "")) bad("Bad public key");
  if (!b.encKey?.ct) bad("Missing encrypted key");
  if (!b.site?.name || typeof b.site.lat !== "number" || typeof b.site.lng !== "number") bad("A site with a location is required");
  const d = await db();
  if ((await d.query("SELECT 1 FROM parties WHERE handle = $1", [b.handle])).length) bad("That username is taken", 409);
  if (b.role === "qa") {
    const m = (await d.query("SELECT id FROM parties WHERE id = $1 AND role = 'manufacturer'", [b.org]))[0];
    if (!m) bad("Pick the manufacturer this quality approver works for");
  }
  const proof = b.role === "qa" ? null : cleanProof(b.proof);
  const prefix = { manufacturer: "M", qa: "Q", warehouse: "W", retailer: "R" }[b.role as "manufacturer"];
  const id = newId(prefix, 2);
  await d.query(
    "INSERT INTO parties (id, handle, name, role, org, public_key, enc_key, status, created_at, proof) VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$8,$9)",
    [id, b.handle, b.name.trim(), b.role, b.role === "qa" ? b.org : null, b.publicKey, JSON.stringify(b.encKey), now(), proof && JSON.stringify(proof)],
  );
  await d.query("INSERT INTO sites (id, party_id, name, lat, lng) VALUES ($1,$2,$3,$4,$5)", [newId("S", 3), id, b.site.name, b.site.lat, b.site.lng]);
  (await indexes()).parties.set(id, { id, name: b.name.trim(), role: b.role, org: b.org ?? null, publicKey: b.publicKey, status: "pending" });
  return c.json({ id, status: "pending" });
});

/** Company proofs a new manufacturer, warehouse or retailer must give; the network head reviews them. */
function cleanProof(p: any) {
  if (!p || typeof p !== "object") bad("Company details and a proof document are required");
  const str = (k: string, label: string, max = 200) => {
    const v = String(p[k] ?? "").trim();
    if (!v) bad(label + " is required");
    if (v.length > max) bad(label + " is too long");
    return v;
  };
  const out: any = {
    licenceNo: str("licenceNo", "Licence number", 40).toUpperCase(),
    gstin: str("gstin", "GSTIN", 15).toUpperCase(),
    address: str("address", "Address", 300),
    contactName: str("contactName", "Contact person", 80),
    phone: str("phone", "Phone", 20),
    email: str("email", "Email", 120),
    website: String(p.website ?? "").trim().slice(0, 120) || null,
  };
  if (!/^[+0-9 ()-]{8,20}$/.test(out.phone)) bad("Phone number looks wrong");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(out.email)) bad("Email looks wrong");
  const doc = p.doc;
  if (!doc?.data) bad("Attach your licence or registration certificate");
  const m = /^data:(image\/(png|jpeg|webp|svg\+xml)|application\/pdf);base64,/.exec(String(doc.data));
  if (!m) bad("The document must be a PDF, PNG, JPG or WebP file");
  if (String(doc.data).length > 4_000_000) bad("The document must be under 3 MB");
  out.doc = { name: String(doc.name ?? "document").slice(0, 100), type: m![1], data: String(doc.data) };
  return out;
}

/** Step 1 of sign-in: the encrypted key (only the user's passphrase can open it) and a one-time challenge. */
app.post("/auth/challenge", async (c) => {
  const { handle } = await c.req.json();
  const d = await db();
  const p = (await d.query("SELECT id, enc_key, status, role, name FROM parties WHERE handle = $1", [String(handle ?? "").toLowerCase()]))[0];
  if (!p) bad("No account with that username", 404);
  const nonce = toB64url(randomBytes(24));
  await d.query("INSERT INTO challenges (nonce, party_id, expires) VALUES ($1,$2,$3)", [nonce, p.id, now() + 120_000]);
  return c.json({ partyId: p.id, encKey: p.enc_key, nonce, status: p.status });
});

/** Step 2: the browser signs the challenge with the decrypted key; the server checks it against the public key. */
app.post("/auth/login", async (c) => {
  const { partyId, nonce, sig } = await c.req.json();
  const d = await db();
  const ch = (await d.query("DELETE FROM challenges WHERE nonce = $1 AND party_id = $2 RETURNING expires", [nonce, partyId]))[0];
  if (!ch || Number(ch.expires) < now()) bad("Challenge expired, try again", 401);
  const p = (await indexes()).parties.get(partyId);
  if (!p || !verifyMessage("UG/login", { nonce, party: partyId }, sig, p.publicKey)) bad("Signature check failed", 401);
  const token = toHex(randomBytes(24));
  await d.query("INSERT INTO sessions (token, party_id, expires) VALUES ($1,$2,$3)", [token, partyId, now() + 12 * 3600_000]);
  return c.json({ token, party: { id: p!.id, name: p!.name, role: p!.role, org: p!.org, status: p!.status } });
});

// ------------------------------------------------------------------ signed-in routes

const authed = new Hono<Env>();
authed.use("*", async (c, next) => {
  const token = c.req.header("authorization")?.replace(/^Bearer /, "");
  if (!token) bad("Sign in first", 401);
  const d = await db();
  const s = (await d.query("SELECT party_id, expires FROM sessions WHERE token = $1", [token]))[0];
  if (!s || Number(s.expires) < now()) bad("Session expired, sign in again", 401);
  const p = (await indexes()).parties.get(s.party_id)!;
  c.set("party", { id: p.id, role: p.role, name: p.name, org: p.org });
  await next();
});

const requireApproved = async (partyId: string) => {
  const p = (await indexes()).parties.get(partyId);
  if (!p || p.status !== "approved") bad("Your account is waiting for approval", 403);
  return p!;
};
const requireRole = (role: string, ...roles: string[]) => {
  if (![...roles].includes(role)) bad(`Only ${roles.join(" or ")} can do this`, 403);
};

authed.get("/me", async (c) => {
  const me = c.get("party");
  const p = (await indexes()).parties.get(me.id)!;
  const d = await db();
  const note = (await d.query("SELECT review_note FROM parties WHERE id = $1", [me.id]))[0]?.review_note ?? null;
  return c.json({ ...me, status: p.status, reviewNote: note, publicKey: p.publicKey, sites: await sitesOf(me.id) });
});

/**
 * Approvals. The regulator is the head of the network: it reviews every new manufacturer, warehouse and
 * retailer, with their proofs, and approves or rejects them. A manufacturer approves only its own quality approvers.
 */
const canReview = (me: { id: string; role: string }, target: { role: string; org?: string | null }) =>
  me.role === "regulator" || (me.role === "manufacturer" && target.role === "qa" && target.org === me.id);

authed.get("/approvals", async (c) => {
  const me = c.get("party");
  const d = await db();
  const rows = (await d.query(
    "SELECT p.id, p.handle, p.name, p.role, p.org, p.public_key, p.created_at, p.proof, s.name AS site_name, s.lat, s.lng FROM parties p LEFT JOIN sites s ON s.party_id = p.id WHERE p.status = 'pending' ORDER BY p.created_at",
  )).filter((r) => canReview(me, r));
  const others = await d.query("SELECT id, name, proof->>'licenceNo' AS lic, proof->>'gstin' AS gstin FROM parties WHERE proof IS NOT NULL");
  return c.json(
    rows.map((r) => {
      const p = r.proof;
      const checks: Array<{ ok: boolean; label: string; detail?: string }> = [];
      if (p) {
        const g = checkGstin(p.gstin);
        checks.push({ ok: g.ok, label: "GSTIN format and check digit", detail: g.ok ? `${g.state} · PAN ${g.pan}` : g.reason });
        const dupL = others.find((o) => o.id !== r.id && o.lic === p.licenceNo);
        const dupG = others.find((o) => o.id !== r.id && o.gstin === p.gstin);
        checks.push({ ok: !dupL, label: "Licence number not used by another company", detail: dupL ? "also used by " + dupL.name : undefined });
        checks.push({ ok: !dupG, label: "GSTIN not used by another company", detail: dupG ? "also used by " + dupG.name : undefined });
        checks.push({ ok: !!p.doc, label: "Licence document attached", detail: p.doc?.name });
      }
      checks.push({ ok: r.lat != null, label: "Site location given", detail: r.site_name ?? undefined });
      const { doc, ...rest } = p ?? {};
      return { ...r, proof: p ? { ...rest, doc: doc ? { name: doc.name, type: doc.type } : null } : null, checks };
    }),
  );
});

/** The proof document itself, only for whoever reviews the account. */
authed.get("/approvals/:id/doc", async (c) => {
  const me = c.get("party");
  const d = await db();
  const r = (await d.query("SELECT role, org, proof FROM parties WHERE id = $1", [c.req.param("id")]))[0];
  if (!r || !canReview(me, r)) bad("Not found", 404);
  if (!r.proof?.doc) bad("No document", 404);
  return c.json(r.proof.doc);
});

authed.post("/approvals/:id", async (c) => {
  const me = c.get("party");
  await requireApproved(me.id);
  const { sig } = await c.req.json();
  const ix = await indexes();
  const target = ix.parties.get(c.req.param("id"));
  if (!target || target.status !== "pending") bad("Nothing to approve", 404);
  if (!canReview(me, target!)) bad("Only the regulator can approve companies", 403);
  // The endorsement: the approver signs the new party's id, role and public key.
  const body = { party: target!.id, role: target!.role, publicKey: target!.publicKey };
  if (!verifyMessage("UG/endorse", body, sig, ix.parties.get(me.id)!.publicKey)) bad("Endorsement signature is invalid", 401);
  const d = await db();
  await d.query("UPDATE parties SET status = 'approved', approved_by = $1, approval_sig = $2, reviewed_at = $3 WHERE id = $4", [me.id, sig, now(), target!.id]);
  target!.status = "approved";
  return c.json({ ok: true });
});

authed.post("/approvals/:id/reject", async (c) => {
  const me = c.get("party");
  await requireApproved(me.id);
  const { reason } = await c.req.json();
  if (!String(reason ?? "").trim()) bad("Say why, so the company can fix it");
  const ix = await indexes();
  const target = ix.parties.get(c.req.param("id"));
  if (!target || target.status !== "pending") bad("Nothing to reject", 404);
  if (!canReview(me, target!)) bad("Only the regulator can review companies", 403);
  const d = await db();
  await d.query("UPDATE parties SET status = 'rejected', review_note = $1, approved_by = $2, reviewed_at = $3 WHERE id = $4", [String(reason).trim().slice(0, 500), me.id, now(), target!.id]);
  target!.status = "rejected";
  return c.json({ ok: true });
});

authed.post("/revoke/:id", async (c) => {
  const me = c.get("party");
  requireRole(me.role, "regulator");
  const ix = await indexes();
  const target = ix.parties.get(c.req.param("id"));
  if (!target) bad("Unknown party", 404);
  const d = await db();
  await d.query("UPDATE parties SET status = 'revoked' WHERE id = $1", [target!.id]);
  target!.status = "revoked";
  ix.revoked.add(target!.id);
  await raiseAlert({ kind: "revoked", severity: 3, party: target!.id, message: `Key of ${target!.name} revoked by ${me.name}` });
  return c.json({ ok: true });
});

authed.post("/sites", async (c) => {
  const me = c.get("party");
  const b = await c.req.json();
  if (!b.name || typeof b.lat !== "number" || typeof b.lng !== "number") bad("Name and location are required");
  const d = await db();
  const id = newId("S", 3);
  await d.query("INSERT INTO sites (id, party_id, name, lat, lng) VALUES ($1,$2,$3,$4,$5)", [id, me.id, b.name, b.lat, b.lng]);
  return c.json({ id });
});

// ------------------------------------------------------------------ batches (two-person approval)

authed.get("/batches", async (c) => {
  const me = c.get("party");
  const d = await db();
  const mfr = me.role === "qa" ? me.org : me.id;
  const rows =
    me.role === "regulator"
      ? await d.query("SELECT * FROM batches ORDER BY created_at DESC")
      : await d.query("SELECT * FROM batches WHERE mfr = $1 ORDER BY created_at DESC", [mfr]);
  return c.json(rows);
});

authed.post("/batches", async (c) => {
  const me = c.get("party");
  requireRole(me.role, "manufacturer");
  await requireApproved(me.id);
  const { body, sig } = await c.req.json();
  if (body?.mfr !== me.id) bad("Batch must name you as manufacturer");
  if (!/^B-[A-Z0-9-]{2,16}$/.test(body.id ?? "")) bad("Batch id must look like B-1024");
  if (!body.productCode || !body.productName || !body.mfg || !(body.quantity > 0 && body.quantity <= 500)) bad("Fill in product, dates and a quantity from 1 to 500");
  if (!verifyMessage("UG/batch", body, sig, (await indexes()).parties.get(me.id)!.publicKey)) bad("Batch signature is invalid", 401);
  const d = await db();
  if ((await d.query("SELECT 1 FROM batches WHERE id = $1", [body.id])).length) bad("That batch id already exists", 409);
  await d.query(
    `INSERT INTO batches (id, mfr, product_code, product_name, category, mfg, exp, quantity, status, created_by, sig, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'awaiting_qa',$9,$10,$11)`,
    [body.id, me.id, body.productCode, body.productName, body.category ?? "General", body.mfg, body.exp || null, body.quantity, me.id, sig, now()],
  );
  const ix = await indexes();
  ix.ids.insert(body.id);
  if (body.exp) ix.expiry.insert(body.exp, body.id);
  return c.json({ id: body.id, status: "awaiting_qa" });
});

/** The second signature: a quality approver of the same manufacturer co-signs the batch. */
authed.post("/batches/:id/approve", async (c) => {
  const me = c.get("party");
  requireRole(me.role, "qa");
  await requireApproved(me.id);
  const { sig } = await c.req.json();
  const d = await db();
  const b = (await d.query("SELECT * FROM batches WHERE id = $1", [c.req.param("id")]))[0];
  if (!b || b.mfr !== me.org) bad("Unknown batch", 404);
  if (b.status !== "awaiting_qa") bad("This batch is already approved");
  if (!verifyMessage("UG/batch-qa", { batch: b.id, sig: b.sig }, sig, (await indexes()).parties.get(me.id)!.publicKey)) bad("Approval signature is invalid", 401);
  await d.query("UPDATE batches SET status = 'approved', qa_by = $1, qa_sig = $2 WHERE id = $3", [me.id, sig, b.id]);
  return c.json({ ok: true });
});

// ------------------------------------------------------------------ issuing items and packing

/** Record a signed custody event (shared by issuing, packing and scanning). */
async function appendEvent(q: (sql: string, p?: unknown[]) => Promise<any[]>, body: EventBody, sig: string, flags: string[] = []) {
  const unit = (await q("SELECT id, head FROM units WHERE id = $1 FOR UPDATE", [body.unit]))[0];
  if (!unit) bad("Unknown unit " + body.unit, 404);
  if (body.prev !== unit.head) bad("Someone else recorded a scan on this unit first. Scan again.", 409);
  const hash = eventHash(body, sig);
  const seq = Number((await q("SELECT COUNT(*) AS n FROM events WHERE unit_id = $1", [body.unit]))[0].n);
  await q(
    "INSERT INTO events (hash, unit_id, seq, body, sig, actor, type, ts, server_ts, flags) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
    [hash, body.unit, seq, JSON.stringify(body), sig, body.actor, body.type, body.ts, now(), JSON.stringify(flags)],
  );
  await q("UPDATE units SET head = $1 WHERE id = $2", [hash, body.unit]);
  return hash;
}

authed.post("/items", async (c) => {
  const me = c.get("party");
  requireRole(me.role, "manufacturer");
  const p = await requireApproved(me.id);
  const { batch: batchId, items } = (await c.req.json()) as {
    batch: string;
    items: Array<{ unit: SignedUnit; claimHash: string; event: { body: EventBody; sig: string } }>;
  };
  const d = await db();
  const batch = (await d.query("SELECT * FROM batches WHERE id = $1", [batchId]))[0];
  if (!batch || batch.mfr !== me.id) bad("Unknown batch", 404);
  if (batch.status !== "approved") bad("A quality approver must approve this batch before items can be issued", 403);
  if (!Array.isArray(items) || !items.length) bad("No items");
  if (batch.issued + items.length > batch.quantity) bad(`Issuance limit: this batch allows ${batch.quantity} items and ${batch.issued} are already issued`, 403);
  for (const it of items) {
    const f = it.unit.f as ItemFields;
    if (f.kind !== "item" || f.mfr !== me.id || f.batch !== batchId || f.product !== batch.product_code || f.mfg !== batch.mfg || (f.exp ?? null) !== (batch.exp ?? null))
      bad(`Item ${f.id} does not match its batch`);
    if (!verifyUnit(it.unit, p.publicKey)) bad(`Signature on item ${f.id} is invalid`, 401);
    const e = it.event;
    if (e.body.unit !== f.id || e.body.type !== "MANUFACTURED" || e.body.actor !== me.id || e.body.prev !== "0") bad("Bad manufacturing record");
    if (!verifyEvent(e.body, e.sig, p.publicKey)) bad("Manufacturing record signature is invalid", 401);
  }
  const ix = await indexes();
  await d.tx(async (q) => {
    for (const it of items) {
      const f = it.unit.f as ItemFields;
      await q(
        "INSERT INTO units (id, kind, batch_id, fields, sig, dna, signer, custodian, claim_hash, created_at) VALUES ($1,'item',$2,$3,$4,$5,$6,$6,$7,$8)",
        [f.id, batchId, JSON.stringify(f), it.unit.sig, dnaOf(f), me.id, it.claimHash, now()],
      );
      await appendEvent(q, it.event.body, it.event.sig);
    }
    await q("UPDATE batches SET issued = issued + $1 WHERE id = $2", [items.length, batchId]);
  });
  for (const it of items) {
    ix.ids.insert(it.unit.f.id);
    const b = it.event.body;
    if (b.lat != null && b.lng != null) ix.lastSeen.set(b.unit, { lat: b.lat, lng: b.lng, ts: b.ts, source: "custody" });
  }
  return c.json({ issued: items.length });
});

/** Units this party holds and can act on (top-level only, or everything with ?all=1). */
authed.get("/inventory", async (c) => {
  const me = c.get("party");
  const d = await db();
  const rows = await d.query(
    `SELECT u.id, u.kind, u.batch_id, u.parent_id, u.custodian, u.in_transit_to, u.sold_ts, u.condition_bad, u.fields, u.created_at,
            b.product_name, b.exp,
            (SELECT COUNT(*) FROM units k WHERE k.parent_id = u.id) AS children
       FROM units u LEFT JOIN batches b ON b.id = u.batch_id
      WHERE (u.custodian = $1 OR u.in_transit_to = $1) AND u.parent_id IS NULL
      ORDER BY u.created_at DESC, u.id`,
    [me.id],
  );
  return c.json(rows.map((r) => ({ ...r, children: Number(r.children) })));
});

/** Pack items into a carton, or cartons into a pallet. The container's QR carries a Merkle root of its contents. */
authed.post("/containers", async (c) => {
  const me = c.get("party");
  const p = await requireApproved(me.id);
  requireRole(me.role, "manufacturer", "warehouse");
  const { unit, children, event } = (await c.req.json()) as { unit: SignedUnit; children: string[]; event: { body: EventBody; sig: string } };
  const f = unit.f as ContainerFields;
  if (f.kind !== "carton" && f.kind !== "pallet") bad("Not a container");
  if (f.by !== me.id) bad("Container must be signed by you");
  const sorted = [...children].sort();
  if (!sorted.length || f.count !== sorted.length) bad("Count does not match contents");
  if (merkleRoot(sorted) !== f.root) bad("Merkle root does not match the contents", 400);
  if (!verifyUnit(unit, p.publicKey)) bad("Container signature is invalid", 401);
  if (event.body.unit !== f.id || event.body.type !== "PACKED" || event.body.actor !== me.id || event.body.prev !== "0") bad("Bad packing record");
  if (!verifyEvent(event.body, event.sig, p.publicKey)) bad("Packing record signature is invalid", 401);
  const d = await db();
  const childKind = f.kind === "carton" ? "item" : "carton";
  for (const id of sorted) {
    const u = await getUnit(id);
    if (!u || u.kind !== childKind) bad(`${id} is not a ${childKind}`);
    if (u.parent_id) bad(`${id} is already packed in ${u.parent_id}`);
    if (u.custodian !== me.id) bad(`You do not hold ${id}`, 403);
    if (u.sold_ts) bad(`${id} is already sold`);
  }
  const ts = now();
  await d.tx(async (q) => {
    await q(
      "INSERT INTO units (id, kind, fields, sig, dna, signer, custodian, created_at) VALUES ($1,$2,$3,$4,$5,$6,$6,$7)",
      [f.id, f.kind, JSON.stringify(f), unit.sig, dnaOf(f), me.id, ts],
    );
    await appendEvent(q, event.body, event.sig);
    for (const id of sorted) {
      await q("UPDATE units SET parent_id = $1, custodian = NULL WHERE id = $2", [f.id, id]);
      await q("INSERT INTO pack_links (child, parent, from_ts) VALUES ($1,$2,$3)", [id, f.id, event.body.ts]);
    }
  });
  (await indexes()).ids.insert(f.id);
  return c.json({ id: f.id, payload: encodePayload(unit) });
});

/** Printable labels: every item of a batch, or every container this party packed. */
authed.get("/labels", async (c) => {
  const me = c.get("party");
  const d = await db();
  const batch = c.req.query("batch");
  const rows = batch
    ? await d.query("SELECT id, kind, fields, sig, parent_id FROM units WHERE batch_id = $1 AND signer = $2 ORDER BY id", [batch, me.id])
    : await d.query("SELECT id, kind, fields, sig, parent_id, (SELECT COUNT(*) FROM pack_links l WHERE l.parent = u.id) AS n FROM units u WHERE kind <> 'item' AND signer = $1 ORDER BY created_at DESC", [me.id]);
  return c.json(rows.map((r) => ({ id: r.id, kind: r.kind, parent: r.parent_id, count: r.n != null ? Number(r.n) : undefined, payload: encodePayload({ f: r.fields, sig: r.sig }) })));
});

// ------------------------------------------------------------------ scanning: one endpoint for every custody record

authed.post("/events", async (c) => {
  const me = c.get("party");
  const p = await requireApproved(me.id);
  const { body, sig } = (await c.req.json()) as { body: EventBody; sig: string };
  if (body.actor !== me.id) bad("Record must name you as the actor");
  if (!EVENT_TYPES.includes(body.type) || ["MANUFACTURED", "PACKED"].includes(body.type)) bad("Unsupported record type");
  if (!verifyEvent(body, sig, p.publicKey)) bad("Signature is invalid", 401);
  const ix = await indexes();
  const unit = await getUnit(body.unit);
  if (!unit) bad("Unknown unit", 404);
  const { top, custodian, inTransitTo } = await effectiveCustody(unit);
  const flags: string[] = [];

  // Cross-checks on reported time and place.
  if (!clock.trustDeviceTime && Math.abs(body.ts - now()) > 10 * 60_000) flags.push("device clock differs from server by more than 10 minutes");
  if (body.site && body.lat != null && body.lng != null) {
    const s = (await sitesOf(me.id)).find((x) => x.id === body.site);
    if (!s) bad("That site is not one of yours");
    const km = haversineKm(s, { lat: body.lat, lng: body.lng });
    if (km > 2) flags.push(`GPS is ${km.toFixed(1)} km from the registered site`);
  }

  const d = await db();
  let extra: any = {};
  const isTop = top.id === unit.id;

  switch (body.type) {
    case "DISPATCHED": {
      if (!isTop) bad(`${unit.id} is packed inside ${top.id}. Scan and dispatch ${top.id} instead.`);
      if (custodian !== me.id) bad("You don't hold this unit", 403);
      const to = ix.parties.get(String(body.data?.to));
      if (!to || to.status !== "approved" || to.id === me.id) bad("Pick an approved destination");
      const eta = await estimateArrival(me.id, to!.id);
      const shipId = newId("SH", 3);
      await d.tx(async (q) => {
        await appendEvent(q, body, sig, flags);
        await q("UPDATE units SET custodian = NULL, in_transit_to = $1 WHERE id = $2", [to!.id, unit.id]);
        await q(
          "INSERT INTO shipments (id, unit_id, from_party, to_party, ref, dispatched_ts, eta_ts, eta_path, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'in_transit')",
          [shipId, unit.id, me.id, to!.id, body.data?.ref ?? null, body.ts, Math.round(body.ts + (eta.hours + eta.marginHours) * 3600_000), JSON.stringify(eta)],
        );
      });
      extra = { shipment: shipId, eta: { ...eta, expected: Math.round(body.ts + eta.hours * 3600_000) } };
      break;
    }
    case "RECEIVED": {
      if (!isTop) bad(`${unit.id} is packed inside ${top.id}. Scan ${top.id} instead.`);
      if (!inTransitTo) bad("This unit is not in transit");
      const ship = (await d.query("SELECT * FROM shipments WHERE unit_id = $1 AND status = 'in_transit' ORDER BY dispatched_ts DESC LIMIT 1", [unit.id]))[0];
      // Only the company the shipment was addressed to may receive it. Anyone else is refused, and the attempt is reported.
      if (inTransitTo !== me.id) {
        await raiseAlert({ kind: "diverted", severity: 4, unit: unit.id, party: me.id, message: `${me.name} tried to receive ${unit.id}, which was sent to ${ix.parties.get(inTransitTo!)?.name}` });
        bad(`This shipment was sent to another company. Only they can receive it.`, 403);
      }
      const diverted = false;
      await d.tx(async (q) => {
        await appendEvent(q, body, sig, diverted ? [...flags, `expected at ${ix.parties.get(inTransitTo!)?.name}`] : flags);
        await q("UPDATE units SET custodian = $1, in_transit_to = NULL WHERE id = $2", [me.id, unit.id]);
        if (ship) await q("UPDATE shipments SET received_ts = $1, received_by = $2, status = $3 WHERE id = $4", [body.ts, me.id, diverted ? "diverted" : "received", ship.id]);
      });
      if (diverted)
        await raiseAlert({ kind: "diverted", severity: 4, unit: unit.id, party: me.id, message: `${unit.id} was meant for ${ix.parties.get(inTransitTo!)?.name} but was received by ${me.name}` });
      const sub = await subtree(unit.id);
      extra = { transitHours: ship ? (body.ts - Number(ship.dispatched_ts)) / 3600_000 : null, diverted, itemsUpdated: sub.items.length };
      break;
    }
    case "STORED":
    case "CONDITION": {
      if (custodian !== me.id) bad("You don't hold this unit", 403);
      const bad_ = body.type === "CONDITION" && body.data?.ok === false;
      await d.tx(async (q) => {
        await appendEvent(q, body, sig, flags);
        if (bad_) await q("UPDATE units SET condition_bad = TRUE WHERE id = $1", [unit.id]);
      });
      if (bad_)
        await raiseAlert({ kind: "condition", severity: 3, unit: unit.id, party: me.id, message: `Condition check failed on ${unit.id}: ${body.data?.note ?? ""}`.trim() });
      extra = { itemsUpdated: (await subtree(unit.id)).items.length };
      break;
    }
    case "UNPACKED": {
      if (unit.kind === "item") bad("Items can't be unpacked");
      if (!isTop) bad(`${unit.id} is inside ${top.id}. Unpack ${top.id} first.`);
      if (custodian !== me.id) bad("You don't hold this unit", 403);
      const kids: string[] = (await d.query("SELECT id FROM units WHERE parent_id = $1 ORDER BY id", [unit.id])).map((r) => r.id);
      await d.tx(async (q) => {
        await appendEvent(q, body, sig, flags);
        await q("UPDATE units SET parent_id = NULL, custodian = $1 WHERE parent_id = $2", [me.id, unit.id]);
        await q("UPDATE pack_links SET to_ts = $1 WHERE parent = $2 AND to_ts IS NULL", [body.ts, unit.id]);
        await q("UPDATE units SET custodian = NULL WHERE id = $1", [unit.id]);
      });
      // Random spot-check chosen by the server, so nobody knows in advance which items will be checked.
      const fields = unit.fields as ContainerFields;
      const sample = [...kids].sort(() => Math.random() - 0.5).slice(0, Math.min(kids.length, Math.max(1, Math.ceil(kids.length * 0.1))));
      extra = {
        released: kids.length,
        spotCheck: sample.map((id) => ({ id, proof: merkleProof(kids, kids.indexOf(id)) })),
        root: fields.root,
      };
      break;
    }
    case "SPOT_CHECK": {
      if (unit.kind !== "item") bad("Spot checks are on items");
      const carton = String(body.data?.carton ?? "");
      const link = (await d.query("SELECT 1 FROM pack_links WHERE child = $1 AND parent = $2", [unit.id, carton]))[0];
      await d.tx(async (q) => appendEvent(q, body, sig, link ? flags : [...flags, `not packed in ${carton}`]));
      if (!link)
        await raiseAlert({ kind: "swap", severity: 5, unit: unit.id, party: me.id, message: `Spot check: ${unit.id} was found in ${carton} but was never packed there` });
      extra = { belongs: !!link };
      break;
    }
    case "SOLD": {
      requireRole(me.role, "retailer");
      if (unit.kind !== "item") bad("Only single items are sold. Unpack the carton first.");
      if (!isTop || custodian !== me.id) bad("You don't hold this item on your shelf", 403);
      if (unit.sold_ts) bad("Already sold");
      await d.tx(async (q) => {
        await appendEvent(q, body, sig, flags);
        await q("UPDATE units SET sold_ts = $1, sold_at_site = $2 WHERE id = $3", [body.ts, body.site, unit.id]);
      });
      break;
    }
  }
  if (body.lat != null && body.lng != null) {
    for (const id of (await subtree(unit.id)).order) ix.lastSeen.set(id, { lat: body.lat, lng: body.lng, ts: body.ts, source: "custody" });
  }
  const sub = await subtree(unit.id);
  return c.json({ ok: true, flags, unit: unit.id, kind: unit.kind, itemsInside: sub.items.length, ...extra });
});

authed.get("/eta", async (c) => {
  const me = c.get("party");
  const to = c.req.query("to")!;
  const eta = await estimateArrival(me.id, to);
  return c.json({ ...eta, expected: Math.round(now() + eta.hours * 3600_000) });
});

authed.get("/shipments", async (c) => {
  const me = c.get("party");
  const d = await db();
  const rows = await d.query(
    "SELECT * FROM shipments WHERE from_party = $1 OR to_party = $1 OR received_by = $1 OR $2 = 'regulator' ORDER BY dispatched_ts DESC LIMIT 100",
    [me.id, me.role],
  );
  return c.json(rows);
});

// ------------------------------------------------------------------ unit details (staff and buyer)

async function unitView(id: string) {
  const u = await getUnit(id);
  if (!u) bad("Unknown unit", 404);
  const ix = await indexes();
  const d = await db();
  const batch = u.batch_id ? (await d.query("SELECT * FROM batches WHERE id = $1", [u.batch_id]))[0] : null;
  const { top, custodian, inTransitTo } = await effectiveCustody(u);
  const sub = await subtree(id);
  const chain = await chainOf(id);
  const check = verifyChain(chain, (pid) => ix.parties.get(pid)?.publicKey);
  const containers: string[] = [];
  for (const l of await d.query("SELECT parent FROM pack_links WHERE child = $1 ORDER BY from_ts", [id])) containers.push(l.parent);
  return {
    id: u.id,
    kind: u.kind,
    fields: u.fields,
    payload: encodePayload({ f: u.fields, sig: u.sig }),
    head: u.head,
    batch: batch && { id: batch.id, productName: batch.product_name, productCode: batch.product_code, category: batch.category, mfg: batch.mfg, exp: batch.exp, status: batch.status, mfr: batch.mfr, mfrName: ix.parties.get(batch.mfr)?.name, qaBy: batch.qa_by && ix.parties.get(batch.qa_by)?.name },
    parent: u.parent_id,
    top: top.id,
    custodian,
    custodianName: custodian ? ix.parties.get(custodian)?.name : null,
    inTransitTo,
    inTransitToName: inTransitTo ? ix.parties.get(inTransitTo)?.name : null,
    sold: u.sold_ts ? Number(u.sold_ts) : null,
    claimed: u.claimed_ts ? Number(u.claimed_ts) : null,
    conditionBad: u.condition_bad,
    contents: { count: sub.items.length, direct: (sub.kids.get(id) ?? []).length, children: sub.kids.get(id) ?? [] },
    containers,
    chainCheck: check,
    history: await history(id),
    scans: Number((await d.query("SELECT COUNT(*) AS n FROM scans WHERE unit_id = $1", [id]))[0].n),
  };
}

/**
 * Staff view of a unit. A company sees a unit only if it is involved: it holds it, it is the destination of
 * the shipment, or it appears in the unit's history. Other companies (and the regulator sees everything) get
 * nothing beyond the id, so a shipment is visible only to its sender and its chosen destination.
 */
authed.get("/units/:id", async (c) => {
  const me = c.get("party");
  const v = await unitView(c.req.param("id"));
  const org = me.role === "qa" ? me.org : me.id;
  const involved = me.role === "regulator" || v.custodian === org || v.inTransitTo === org || v.history.some((h) => h.actor === org);
  if (!involved) return c.json({ id: v.id, kind: v.kind, restricted: true });
  return c.json(v);
});

// ------------------------------------------------------------------ buyer (no account, read only)

app.post("/verify", async (c) => {
  const b = await c.req.json();
  if (!b.device) bad("Missing device id");
  const r = await verifyScan(String(b.text ?? ""), { device: String(b.device), lat: b.lat ?? null, lng: b.lng ?? null, record: true });
  const view = r.row ? await unitView(r.row.id) : null;
  return c.json({ verdict: r.verdict, checks: r.checks, reasons: r.reasons, unit: r.unit, view: r.verdict === "COUNTERFEIT" ? null : view });
});

app.post("/claim", async (c) => {
  const { unit, code, device } = await c.req.json();
  const u = await getUnit(String(unit));
  if (!u || u.kind !== "item" || !u.claim_hash) bad("Unknown item", 404);
  if (u.claimed_ts) {
    return c.json({ ok: u.claimed_device === device, already: true, claimedAt: Number(u.claimed_ts) });
  }
  if (hashClaim(u.id, String(code ?? "")) !== u.claim_hash) bad("That hidden code does not match this item", 400);
  const d = await db();
  await d.query("UPDATE units SET claimed_ts = $1, claimed_device = $2 WHERE id = $3", [now(), device, u.id]);
  return c.json({ ok: true, already: false, claimedAt: now() });
});

const SEVERITY: Record<string, number> = { fake: 4, expired: 3, damaged: 2, wrong: 2, other: 1 };

app.post("/complaints", async (c) => {
  const b = await c.req.json();
  if (!SEVERITY[b.reason]) bad("Pick a reason");
  if (!b.text?.trim() || b.text.length > 1000) bad("Describe the problem in up to 1000 characters");
  if (!b.device) bad("Missing device id");
  const d = await db();
  const recent = (await d.query("SELECT COUNT(*) AS n FROM complaints WHERE device = $1 AND ts > $2", [b.device, now() - 3600_000]))[0];
  if (Number(recent.n) >= 3) bad("Too many complaints from this phone in the last hour. Try again later.", 409);
  const u = b.unit ? await getUnit(String(b.unit)) : null;
  const withClaim = !!(u?.claim_hash && b.code && hashClaim(u.id, String(b.code)) === u.claim_hash);
  let sev = SEVERITY[b.reason] + (withClaim ? 1 : 0) + (["COUNTERFEIT", "SUSPICIOUS_CLONE"].includes(b.verdict) ? 1 : 0);
  sev = Math.min(5, sev);
  const id = "CMP-" + toHex(randomBytes(3)).toUpperCase();
  const p = b.lat != null ? { lat: Math.round(b.lat * 100) / 100, lng: Math.round(b.lng * 100) / 100 } : null;
  await d.query(
    `INSERT INTO complaints (id, unit_id, batch_id, reason, text, contact, with_claim, verdict, lat, lng, device, ts, status, severity)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'received',$13)`,
    [id, u?.id ?? b.unit ?? null, u?.batch_id ?? null, b.reason, b.text.trim(), b.contact?.trim() || null, withClaim, b.verdict ?? null, p?.lat ?? null, p?.lng ?? null, b.device, now(), sev],
  );
  await raiseAlert({ kind: "complaint", severity: sev, unit: u?.id ?? null, batch: u?.batch_id ?? null, party: u?.signer ?? null, message: `Complaint ${id} (${b.reason}${withClaim ? ", hidden code verified" : ""}): ${b.text.trim().slice(0, 120)}`, dedupe: "cmp:" + id });
  return c.json({ id, severity: sev, withClaim });
});

app.get("/complaints/:id", async (c) => {
  const d = await db();
  const r = (await d.query("SELECT id, unit_id, reason, text, status, response, ts, severity, with_claim FROM complaints WHERE id = $1", [c.req.param("id").toUpperCase()]))[0];
  if (!r) bad("No complaint with that number", 404);
  return c.json(r);
});

// ------------------------------------------------------------------ regulator and manufacturer oversight

authed.get("/alerts", async (c) => {
  const me = c.get("party");
  const mfr = me.role === "qa" ? me.org : me.id;
  const filter = me.role === "regulator" ? undefined : (a: any) => a.party_id === me.id || a.party_id === mfr;
  return c.json(await alertHeap(filter));
});

authed.post("/alerts/:id/close", async (c) => {
  const d = await db();
  await d.query("UPDATE alerts SET status = 'closed' WHERE id = $1", [c.req.param("id")]);
  return c.json({ ok: true });
});

authed.get("/complaints", async (c) => {
  const me = c.get("party");
  const d = await db();
  const rows =
    me.role === "regulator"
      ? await d.query("SELECT * FROM complaints ORDER BY ts DESC")
      : await d.query("SELECT c.* FROM complaints c JOIN units u ON u.id = c.unit_id WHERE u.signer = $1 ORDER BY c.ts DESC", [me.role === "qa" ? me.org : me.id]);
  return c.json(rows);
});

authed.post("/complaints/:id", async (c) => {
  const me = c.get("party");
  requireRole(me.role, "regulator", "manufacturer");
  const { status, response } = await c.req.json();
  if (!["under_review", "resolved", "rejected"].includes(status)) bad("Bad status");
  const d = await db();
  await d.query("UPDATE complaints SET status = $1, response = $2 WHERE id = $3", [status, response ?? null, c.req.param("id")]);
  if (status !== "under_review") await d.query("UPDATE alerts SET status = 'closed' WHERE dedupe = $1", ["cmp:" + c.req.param("id")]);
  return c.json({ ok: true });
});

authed.get("/recall/:batch", async (c) => {
  const me = c.get("party");
  requireRole(me.role, "regulator", "manufacturer");
  const budget = Math.min(60, Math.max(1, Number(c.req.query("budget") ?? 10)));
  const staff = Math.min(10, Math.max(1, Number(c.req.query("staff") ?? 3)));
  return c.json(await recallAnalysis(c.req.param("batch"), budget, staff));
});

authed.post("/recall/:batch", async (c) => {
  const me = c.get("party");
  requireRole(me.role, "regulator", "manufacturer");
  const d = await db();
  const b = (await d.query("SELECT * FROM batches WHERE id = $1", [c.req.param("batch")]))[0];
  if (!b || (me.role === "manufacturer" && b.mfr !== me.id)) bad("Unknown batch", 404);
  await d.query("UPDATE batches SET status = 'recalled' WHERE id = $1", [b.id]);
  await raiseAlert({ kind: "recall", severity: 5, batch: b.id, party: b.mfr, message: `Batch ${b.id} (${b.product_name}) recalled by ${me.name}` });
  return c.json({ ok: true });
});

// ------------------------------------------------------------------ search and expiry (trie, AVL)

app.get("/search", async (c) => {
  const ix = await indexes();
  const q = c.req.query("q") ?? "";
  return c.json(q ? ix.ids.search(q, 15) : { total: 0, keys: [], path: [] });
});

app.get("/expiring", async (c) => {
  const ix = await indexes();
  const days = Math.min(3650, Math.max(1, Number(c.req.query("days") ?? 30)));
  const lo = new Date().toISOString().slice(0, 10);
  const hi = new Date(now() + days * 86400_000).toISOString().slice(0, 10);
  const d = await db();
  const hits = ix.expiry.range(lo, hi);
  const rows = hits.length ? await d.query("SELECT id, product_name, exp, mfr, status, issued FROM batches WHERE id = ANY($1)", [hits.map((h) => h.value)]) : [];
  return c.json({ lo, hi, batches: rows.sort((a, b) => (a.exp < b.exp ? -1 : 1)) });
});

// ------------------------------------------------------------------ DSA page: live snapshots

// Load the demo data set (used by the "Load demo data" button on the home page).
app.post("/demo/seed", async (c) => {
  if (process.env.ALLOW_DEMO_SEED === "0") bad("Demo loading is turned off on this server", 403);
  const body = await c.req.json().catch(() => ({}));
  const { seedDemo } = await import("./seed");
  return c.json(await seedDemo({ reset: !!body.reset }));
});

app.get("/dsa/overview", async (c) => {
  const ix = await indexes();
  const d = await db();
  const cartons = await d.query("SELECT u.id FROM units u JOIN pack_links l ON l.parent = u.id WHERE u.kind = 'carton' GROUP BY u.id ORDER BY count(*) DESC, u.id LIMIT 20");
  const units = await d.query("SELECT id, kind FROM units WHERE kind <> 'item' ORDER BY created_at DESC LIMIT 1");
  const anyItem = await d.query("SELECT e.unit_id AS id FROM events e JOIN units u ON u.id = e.unit_id WHERE u.kind = 'item' GROUP BY e.unit_id ORDER BY count(*) DESC, e.unit_id LIMIT 1");
  const batches = await d.query("SELECT id FROM batches ORDER BY created_at DESC");
  const { ordered, array } = await alertHeap();
  const { g, rows } = await routeGraph();
  const names = (id: string) => ix.parties.get(id)?.name ?? id;
  const src = rows[0]?.from_party;
  const dj = src ? dijkstra(g, src) : null;
  return c.json({
    hashmap: ix.parties.snapshot(),
    partyNames: Object.fromEntries([...ix.parties.entries()].map(([k, v]) => [k, v.name])),
    revoked: ix.revoked.snapshot(),
    lastSeen: { size: ix.lastSeen.size, capacity: ix.lastSeen.capacity },
    avl: { tree: ix.expiry.snapshot(), height: ix.expiry.height, rotations: ix.expiry.rotations.slice(-8) },
    heap: { array: array.map((a) => ({ id: a.id, severity: a.severity, kind: a.kind, ts: Number(a.ts) })), ordered: ordered.slice(0, 10).map((a) => ({ id: a.id, severity: a.severity, kind: a.kind, message: a.message })) },
    routes: {
      edges: rows.map((r) => ({ from: r.from_party, fromName: names(r.from_party), to: r.to_party, toName: names(r.to_party), hours: Number(r.hours), n: Number(r.n) })),
      source: src ? { id: src, name: names(src) } : null,
      dist: dj ? Object.entries(dj.dist).map(([k, v]) => ({ id: k, name: names(k), hours: v, path: dj.pathTo(k).map(names) })) : [],
      settled: dj?.settled.map(names) ?? [],
    },
    samples: { cartons: cartons.map((x) => x.id), container: units[0]?.id ?? null, item: anyItem[0]?.id ?? null, batches: batches.map((b) => b.id) },
  });
});

app.get("/dsa/trie", async (c) => {
  const ix = await indexes();
  const q = c.req.query("q") ?? "";
  return c.json({ search: ix.ids.search(q || "B", 10), subtree: ix.ids.subtree(q, 3) });
});

app.get("/dsa/merkle/:carton", async (c) => {
  const u = await getUnit(c.req.param("carton"));
  if (!u || u.kind === "item") bad("Not a container", 404);
  const d = await db();
  const kids: string[] = (await d.query("SELECT child FROM pack_links WHERE parent = $1 ORDER BY child", [u.id])).map((r) => r.child);
  const sorted = [...new Set(kids)].sort();
  const pick = Math.max(0, sorted.indexOf(c.req.query("item") ?? sorted[0]));
  return c.json({
    id: u.id,
    signedRoot: (u.fields as ContainerFields).root,
    leaves: sorted,
    levels: buildLevels(sorted),
    pick,
    proof: merkleProof(sorted, pick),
  });
});

app.get("/dsa/tree/:id", async (c) => {
  const id = c.req.param("id");
  const sub = await subtree(id);
  return c.json({ root: id, order: sub.order, items: sub.items.length, kids: Object.fromEntries(sub.kids), kind: Object.fromEntries(sub.kind) });
});

app.get("/dsa/chain/:id", async (c) => {
  const ix = await indexes();
  const chain = await chainOf(c.req.param("id"));
  // Optional what-if: pretend record ?tamper=i had its time changed, and re-verify.
  const t = c.req.query("tamper");
  const test = t != null ? chain.map((r, i) => (i === Number(t) ? { ...r, body: { ...r.body, ts: r.body.ts + 3600_000 } } : r)) : chain;
  return c.json({ records: test.map((r) => ({ type: r.body.type, actor: ix.parties.get(r.body.actor)?.name, ts: r.body.ts, prev: r.body.prev, hash: r.hash })), check: verifyChain(test, (pid) => ix.parties.get(pid)?.publicKey) });
});

app.get("/dsa/recall/:batch", async (c) => c.json(await recallAnalysis(c.req.param("batch"), Number(c.req.query("budget") ?? 10), Number(c.req.query("staff") ?? 3))));

app.get("/dsa/hash", (c) => {
  const text = c.req.query("text") ?? "";
  return c.json({ text, hash: hashOf("UG/demo", text) });
});

app.route("/", authed);
