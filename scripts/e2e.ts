// End-to-end check of the whole website's back end: every feature, through the same HTTP API the browser uses,
// on a fresh in-memory database. Run: npm run e2e   (prints one line per check; exits with 1 if any fail)
process.env.PGLITE_DIR = "memory";

const { app } = await import("../server/app");
const { seedDemo, DEMO_PASSPHRASE } = await import("../server/seed");
const { db } = await import("../server/db");
const { generateKeyPair, signMessage } = await import("../shared/crypto");
const { encryptSecretKey, decryptSecretKey } = await import("../shared/keystore");
const { encodePayload, signUnit } = await import("../shared/identity");
const { signEvent } = await import("../shared/events");
const { merkleRoot, verifyProof } = await import("../shared/dsa/merkle");
const { gstinCheckChar } = await import("../shared/gstin");
const { randomBytes, toHex } = await import("../shared/bytes");
const { sha256Hex } = await import("../shared/crypto");

let passed = 0;
const failed: string[] = [];
let section = "";
const part = (name: string) => console.log(`\n${(section = name)}`);
function check(label: string, ok: unknown, detail?: unknown) {
  if (ok) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed.push(`${section}: ${label}`);
    console.log(`  ✗ ${label}${detail !== undefined ? "  →  " + JSON.stringify(detail).slice(0, 300) : ""}`);
  }
}

async function call(method: string, path: string, body?: unknown, token?: string) {
  const res = await app.request("/api" + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as any };
}
const ok = async (method: string, path: string, body?: unknown, token?: string) => {
  const r = await call(method, path, body, token);
  if (r.status >= 400) throw new Error(`${method} ${path} → ${r.status} ${r.json.error}`);
  return r.json;
};

interface Who { id: string; token: string; sk: string; site: { id: string; lat: number; lng: number } }

/** Sign in exactly like the browser: fetch the encrypted key, open it with the passphrase, sign the challenge. */
async function signIn(handle: string, pass = DEMO_PASSPHRASE): Promise<Who> {
  const ch = await ok("POST", "/auth/challenge", { handle });
  const sk = await decryptSecretKey(ch.encKey, pass);
  const sig = signMessage("UG/login", { nonce: ch.nonce, party: ch.partyId }, sk);
  const { token } = await ok("POST", "/auth/login", { partyId: ch.partyId, nonce: ch.nonce, sig });
  const me = await ok("GET", "/me", undefined, token);
  return { id: me.id, token, sk, site: me.sites[0] };
}

const head = async (unit: string) => (await (await db()).query("SELECT head FROM units WHERE id = $1", [unit]))[0].head;
const ev = (a: Who, unit: string, type: string, prev: string, data: Record<string, unknown> = {}) => {
  const body = { unit, type, actor: a.id, ts: Date.now(), lat: a.site.lat, lng: a.site.lng, acc: 10, site: a.site.id, prev, data } as any;
  return { body, sig: signEvent(body, a.sk) };
};
const scan = async (a: Who, unit: string, type: string, data: Record<string, unknown> = {}) =>
  call("POST", "/events", ev(a, unit, type, await head(unit), data), a.token);
async function pack(a: Who, kind: "carton" | "pallet", ids: string[], root?: string) {
  const children = [...ids].sort();
  const f = { kind, id: (kind === "carton" ? "C-" : "P-") + toHex(randomBytes(3)).toUpperCase(), by: a.id, count: children.length, root: root ?? merkleRoot(children), packed: new Date().toISOString() } as any;
  const r = await call("POST", "/containers", { unit: signUnit(f, a.sk), children, event: ev(a, f.id, "PACKED", "0", { count: children.length }) }, a.token);
  return { ...r, id: f.id };
}

// ------------------------------------------------------------------------------------------------

part("0. Demo data");
const seeded = await seedDemo({ reset: true });
check("demo companies, batches and ten days of signed history load through the API", seeded.seeded);

