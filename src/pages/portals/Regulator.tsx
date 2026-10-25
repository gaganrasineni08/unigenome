import { useEffect, useState } from "react";
import { Route, Routes } from "react-router-dom";
import { AlertsPanel } from "../../components/Alerts";
import { Approvals } from "../../components/Approvals";
import { BfsGraph } from "../../components/BfsGraph";
import { Gate, SignOutButton } from "../../components/Gate";
import { Shipments } from "../../components/Inventory";
import { Alert, Badge, Button, Card, Empty, Field, H1, H2, Input, Page, Select, Spinner, TopBar, useAsync } from "../../components/ui";
import { api } from "../../lib/api";
import { ROLE_LABEL, fmtDate } from "../../lib/format";
import { Complaints } from "./Complaints";

const COLOR = "#D96C6C";

export default function RegulatorPortal() {
  return (
    <Gate portal="regulator" roles={["regulator"]} color={COLOR}>
      <TopBar
        title="Regulator"
        color={COLOR}
        right={<SignOutButton />}
        tabs={[
          { to: "/regulator", label: "Alerts", end: true },
          { to: "/regulator/recall", label: "Recall" },
          { to: "/regulator/complaints", label: "Complaints" },
          { to: "/regulator/expiring", label: "Expiring" },
          { to: "/regulator/approvals", label: "New companies" },
          { to: "/regulator/parties", label: "Parties & keys" },
          { to: "/regulator/shipments", label: "Shipments" },
        ]}
      />
      <Page>
        <Routes>
          <Route index element={<><H1 sub="Every counterfeit scan, possible copy, failed condition check, overdue or diverted shipment and complaint lands here. A binary heap keeps the most severe, then oldest, on top.">Alerts</H1><AlertsPanel showHeap /></>} />
          <Route path="recall" element={<Recall />} />
          <Route path="complaints" element={<Complaints />} />
          <Route path="expiring" element={<Expiring />} />
          <Route path="approvals" element={<><H1 sub="You are the head of the network. Every new manufacturer, warehouse and retailer waits here until you have checked its licence, GSTIN and documents. Approving means signing its public key.">New company registrations</H1><Approvals /></>} />
          <Route path="parties" element={<Parties />} />
          <Route path="shipments" element={<Shipments />} />
        </Routes>
      </Page>
    </Gate>
  );
}

