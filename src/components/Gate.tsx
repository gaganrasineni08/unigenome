// Sign-in gate for each staff portal, with the demo accounts listed for the review.
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useSession, type Party } from "../lib/session";
import { ROLE_LABEL } from "../lib/format";
import { Alert, Button, Card, Field, Input, Page, Spinner, TopBar, useAsync } from "./ui";

const DEMO: Record<string, Array<[string, string]>> = {
  manufacturer: [["sunpharma", "Production manager"], ["sunqa", "Quality approver (second signature)"]],
  warehouse: [["hydwarehouse", "Hyderabad warehouse"], ["mumwarehouse", "Mumbai warehouse"]],
  retailer: [["apollo", "Banjara Hills pharmacy"], ["medplus", "Secunderabad pharmacy"], ["andheri", "Andheri chemist"]],
  regulator: [["regulator", "Drug Control Authority"]],
};

export function Gate({ portal, roles, color, children }: { portal: string; roles: Party["role"][]; color: string; children: ReactNode }) {
  const { me, loading, signIn, signOut } = useSession();
  const [handle, setHandle] = useState("");
  const [pass, setPass] = useState("");
  const { busy, error, run } = useAsync();

  if (loading)
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner />
      </div>
    );
  if (me && roles.includes(me.role)) return <>{children}</>;

  const label = portal[0].toUpperCase() + portal.slice(1);
  return (
    <>
      <TopBar title={label + " portal"} color={color} />
      <Page>
        <div className="mx-auto max-w-md">
          {me ? (
            <Card>
              <p>
                You're signed in as <b>{me.name}</b> ({ROLE_LABEL[me.role]}). This portal is for {roles.map((r) => ROLE_LABEL[r]).join(" or ")} accounts.
              </p>
              <div className="mt-4 flex gap-2">
                <Button onClick={signOut}>Sign out</Button>
                <Link to={`/${me.role === "qa" ? "manufacturer" : me.role}`}>
                  <Button variant="soft">Go to my portal</Button>
                </Link>
              </div>
            </Card>
          ) : (
            <Card>
              <h1 className="font-display text-2xl font-semibold">Sign in to the {label} portal</h1>
              <p className="mt-1 text-sm text-mute">Your passphrase unlocks your private key in this browser. It is never sent to the server.</p>
              <form
                className="mt-5 space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  run(() => signIn(handle, pass));
                }}
              >
                <Field label="Username">
                  <Input value={handle} onChange={(e) => setHandle(e.target.value)} autoCapitalize="none" autoComplete="username" />
                </Field>
                <Field label="Passphrase">
                  <Input type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="current-password" />
                </Field>
                {error && <Alert>{error}</Alert>}
                <Button busy={busy} className="w-full" type="submit">
                  Sign in
                </Button>
              </form>
              {DEMO[portal] && (
                <div className="mt-6 rounded-xl border border-line bg-abyss/60 p-3 text-sm">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-mute">Demo accounts · passphrase demo1234</div>
                  {DEMO[portal].map(([h, d]) => (
                    <button key={h} type="button" onClick={() => { setHandle(h); setPass("demo1234"); }} className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left hover:bg-white/5">
                      <span className="mono text-sea">{h}</span>
                      <span className="text-mute">{d}</span>
                    </button>
                  ))}
                </div>
              )}
              {portal !== "regulator" && (
                <p className="mt-4 text-center text-sm text-mute">
                  New here? <Link className="text-mint underline" to={`/register?role=${portal}`}>Register and create your keys</Link>
                </p>
              )}
            </Card>
          )}
        </div>
      </Page>
    </>
  );
}

export function SignOutButton() {
  const { me, signOut } = useSession();
  if (!me) return null;
  return (
    <div className="flex items-center gap-2">
      <span className="hidden text-sm text-mute sm:inline">{me.name}</span>
      {me.status !== "approved" && <span className="rounded-full bg-amber/20 px-2 py-0.5 text-xs text-amber">awaiting approval</span>}
      <Button variant="ghost" onClick={signOut}>
        Sign out
      </Button>
    </div>
  );
}
