// Home: a scroll story over the 3D ring road (factory -> warehouse -> shop -> buyer's phone, watched by the
// regulator's tower in the middle), then the portals.
import { lazy, Suspense, useEffect, useRef, useState, type PointerEvent } from "react";
import { Link } from "react-router-dom";
import { Alert, Button, PORTALS } from "../components/ui";
import { api } from "../lib/api";
import { labelStore } from "../lib/labels";

const Story = lazy(() => import("../three/Story"));

// `side` is where the card sits on wide screens (-1 left, 1 right); the 3D camera frames its subject
// on the other side. Phones always show the card at the bottom.
const STEPS: Array<{ tag: string; title: string; body: string; side: number; color?: string; facts?: string[] }> = [
  {
    tag: "Anti-counterfeit for any product",
    title: "Every product gets a DNA it can't fake.",
    body: "UniGenome gives each item a signed QR identity, follows it from the factory to the shelf, and lets any buyer check it with a phone camera.",
    side: 0, // the landing screen: the title is centred over the scene, not on a card
  },
  {
    tag: "1 · Manufacture",
    title: "The factory signs each item.",
    body: "Product, batch, dates and a random salt are hashed with SHA-256 into the item's DNA, then signed with the manufacturer's private key (Ed25519). Change one letter and the signature fails.",
    color: PORTALS.manufacturer.color,
    facts: ["SHA-256", "Ed25519", "random salt"],
    side: 1,
  },
  {
    tag: "2 · Pack",
    title: "One QR on the carton speaks for everything inside.",
    body: "Items go into cartons and cartons onto pallets. The carton QR carries a Merkle root of its contents, so a single scan of the box updates every item in it.",
    color: PORTALS.manufacturer.color,
    facts: ["Merkle root", "1 scan → 12 items"],
    side: -1,
  },
  {
    tag: "3 · Transport",
    title: "Every scan records where and when.",
    body: "Dispatch and receive scans store GPS location, time and the dispatch date, signed and linked into a hash chain. Dijkstra over past deliveries predicts the arrival date, and late shipments raise alerts.",
    color: PORTALS.warehouse.color,
    facts: ["GPS + time", "hash chain", "Dijkstra ETA"],
    side: 1,
  },
  {
    tag: "4 · Warehouse",
    title: "Scan the pallet, not 48 boxes.",
    body: "Receiving a pallet walks its packaging tree (DFS) and updates every carton and item. The server picks random cartons for a spot check, proved with Merkle paths.",
    color: PORTALS.warehouse.color,
    facts: ["DFS", "Merkle proofs", "spot checks"],
    side: -1,
  },
  {
    tag: "5 · Sell",
    title: "The shop marks it sold.",
    body: "The retailer's sale scan closes the chain. A copied code that shows up far from its shop, or in two cities an hour apart, is flagged as a clone.",
    color: PORTALS.retailer.color,
    facts: ["sale scan", "clone detection"],
    side: 1,
  },
  {
    tag: "6 · Buy",
    title: "The buyer just scans. Read-only.",
    body: "The signature is checked on the phone, even offline. Then the full journey, map and verdict appear. The buyer can't change anything, but can raise a complaint, which goes straight to the regulator's priority queue.",
    color: PORTALS.buyer.color,
    facts: ["offline verify", "full journey", "complaints"],
    side: -1,
  },
  {
    tag: "7 · Watch",
    title: "The regulator sees the whole ring.",
    body: "Every checkpoint reports to the regulator. Alerts wait in a max-heap so the most serious comes first, and a recall walks the supply-chain graph with BFS to find every shop that got the batch.",
    color: PORTALS.regulator.color,
    facts: ["max-heap alerts", "BFS recall"],
    side: 1,
  },
];
// One entry per chapter for the camera, the portals last (centred).
const SIDES = [...STEPS.map((s) => s.side), 0];
const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));

