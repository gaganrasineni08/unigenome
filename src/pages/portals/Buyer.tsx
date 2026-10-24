// Buyer side: no account. Scan, see the product's full history (read only), claim it, or raise a complaint.
import { useEffect, useState } from "react";
import { Link, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { decodePayload, payloadFromScan, signerOf, verifyUnit, type SignedUnit } from "../../../shared/identity";
import { JourneyMap, Timeline } from "../../components/Journey";
import { Scanner } from "../../components/Scanner";
import { VERDICTS, VerdictHero } from "../../components/Verdict";
import { Alert, Badge, Button, Card, Field, H1, H2, Input, Page, Select, Spinner, TextArea, TopBar, useAsync } from "../../components/ui";
import { api } from "../../lib/api";
import { deviceId } from "../../lib/device";
import { fmtDate, fmtDateTime } from "../../lib/format";
import { getGps } from "../../lib/geo";

const COLOR = "#8E7CC3";

/** Public keys cached on the phone, so the signature check works with no signal. */
async function keys(): Promise<{ parties: any[]; revoked: string[]; at: number; offline: boolean }> {
  try {
    const k = await api<any>("/keys", { auth: false });
    try {
      localStorage.setItem("ug.keys", JSON.stringify(k));
    } catch {
      /* ignore */
    }
    return { ...k, offline: false };
  } catch {
    try {
      const k = JSON.parse(localStorage.getItem("ug.keys") ?? "null");
      if (k) return { ...k, offline: true };
    } catch {
      /* ignore */
    }
    return { parties: [], revoked: [], at: 0, offline: true };
  }
}

function offlineCheck(text: string, k: Awaited<ReturnType<typeof keys>>) {
  let u: SignedUnit;
  try {
    u = decodePayload(payloadFromScan(text));
  } catch {
    return { ok: false, label: "Not a UniGenome code", unit: null };
  }
  const p = k.parties.find((x) => x.id === signerOf(u.f));
  if (!p) return { ok: false, label: "Unknown signer", unit: u };
  if (k.revoked.includes(p.id)) return { ok: false, label: "Signer's key was revoked", unit: u };
  return { ok: verifyUnit(u, p.publicKey), label: verifyUnit(u, p.publicKey) ? `Signed by ${p.name}` : "Signature does not match", unit: u };
}

export default function BuyerPortal() {
  return (
    <>
      <TopBar
        title="Buyer"
        color={COLOR}
        tabs={[
          { to: "/buyer", label: "Check a product", end: true },
          { to: "/buyer/complaint", label: "Track a complaint" },
        ]}
      />
      <Page>
        <Routes>
          <Route index element={<ScanHome />} />
          <Route path="complaint" element={<Track />} />
        </Routes>
      </Page>
    </>
  );
}

function ScanHome() {
  const nav = useNavigate();
  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    keys();
  }, []);
  return (
    <div className="mx-auto max-w-xl">
      <H1 sub="Point your camera at the QR on the pack. You'll see who made it, every place it has been, and whether it's genuine. You don't need an account.">Is it genuine?</H1>
      <Card>
        <Scanner onResult={(t) => nav("/v#" + payloadFromScan(t))} label="Scan the QR on the product" />
      </Card>
      <p className="mt-4 text-center text-xs text-mute">Tip: your phone's normal camera app also works. The QR opens this page directly.</p>
    </div>
  );
}

export function VerifyPage() {
  const loc = useLocation();
  const payload = decodeURIComponent(loc.hash.slice(1));
  const [offline, setOffline] = useState<ReturnType<typeof offlineCheck> | null>(null);
  const [res, setRes] = useState<any>(null);
  const [netError, setNetError] = useState<string | null>(null);
  const [where, setWhere] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    let alive = true;
    setRes(null);
    setNetError(null);
    (async () => {
      // T0 first, on the phone, with cached public keys: works offline.
      const k = await keys();
      if (!alive) return;
      setOffline(offlineCheck(payload, k));
      const gps = await getGps(6000);
      if (gps) setWhere({ lat: gps.lat, lng: gps.lng });
      try {
        const r = await api("/verify", { body: { text: payload, device: deviceId(), lat: gps?.lat, lng: gps?.lng }, auth: false });
        if (alive) setRes(r);
      } catch (e) {
        if (alive) setNetError((e as Error).message);
      }
    })();
    return () => {
      alive = false;
    };
  }, [payload]);

  return (
    <>
      <TopBar title="Buyer" color={COLOR} right={<Link to="/buyer"><Button variant="soft">Scan another</Button></Link>} />
      <Page>
        <div className="mx-auto max-w-3xl space-y-5">
          {!res && !netError && (
            <Card className="text-center">
              <Spinner />
              <p className="mt-3 text-sm text-mute">{offline ? (offline.ok ? `Signature check passed on your phone: ${offline.label}. Getting the full history…` : `Signature check failed: ${offline.label}`) : "Checking the signature on your phone…"}</p>
            </Card>
          )}
          {netError && offline && (
            <>
              <VerdictHero verdict={offline.ok ? "GENUINE" : "COUNTERFEIT"} />
              <Alert tone="amber">
                You're offline, so only the signature check ran ({offline.label}). Copy detection and the journey need a connection. Scan again when you're online.
              </Alert>
            </>
          )}
          {res && <Result res={res} where={where} offline={offline} />}
        </div>
      </Page>
    </>
  );
}

