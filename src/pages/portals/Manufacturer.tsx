import { labelStore } from "../../lib/labels";
import { useEffect, useMemo, useState } from "react";
import { Link, Route, Routes } from "react-router-dom";
import { randomBytes, toHex } from "../../../shared/bytes";
import { sha256Hex, signMessage } from "../../../shared/crypto";
import { encodePayload, signUnit, type ContainerFields, type ItemFields } from "../../../shared/identity";
import { signEvent, type EventBody } from "../../../shared/events";
import { merkleRoot } from "../../../shared/dsa/merkle";
import { AlertsPanel } from "../../components/Alerts";
import { Approvals } from "../../components/Approvals";
import { Gate, SignOutButton } from "../../components/Gate";
import { Inventory, Shipments } from "../../components/Inventory";
import { QrImage, verifyUrl } from "../../components/QrImage";
import { ScanAct } from "../../components/ScanAct";
import { Alert, Badge, Button, Card, Empty, Field, H1, H2, Input, Mono, Page, Select, Spinner, Stat, TopBar, useAsync } from "../../components/ui";
import { api } from "../../lib/api";
import { fmtDate } from "../../lib/format";
import { locate } from "../../lib/record";
import { useSession } from "../../lib/session";
import { Complaints } from "./Complaints";

const COLOR = "#02C39A";

export { labelStore };

export default function ManufacturerPortal() {
  return (
    <Gate portal="manufacturer" roles={["manufacturer", "qa"]} color={COLOR}>
      <Shell />
    </Gate>
  );
}

function Shell() {
  const { me } = useSession();
  const qa = me!.role === "qa";
  const tabs = qa
    ? [{ to: "/manufacturer", label: "Batches to approve", end: true }, { to: "/manufacturer/alerts", label: "Alerts" }]
    : [
        { to: "/manufacturer", label: "Overview", end: true },
        { to: "/manufacturer/batches", label: "1 · Batches" },
        { to: "/manufacturer/issue", label: "2 · Issue items" },
        { to: "/manufacturer/pack", label: "3 · Pack" },
        { to: "/manufacturer/labels", label: "4 · Labels" },
        { to: "/manufacturer/scan", label: "5 · Scan & dispatch" },
        { to: "/manufacturer/shipments", label: "Shipments" },
        { to: "/manufacturer/partners", label: "Staff" },
        { to: "/manufacturer/complaints", label: "Complaints" },
      ];
  return (
    <>
      <TopBar title={qa ? "Quality approver" : "Manufacturer"} color={COLOR} tabs={tabs} right={<SignOutButton />} />
      <Page>
        <Routes>
          {qa ? (
            <>
              <Route index element={<QaApprovals />} />
              <Route path="alerts" element={<AlertsPanel />} />
            </>
          ) : (
            <>
              <Route index element={<Overview />} />
              <Route path="batches" element={<Batches />} />
              <Route path="issue" element={<Issue />} />
              <Route path="pack" element={<Pack />} />
              <Route path="labels" element={<Labels />} />
              <Route path="scan" element={<><H1 sub="Scan a carton or pallet, then dispatch it. Destination and dispatch date are signed into the record.">Scan and dispatch</H1><ScanAct allowed={["DISPATCHED", "STORED", "CONDITION", "UNPACKED", "RECEIVED"]} /></>} />
              <Route path="shipments" element={<Shipments />} />
              <Route path="partners" element={<><H1 sub="Your quality approvers register themselves. You approve them by signing their public key. Warehouses and retailers are approved by the regulator.">Staff approvals</H1><Approvals /></>} />
              <Route path="complaints" element={<Complaints />} />
            </>
          )}
        </Routes>
      </Page>
    </>
  );
}