export default function Home() {
  const progress = useRef(0);
  const cards = useRef<Array<HTMLElement | null>>([]);
  const [active, setActive] = useState(0);
  const [webgl] = useState(() => {
    try {
      const c = document.createElement("canvas");
      return !!(c.getContext("webgl2") || c.getContext("webgl"));
    } catch {
      return false;
    }
  });
  useEffect(() => {
    // The 3D scene follows a fractional chapter: 0 while the first section fills the screen, 1 at the
    // second, and so on, with the portals as the last chapter.
    const on = () => {
      const els = Array.from(document.querySelectorAll<HTMLElement>("[data-chapter]"));
      const mid = scrollY + innerHeight / 2;
      const centres = els.map((el) => el.offsetTop + Math.min(el.offsetHeight, innerHeight) / 2);
      let f = 0;
      if (mid >= centres[centres.length - 1]) f = centres.length - 1;
      else
        for (let i = 0; i < centres.length - 1; i++)
          if (mid < centres[i + 1]) {
            f = i + Math.max(0, (mid - centres[i]) / (centres[i + 1] - centres[i]));
            break;
          }
      progress.current = f;
      setActive(Math.round(f));
      // Each card slides in from its side as its section reaches the middle of the screen, then drifts
      // up and away as the next arrives. `--d` is the section's offset from the middle, in screens.
      cards.current.forEach((el, i) => {
        if (!el) return;
        const d = (centres[i] - mid) / innerHeight;
        el.style.setProperty("--off", clamp((Math.abs(d) - 0.12) / 0.55).toFixed(3));
        el.style.setProperty("--d", clamp(d, -1, 1).toFixed(3));
        el.style.setProperty("--fill", clamp(0.6 - d).toFixed(3));
      });
    };
    on();
    addEventListener("scroll", on, { passive: true });
    addEventListener("resize", on);
    return () => {
      removeEventListener("scroll", on);
      removeEventListener("resize", on);
    };
  }, []);

  return (
    <div className="relative overflow-x-clip">
      <div className="fixed inset-0 -z-0">
        {webgl ? (
          <Suspense fallback={<div className="h-full w-full bg-abyss" />}>
            <Story progress={progress} sides={SIDES} />
          </Suspense>
        ) : (
          <div className="h-full w-full bg-[radial-gradient(circle_at_30%_20%,#0b4a50,#031b1e)]" />
        )}
        {/* a soft shade behind whichever side the current card is on, or behind the centred title */}
        <div className={`pointer-events-none absolute inset-0 bg-gradient-to-r from-[#01040a]/70 via-[#01040a]/10 to-transparent transition-opacity duration-700 ${STEPS[active]?.side === -1 ? "opacity-100" : "opacity-0"}`} />
        <div className={`pointer-events-none absolute inset-0 bg-gradient-to-l from-[#01040a]/70 via-[#01040a]/10 to-transparent transition-opacity duration-700 ${STEPS[active]?.side === 1 ? "opacity-100" : "opacity-0"}`} />
        <div className={`pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_45%_at_50%_45%,rgba(1,4,10,0.55),transparent)] transition-opacity duration-700 ${active === 0 ? "opacity-100" : "opacity-0"}`} />
      </div>

      <ChapterRail active={active} />

      <header className="lg-bar fixed inset-x-0 top-0 z-30">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-4">
          <img src="/icon.svg" className="h-9 w-9" alt="" />
          <span className="font-display text-xl font-semibold">UniGenome</span>
          <nav className="ml-auto flex gap-1 text-sm">
            <a href="#portals" className="lg-pill rounded-lg px-3 py-1.5 font-medium">Open a portal</a>
          </nav>
        </div>
      </header>

      <main className="relative z-10">
        <section id="step-0" data-chapter className="flex min-h-[100svh] flex-col items-center justify-center px-4 pt-20 text-center">
          <div ref={(el) => void (cards.current[0] = el)} className="hero-intro">
            <div className="hero-eyebrow hero-in">
              <span className="story-dot" />
              {STEPS[0].tag}
            </div>
            <h1 className="hero-in mt-6 font-display text-5xl font-semibold leading-[1.02] tracking-tight sm:text-7xl lg:text-8xl" style={{ animationDelay: "0.12s" }}>
              Every product gets a <span className="hero-dna">DNA</span> it can't fake.
            </h1>
            <p className="hero-in mx-auto mt-6 max-w-xl text-base leading-relaxed text-[#d3e3e8] sm:text-lg" style={{ animationDelay: "0.24s" }}>{STEPS[0].body}</p>
            <div className="hero-in mt-8 flex flex-wrap justify-center gap-3" style={{ animationDelay: "0.36s" }}>
              <Link to="/buyer"><Button>Scan a product</Button></Link>
              <a href="#portals"><Button variant="soft">I work in the supply chain</Button></a>
            </div>
            <a href="#step-1" className="hero-in hero-scroll" style={{ animationDelay: "0.6s" }}>
              <span>Scroll to ride along with a carton</span>
              <i aria-hidden />
            </a>
          </div>
        </section>
        {STEPS.map((s, i) => i > 0 && (
          <section key={i} id={`step-${i}`} data-chapter className="flex min-h-[100svh] items-end px-4 pb-8 sm:items-center sm:pb-0">
            <div className={`mx-auto flex w-full max-w-6xl ${s.side === 1 ? "sm:justify-end" : ""}`}>
              <article
                ref={(el) => void (cards.current[i] = el)}
                onPointerMove={tilt}
                onPointerLeave={untilt}
                className="story-card glass glass-strong w-full max-w-md rounded-3xl p-6 sm:p-8"
                style={{ ["--accent" as string]: s.color ?? "#02C39A", ["--dir" as string]: s.side }}
              >
                <span className="story-num" aria-hidden>{String(i).padStart(2, "0")}</span>
                <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em]" style={{ color: s.color ?? "#02C39A" }}>
                  <span className="story-dot" />
                  {s.tag}
                </div>
                <h2 className="font-display text-3xl font-semibold leading-tight sm:text-4xl">{s.title}</h2>
                <p className="mt-4 text-base leading-relaxed text-[#c9dbe0] sm:text-lg">{s.body}</p>
                {s.facts && (
                  <div className="mt-5 flex flex-wrap gap-2">
                    {s.facts.map((f) => (
                      <span key={f} className="story-fact">{f}</span>
                    ))}
                  </div>
                )}
                <div className="story-bar" aria-hidden><i /></div>
              </article>
            </div>
          </section>
        ))}
        <Portals />
      </main>
    </div>
  );
}

