import { useEffect, useState } from "react";
import { signMessage } from "../../shared/crypto";
import { api } from "../lib/api";
import { ROLE_LABEL, fmtDateTime } from "../lib/format";
import { useSession } from "../lib/session";
import { Alert, Badge, Button, Card, Empty, H2, Input, Mono, Spinner, useAsync } from "./ui";

/**
 * The review queue. The regulator (head of the network) sees every new company with its proofs and
 * automatic checks; approving means signing the company's public key, an endorsement anyone can check later.
 */
export function Approvals() {
  const [rows, setRows] = useState<any[] | null>(null);
  const load = () => api<any[]>("/approvals").then(setRows);
  useEffect(() => {
    load();
  }, []);
  if (!rows) return <Spinner />;
  return (
    <div className="space-y-4">
      <Card>
        <H2 right={<Badge tone="amber">{rows.length} waiting</Badge>}>Registrations waiting for review</H2>
        {rows.length === 0 ? <Empty>No one is waiting.</Empty> : <p className="text-sm text-mute">Check each company's details and document, then approve or reject. A rejected company is told the reason.</p>}
      </Card>
      {rows.map((p) => (
        <Review key={p.id} p={p} onDone={load} />
      ))}
    </div>
  );
}

function Review({ p, onDone }: { p: any; onDone: () => void }) {
  const { secretKey } = useSession();
  const { busy, error, run } = useAsync();
  const [doc, setDoc] = useState<{ url: string; type: string; name: string } | null>(null);
  const [checked, setChecked] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const pr = p.proof;
  const allOk = p.checks.every((c: any) => c.ok);

  useEffect(() => () => {
    if (doc) URL.revokeObjectURL(doc.url);
  }, [doc]);

  const openDoc = () =>
    run(async () => {
      const d = await api<{ name: string; type: string; data: string }>(`/approvals/${p.id}/doc`);
      // A blob URL lets the browser show PDFs inline; data URLs are blocked in frames.
      const blob = await (await fetch(d.data)).blob();
      setDoc({ url: URL.createObjectURL(blob), type: d.type, name: d.name });
    });

  const approve = () =>
    run(async () => {
      const sig = signMessage("UG/endorse", { party: p.id, role: p.role, publicKey: p.public_key }, secretKey!);
      await api(`/approvals/${p.id}`, { body: { sig } });
      onDone();
    });

  const reject = () =>
    run(async () => {
      await api(`/approvals/${p.id}/reject`, { body: { reason } });
      onDone();
    });

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-display text-xl font-semibold">{p.name}</div>
          <div className="text-sm text-mute">
            {ROLE_LABEL[p.role]} · @{p.handle} · registered {fmtDateTime(Number(p.created_at))}
          </div>
        </div>
        <Badge tone={allOk ? "mint" : "coral"}>{allOk ? "all checks passed" : "check the warnings"}</Badge>
      </div>

      {pr ? (
        <div className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <Row k="Licence no." v={<span className="mono">{pr.licenceNo}</span>} />
          <Row k="GSTIN" v={<span className="mono">{pr.gstin}</span>} />
          <Row k="Address" v={pr.address} />
          <Row k="Site" v={p.site_name ? `${p.site_name} (${Number(p.lat).toFixed(3)}, ${Number(p.lng).toFixed(3)})` : "none"} />
          <Row k="Contact" v={pr.contactName} />
          <Row k="Phone / email" v={`${pr.phone} · ${pr.email}`} />
          {pr.website && <Row k="Website" v={pr.website} />}
        </div>
      ) : (
        <p className="mt-3 text-sm text-mute">Quality approver for your company: no company documents needed.</p>
      )}

      <div className="mt-4 rounded-xl border border-line bg-abyss/40 p-3">
        <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-mute">Automatic checks</div>
        <ul className="space-y-1 text-sm">
          {p.checks.map((c: any, i: number) => (
            <li key={i} className="flex gap-2">
              <span className={c.ok ? "text-mint" : "text-coral"}>{c.ok ? "✓" : "✕"}</span>
              <span>
                {c.label}
                {c.detail && <span className="text-mute"> · {c.detail}</span>}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {pr?.doc && (
        <div className="mt-4">
          {!doc ? (
            <Button variant="soft" onClick={openDoc} busy={busy}>
              View document ({pr.doc.name})
            </Button>
          ) : (
            <div className="overflow-hidden rounded-xl border border-line bg-white">
              {doc.type === "application/pdf" ? (
                <iframe src={doc.url} title={doc.name} className="h-[480px] w-full" />
              ) : (
                <img src={doc.url} alt={doc.name} className="mx-auto max-h-[520px]" />
              )}
            </div>
          )}
        </div>
      )}

      <details className="mt-3 text-sm text-mute">
        <summary className="cursor-pointer">Public key</summary>
        <Mono>{p.public_key}</Mono>
      </details>

      {error && <div className="mt-3"><Alert>{error}</Alert></div>}

      {rejecting ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason, e.g. licence number doesn't match the certificate" className="flex-1" />
          <Button variant="danger" onClick={reject} busy={busy} disabled={!reason.trim()}>Reject</Button>
          <Button variant="ghost" onClick={() => setRejecting(false)}>Cancel</Button>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {pr && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="h-4 w-4 accent-[#02C39A]" />
              I have checked the document and details
            </label>
          )}
          <div className="ml-auto flex gap-2">
            <Button variant="soft" onClick={() => setRejecting(true)}>Reject…</Button>
            <Button onClick={approve} busy={busy} disabled={!!pr && !checked}>Sign and approve</Button>
          </div>
        </div>
      )}
    </Card>
  );
}

const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <div>
    <span className="text-mute">{k}: </span>
    {v}
  </div>
);