part("1. Sign-in (signature challenge, passphrase never sent)");
const reg = await signIn("regulator");
const M = await signIn("sunpharma");
const QA = await signIn("sunqa");
const W1 = await signIn("hydwarehouse");
const apollo = await signIn("apollo");
check("all demo accounts sign in with the passphrase", reg.token && M.token && QA.token && W1.token && apollo.token);
{
  const ch = await ok("POST", "/auth/challenge", { handle: "apollo" });
  let refused = false;
  try { await decryptSecretKey(ch.encKey, "wrong-pass"); } catch { refused = true; }
  check("a wrong passphrase cannot open the private key", refused);
  const sig = signMessage("UG/login", { nonce: ch.nonce, party: ch.partyId }, apollo.sk);
  await ok("POST", "/auth/login", { partyId: ch.partyId, nonce: ch.nonce, sig });
  const again = await call("POST", "/auth/login", { partyId: ch.partyId, nonce: ch.nonce, sig });
  check("a used challenge cannot be replayed", again.status === 401, again);
  const forged = await call("POST", "/auth/login", { partyId: ch.partyId, nonce: (await ok("POST", "/auth/challenge", { handle: "apollo" })).nonce, sig: signMessage("UG/login", { nonce: "x", party: ch.partyId }, W1.sk) });
  check("a signature from another key is refused", forged.status === 401, forged);
}

part("2. A new company registers; the regulator reviews its proofs");
const newKeys = generateKeyPair();
const g14 = "36AABCN1234K1Z";
const shopSite = { name: "Kukatpally store", lat: 17.4948, lng: 78.3996 };
{
  const proof = { licenceNo: "TS/RTL/2026/9001", gstin: g14 + gstinCheckChar(g14), address: "KPHB Colony, Hyderabad", contactName: "Test Owner", phone: "+91 9876543210", email: "owner@newshop.in", doc: { name: "licence.png", data: "data:image/png;base64,iVBORw0KGgo=" } };
  const noProof = await call("POST", "/register", { handle: "newshop2", name: "No Proof Shop", role: "retailer", publicKey: newKeys.publicKey, encKey: await encryptSecretKey(newKeys.secretKey, "newshop123"), site: shopSite });
  check("registration without company proofs is refused", noProof.status === 400, noProof);
  const r = await ok("POST", "/register", { handle: "newshop", name: "New Health Mart", role: "retailer", publicKey: newKeys.publicKey, encKey: await encryptSecretKey(newKeys.secretKey, "newshop123"), site: shopSite, proof });
  check("registration with proofs is accepted and starts as pending", r.status === "pending");
}
let shop = await signIn("newshop", "newshop123");
{
  const blocked = await call("POST", "/sites", { name: "x", lat: 1, lng: 1 }, shop.token);
  const dispatchTry = await scan(shop, "B-1024-010", "SOLD");
  check("a pending company cannot record scans", dispatchTry.status === 403, dispatchTry);
  void blocked;
  const queue = await ok("GET", "/approvals", undefined, reg.token);
  const mine = queue.find((p: any) => p.id === shop.id);
  const fast = queue.find((p: any) => p.handle === "fastpharma");
  check("the regulator sees the new company in the review queue", !!mine);
  check("its automatic checks all pass (GSTIN check digit, unique licence and GSTIN, document, site)", mine?.checks.every((c: any) => c.ok), mine?.checks);
  check("the seeded bad applicant fails the GSTIN check digit and the duplicate-licence check", fast && !fast.checks[0].ok && !fast.checks[1].ok, fast?.checks);
  const doc = await call("GET", `/approvals/${shop.id}/doc`, undefined, apollo.token);
  check("another company cannot open the proof document", doc.status === 404, doc);
  const notReg = await call("POST", `/approvals/${shop.id}`, { sig: signMessage("UG/endorse", { party: shop.id, role: "retailer", publicKey: newKeys.publicKey }, apollo.sk) }, apollo.token);
  check("only the regulator can approve a company", notReg.status === 403, notReg);
  const badSig = await call("POST", `/approvals/${shop.id}`, { sig: signMessage("UG/endorse", { party: shop.id, role: "retailer", publicKey: "00".repeat(32) }, reg.sk) }, reg.token);
  check("an approval whose signature doesn't cover this key is refused", badSig.status === 401, badSig);
  await ok("POST", `/approvals/${shop.id}`, { sig: signMessage("UG/endorse", { party: shop.id, role: "retailer", publicKey: newKeys.publicKey }, reg.sk) }, reg.token);
  check("the regulator signs and approves it", (await ok("GET", "/me", undefined, shop.token)).status === "approved");
  const rej = await ok("POST", `/approvals/${fast.id}/reject`, { reason: "GSTIN check digit is wrong" }, reg.token);
  check("the bad applicant is rejected with a reason", rej.ok);
}
shop = await signIn("newshop", "newshop123");