// A light 3D tilt towards the pointer while it is over a card.
function tilt(e: PointerEvent<HTMLElement>) {
  if (e.pointerType !== "mouse") return;
  const r = e.currentTarget.getBoundingClientRect();
  e.currentTarget.style.setProperty("--ry", `${(((e.clientX - r.left) / r.width - 0.5) * 6).toFixed(2)}deg`);
  e.currentTarget.style.setProperty("--rx", `${(((e.clientY - r.top) / r.height - 0.5) * -6).toFixed(2)}deg`);
}
function untilt(e: PointerEvent<HTMLElement>) {
  e.currentTarget.style.setProperty("--ry", "0deg");
  e.currentTarget.style.setProperty("--rx", "0deg");
}

/** Dots down the right edge: one per chapter, the current one lit in its colour. */
function ChapterRail({ active }: { active: number }) {
  return (
    <nav aria-label="Story chapters" className="fixed right-4 top-1/2 z-20 hidden -translate-y-1/2 flex-col gap-3 xl:flex">
      {[...STEPS, { tag: "Portals", color: "#02C39A" }].map((s, i) => (
        <a
          key={i}
          href={i < STEPS.length ? `#step-${i}` : "#portals"}
          title={s.tag}
          className={`rail-dot ${i === active ? "is-on" : ""}`}
          style={{ ["--accent" as string]: s.color ?? "#02C39A" }}
        />
      ))}
    </nav>
  );
}