function Recall() {
  const [batches, setBatches] = useState<any[]>([]);
  const [batch, setBatch] = useState("");
  const [budget, setBudget] = useState(10);
  const [staff, setStaff] = useState(3);
  const [r, setR] = useState<any>(null);
  const { busy, error, run } = useAsync();
  useEffect(() => {
    api<any[]>("/batches").then((b) => { setBatches(b); setBatch(b.find((x) => x.id === "B-1024")?.id ?? b[0]?.id ?? ""); });
  }, []);
  const analyse = () => run(async () => setR(await api(`/recall/${batch}?budget=${budget}&staff=${staff}`)));
  useEffect(() => {
    if (batch) analyse();
  }, [batch, budget, staff]);
  const names = Object.fromEntries((r?.candidates ?? []).map((c: any) => [c.id, c.name]));
  return (
    <>
      <H1 sub="BFS over the real shipment records finds everyone the batch reached. A dynamic program then picks which sites to inspect within your budget and inspector count.">Recall a batch</H1>
      <Card>
        <div className="grid gap-4 md:grid-cols-[1.4fr_1fr_1fr_auto] md:items-end">
          <Field label="Batch">
            <Select value={batch} onChange={(e) => setBatch(e.target.value)}>
              {batches.map((b) => <option key={b.id} value={b.id}>{b.id} · {b.product_name} {b.status === "recalled" ? "(recalled)" : ""}</option>)}
            </Select>
          </Field>
          <Field label={`Budget: ₹${budget}k`}><input type="range" min={2} max={30} value={budget} onChange={(e) => setBudget(Number(e.target.value))} className="w-full accent-[#02C39A]" /></Field>
          <Field label={`Inspectors: ${staff}`}><input type="range" min={1} max={8} value={staff} onChange={(e) => setStaff(Number(e.target.value))} className="w-full accent-[#02C39A]" /></Field>
          {r?.batch?.status !== "recalled" ? (
            <Button variant="danger" busy={busy} onClick={() => run(async () => { await api(`/recall/${batch}`, { body: {} }); await analyse(); })}>Recall batch</Button>
          ) : (
            <Badge tone="coral">Recalled</Badge>
          )}
        </div>
        {error && <div className="mt-3"><Alert>{error}</Alert></div>}
      </Card>
      {!r ? (
        <div className="mt-6"><Spinner /></div>
      ) : (
        <div className="mt-6 space-y-6">
          <Card>
            <H2 right={<Badge tone="teal">{r.bfs.order.length} parties reached · {r.soldUnits} sold to buyers</Badge>}>1 · Where the batch went (BFS)</H2>
            {r.bfs.order.length <= 1 ? <Empty>This batch hasn't left the factory.</Empty> : <BfsGraph graph={r.graph} bfs={r.bfs} />}
          </Card>
          <Card>
            <H2>2 · Who to inspect (0/1 knapsack, two limits)</H2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wider text-mute">
                  <tr><th className="py-2">Site</th><th>Units held</th><th>Complaints</th><th>Alerts</th><th>Distance</th><th>Cost ₹k</th><th>Inspectors</th><th>Risk</th><th>DP</th><th>Greedy</th></tr>
                </thead>
                <tbody>
                  {r.candidates.map((c: any) => (
                    <tr key={c.id} className="border-t border-line">
                      <td className="py-2">{c.name}</td>
                      <td>{c.held}</td><td>{c.complaints}</td><td>{c.alerts}</td><td>{c.km} km</td><td>{c.cost}</td><td>{c.staff}</td>
                      <td className="font-semibold">{c.risk}</td>
                      <td>{r.dp.chosen.includes(c.id) ? <span className="text-mint">✓</span> : ""}</td>
                      <td>{r.greedy.chosen.includes(c.id) ? <span className="text-amber">✓</span> : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-mute">Risk = 10 × complaints + 5 × alerts + units held + 1. Cost = 1 + distance from your office ÷ 50 km, in ₹ thousands. Two inspectors for sites holding more than 20 units.</p>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-mint/40 bg-mint/10 p-4">
                <div className="text-xs font-semibold uppercase tracking-wider text-mint">Dynamic programming (exact)</div>
                <div className="font-display text-3xl">{r.dp.risk} risk covered</div>
                <div className="text-sm text-mute">₹{r.dp.cost}k, {r.dp.staff} inspectors · {r.dp.chosen.map((id: string) => names[id]).join(", ") || "nothing fits"}</div>
              </div>
              <div className="rounded-xl border border-amber/40 bg-amber/10 p-4">
                <div className="text-xs font-semibold uppercase tracking-wider text-amber">Greedy by risk per ₹ (baseline)</div>
                <div className="font-display text-3xl">{r.greedy.risk} risk covered</div>
                <div className="text-sm text-mute">₹{r.greedy.cost}k, {r.greedy.staff} inspectors · {r.greedy.chosen.map((id: string) => names[id]).join(", ") || "nothing fits"}</div>
              </div>
            </div>
            <details className="mt-4">
              <summary className="cursor-pointer text-sm text-mute">Show the DP table for {staff} inspectors ({r.dpCells.toLocaleString()} cells computed)</summary>
              <div className="mt-2 overflow-x-auto">
                <table className="mono text-[11px]">
                  <tbody>
                    <tr><td className="pr-2 text-mute">i \ b</td>{r.dpTable[0].map((_: any, b: number) => <td key={b} className="px-1 text-mute">{b}</td>)}</tr>
                    {r.dpTable.map((row: number[], i: number) => (
                      <tr key={i}><td className="pr-2 text-mute">{i === 0 ? "none" : names[r.candidates[i - 1].id]?.split(",")[0]}</td>{row.map((v, b) => <td key={b} className={`px-1 ${i === r.dpTable.length - 1 && b === row.length - 1 ? "text-mint font-bold" : ""}`}>{v}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </Card>
        </div>
      )}
    </>
  );
}

function Expiring() {
  const [days, setDays] = useState(30);
  const [r, setR] = useState<any>(null);
  useEffect(() => {
    api(`/expiring?days=${days}`, { auth: false }).then(setR);
  }, [days]);
  return (
    <>
      <H1 sub="A range query on an AVL tree keyed by expiry date: O(log n + k).">Expiring soon</H1>
      <Card>
        <Field label={`Within ${days} days`}><input type="range" min={7} max={1200} value={days} onChange={(e) => setDays(Number(e.target.value))} className="w-full accent-[#02C39A]" /></Field>
        {!r ? <Spinner /> : r.batches.length === 0 ? <div className="mt-3"><Empty>Nothing expires between {r.lo} and {r.hi}.</Empty></div> : (
          <ul className="mt-4 space-y-2">
            {r.batches.map((b: any) => (
              <li key={b.id} className="flex items-center justify-between rounded-xl border border-line bg-abyss/40 px-3 py-2">
                <span><span className="mono text-sea">{b.id}</span> {b.product_name}</span>
                <Badge tone="amber">expires {fmtDate(b.exp)}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

function Parties() {
  const [rows, setRows] = useState<any[] | null>(null);
  const { busy, error, run } = useAsync();
  const [q, setQ] = useState("");
  const load = () => api<any[]>("/parties", { auth: false }).then(setRows);
  useEffect(() => {
    load();
  }, []);
  if (!rows) return <Spinner />;
  return (
    <>
      <H1 sub="Revoking a key adds it to the revocation set. Every phone picks this up at its next sync, and codes signed by that key stop verifying.">Parties and keys</H1>
      {error && <Alert>{error}</Alert>}
      <Card>
        <Input placeholder="Filter" value={q} onChange={(e) => setQ(e.target.value)} className="mb-3" />
        <ul className="space-y-2">
          {rows.filter((p) => (p.name + p.handle).toLowerCase().includes(q.toLowerCase())).map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-abyss/40 p-3">
              <div>
                <div className="font-semibold">{p.name} <span className="text-xs text-mute">@{p.handle}</span></div>
                <div className="text-xs text-mute">{ROLE_LABEL[p.role]} · {p.id} · {p.sites.map((s: any) => s.name).join(", ")}</div>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={p.status === "approved" ? "mint" : p.status === "revoked" ? "coral" : "amber"}>{p.status}</Badge>
                {p.status === "approved" && p.role !== "regulator" && (
                  <Button variant="ghost" busy={busy} onClick={() => confirm(`Revoke the key of ${p.name}? Every code and record it ever signed will stop verifying.`) && run(async () => { await api(`/revoke/${p.id}`, { body: {} }); await load(); })}>Revoke key</Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
