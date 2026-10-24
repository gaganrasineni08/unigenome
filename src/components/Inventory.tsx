import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { fmtDate } from "../lib/format";
import { Badge, Card, Empty, H2, Spinner } from "./ui";

export function Inventory({ title = "What you hold" }: { title?: string }) {
  const [rows, setRows] = useState<any[] | null>(null);
  useEffect(() => {
    api<any[]>("/inventory").then(setRows);
  }, []);
  if (!rows) return <Spinner />;
  const held = rows.filter((r) => !r.in_transit_to);
  const incoming = rows.filter((r) => r.in_transit_to);
  const row = (r: any) => (
    <li key={r.id} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-abyss/40 px-3 py-2">
      <div>
        <span className="mono text-sea">{r.id}</span>
        <span className="ml-2 text-sm text-mute">{r.kind === "item" ? r.product_name : `${r.kind} · ${r.children} inside`}</span>
      </div>
      <div className="flex gap-1">
        {r.sold_ts && <Badge tone="violet">sold</Badge>}
        {r.condition_bad && <Badge tone="coral">condition failed</Badge>}
        {r.kind === "item" && r.exp && <Badge>exp {fmtDate(r.exp)}</Badge>}
      </div>
    </li>
  );
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Card>
        <H2 right={<Badge tone="mint">{held.length}</Badge>}>{title}</H2>
        {held.length ? <ul className="space-y-2">{held.map(row)}</ul> : <Empty>Nothing here yet.</Empty>}
      </Card>
      <Card>
        <H2 right={<Badge tone="amber">{incoming.length}</Badge>}>On the way to you</H2>
        {incoming.length ? <ul className="space-y-2">{incoming.map(row)}</ul> : <Empty>No incoming shipments.</Empty>}
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
