import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { generateKeyPair } from "../../shared/crypto";
import { checkGstin } from "../../shared/gstin";
import { encryptSecretKey } from "../../shared/keystore";
import { api } from "../lib/api";
import { getGps } from "../lib/geo";
import { useSession } from "../lib/session";
import { Alert, Button, Card, Field, Input, Mono, Page, Select, TopBar, useAsync } from "../components/ui";

export default function Register() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const { signIn } = useSession();
  const [role, setRole] = useState(params.get("role") === "manufacturer" ? "manufacturer" : params.get("role") ?? "warehouse");
  const [f, setF] = useState({ handle: "", name: "", pass: "", pass2: "", site: "", lat: "", lng: "", org: "", licenceNo: "", gstin: "", address: "", contactName: "", phone: "", email: "", website: "" });
  const [doc, setDoc] = useState<{ name: string; type: string; data: string } | null>(null);
  const [mfrs, setMfrs] = useState<any[]>([]);
  const [keys, setKeys] = useState<{ publicKey: string } | null>(null);
  const { busy, error, run, setError } = useAsync();
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });

  useEffect(() => {
    api<any[]>("/parties", { auth: false }).then((p) => setMfrs(p.filter((x) => x.role === "manufacturer" && x.status === "approved")));
  }, []);

  const locate = async () => {
    const fix = await getGps();
    if (fix) setF((x) => ({ ...x, lat: fix.lat.toFixed(5), lng: fix.lng.toFixed(5) }));
    else setError("Couldn't get GPS. Type the latitude and longitude of your site instead.");
  };

  const pickDoc = (file: File | undefined) => {
    if (!file) return;
    if (file.size > 3_000_000) return setError("The document must be under 3 MB");
    if (!/^(image\/(png|jpeg|webp)|application\/pdf)$/.test(file.type)) return setError("Upload a PDF, PNG, JPG or WebP file");
    const r = new FileReader();
    r.onload = () => setDoc({ name: file.name, type: file.type, data: String(r.result) });
    r.readAsDataURL(file);
  };
  const company = role !== "qa";
  const gst = f.gstin ? checkGstin(f.gstin) : null;

  const submit = () =>
    run(async () => {
      if (f.pass.length < 8) throw new Error("Use a passphrase of at least 8 characters");
      if (f.pass !== f.pass2) throw new Error("The two passphrases don't match");
      const lat = Number(f.lat), lng = Number(f.lng);
      if (company) {
        if (!f.licenceNo || !f.gstin || !f.address || !f.contactName || !f.phone || !f.email) throw new Error("Fill in all the company details");
        if (!doc) throw new Error("Attach your licence or registration certificate");
      }
      if (!f.site || !Number.isFinite(lat) || !Number.isFinite(lng) || !f.lat || !f.lng) throw new Error("Give your site a name and a location");
      // 1. Keys are made here, in the browser.
      const k = generateKeyPair();
      setKeys({ publicKey: k.publicKey });
      // 2. The private key is encrypted with the passphrase before it is sent anywhere.
      const encKey = await encryptSecretKey(k.secretKey, f.pass);
      await api("/register", { body: { handle: f.handle.trim().toLowerCase(), name: f.name, role, org: role === "qa" ? f.org : undefined, publicKey: k.publicKey, encKey, site: { name: f.site, lat, lng }, proof: company ? { licenceNo: f.licenceNo, gstin: f.gstin, address: f.address, contactName: f.contactName, phone: f.phone, email: f.email, website: f.website, doc } : undefined }, auth: false });
      await signIn(f.handle, f.pass);
      nav("/" + (role === "qa" ? "manufacturer" : role));
    });

  return (
    <>
      <TopBar title="Register" color="#02C39A" />
      <Page>
        <div className="mx-auto grid max-w-4xl gap-6 md:grid-cols-[1.2fr_1fr]">
          <Card>
            <h1 className="font-display text-2xl font-semibold">Create your account and keys</h1>
            <div className="mt-5 grid gap-4">
              <Field label="I am a">
                <Select value={role} onChange={(e) => setRole(e.target.value)}>
                  <option value="manufacturer">Manufacturer</option>
                  <option value="qa">Quality approver for a manufacturer</option>
                  <option value="warehouse">Warehouse or distributor</option>
                  <option value="retailer">Retailer</option>
                </Select>
              </Field>
              {role === "qa" && (
                <Field label="Manufacturer you work for">
                  <Select value={f.org} onChange={set("org")}>
                    <option value="">Choose…</option>
                    {mfrs.map((m) => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </Select>
                </Field>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Organisation name"><Input value={f.name} onChange={set("name")} /></Field>
                <Field label="Username"><Input value={f.handle} onChange={set("handle")} autoCapitalize="none" /></Field>
                <Field label="Passphrase" hint="At least 8 characters"><Input type="password" value={f.pass} onChange={set("pass")} /></Field>
                <Field label="Repeat passphrase"><Input type="password" value={f.pass2} onChange={set("pass2")} /></Field>
              </div>
              {company && (
                <div className="grid gap-4 rounded-xl border border-line bg-abyss/40 p-4">
                  <div>
                    <div className="font-semibold">Company proof</div>
                    <p className="text-sm text-mute">The regulator checks these before your company can join.</p>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label={role === "manufacturer" ? "Manufacturing licence no." : role === "warehouse" ? "Wholesale / drug licence no." : "Retail drug licence no."}><Input value={f.licenceNo} onChange={set("licenceNo")} placeholder="e.g. TS/HYD/2024/0193" /></Field>
                    <Field label="GSTIN" hint={gst ? (gst.ok ? `✓ ${gst.state}` : `✕ ${gst.reason}`) : "15 characters"}><Input value={f.gstin} onChange={set("gstin")} className="mono uppercase" maxLength={15} /></Field>
                  </div>
                  <Field label="Registered address"><Input value={f.address} onChange={set("address")} /></Field>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <Field label="Contact person"><Input value={f.contactName} onChange={set("contactName")} /></Field>
                    <Field label="Phone"><Input value={f.phone} onChange={set("phone")} inputMode="tel" /></Field>
                    <Field label="Email"><Input value={f.email} onChange={set("email")} type="email" /></Field>
                  </div>
                  <Field label="Website (optional)"><Input value={f.website} onChange={set("website")} /></Field>
                  <Field label="Licence or registration certificate" hint="PDF, PNG, JPG or WebP, under 3 MB">
                    <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-line px-3 py-3 text-sm hover:border-mint">
                      <span className="rounded-lg bg-white/10 px-3 py-1.5 font-medium">Choose file</span>
                      <span className="truncate text-mute">{doc ? doc.name : "No file chosen"}</span>
                      <input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => pickDoc(e.target.files?.[0])} />
                    </label>
                  </Field>
                </div>
              )}
              <Field label="Site name" hint="Your factory, warehouse or shop. Scans snap to the nearest site."><Input value={f.site} onChange={set("site")} placeholder="e.g. Shamshabad warehouse" /></Field>
              <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                <Field label="Latitude"><Input value={f.lat} onChange={set("lat")} /></Field>
                <Field label="Longitude"><Input value={f.lng} onChange={set("lng")} /></Field>
                <Button variant="soft" onClick={locate} type="button">Use GPS</Button>
              </div>
              {error && <Alert>{error}</Alert>}
              <Button busy={busy} onClick={submit}>Generate keys and register</Button>
              <p className="text-center text-sm text-mute">Already registered? <Link className="text-mint underline" to={"/" + (role === "qa" ? "manufacturer" : role)}>Sign in</Link></p>
            </div>
          </Card>
          <Card className="h-fit">
            <h2 className="font-display text-lg font-semibold">What happens to your key</h2>
            <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-mute">
              <li>Your browser generates an Ed25519 key pair.</li>
              <li>The private key is encrypted with your passphrase (PBKDF2 → AES-GCM). Only the encrypted copy goes to the server.</li>
              <li>The public key and your company proofs are registered. The regulator, as head of the network, checks the proofs and approves you by signing your public key. (A quality approver is approved by their own manufacturer.)</li>
              <li>Every scan you record is signed with your key, so nobody can record in your name.</li>
            </ol>
            {keys && <div className="mt-4"><div className="text-xs text-mute">Your public key</div><Mono>{keys.publicKey}</Mono></div>}
          </Card>
        </div>
      </Page>
    </>
  );
}
