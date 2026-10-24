import { useEffect, useState } from "react";
import { signMessage } from "../../shared/crypto";
import { api } from "../lib/api";
import { ROLE_LABEL, fmtDateTime } from "../lib/format";
import { useSession } from "../lib/session";
import { Alert, Badge, Button, Card, Empty, H2, Mono, Spinner, useAsync } from "./ui";

/** Approving an account means signing its public key: an endorsement anyone can check later. */
export function Approvals() {
  const { secretKey } = useSession();
  const [rows, setRows] = useState<any[] | null>(null);
  const { busy, error, run } = useAsync();
  const load = () => api<any[]>("/approvals").then(setRows);
  useEffect(() => {
    load();
  }, []);
  if (!rows) return <Spinner />;
  return (
    <Card>
      <H2 right={<Badge tone="amber">{rows.length} waiting</Badge>}>Accounts waiting for approval</H2>
      {error && <Alert>{error}</Alert>}
      {rows.length === 0 ? (
        <Empty>No one is waiting.</Empty>
      ) : (
        <ul className="space-y-3">
          {rows.map((p) => (
            <li key={p.id} className="rounded-xl border border-line bg-abyss/40 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="font-semibold">{p.name}</div>
                  <div className="text-xs text-mute">
                    {ROLE_LABEL[p.role]} · @{p.handle} · registered {fmtDateTime(Number(p.created_at))}
                  </div>
                </div>
                <Button
                  busy={busy}
                  onClick={() =>
                    run(async () => {
                      const sig = signMessage("UG/endorse", { party: p.id, role: p.role, publicKey: p.public_key }, secretKey!);
                      await api(`/approvals/${p.id}`, { body: { sig } });
                      await load();
                    })
                  }
                >
                  Sign and approve
                </Button>
              </div>
              <div className="mt-2 text-xs text-mute">Public key</div>
              <Mono>{p.public_key}</Mono>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
