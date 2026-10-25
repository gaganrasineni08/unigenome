import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { fmtDate } from "../lib/format";
import { Badge, Card, Empty, H2, Spinner } from "./ui";

/** What a party holds. Each row links to the scan screen with that unit open and the likely next step chosen. */
export function Inventory({ title = "What you hold", scanPath, retail }: { title?: string; scanPath: string; retail?: boolean }) {
  const [rows, setRows] = useState<any[] | null>(null);
  useEffect(() => {
    api<any[]>("/inventory").then(setRows);
  }, []);
  if (!rows) return <Spinner />;
  const held = rows.filter((r) => !r.in_transit_to && !r.sold_ts);
  const sold = rows.filter((r) => r.sold_ts);
  const incoming = rows.filter((r) => r.in_transit_to);
  const next = (r: any): [string, string] | null =>
    r.sold_ts ? null
    : r.in_transit_to ? ["RECEIVED", "Receive"]
    : r.kind !== "item" ? (retail ? ["UNPACKED", "Open"] : ["DISPATCHED", "Dispatch"])
    : retail ? ["SOLD", "Sell"] : null;
  const row = (r: any) => {
    const n = next(r);
    return (
    <li key={r.id} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-abyss/40 px-3 py-2">
      <div>
        <span className="mono text-sea">{r.id}</span>
        <span className="ml-2 text-sm text-mute">{r.kind === "item" ? r.product_name : `${r.kind} · ${r.children} inside`}</span>
      </div>
      <div className="flex gap-1">
        {r.sold_ts && <Badge tone="violet">sold</Badge>}
        {r.condition_bad && <Badge tone="coral">condition failed</Badge>}
        {r.kind === "item" && r.exp && <Badge>exp {fmtDate(r.exp)}</Badge>}
        <Link to={`${scanPath}?unit=${r.id}${n ? "&do=" + n[0] : ""}`} className="rounded-lg bg-white/10 px-2.5 py-1 text-xs font-semibold hover:bg-mint hover:text-abyss">
          {n ? n[1] : "View"} →
        </Link>
      </div>
    </li>
    );
  };
  return (
    <div className="grid gap-6 md:grid-cols-2">
      {retail && (
        <div className="md:col-span-2 rounded-2xl border border-amber/40 bg-amber/10 p-4 text-sm">
          <b>What to do next:</b> the items below are on your shelf, ready to sell. When a customer buys one, press <b>Sell</b> next to it
          (or scan its QR on the Scan tab) and choose <b>Mark sold</b>. The sale is signed with your shop's location and time, so the buyer's
          phone shows “Sold at {"{your shop}"} on {"{date}"}”, and any copy of that QR seen somewhere else is flagged.
        </div>
      )}
      <Card>
        <H2 right={<Badge tone="mint">{held.length}</Badge>}>{title}</H2>
        {held.length ? <ul className="max-h-[70vh] space-y-2 overflow-y-auto pr-1">{held.map(row)}</ul> : <Empty>Nothing here yet.</Empty>}
      </Card>
      <Card>
        <H2 right={<Badge tone="amber">{incoming.length}</Badge>}>On the way to you</H2>
        {incoming.length ? <ul className="space-y-2">{incoming.map(row)}</ul> : <Empty>No incoming shipments.</Empty>}
        {sold.length > 0 && (
          <>
            <div className="mt-6"><H2 right={<Badge tone="violet">{sold.length}</Badge>}>Sold</H2></div>
            <ul className="max-h-[40vh] space-y-2 overflow-y-auto pr-1">{sold.map(row)}</ul>
          </>
        )}
      </Card>
    </div>
  );
}

export function Shipments() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  useEffect(() => {
    api<any[]>("/shipments").then(setRows);
    api<any[]>("/parties", { auth: false }).then((p) => setNames(Object.fromEntries(p.map((x) => [x.id, x.name]))));
  }, []);
  if (!rows) return <Spinner />;
  return (
    <Card>
      <H2>Shipments</H2>
      {rows.length === 0 ? (
        <Empty>No shipments yet.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-mute">
              <tr><th className="py-2">Unit</th><th>From</th><th>To</th><th>Dispatched</th><th>Expected by</th><th>Status</th></tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const late = s.status === "in_transit" && Number(s.eta_ts) < Date.now();
                return (
                  <tr key={s.id} className="border-t border-line">
                    <td className="py-2 mono text-sea">{s.unit_id}</td>
                    <td>{names[s.from_party] ?? s.from_party}</td>
                    <td>{names[s.to_party] ?? s.to_party}</td>
                    <td>{fmtDate(Number(s.dispatched_ts))}</td>
                    <td>{fmtDate(Number(s.eta_ts))}</td>
                    <td>
                      <Badge tone={s.status === "received" ? "mint" : s.status === "diverted" ? "coral" : late ? "coral" : "amber"}>
                        {late ? "overdue" : s.status.replace("_", " ")}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