function Overview() {
  const { me } = useSession();
  const [batches, setBatches] = useState<any[] | null>(null);
  useEffect(() => {
    api<any[]>("/batches").then(setBatches);
  }, []);
  if (!batches) return <Spinner />;
  const steps = [
    ["Batches", "Create a batch. A quality approver must co-sign it.", "/manufacturer/batches"],
    ["Issue items", "Each item gets its own signed identity and a hidden claim code.", "/manufacturer/issue"],
    ["Pack", "Put items in cartons and cartons on pallets. One QR per box.", "/manufacturer/pack"],
    ["Labels", "Print the QR labels and the hidden codes for inside the pack.", "/manufacturer/labels"],
    ["Scan & dispatch", "Scan the pallet or carton and send it to a warehouse.", "/manufacturer/scan"],
  ];
  return (
    <>
      <H1 sub={me!.name}>Factory floor</H1>
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Batches" value={batches.length} />
        <Stat label="Items issued" value={batches.reduce((a, b) => a + b.issued, 0)} tone="#00A896" />
        <Stat label="Awaiting second signature" value={batches.filter((b) => b.status === "awaiting_qa").length} tone="#E8A33D" />
      </div>
      <div className="mt-6 grid gap-3 md:grid-cols-5">
        {steps.map(([t, d, to], i) => (
          <Link key={to} to={to} className="glass group rounded-2xl p-4 transition hover:-translate-y-1 hover:border-mint/50">
            <div className="font-display text-3xl text-mint/70">{i + 1}</div>
            <div className="mt-1 font-semibold">{t}</div>
            <div className="mt-1 text-sm text-mute">{d}</div>
          </Link>
        ))}
      </div>
      <div className="mt-6">
        <AlertsPanel />
      </div>
    </>
  );
}

const STATUS: Record<string, [string, any]> = {
  awaiting_qa: ["waiting for second signature", "amber"],
  approved: ["approved", "mint"],
  recalled: ["recalled", "coral"],
};

function BatchList({ batches, action }: { batches: any[]; action?: (b: any) => React.ReactNode }) {
  if (!batches.length) return <Empty>No batches yet.</Empty>;
  return (
    <ul className="space-y-2">
      {batches.map((b) => (
        <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-abyss/40 p-3">
          <div>
            <div><span className="mono text-sea">{b.id}</span> <span className="font-semibold">{b.product_name}</span></div>
            <div className="text-xs text-mute">
              {b.product_code} · made {fmtDate(b.mfg)} {b.exp && `· expires ${fmtDate(b.exp)}`} · {b.issued}/{b.quantity} issued
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge tone={STATUS[b.status]?.[1]}>{STATUS[b.status]?.[0] ?? b.status}</Badge>
            {action?.(b)}
          </div>
        </li>
      ))}
    </ul>
  );
}

function Batches() {
  const { me, secretKey } = useSession();
  const [batches, setBatches] = useState<any[]>([]);
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({ id: "B-" + (1100 + Math.floor(Math.random() * 800)), productCode: "", productName: "", category: "Pharmaceuticals", mfg: today, exp: "", quantity: "48" });
  const { busy, error, run } = useAsync();
  const load = () => api<any[]>("/batches").then(setBatches);
  useEffect(() => {
    load();
  }, []);
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  const create = () =>
    run(async () => {
      const body = { id: f.id.trim().toUpperCase(), mfr: me!.id, productCode: f.productCode.trim().toUpperCase(), productName: f.productName.trim(), category: f.category, mfg: f.mfg, exp: f.exp || undefined, quantity: Number(f.quantity) };
      await api("/batches", { body: { body, sig: signMessage("UG/batch", body, secretKey!) } });
      setF({ ...f, id: "B-" + (1100 + Math.floor(Math.random() * 800)), productCode: "", productName: "" });
      await load();
    });
  return (
    <>
      <H1 sub="A batch fixes the product, dates and the most items that may ever be issued under it. Codes beyond that limit are refused.">Batches</H1>
      <div className="grid gap-6 lg:grid-cols-[1fr_1.3fr]">
        <Card>
          <H2>New batch</H2>
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Batch id"><Input value={f.id} onChange={set("id")} /></Field>
              <Field label="Product code"><Input value={f.productCode} onChange={set("productCode")} placeholder="PCM-500" /></Field>
            </div>
            <Field label="Product name"><Input value={f.productName} onChange={set("productName")} placeholder="Paracetamol 500 mg, strip of 10" /></Field>
            <Field label="Category">
              <Select value={f.category} onChange={set("category")}>
                {["Pharmaceuticals", "Food", "Electronics", "Cosmetics", "Luxury goods", "Auto parts", "General"].map((c) => <option key={c}>{c}</option>)}
              </Select>
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Made on"><Input type="date" value={f.mfg} onChange={set("mfg")} /></Field>
              <Field label="Expires (optional)"><Input type="date" value={f.exp} onChange={set("exp")} /></Field>
              <Field label="Max items"><Input type="number" min={1} max={500} value={f.quantity} onChange={set("quantity")} /></Field>
            </div>
            {error && <Alert>{error}</Alert>}
            <Button busy={busy} onClick={create}>Sign and create batch</Button>
          </div>
        </Card>
        <Card>
          <H2>Your batches</H2>
          <BatchList batches={batches} />
        </Card>
      </div>
    </>
  );
}

