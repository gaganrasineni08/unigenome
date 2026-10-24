import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { fmtDateTime } from "../lib/format";
import { Badge, Button, Card, Empty, H2, Spinner } from "./ui";

const SEV = ["", "#8fb3ae", "#00A896", "#E8A33D", "#8E7CC3", "#D96C6C"];

/** Open alerts, highest severity first: the order comes from popping a binary heap on the server. */
export function AlertsPanel({ showHeap = false }: { showHeap?: boolean }) {
  const [data, setData] = useState<{ ordered: any[]; array: any[] } | null>(null);
  const load = () => api("/alerts").then(setData);
  useEffect(() => {
    load();
  }, []);
  if (!data) return <Spinner />;
  return (
    <Card>
      <H2 right={<Badge tone="coral">{data.ordered.length} open</Badge>}>Alerts queue</H2>
      {showHeap && (
        <div className="mb-4 overflow-x-auto rounded-xl border border-line bg-abyss/60 p-3">
          <div className="mb-2 text-xs text-mute">Heap array as stored (index i has children 2i+1, 2i+2). The top is always the most urgent.</div>
          <div className="flex gap-1">
            {data.array.map((a, i) => (
              <div key={a.id} className="min-w-12 rounded-lg border px-2 py-1 text-center text-xs" style={{ borderColor: SEV[a.severity], color: SEV[a.severity] }}>
                <div className="text-[10px] text-mute">[{i}]</div>
                <div className="font-bold">{a.severity}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      {data.ordered.length === 0 ? (
        <Empty>No open alerts.</Empty>
      ) : (
        <ul className="space-y-2">
          {data.ordered.map((a) => (
            <li key={a.id} className="flex items-start gap-3 rounded-xl border border-line bg-abyss/40 p-3">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold" style={{ background: SEV[a.severity] + "30", color: SEV[a.severity] }}>
                {a.severity}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm">{a.message}</div>
                <div className="text-xs text-mute">
                  {a.kind} · {fmtDateTime(Number(a.ts))}
                </div>
              </div>
              <Button variant="ghost" onClick={() => api(`/alerts/${a.id}/close`, { body: {} }).then(load)}>
                Close
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