part("3. Batch with two-person approval, then item QRs");
const BID = "B-E2E1";
const body = { id: BID, mfr: M.id, productCode: "AMX-250", productName: "Amoxicillin 250 mg", category: "Pharmaceuticals", mfg: "2026-10-20", exp: "2028-10-19", quantity: 6 };
await ok("POST", "/batches", { body, sig: signMessage("UG/batch", body, M.sk) }, M.token);
const codes: Record<string, string> = {};
const makeItems = (from: number, to: number) => {
  const items: any[] = [];
  for (let i = from; i <= to; i++) {
    const f = { kind: "item", id: `${BID}-${String(i).padStart(3, "0")}`, batch: BID, mfr: M.id, product: body.productCode, mfg: body.mfg, exp: body.exp, salt: toHex(randomBytes(8)) } as any;
    codes[f.id] = toHex(randomBytes(4)).toUpperCase();
    items.push({ unit: signUnit(f, M.sk), claimHash: sha256Hex("claim:" + f.id + ":" + codes[f.id]), event: ev(M, f.id, "MANUFACTURED", "0") });
  }
  return items;
};
{
  const early = await call("POST", "/items", { batch: BID, items: makeItems(1, 6) }, M.token);
  check("items can't be issued before a second person approves the batch", early.status === 403, early);
  const selfApprove = await call("POST", `/batches/${BID}/approve`, { sig: "x" }, M.token);
  check("the manufacturer can't approve its own batch", selfApprove.status === 403, selfApprove);
  const b = (await (await db()).query("SELECT sig FROM batches WHERE id = $1", [BID]))[0];
  await ok("POST", `/batches/${BID}/approve`, { sig: signMessage("UG/batch-qa", { batch: BID, sig: b.sig }, QA.sk) }, QA.token);
  check("the quality approver co-signs it", true);
  const forged = makeItems(1, 1);
  forged[0].unit.f.product = "FAKE";
  const fr = await call("POST", "/items", { batch: BID, items: forged }, M.token);
  check("an item that doesn't match its batch is refused", fr.status === 400, fr);
  const issued = await ok("POST", "/items", { batch: BID, items: makeItems(1, 6) }, M.token);
  check("6 signed item QRs are issued", issued.issued === 6);
  const extra = await call("POST", "/items", { batch: BID, items: makeItems(7, 7) }, M.token);
  check("a 7th item is refused (issuance limit = batch quantity)", extra.status === 403, extra);
}
const items = Array.from({ length: 6 }, (_, i) => `${BID}-${String(i + 1).padStart(3, "0")}`);

part("4. Packing: one carton QR (Merkle root) for many items, then a pallet");
{
  const bad = await pack(M, "carton", items.slice(0, 3), merkleRoot(["X"]));
  check("a carton whose signed Merkle root doesn't match its contents is refused", bad.status === 400, bad.json);
}
const c1 = await pack(M, "carton", items.slice(0, 3));
const c2 = await pack(M, "carton", items.slice(3));
check("two cartons of 3 items are packed, each with one signed QR", c1.status === 200 && c2.status === 200, [c1.json, c2.json]);
const twice = await pack(M, "carton", [items[0]]);
check("an item already in a carton can't be packed again", twice.status === 400, twice.json);
const pal = await pack(M, "pallet", [c1.id, c2.id]);
check("the two cartons are packed onto a pallet", pal.status === 200, pal.json);

part("5. Dispatch to one chosen company (hash chain, Dijkstra arrival estimate)");
{
  const inner = await scan(M, items[0], "DISPATCHED", { to: W1.id });
  check("an item inside a carton can't be dispatched on its own", inner.status === 400, inner.json);
  const stale = await call("POST", "/events", ev(M, pal.id, "DISPATCHED", "0", { to: W1.id }), M.token);
  check("a record that doesn't link to the latest record (hash chain) is refused", stale.status === 409, stale.json);
  const d = await scan(M, pal.id, "DISPATCHED", { to: W1.id, ref: "TRK-E2E" });
  check("the pallet is dispatched to the Hyderabad warehouse", d.status === 200, d.json);
  check("an arrival estimate comes from Dijkstra on past delivery times", d.json.eta?.method === "dijkstra", d.json.eta);
  const notMine = await scan(apollo, pal.id, "DISPATCHED", { to: W1.id });
  check("a company that doesn't hold it can't dispatch it", notMine.status === 403, notMine.json);
}