function Result({ res, offline }: { res: any; where?: unknown; offline: any }) {
  const v = res.view;
  const f = res.unit?.f;
  return (
    <>
      <VerdictHero verdict={res.verdict} />
      {res.reasons?.length > 0 && <Alert tone={res.verdict === "SUSPICIOUS_CLONE" ? "amber" : "coral"}>Why: {res.reasons.join("; ")}.</Alert>}

      {v?.batch && (
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-mute">{v.batch.category}</div>
              <div className="font-display text-2xl font-semibold">{v.batch.productName}</div>
              <div className="mt-1 text-sm text-mute">
                Made by <b className="text-ink">{v.batch.mfrName}</b> <Badge tone="mint">verified</Badge>
              </div>
            </div>
            <div className="text-right text-sm">
              <div className="mono text-sea">{v.id}</div>
              <div className="text-mute">Batch {v.batch.id}</div>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Info k="Manufactured" v={fmtDate(v.batch.mfg)} />
            <Info k="Expires" v={v.batch.exp ? fmtDate(v.batch.exp) : "No expiry"} />
            <Info k="Second signature" v={v.batch.qaBy ?? "missing"} />
            <Info k="Times scanned" v={String(v.scans)} />
          </div>
          {v.containers.length > 0 && <p className="mt-3 text-sm text-mute">Travelled inside: {v.containers.join(" → ")}</p>}
          {v.sold && <p className="mt-1 text-sm text-mute">Sold on {fmtDateTime(v.sold)}.</p>}
        </Card>
      )}

      <Card>
        <H2>Checks</H2>
        <ul className="space-y-1.5 text-sm">
          {offline && (
            <li className="flex gap-2">
              <span className={offline.ok ? "text-mint" : "text-coral"}>{offline.ok ? "✓" : "✕"}</span>
              <span>
                <Badge>T0</Badge> Signature checked on your phone (works offline)
              </span>
            </li>
          )}
          {res.checks.map((c: any, i: number) => (
            <li key={i} className="flex gap-2">
              <span className={c.ok ? "text-mint" : "text-coral"}>{c.ok ? "✓" : "✕"}</span>
              <span>
                <Badge>{c.tier}</Badge> {c.label}
                {c.detail && <span className="text-mute"> · {c.detail}</span>}
              </span>
            </li>
          ))}
          {v && (
            <li className="flex gap-2">
              <span className={v.chainCheck.ok ? "text-mint" : "text-coral"}>{v.chainCheck.ok ? "✓" : "✕"}</span>
              <span>Custody records unbroken (hash chain of {v.history.filter((h: any) => !h.via).length} records)</span>
            </li>
          )}
        </ul>
      </Card>

      {v && v.history.length > 0 && (
        <Card>
          <H2>Journey</H2>
          <JourneyMap history={v.history} />
          <div className="mt-5">
            <Timeline history={v.history} />
          </div>
        </Card>
      )}

      {f?.kind === "item" && res.verdict !== "COUNTERFEIT" && <Claim unit={f.id} claimed={v?.claimed} />}
      <Complain unit={f?.id ?? null} verdict={res.verdict} />
      <p className="text-center text-xs text-mute">This page is read only. Nothing here can change the product's records.</p>
    </>
  );
}

const Info = ({ k, v }: { k: string; v: string }) => (
  <div className="rounded-xl border border-line bg-abyss/40 p-2.5">
    <div className="text-xs text-mute">{k}</div>
    <div className="font-semibold">{v}</div>
  </div>
);

function Claim({ unit, claimed }: { unit: string; claimed: number | null }) {
  const [code, setCode] = useState("");
  const [done, setDone] = useState<any>(null);
  const { busy, error, run } = useAsync();
  if (claimed && !done)
    return (
      <Card>
        <H2>Claimed</H2>
        <p className="text-sm text-mute">This item was claimed by its buyer on {fmtDate(claimed)}. If you just bought it and didn't claim it, it may be a copy: raise a complaint below.</p>
      </Card>
    );
  return (
    <Card>
      <H2>Bought it? Claim it</H2>
      <p className="text-sm text-mute">Open the pack and type the hidden code printed inside. After that, anyone scanning a copy of this QR is told it was already claimed.</p>
      {done ? (
        <Alert tone={done.ok ? "mint" : "amber"}>{done.ok ? "Claimed. This item is now registered to this phone." : "This item was already claimed on another phone."}</Alert>
      ) : (
        <div className="mt-3 flex gap-2">
          <Input placeholder="XXXX-XXXX" value={code} onChange={(e) => setCode(e.target.value)} className="mono uppercase" />
          <Button busy={busy} onClick={() => run(async () => setDone(await api("/claim", { body: { unit, code, device: deviceId() }, auth: false })))}>
            Claim
          </Button>
        </div>
      )}
      {error && <div className="mt-2"><Alert>{error}</Alert></div>}
    </Card>
  );
}