function QaApprovals() {
  const { secretKey } = useSession();
  const [batches, setBatches] = useState<any[] | null>(null);
  const { busy, error, run } = useAsync();
  const load = () => api<any[]>("/batches").then(setBatches);
  useEffect(() => {
    load();
  }, []);
  if (!batches) return <Spinner />;
  return (
    <>
      <H1 sub="No batch can issue codes until you co-sign it. This stops one person inside the company from printing extra genuine codes.">Second signature</H1>
      {error && <Alert>{error}</Alert>}
      <Card>
        <BatchList
          batches={batches}
          action={(b) =>
            b.status === "awaiting_qa" && (
              <Button busy={busy} onClick={() => run(async () => { await api(`/batches/${b.id}/approve`, { body: { sig: signMessage("UG/batch-qa", { batch: b.id, sig: b.sig }, secretKey!) } }); await load(); })}>
                Co-sign
              </Button>
            )
          }
        />
      </Card>
    </>
  );
}

function Issue() {
  const { me, secretKey } = useSession();
  const [batches, setBatches] = useState<any[]>([]);
  const [pick, setPick] = useState("");
  const [n, setN] = useState("24");
  const [done, setDone] = useState<{ batch: string; ids: string[]; items: Array<{ id: string; payload: string; code: string }> } | null>(null);
  const [progress, setProgress] = useState(0);
  const { busy, error, run } = useAsync();
  const load = () => api<any[]>("/batches").then((b) => { setBatches(b); if (!pick) setPick(b.find((x) => x.status === "approved" && x.issued < x.quantity)?.id ?? ""); });
  useEffect(() => {
    load();
  }, []);
  const batch = batches.find((b) => b.id === pick);
  useEffect(() => {
    if (batch) setN(String(Math.min(24, batch.quantity - batch.issued)));
  }, [pick, batches.length]);
  const issue = () =>
    run(async () => {
      if (!batch) throw new Error("Pick a batch");
      const count = Math.min(Number(n), batch.quantity - batch.issued);
      if (!(count > 0)) throw new Error("Nothing left to issue in this batch");
      const where = await locate(me!);
      const codes: Record<string, string> = {};
      const items: any[] = [];
      for (let i = 1; i <= count; i++) {
        const num = batch.issued + i;
        const f: ItemFields = { kind: "item", id: `${batch.id}-${String(num).padStart(3, "0")}`, batch: batch.id, mfr: me!.id, product: batch.product_code, mfg: batch.mfg, salt: toHex(randomBytes(8)) };
        if (batch.exp) f.exp = batch.exp;
        const claim = toHex(randomBytes(4)).toUpperCase();
        codes[f.id] = claim;
        const body: EventBody = { unit: f.id, type: "MANUFACTURED", actor: me!.id, ts: Date.now(), lat: where.fix.lat, lng: where.fix.lng, acc: where.fix.acc, site: where.site?.id ?? null, prev: "0", data: {} };
        items.push({ unit: signUnit(f, secretKey!), claimHash: sha256Hex("claim:" + f.id + ":" + claim), event: { body, sig: signEvent(body, secretKey!) } });
        setProgress(Math.round((i / count) * 50));
      }
      for (let i = 0; i < items.length; i += 100) {
        await api("/items", { body: { batch: batch.id, items: items.slice(i, i + 100) } });
        setProgress(50 + Math.round(((i + 100) / items.length) * 50));
      }
      labelStore.add(batch.id, codes);
      setDone({ batch: batch.id, ids: Object.keys(codes), items: items.map((it) => ({ id: it.unit.f.id, payload: encodePayload(it.unit), code: codes[it.unit.f.id] })) });
      await load();
    });
  return (
    <>
      <H1 sub="Your browser builds each item's DNA0 (SHA-256 of its fields), signs it with your key, and makes a hidden claim code. The server keeps only a hash of the claim code.">Issue items</H1>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <div className="grid gap-3">
            <Field label="Approved batch">
              <Select value={pick} onChange={(e) => setPick(e.target.value)}>
                <option value="">Choose…</option>
                {batches.filter((b) => b.status === "approved").map((b) => (
                  <option key={b.id} value={b.id} disabled={b.issued >= b.quantity}>{b.id} · {b.product_name} ({b.quantity - b.issued} left)</option>
                ))}
              </Select>
            </Field>
            <Field label="How many items"><Input type="number" min={1} value={n} onChange={(e) => setN(e.target.value)} /></Field>
            {error && <Alert>{error}</Alert>}
            <Button busy={busy} onClick={issue}>Sign and issue</Button>
            {busy && <div className="h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-mint transition-all" style={{ width: progress + "%" }} /></div>}
            {batches.some((b) => b.status === "awaiting_qa") && <p className="text-sm text-amber">Some batches are still waiting for the quality approver's signature.</p>}
          </div>
        </Card>
        <Card className="h-fit">
          <H2>How it goes</H2>
          <ol className="list-decimal space-y-1.5 pl-5 text-sm text-mute">
            <li><b className="text-ink">Issue</b>: every item gets its own signed QR.</li>
            <li><b className="text-ink">Item QRs</b>: print them on the packs.</li>
            <li><b className="text-ink">Carton</b>: put the items in cartons; each carton gets <i>one</i> QR that stands for all of them.</li>
            <li><b className="text-ink">Pallet</b> (optional): one QR for several cartons.</li>
            <li><b className="text-ink">Dispatch</b>: scan the carton or pallet and send it.</li>
          </ol>
        </Card>
      </div>
      {done && <AfterIssue key={done.batch + done.ids[0]} batch={done.batch} items={done.items} />}
    </>
  );
}

/** Pack a set of units into one signed carton or pallet whose QR carries the Merkle root of its contents. */
async function packInto(me: any, secretKey: string, kind: "carton" | "pallet", ids: string[]) {
  const children = [...ids].sort();
  const f: ContainerFields = { kind, id: (kind === "carton" ? "C-" : "P-") + toHex(randomBytes(3)).toUpperCase(), by: me.id, count: children.length, root: merkleRoot(children), packed: new Date().toISOString() };
  const where = await locate(me);
  const body: EventBody = { unit: f.id, type: "PACKED", actor: me.id, ts: Date.now(), lat: where.fix.lat, lng: where.fix.lng, acc: where.fix.acc, site: where.site?.id ?? null, prev: "0", data: { count: children.length } };
  const unit = signUnit(f, secretKey);
  await api("/containers", { body: { unit, children, event: { body, sig: signEvent(body, secretKey) } } });
  return { id: f.id, payload: encodePayload(unit), count: children.length, children };
}

type Made = { id: string; payload: string; count: number; children: string[] };

/** Steps 2 to 4 right after issuing: the item QRs, then cartons (one QR each), then an optional pallet. */
function AfterIssue({ batch, items }: { batch: string; items: Array<{ id: string; payload: string; code: string }> }) {
  const { me, secretKey } = useSession();
  const [per, setPer] = useState(String(Math.min(12, items.length)));
  const [cartons, setCartons] = useState<Made[] | null>(null);
  const [pallet, setPallet] = useState<Made | null>(null);
  const { busy, error, run } = useAsync();
  const size = Math.max(1, Math.floor(Number(per) || 1));
  const groups = Math.ceil(items.length / size);

  const packCartons = () =>
    run(async () => {
      const out: Made[] = [];
      for (let i = 0; i < items.length; i += size) out.push(await packInto(me, secretKey!, "carton", items.slice(i, i + size).map((x) => x.id)));
      setCartons(out);
    });
  const packPallet = () =>
    run(async () => {
      setPallet(await packInto(me, secretKey!, "pallet", cartons!.map((c) => c.id)));
    });

  return (
    <div className="mt-6 space-y-6">
      <Card>
        <H2 right={<Badge tone="mint">{items.length} items</Badge>}>Step 2 · Item QR codes</H2>
        <p className="mb-4 text-sm text-mute">Each item has its own signed QR, printed on the pack. The hidden code under it goes <i>inside</i> the pack, for the buyer to claim the item.</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {items.map((it) => (
            <div key={it.id} className="rounded-xl bg-white p-2 text-center text-[#011f22]">
              <QrImage text={verifyUrl(it.payload)} size={120} className="mx-auto !p-0" />
              <div className="mono mt-1 text-xs font-semibold">{it.id}</div>
              <div className="mono text-[10px] text-[#55706d]">code {it.code.slice(0, 4)}-{it.code.slice(4)}</div>
            </div>
          ))}
        </div>
        <div className="mt-4"><Link to={`/manufacturer/labels?batch=${batch}`}><Button variant="soft">Open printable labels</Button></Link></div>
      </Card>

      <Card>
        <H2>Step 3 · Pack into cartons</H2>
        {!cartons ? (
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Items per carton"><Input type="number" min={1} value={per} onChange={(e) => setPer(e.target.value)} className="!w-32" /></Field>
            <Button busy={busy} onClick={packCartons}>Sign and pack into {groups} carton{groups > 1 ? "s" : ""}</Button>
            {error && <Alert>{error}</Alert>}
          </div>
        ) : (
          <>
            <p className="mb-4 text-sm text-mute">One QR per carton. It carries the Merkle root of the items inside, so scanning this one code updates all of them.</p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {cartons.map((c) => (
                <div key={c.id} className="rounded-2xl border border-mint/40 bg-mint/5 p-4 text-center">
                  <QrImage text={verifyUrl(c.payload)} size={170} className="mx-auto" />
                  <div className="mono mt-2 text-lg font-semibold">{c.id}</div>
                  <div className="text-sm text-mint">one QR for {c.count} items</div>
                  <div className="mono mt-1 text-[11px] text-mute">{c.children[0]} … {c.children[c.children.length - 1]}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </Card>

      {cartons && (
        <Card>
          <H2>Step 4 · Pallet (optional) and dispatch</H2>
          {!pallet ? (
            <div className="flex flex-wrap gap-2">
              {cartons.length > 1 && <Button busy={busy} onClick={packPallet}>Put all {cartons.length} cartons on one pallet</Button>}
              {cartons.length > 1 && <Link to="/manufacturer/scan"><Button variant="soft">Skip: dispatch cartons separately →</Button></Link>}
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-6">
              <div className="rounded-2xl border border-sea/40 bg-sea/5 p-4 text-center">
                <QrImage text={verifyUrl(pallet.payload)} size={190} className="mx-auto" />
                <div className="mono mt-2 text-lg font-semibold">{pallet.id}</div>
                <div className="text-sm text-sea">one QR for {pallet.count} cartons · {items.length} items</div>
              </div>
              <div className="max-w-sm text-sm text-mute">
                <p>Scan this pallet QR when you dispatch it: the record covers every carton and item on it.</p>
                <Link to={`/manufacturer/scan?unit=${pallet.id}&do=DISPATCHED`}><Button className="mt-3">Dispatch this pallet →</Button></Link>
              </div>
            </div>
          )}
          {!pallet && cartons.length === 1 && (
            <div className="mt-3"><Link to={`/manufacturer/scan?unit=${cartons[0].id}&do=DISPATCHED`}><Button>Dispatch this carton →</Button></Link></div>
          )}
          {error && <div className="mt-3"><Alert>{error}</Alert></div>}
        </Card>
      )}
    </div>
  );
}

function Pack() {
  const { me, secretKey } = useSession();
  const [inv, setInv] = useState<any[] | null>(null);
  const [kind, setKind] = useState<"carton" | "pallet">("carton");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [made, setMade] = useState<{ id: string; payload: string; count: number } | null>(null);
  const { busy, error, run } = useAsync();
  const load = () => api<any[]>("/inventory").then((r) => setInv(r.filter((x) => !x.in_transit_to && !x.sold_ts)));
  useEffect(() => {
    load();
  }, []);
  const choices = useMemo(() => (inv ?? []).filter((u) => u.kind === (kind === "carton" ? "item" : "carton")), [inv, kind]);
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const pack = () =>
    run(async () => {
      const children = [...sel].sort();
      if (!children.length) throw new Error("Select what goes inside");
      const f: ContainerFields = { kind, id: (kind === "carton" ? "C-" : "P-") + toHex(randomBytes(3)).toUpperCase(), by: me!.id, count: children.length, root: merkleRoot(children), packed: new Date().toISOString() };
      const where = await locate(me!);
      const body: EventBody = { unit: f.id, type: "PACKED", actor: me!.id, ts: Date.now(), lat: where.fix.lat, lng: where.fix.lng, acc: where.fix.acc, site: where.site?.id ?? null, prev: "0", data: { count: children.length } };
      const unit = signUnit(f, secretKey!);
      await api("/containers", { body: { unit, children, event: { body, sig: signEvent(body, secretKey!) } } });
      setMade({ id: f.id, payload: encodePayload(unit), count: children.length });
      setSel(new Set());
      await load();
    });
  if (!inv) return <Spinner />;
  return <PackView {...{ kind, setKind, choices, sel, setSel, toggle, pack, busy, error, made }} />;
}

export function PackView({ kind, setKind, choices, sel, setSel, toggle, pack, busy, error, made }: any) {
  return (
    <>
      <H1 sub="The box's QR carries a Merkle root of everything inside, signed by you. Scanning the box later updates every item in it.">Pack</H1>
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Button variant={kind === "carton" ? "primary" : "soft"} onClick={() => { setKind("carton"); setSel(new Set()); }}>Items → carton</Button>
            <Button variant={kind === "pallet" ? "primary" : "soft"} onClick={() => { setKind("pallet"); setSel(new Set()); }}>Cartons → pallet</Button>
            <span className="ml-auto text-sm text-mute">{sel.size} selected</span>
          </div>
          {choices.length === 0 ? (
            <Empty>No loose {kind === "carton" ? "items" : "cartons"} to pack.</Empty>
          ) : (
            <>
              <div className="mb-2 flex gap-2">
                {[12, 24, 48].map((k) => (
                  <Button key={k} variant="ghost" onClick={() => setSel(new Set(choices.slice(0, k).map((c: any) => c.id)))}>First {k}</Button>
                ))}
                <Button variant="ghost" onClick={() => setSel(new Set())}>Clear</Button>
              </div>
              <div className="grid max-h-96 grid-cols-2 gap-1.5 overflow-y-auto sm:grid-cols-3">
                {choices.map((c: any) => (
                  <button key={c.id} onClick={() => toggle(c.id)} className={`rounded-lg border px-2 py-1.5 text-left text-xs transition ${sel.has(c.id) ? "border-mint bg-mint/15" : "border-line hover:border-sea"}`}>
                    <div className="mono">{c.id}</div>
                    <div className="truncate text-mute">{c.kind === "item" ? c.product_name : `${c.children} items`}</div>
                  </button>
                ))}
              </div>
            </>
          )}
          {error && <div className="mt-3"><Alert>{error}</Alert></div>}
          <Button className="mt-4 w-full" busy={busy} onClick={pack}>Sign and pack {sel.size || ""} into a {kind}</Button>
        </Card>
        {made && (
          <Card className="text-center">
            <H2>{made.id}</H2>
            <QrImage text={verifyUrl(made.payload)} size={200} className="mx-auto" />
            <p className="mt-3 text-sm text-mute">{made.count} units inside. Print this on the outside of the {kind}.</p>
          </Card>
        )}
      </div>
    </>
  );
}

function Labels() {
  const [batches, setBatches] = useState<any[]>([]);
  const [pick, setPick] = useState(new URLSearchParams(location.search).get("batch") ?? "containers");
  const [rows, setRows] = useState<any[] | null>(null);
  useEffect(() => {
    api<any[]>("/batches").then(setBatches);
  }, []);
  useEffect(() => {
    setRows(null);
    api<any[]>(pick === "containers" ? "/labels" : "/labels?batch=" + pick).then(setRows);
  }, [pick]);
  const codes = pick === "containers" ? {} : labelStore.get(pick);
  const product = batches.find((b) => b.id === pick);
  return (
    <>
      <div className="no-print">
        <H1 sub="Outer QR goes on the pack. The hidden code is printed inside, under the seal, for the buyer to claim the item after buying it.">Labels</H1>
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <Field label="Print labels for">
            <Select value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="containers">Cartons and pallets</option>
              {batches.map((b) => <option key={b.id} value={b.id}>Items of {b.id} · {b.product_name}</option>)}
            </Select>
          </Field>
          <Button onClick={() => window.print()}>Print</Button>
        </div>
      </div>
      {!rows ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <Empty>No labels yet.</Empty>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 print:grid-cols-4 print:gap-2">
          {rows.map((r) => (
            <div key={r.id} className="rounded-xl bg-white p-3 text-center text-[#011f22] print:break-inside-avoid print:rounded-none print:border print:border-black/20">
              <QrImage text={verifyUrl(r.payload)} size={130} className="mx-auto !p-0" />
              <div className="mt-1 font-mono text-xs font-semibold">{r.id}</div>
              <div className="text-[10px] text-[#5B6F6C]">{r.kind === "item" ? product?.product_name : `${r.kind} · ${r.count} inside`}</div>
              {r.kind === "item" && (
                <div className="mt-2 rounded border border-dashed border-[#5B6F6C] px-1 py-1 text-[10px]">
                  Inside the pack · hidden code
                  <div className="font-mono text-sm font-bold tracking-widest">{codes[r.id] ? codes[r.id].slice(0, 4) + "-" + codes[r.id].slice(4) : "not on this device"}</div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