part("6. Only the destination company can see and receive it; one scan moves every item");
{
  const peek = await ok("GET", "/units/" + pal.id, undefined, apollo.token);
  check("another company scanning the pallet sees only its id", peek.restricted === true && !peek.history, peek);
  const grab = await scan(apollo, pal.id, "RECEIVED");
  check("another company trying to receive it is refused", grab.status === 403, grab.json);
  const alerts = await ok("GET", "/alerts", undefined, reg.token);
  check("…and that attempt raises a 'diverted' alert", alerts.ordered.some((a: any) => a.kind === "diverted" && a.unit_id === pal.id));
  const full = await ok("GET", "/units/" + pal.id, undefined, W1.token);
  check("the destination company sees the full details", !full.restricted && full.contents.count === 6, full.contents);
  const rec = await scan(W1, pal.id, "RECEIVED");
  check("the destination receives it", rec.status === 200, rec.json);
  check("one pallet scan updated all 6 items inside (DFS of the packaging tree)", rec.json.itemsUpdated === 6, rec.json);
  const item = await ok("GET", "/units/" + items[4], undefined, W1.token);
  check("an item deep inside now shows the warehouse as its holder", item.custodian === W1.id, item.custodian);
  check("the pallet's hash chain verifies (every link, hash and signature)", full.chainCheck.ok);
}

part("7. Warehouse → shop, opening the carton, random spot check (Merkle proofs)");
let spot: any;
{
  check("the warehouse unpacks the pallet", (await scan(W1, pal.id, "UNPACKED")).status === 200);
  check("a condition check is recorded on the carton", (await scan(W1, c1.id, "CONDITION", { ok: true, reading: "23 °C" })).status === 200);
  const d = await scan(W1, c1.id, "DISPATCHED", { to: shop.id });
  check("carton 1 is dispatched to the newly approved shop", d.status === 200, d.json);
  check("the shop receives it", (await scan(shop, c1.id, "RECEIVED")).status === 200);
  const open = await scan(shop, c1.id, "UNPACKED");
  spot = open.json;
  check("the shop opens the carton and 3 items go on its shelf", open.json.released === 3, open.json);
  check("the server picks items to spot-check, each with a Merkle proof", open.json.spotCheck?.length >= 1);
  const s0 = open.json.spotCheck[0];
  check("the proof hashes up to the root signed on the carton's QR", verifyProof(s0.id, s0.proof, open.json.root));
  check("a proof for an item that wasn't in the carton does not", !verifyProof(items[5], s0.proof, open.json.root));
  const sc = await scan(shop, s0.id, "SPOT_CHECK", { carton: c1.id });
  check("the spot-check scan confirms the item belongs", sc.json.belongs === true, sc.json);
  const swap = await scan(shop, items[0], "SPOT_CHECK", { carton: c2.id });
  check("an item claimed to be from the wrong carton is flagged", swap.json.belongs === false, swap.json);
  const alerts = await ok("GET", "/alerts", undefined, reg.token);
  check("…and raises a severity-5 'swap' alert", alerts.ordered.some((a: any) => a.kind === "swap" && Number(a.severity) === 5));
}

part("8. Sale at the shop");
{
  check("the shop sells item 1", (await scan(shop, items[0], "SOLD")).status === 200);
  const again = await scan(shop, items[0], "SOLD");
  check("it can't be sold twice", again.status >= 400, again.json);
  const notHeld = await scan(shop, items[4], "SOLD");
  check("the shop can't sell an item it doesn't hold", notHeld.status === 403, notHeld.json);
}

