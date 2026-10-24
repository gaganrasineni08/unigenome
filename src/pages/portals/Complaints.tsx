import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { fmtDateTime } from "../../lib/format";
import { Badge, Button, Card, Empty, H1, Input, Spinner } from "../../components/ui";

const TONE: Record<string, any> = { received: "amber", under_review: "teal", resolved: "mint", rejected: "mute" };

export function Complaints() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [reply, setReply] = useState<Record<string, string>>({});
  const load = () => api<any[]>("/complaints").then(setRows);
  useEffect(() => {
    load();
  }, []);
  if (!rows) return <Spinner />;
  const set = (id: string, status: string) => api(`/complaints/${id}`, { body: { status, response: reply[id] } }).then(load);
  return (
    <>
      <H1 sub="Buyers raise these from the product page. Complaints that include the hidden code from inside the pack are ranked higher, because only someone holding the product has it.">Complaints</H1>
      {rows.length === 0 ? (
        <Empty>No complaints.</Empty>
      ) : (
        <div className="space-y-3">
          {rows.map((c) => (
            <Card key={c.id}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="mono text-sea">{c.id}</span>
                <Badge tone={TONE[c.status]}>{c.status.replace("_", " ")}</Badge>
                <Badge tone="coral">severity {c.severity}</Badge>
                {c.with_claim && <Badge tone="mint">hidden code verified</Badge>}
                <span className="ml-auto text-xs text-mute">{fmtDateTime(Number(c.ts))}</span>
              </div>
              <div className="mt-2 text-sm"><b className="capitalize">{c.reason}</b> on <span className="mono">{c.unit_id ?? "unknown item"}</span>{c.verdict && <span className="text-mute"> · scan said {c.verdict.toLowerCase().replace("_", " ")}</span>}</div>
              <p className="mt-1 text-sm text-mute">“{c.text}”</p>
              {c.contact && <p className="text-xs text-mute">Contact: {c.contact}</p>}
              {c.response && <p className="mt-2 text-sm">Response: {c.response}</p>}
              {["received", "under_review"].includes(c.status) && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Input className="min-w-60 flex-1" placeholder="Reply to the buyer (optional)" value={reply[c.id] ?? ""} onChange={(e) => setReply({ ...reply, [c.id]: e.target.value })} />
                  {c.status === "received" && <Button variant="soft" onClick={() => set(c.id, "under_review")}>Start review</Button>}
                  <Button onClick={() => set(c.id, "resolved")}>Resolve</Button>
                  <Button variant="ghost" onClick={() => set(c.id, "rejected")}>Reject</Button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
