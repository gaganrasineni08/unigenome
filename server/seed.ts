// Demo data: real parties with real keys, and ten days of signed history, created through the same API
// the app uses, so every record passes the same checks. Run with `npm run seed` or the button on the home page.
import { randomBytes, toHex } from "../shared/bytes";
import { generateKeyPair, signMessage } from "../shared/crypto";
import { encryptSecretKey } from "../shared/keystore";
import { encodePayload, signUnit, type ContainerFields, type ItemFields } from "../shared/identity";
import { signEvent, type EventBody, type EventType } from "../shared/events";
import { merkleRoot } from "../shared/dsa/merkle";
import { app, clock } from "./app";
import { db } from "./db";
import { hashClaim, newId } from "./logic";
import { indexes, resetIndexes } from "./indexes";

export const DEMO_PASSPHRASE = "demo1234";
const HOUR = 3600_000;
const DAY = 24 * HOUR;

interface Actor {
  id: string;
  handle: string;
  name: string;
  role: string;
  sk: string;
  pk: string;
  token: string;
  site: { id: string; name: string; lat: number; lng: number };
}

async function call(method: string, path: string, body?: unknown, token?: string) {
  const res = await app.request("/api" + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json: any = await res.json();
  if (!res.ok) throw new Error(`${method} ${path}: ${json.error}`);
  return json;
}

async function login(a: Omit<Actor, "token" | "id" | "site"> & { id?: string }) {
  const ch = await call("POST", "/auth/challenge", { handle: a.handle });
  const sig = signMessage("UG/login", { nonce: ch.nonce, party: ch.partyId }, a.sk);
  const r = await call("POST", "/auth/login", { partyId: ch.partyId, nonce: ch.nonce, sig });
  return { id: ch.partyId as string, token: r.token as string };
}

export async function seedDemo(opts: { reset?: boolean } = {}) {
  const d = await db();
  if (opts.reset) {
    for (const t of ["parties", "sites", "challenges", "sessions", "batches", "units", "pack_links", "events", "shipments", "scans", "complaints", "alerts"])
      await d.query(`DELETE FROM ${t}`);
    resetIndexes();
  } else if ((await d.query("SELECT 1 FROM parties LIMIT 1")).length) {
    return { seeded: false, reason: "Data already exists" };
  }
  clock.trustDeviceTime = true;
  try {
    return await run();
  } finally {
    clock.trustDeviceTime = false;
  }
}

async function run() {
  const d = await db();
  const t0 = Date.now() - 10 * DAY;

  // ---- the regulator is the root of trust, inserted directly
  const reg = generateKeyPair();
  const regId = "G-CDSCO";
  await d.query(
    "INSERT INTO parties (id, handle, name, role, public_key, enc_key, status, created_at) VALUES ($1,'regulator','Drug Control Authority (demo)','regulator',$2,$3,'approved',$4)",
    [regId, reg.publicKey, JSON.stringify(await encryptSecretKey(reg.secretKey, DEMO_PASSPHRASE)), t0],
  );
  await d.query("INSERT INTO sites (id, party_id, name, lat, lng) VALUES ('S-REG','G-CDSCO','Authority office, Hyderabad',17.4065,78.4772)");
  resetIndexes();
  const regTok = await login({ handle: "regulator", name: "", role: "regulator", sk: reg.secretKey, pk: reg.publicKey });

  const people: Array<[string, string, string, string, number, number, string?]> = [
    ["sunpharma", "Sun Remedies Ltd (demo)", "manufacturer", "Pune plant", 18.5204, 73.8567],
    ["sunqa", "Sun Remedies Quality Desk", "qa", "Pune QA lab", 18.5214, 73.8577, "sunpharma"],
    ["hydwarehouse", "Deccan Logistics, Hyderabad", "warehouse", "Shamshabad warehouse", 17.2403, 78.4294],
    ["mumwarehouse", "Western Cargo, Mumbai", "warehouse", "Bhiwandi warehouse", 19.2813, 73.0483],
    ["apollo", "City Pharmacy, Banjara Hills", "retailer", "Banjara Hills store", 17.4156, 78.4347],
    ["medplus", "Care Pharmacy, Secunderabad", "retailer", "Secunderabad store", 17.4399, 78.4983],
    ["andheri", "Wellness Chemists, Andheri", "retailer", "Andheri store", 19.1136, 72.8697],
  ];
  const A: Record<string, Actor> = {};
  for (const [handle, name, role, siteName, lat, lng, orgHandle] of people) {
    const k = generateKeyPair();
    const reg = await call("POST", "/register", {
      handle, name, role, org: orgHandle ? A[orgHandle].id : undefined,
      publicKey: k.publicKey, encKey: await encryptSecretKey(k.secretKey, DEMO_PASSPHRASE), site: { name: siteName, lat, lng },
    });
    // Manufacturers are endorsed by the regulator; everyone else by the manufacturer.
    const approver = role === "manufacturer" ? { sk: reg.secretKey ?? "", tok: regTok.token } : null;
    const endorse = { party: reg.id, role, publicKey: k.publicKey };
    if (role === "manufacturer") {
      const regSk = (await regKey()).sk;
      await call("POST", `/approvals/${reg.id}`, { sig: signMessage("UG/endorse", endorse, regSk) }, regTok.token);
    } else {
      await call("POST", `/approvals/${reg.id}`, { sig: signMessage("UG/endorse", endorse, A.sunpharma.sk) }, A.sunpharma.token);
    }
    void approver;
    const { token } = await login({ handle, name, role, sk: k.secretKey, pk: k.publicKey });
    const site = (await d.query("SELECT * FROM sites WHERE party_id = $1", [reg.id]))[0];
    A[handle] = { id: reg.id, handle, name, role, sk: k.secretKey, pk: k.publicKey, token, site: { id: site.id, name: site.name, lat: site.lat, lng: site.lng } };
  }
  async function regKey() {
    return { sk: reg.secretKey };
  }

  const ev = (a: Actor, unit: string, type: EventType, ts: number, prev: string, data: Record<string, unknown> = {}): { body: EventBody; sig: string } => {
    const jitter = () => (Math.random() - 0.5) * 0.002;
    const body: EventBody = { unit, type, actor: a.id, ts, lat: a.site.lat + jitter(), lng: a.site.lng + jitter(), acc: 12, site: a.site.id, prev, data };
    return { body, sig: signEvent(body, a.sk) };
  };
  const head = async (id: string) => (await d.query("SELECT head FROM units WHERE id = $1", [id]))[0].head as string;
  const scan = async (a: Actor, unit: string, type: EventType, ts: number, data: Record<string, unknown> = {}) =>
    call("POST", "/events", ev(a, unit, type, ts, await head(unit), data), a.token);

  const M = A.sunpharma;
  const claimCodes: Record<string, string> = {};

  async function makeBatch(id: string, code: string, name: string, mfg: string, exp: string, qty: number, ts: number) {
    const body = { id, mfr: M.id, productCode: code, productName: name, category: "Pharmaceuticals", mfg, exp, quantity: qty };
    await call("POST", "/batches", { body, sig: signMessage("UG/batch", body, M.sk) }, M.token);
    const b = (await d.query("SELECT sig FROM batches WHERE id = $1", [id]))[0];
    await call("POST", `/batches/${id}/approve`, { sig: signMessage("UG/batch-qa", { batch: id, sig: b.sig }, A.sunqa.sk) }, A.sunqa.token);
    const items = [];
    for (let i = 1; i <= qty; i++) {
      const f: ItemFields = { kind: "item", id: `${id}-${String(i).padStart(3, "0")}`, batch: id, mfr: M.id, product: code, mfg, exp, salt: toHex(randomBytes(8)) };
      const claim = toHex(randomBytes(4)).toUpperCase();
      claimCodes[f.id] = claim;
      items.push({ unit: signUnit(f, M.sk), claimHash: hashClaim(f.id, claim), event: ev(M, f.id, "MANUFACTURED", ts + i * 1000, "0", {}) });
    }
    await call("POST", "/items", { batch: id, items }, M.token);
    return items.map((x) => x.unit.f.id);
  }

  async function pack(a: Actor, kind: "carton" | "pallet", children: string[], ts: number) {
    const sorted = [...children].sort();
    const f: ContainerFields = { kind, id: newId(kind === "carton" ? "C" : "P", 3), by: a.id, count: sorted.length, root: merkleRoot(sorted), packed: new Date(ts).toISOString() };
    await call("POST", "/containers", { unit: signUnit(f, a.sk), children: sorted, event: ev(a, f.id, "PACKED", ts, "0", { count: sorted.length }) }, a.token);
    return f.id;
  }

  async function ship(from: Actor, to: Actor, unit: string, out: number, hours: number, receive = true) {
    await scan(from, unit, "DISPATCHED", out, { to: to.id, ref: "TRK-" + toHex(randomBytes(2)).toUpperCase() });
    if (receive) await scan(to, unit, "RECEIVED", out + hours * HOUR, {});
  }

  // ---- route history so arrival estimates have real data (topic 8)
  const W1 = A.hydwarehouse, W2 = A.mumwarehouse, R1 = A.apollo, R2 = A.medplus, R3 = A.andheri;
  const hist = await makeBatch("B-0950", "ORS-200", "Oral Rehydration Salts 200 ml", "2026-09-20", "2027-09-19", 12, t0);
  const hc = [];
  for (let i = 0; i < 6; i++) hc.push(await pack(M, "carton", hist.slice(i * 2, i * 2 + 2), t0 + HOUR + i * 1000));
  await ship(M, W1, hc[0], t0 + 2 * HOUR, 22);
  await ship(M, W1, hc[1], t0 + 3 * HOUR, 26);
  await ship(M, W2, hc[2], t0 + 4 * HOUR, 6);
  await ship(M, W2, hc[3], t0 + 5 * HOUR, 7);
  await ship(W2, W1, hc[2], t0 + 1 * DAY, 18);
  await ship(W1, R1, hc[0], t0 + 2 * DAY, 3);
  await ship(W1, R2, hc[1], t0 + 2 * DAY + HOUR, 4);
  await ship(W2, R3, hc[3], t0 + 1 * DAY + 2 * HOUR, 2);

  // ---- the main demo batch: 48 tablets strips, two cartons of 24 on one pallet
  const t1 = t0 + 3 * DAY;
  const main = await makeBatch("B-1024", "PCM-500", "Paracetamol 500 mg, strip of 10", "2026-10-12", "2028-10-11", 48, t1);
  const c1 = await pack(M, "carton", main.slice(0, 24), t1 + HOUR);
  const c2 = await pack(M, "carton", main.slice(24), t1 + HOUR + 1000);
  const pal = await pack(M, "pallet", [c1, c2], t1 + 2 * HOUR);
  await ship(M, W1, pal, t1 + 3 * HOUR, 23);
  await scan(W1, pal, "CONDITION", t1 + 27 * HOUR, { ok: true, reading: "24 °C, dry", note: "Seal intact" });
  await scan(W1, pal, "UNPACKED", t1 + 2 * DAY, {});
  await scan(W1, c1, "STORED", t1 + 2 * DAY + HOUR, { zone: "Rack B-4" });
  await ship(W1, R1, c1, t1 + 4 * DAY, 3);
  await scan(R1, c1, "UNPACKED", t1 + 4 * DAY + 4 * HOUR, {});
  for (const id of main.slice(0, 3)) await scan(R1, id, "SPOT_CHECK", t1 + 4 * DAY + 5 * HOUR, { carton: c1 });
  await scan(R1, main[0], "SOLD", t1 + 5 * DAY, {});
  await scan(R1, main[1], "SOLD", t1 + 5 * DAY + 2 * HOUR, {});
  // Carton 2 is on the road to Secunderabad right now.
  await ship(W1, R2, c2, Date.now() - 2 * HOUR, 0, false);

  // ---- a batch close to expiry, for the AVL range query (topic 12), and one with a cold-chain breach
  const soon = new Date(Date.now() + 20 * DAY).toISOString().slice(0, 10);
  const vax = await makeBatch("B-0871", "INS-10", "Insulin vial 10 ml", "2025-11-14", soon, 6, t0 + DAY);
  const vc = await pack(M, "carton", vax, t0 + DAY + HOUR);
  await ship(M, W2, vc, t0 + 2 * DAY, 7);
  await scan(W2, vc, "CONDITION", t0 + 2 * DAY + 9 * HOUR, { ok: false, reading: "14 °C for 3 h", note: "Cold room door left open" });

  // ---- a buyer complaint and a clone alert, so the alerts heap has content
  const sold = main[0];
  await call("POST", "/complaints", { unit: sold, reason: "damaged", text: "Strip was torn at one end when I opened the box.", device: "demo-phone-1", code: claimCodes[sold], verdict: "GENUINE" });
  await call("POST", "/claim", { unit: sold, code: claimCodes[sold], device: "demo-phone-1" });

  await indexes();
  return {
    seeded: true,
    passphrase: DEMO_PASSPHRASE,
    accounts: [{ handle: "regulator", role: "regulator" }, ...people.map(([handle, name, role]) => ({ handle, name, role }))],
    samples: { item: sold, claimCode: claimCodes[sold], unsoldItem: main[5], payload: encodePayload({ f: (await d.query("SELECT fields FROM units WHERE id = $1", [main[5]]))[0].fields, sig: (await d.query("SELECT sig FROM units WHERE id = $1", [main[5]]))[0].sig }), carton: c1, inTransit: c2, pallet: pal },
    claimCodes,
  };
}