function Complain({ unit, verdict }: { unit: string | null; verdict: string }) {
  const [open, setOpen] = useState(verdict === "COUNTERFEIT" || verdict === "SUSPICIOUS_CLONE");
  const [f, setF] = useState({ reason: verdict === "COUNTERFEIT" || verdict === "SUSPICIOUS_CLONE" ? "fake" : "damaged", text: "", contact: "", code: "" });
  const [sent, setSent] = useState<any>(null);
  const { busy, error, run } = useAsync();
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  return (
    <Card>
      <H2 right={!open && !sent && <Button variant="soft" onClick={() => setOpen(true)}>Raise a complaint</Button>}>Something wrong?</H2>
      {sent ? (
        <Alert tone="mint">
          Complaint <b className="mono">{sent.id}</b> sent{sent.withClaim ? " with your hidden code, so it's marked high priority" : ""}. Track it any time under{" "}
          <Link className="underline" to={`/buyer/complaint?id=${sent.id}`}>Track a complaint</Link>.
        </Alert>
      ) : (
        open && (
          <div className="grid gap-3">
            <Field label="What's the problem">
              <Select value={f.reason} onChange={set("reason")}>
                <option value="fake">I think it's fake</option>
                <option value="damaged">Damaged</option>
                <option value="expired">Expired or spoiled</option>
                <option value="wrong">Wrong product</option>
                <option value="other">Something else</option>
              </Select>
            </Field>
            <Field label="Describe it"><TextArea value={f.text} onChange={set("text")} maxLength={1000} /></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Hidden code from inside the pack (optional)" hint="Proves you hold the product, so we look at it first"><Input value={f.code} onChange={set("code")} className="mono uppercase" /></Field>
              <Field label="Phone or email (optional)"><Input value={f.contact} onChange={set("contact")} /></Field>
            </div>
            {error && <Alert>{error}</Alert>}
            <Button
              busy={busy}
              onClick={() =>
                run(async () => {
                  const gps = await getGps(4000);
                  setSent(await api("/complaints", { body: { ...f, unit, verdict, device: deviceId(), lat: gps?.lat, lng: gps?.lng }, auth: false }));
                })
              }
            >
              Send complaint
            </Button>
          </div>
        )
      )}
    </Card>
  );
}

function Track() {
  const [id, setId] = useState(new URLSearchParams(location.search).get("id") ?? "");
  const [c, setC] = useState<any>(null);
  const { busy, error, run } = useAsync();
  const look = () => run(async () => setC(await api("/complaints/" + id.trim(), { auth: false })));
  useEffect(() => {
    if (id) look();
  }, []);
  const label: Record<string, string> = { received: "Received", under_review: "Under review", resolved: "Resolved", rejected: "Rejected" };
  return (
    <div className="mx-auto max-w-xl">
      <H1>Track a complaint</H1>
      <Card>
        <div className="flex gap-2">
          <Input placeholder="CMP-XXXXXX" value={id} onChange={(e) => setId(e.target.value)} className="mono uppercase" />
          <Button busy={busy} onClick={look}>Look up</Button>
        </div>
        {error && <div className="mt-3"><Alert>{error}</Alert></div>}
        {c && (
          <div className="mt-5 space-y-2">
            <div className="flex items-center gap-2">
              <span className="mono text-sea">{c.id}</span>
              <Badge tone={c.status === "resolved" ? "mint" : c.status === "rejected" ? "mute" : "amber"}>{label[c.status]}</Badge>
            </div>
            <div className="text-sm text-mute">Raised {fmtDateTime(Number(c.ts))} about {c.unit_id}</div>
            <p className="text-sm">“{c.text}”</p>
            {c.response && <Alert tone="mint">Reply: {c.response}</Alert>}
            <div className="flex gap-1 pt-2">
              {["received", "under_review", "resolved"].map((s, i) => (
                <div key={s} className={`h-1.5 flex-1 rounded-full ${["received", "under_review", "resolved"].indexOf(c.status) >= i || (c.status === "rejected" && i < 1) ? "bg-mint" : "bg-white/10"}`} />
              ))}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

export { VERDICTS };