function Portals() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "mint" | "coral"; text: string } | null>(null);
  const [health, setHealth] = useState<any>(null);
  useEffect(() => {
    api("/parties", { auth: false }).then((p: any) => setHealth({ parties: p.length })).catch(() => setHealth({ parties: 0 }));
  }, []);
  const load = async (reset: boolean) => {
    if (reset && !confirm("This deletes all data on this server and loads the demo again. Continue?")) return;
    setBusy(true);
    setMsg(null);
    try {
      const r: any = await api("/demo/seed", { method: "POST", body: { reset }, auth: false });
      if (!r.seeded) setMsg({ tone: "coral", text: "There is already data here, so nothing was loaded. Use “Reset and reload” to start over." });
      else {
        const byBatch: Record<string, Record<string, string>> = {};
        for (const [id, code] of Object.entries<string>(r.claimCodes ?? {})) {
          const b = id.split("-").slice(0, 2).join("-");
          (byBatch[b] ??= {})[id] = code;
        }
        for (const [b, codes] of Object.entries(byBatch)) labelStore.add(b, codes);
        setMsg({ tone: "mint", text: `Demo loaded. Sign in to any portal with the accounts listed there; the passphrase is ${r.passphrase}.` });
        setHealth({ parties: r.accounts.length });
      }
    } catch (e: any) {
      setMsg({ tone: "coral", text: e.message });
    } finally {
      setBusy(false);
    }
  };
  const cards: Array<[keyof typeof PORTALS, string, string]> = [
    ["manufacturer", "/manufacturer", "Create batches, issue signed items, pack cartons and pallets, print labels, dispatch."],
    ["warehouse", "/warehouse", "Scan to receive, store, check condition, repack and dispatch. One carton scan updates every item."],
    ["retailer", "/retailer", "Receive deliveries, unpack cartons onto the shelf, and scan each sale."],
    ["buyer", "/buyer", "Scan any product to see its verdict, full journey and details. Read-only, with complaints."],
    ["regulator", "/regulator", "Alerts by priority, recall planning (BFS + knapsack), expiring stock, partner approvals."],
  ];
  return (
    <section id="portals" data-chapter className="relative min-h-[100svh] bg-gradient-to-b from-transparent via-[#01040a]/70 to-[#01040a]/95 px-4 pb-20 pt-32">
      <div className="mx-auto max-w-6xl">
        <h2 className="font-display text-4xl font-semibold">Choose your portal</h2>
        <p className="mt-2 max-w-2xl text-mute">Each role has its own screen with only the steps it needs.</p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map(([k, to, d]) => (
            <Link key={k} to={to} className="glass group rounded-2xl p-5 transition hover:-translate-y-1" style={{ borderColor: PORTALS[k].color + "55" }}>
              <div className="text-3xl">{PORTALS[k].icon}</div>
              <div className="mt-2 font-display text-xl font-semibold" style={{ color: PORTALS[k].color }}>{PORTALS[k].label}</div>
              <p className="mt-1 text-sm text-mute">{d}</p>
              <div className="mt-3 text-sm font-medium opacity-70 group-hover:opacity-100">Open →</div>
            </Link>
          ))}
        </div>
        <div className="glass mt-8 rounded-2xl p-5">
          <div className="flex flex-wrap items-center gap-3">
            <div className="mr-auto">
              <div className="font-semibold">Demo data</div>
              <div className="text-sm text-mute">{health == null ? "Checking…" : health.parties ? `${health.parties} registered parties on this server.` : "This server is empty. Load the demo: 8 companies, 3 batches, cartons, a pallet, shipments, a cold-chain failure and a complaint."}</div>
            </div>
            <Button onClick={() => load(false)} disabled={busy}>{busy ? "Loading… (about 10 s)" : "Load demo data"}</Button>
            <Button variant="soft" onClick={() => load(true)} disabled={busy}>Reset and reload</Button>
            <Link to="/register"><Button variant="soft">Register a company</Button></Link>
          </div>
          {msg && <div className="mt-3"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
        </div>
      </div>
    </section>
  );
}
