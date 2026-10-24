import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { generateKeyPair } from "../../shared/crypto";
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
  const [f, setF] = useState({ handle: "", name: "", pass: "", pass2: "", site: "", lat: "", lng: "", org: "" });
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

  const submit = () =>
    run(async () => {
      if (f.pass.length < 8) throw new Error("Use a passphrase of at least 8 characters");
      if (f.pass !== f.pass2) throw new Error("The two passphrases don't match");
      const lat = Number(f.lat), lng = Number(f.lng);
      if (!f.site || !Number.isFinite(lat) || !Number.isFinite(lng) || !f.lat || !f.lng) throw new Error("Give your site a name and a location");
      // 1. Keys are made here, in the browser.
      const k = generateKeyPair();
      setKeys({ publicKey: k.publicKey });
      // 2. The private key is encrypted with the passphrase before it is sent anywhere.
      const encKey = await encryptSecretKey(k.secretKey, f.pass);
      await api("/register", { body: { handle: f.handle.trim().toLowerCase(), name: f.name, role, org: role === "qa" ? f.org : undefined, publicKey: k.publicKey, encKey, site: { name: f.site, lat, lng } }, auth: false });
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
                  <option value="manufacturer">Manufacturer (needs regulator approval)</option>
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
              <li>The public key is registered. Someone above you approves it by signing it: the regulator for manufacturers, a manufacturer for everyone else.</li>
              <li>Every scan you record is signed with your key, so nobody can record in your name.</li>
            </ol>
            {keys && <div className="mt-4"><div className="text-xs text-mute">Your public key</div><Mono>{keys.publicKey}</Mono></div>}
          </Card>
        </div>
      </Page>
    </>
  );
}