part("9. Buyer: genuine product, details, expiry and the full journey");
const payload = async (id: string) => {
  const r = (await (await db()).query("SELECT fields, sig FROM units WHERE id = $1", [id]))[0];
  return location(encodePayload({ f: r.fields, sig: r.sig }));
};
const location = (p: string) => "http://localhost:5173/v#" + p;
const at = { lat: shopSite.lat + 0.001, lng: shopSite.lng };
{
  const v = await ok("POST", "/verify", { text: await payload(items[0]), device: "phone-A", ...at });
  check("the buyer's first scan is GENUINE", v.verdict === "GENUINE", v);
  check("the buyer sees the product name, batch, maker and expiry", v.view.batch.productName === body.productName && v.view.batch.exp === body.exp && !!v.view.batch.mfrName);
  const types = v.view.history.map((h: any) => h.type);
  check("the journey shows factory → warehouse → shop → sold, in time order (k-way merge)", ["MANUFACTURED", "PACKED", "DISPATCHED", "RECEIVED", "SOLD"].every((t) => types.includes(t)) && v.view.history.every((h: any, i: number, a: any[]) => i === 0 || a[i - 1].ts <= h.ts), types);
  const v2 = await ok("POST", "/verify", { text: await payload(items[0]), device: "phone-A", ...at });
  check("the same buyer scanning again on the same phone is still GENUINE (not a false alarm)", v2.verdict === "GENUINE", v2.reasons);
  const wrong = await call("POST", "/claim", { unit: items[0], code: "00000000", device: "phone-A" });
  check("a wrong hidden code is rejected", wrong.status === 400, wrong.json);
  const claim = await ok("POST", "/claim", { unit: items[0], code: codes[items[0]], device: "phone-A" });
  check("the right hidden code (from inside the pack) claims the item", claim.ok && !claim.already);
}

part("10. A copied QR is flagged");
{
  const v = await ok("POST", "/verify", { text: await payload(items[0]), device: "phone-B", ...at });
  check("another phone scanning the claimed item → SUSPICIOUS_CLONE", v.verdict === "SUSPICIOUS_CLONE", v);
  check("…with the reason 'already claimed by a buyer'", v.reasons.some((r: string) => r.includes("already claimed")), v.reasons);
  const shelf = items.slice(0, 3).find((id) => id !== items[0])!;
  const local = await ok("POST", "/verify", { text: await payload(shelf), device: "phone-C", ...at });
  check("an unsold item scanned in its shop is GENUINE", local.verdict === "GENUINE", local);
  const delhi = await ok("POST", "/verify", { text: await payload(shelf), device: "phone-D", lat: 28.6139, lng: 77.209 });
  check("the same item scanned in Delhi a moment later → SUSPICIOUS_CLONE", delhi.verdict === "SUSPICIOUS_CLONE", delhi);
  check("…reasons: impossible travel speed and far from its shop", delhi.reasons.some((r: string) => r.includes("too far")) && delhi.reasons.some((r: string) => r.includes("still at")), delhi.reasons);
  const alerts = await ok("GET", "/alerts", undefined, reg.token);
  check("both raise 'clone' alerts for the regulator", alerts.ordered.filter((a: any) => a.kind === "clone").length >= 2);
}

part("11. A fake or edited QR is caught");
{
  const real = await payload(items[5]);
  const p = real.split("#")[1];
  const i = Math.floor(p.length / 2);
  const tampered = real.split("#")[0] + "#" + p.slice(0, i) + (p[i] === "A" ? "B" : "A") + p.slice(i + 1);
  const v = await ok("POST", "/verify", { text: tampered, device: "phone-E" });
  check("one changed character → COUNTERFEIT", v.verdict === "COUNTERFEIT", v.checks);
  const junk = await ok("POST", "/verify", { text: "hello", device: "phone-E" });
  check("a QR that isn't ours → COUNTERFEIT", junk.verdict === "COUNTERFEIT");
  const other = generateKeyPair();
  const fake = { kind: "item", id: `${BID}-999`, batch: BID, mfr: M.id, product: "AMX-250", mfg: body.mfg, exp: body.exp, salt: "00" } as any;
  const forged = await ok("POST", "/verify", { text: location(encodePayload(signUnit(fake, other.secretKey))), device: "phone-E" });
  check("a QR signed with someone else's key → COUNTERFEIT", forged.verdict === "COUNTERFEIT");
  const neverIssued = await ok("POST", "/verify", { text: location(encodePayload(signUnit(fake, M.sk))), device: "phone-E" });
  check("a correctly signed code that was never issued → COUNTERFEIT (issuance log)", neverIssued.verdict === "COUNTERFEIT", neverIssued.checks);
}

part("12. Complaints");
{
  const c = await ok("POST", "/complaints", { unit: items[0], reason: "fake", text: "Tablets look different from usual.", device: "phone-A", code: codes[items[0]], verdict: "GENUINE" });
  check("a complaint gets a tracking number", /^CMP-/.test(c.id));
  check("proving the hidden code raises its priority", c.withClaim === true && c.severity === 5, c);
  const t = await ok("GET", "/complaints/" + c.id);
  check("the buyer can track it by number", t.status === "received");
  await ok("POST", "/complaints", { unit: items[0], reason: "other", text: "2", device: "phone-A" });
  await ok("POST", "/complaints", { unit: items[0], reason: "other", text: "3", device: "phone-A" });
  const spam = await call("POST", "/complaints", { unit: items[0], reason: "other", text: "4", device: "phone-A" });
  check("a 4th complaint from one phone within an hour is refused (spam limit)", spam.status === 409, spam.json);
  await ok("POST", `/complaints/${c.id}`, { status: "resolved", response: "Checked: genuine stock." }, reg.token);
  check("the regulator resolves it and the buyer sees the answer", (await ok("GET", "/complaints/" + c.id)).status === "resolved");
}

part("13. Alerts, most urgent first (binary heap)");
{
  const { ordered, array } = await ok("GET", "/alerts", undefined, reg.token);
  const sorted = ordered.every((a: any, i: number) => i === 0 || Number(ordered[i - 1].severity) > Number(a.severity) || (Number(ordered[i - 1].severity) === Number(a.severity) && Number(ordered[i - 1].ts) <= Number(a.ts)));
  check(`${ordered.length} open alerts come out highest severity first, then oldest`, sorted);
  const heapOk = array.every((a: any, i: number) => i === 0 || Number(array[(i - 1) >> 1].severity) >= Number(a.severity));
  check("the stored array satisfies the heap property (parent ≥ children)", heapOk);
  const shopAlerts = await ok("GET", "/alerts", undefined, apollo.token);
  check("a company sees only its own alerts", shopAlerts.ordered.every((a: any) => a.party_id === apollo.id));
}

part("14. Recall: BFS over shipments, knapsack DP vs greedy");
{
  const r = await ok("GET", `/recall/${BID}?budget=10&staff=3`, undefined, reg.token);
  check("BFS from the maker reaches the warehouse and the shop", r.bfs.order.includes(W1.id) && r.bfs.order.includes(shop.id), r.bfs.order);
  check("the DP choice fits the budget and inspectors", r.dp.cost <= 10 && r.dp.staff <= 3, r.dp);
  check("the DP total risk is at least the greedy one", r.dp.risk >= r.greedy.risk, { dp: r.dp.risk, greedy: r.greedy.risk });
  await ok("POST", `/recall/${BID}`, {}, reg.token);
  const v = await ok("POST", "/verify", { text: await payload(items[1]), device: "phone-F", ...at });
  check("after the recall, a buyer scan says RECALLED", v.verdict === "RECALLED", v.verdict);
}

part("15. Search (trie) and expiring soon (AVL tree)");
{
  const s = await ok("GET", "/search?q=" + BID);
  check("prefix search finds the batch and its 6 items", s.total >= 7 && s.keys.includes(BID), s);
  const e = await ok("GET", "/expiring?days=30");
  check("the AVL range query finds the batch expiring within 30 days", e.batches.some((b: any) => b.id === "B-0871"), e.batches.map((b: any) => b.id));
  const e2 = await ok("GET", "/expiring?days=3650");
  check("…and a 10-year range also includes the new batch", e2.batches.some((b: any) => b.id === BID));
}

part("16. Tamper-evident history");
{
  const t = await ok("GET", `/dsa/chain/${c1.id}?tamper=1`);
  check("changing the time on one old record breaks the chain at exactly that record", t.check.ok === false && t.check.brokenAt === 1, t.check);
  check("the untouched chain verifies", (await ok("GET", `/dsa/chain/${c1.id}`)).check.ok);
}

part("17. Revoking a stolen key");
{
  await ok("POST", `/revoke/${M.id}`, {}, reg.token);
  const v = await ok("POST", "/verify", { text: await payload(items[2]), device: "phone-G", ...at });
  check("after the regulator revokes the maker's key, its codes are rejected", v.verdict === "COUNTERFEIT" && v.checks.some((c: any) => c.label.includes("revoked")), v.checks);
}

console.log(`\n${passed} passed, ${failed.length} failed`);
if (failed.length) console.log("Failed:\n  " + failed.join("\n  "));
process.exit(failed.length ? 1 : 0);
