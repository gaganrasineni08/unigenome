// The DSA page: each data structure and algorithm, running on the app's live data.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { generateKeyPair, sha256Hex, signMessage, verifyMessage } from "../../shared/crypto";
import { AVLTree } from "../../shared/dsa/avl";
import { greedyAllocate, knapsack2D } from "../../shared/dsa/knapsack";
import { verifyProof } from "../../shared/dsa/merkle";
import { haversineKm, impliedSpeedKmh } from "../../shared/geo";
import { BfsGraph } from "../components/BfsGraph";
import { Alert, Badge, Button, Card, Field, H1, H2, Input, Mono, Page, Select, Spinner, TopBar } from "../components/ui";
import { api } from "../lib/api";
import { fmtHours } from "../lib/format";

const TOPICS = [
  ["hash", "1 · SHA-256"],
  ["sig", "2 · Signatures"],
  ["map", "3 · Hash map"],
  ["chain", "4 · Hash chain"],
  ["merkle", "5 · Merkle tree"],
  ["tree", "6 · Tree + DFS"],
  ["bfs", "7 · Graph + BFS"],
  ["dijkstra", "8 · Dijkstra"],
  ["heap", "9 · Heap"],
  ["knap", "10 · Knapsack DP"],
  ["trie", "11 · Trie"],
  ["avl", "12 · AVL tree"],
  ["geo", "13 · Haversine"],
] as const;

const Code = ({ children }: { children: ReactNode }) => <div className="mt-3 rounded-lg border border-line bg-abyss/70 px-3 py-2 text-xs text-mute">Code: <span className="mono text-sea">{children}</span></div>;

export default function DsaPage() {
  const [tab, setTab] = useState<string>(() => location.hash.slice(1) || "hash");
  const [o, setO] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api("/dsa/overview", { auth: false }).then(setO).catch((e) => setErr(e.message));
  }, []);
  useEffect(() => {
    history.replaceState(null, "", "#" + tab);
  }, [tab]);
  useEffect(() => {
    const on = () => setTab(location.hash.slice(1) || "hash");
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return (
    <>
      <TopBar title="DSA, live" color="#4fc3f7" />
      <Page>
        <H1 sub="Every structure here is the one the app uses, holding the app's real data right now. The file and function names are given so you can open the code.">Data structures and algorithms in UniGenome</H1>
        <div className="mb-6 flex flex-wrap gap-1.5">
          {TOPICS.map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className={`rounded-lg px-3 py-1.5 text-sm transition ${tab === k ? "bg-mint text-abyss font-semibold" : "bg-white/5 text-mute hover:text-ink"}`}>{l}</button>
          ))}
        </div>
        {err ? <Alert>Couldn't load the live data: {err}</Alert> : !o ? <Spinner /> : (
          <>
            {tab === "hash" && <HashDemo />}
            {tab === "sig" && <SigDemo />}
            {tab === "map" && <MapDemo o={o} />}
            {tab === "chain" && <ChainDemo o={o} />}
            {tab === "merkle" && <MerkleDemo o={o} />}
            {tab === "tree" && <TreeDemo o={o} />}
            {tab === "bfs" && <BfsDemo o={o} />}
            {tab === "dijkstra" && <DijkstraDemo o={o} />}
            {tab === "heap" && <HeapDemo o={o} />}
            {tab === "knap" && <KnapDemo />}
            {tab === "trie" && <TrieDemo />}
            {tab === "avl" && <AvlDemo o={o} />}
            {tab === "geo" && <GeoDemo />}
          </>
        )}
      </Page>
    </>
  );
}

function HashDemo() {
  const [t, setT] = useState("ProductID=PCM-500|BatchID=B-1024");
  const h = sha256Hex(t);
  const h2 = sha256Hex(t + " ");
  const diff = [...h].filter((c, i) => c !== h2[i]).length;
  return (
    <Card>
      <H2>SHA-256: a fixed 32-byte fingerprint of any input</H2>
      <Field label="Input"><Input value={t} onChange={(e) => setT(e.target.value)} /></Field>
      <div className="mt-3 text-xs text-mute">SHA-256</div>
      <Mono className="text-base">{h}</Mono>
      <div className="mt-3 text-xs text-mute">Same input plus one space</div>
      <Mono className="text-base">{[...h2].map((c, i) => <span key={i} className={c !== h[i] ? "text-amber" : ""}>{c}</span>)}</Mono>
      <p className="mt-3 text-sm text-mute">{diff} of 64 hex characters changed. Every item's DNA0, every record's hash and every Merkle node is made this way.</p>
      <Code>shared/crypto.ts → sha256Hex, hashOf · shared/identity.ts → dnaOf</Code>
    </Card>
  );
}

function SigDemo() {
  const [k, setK] = useState(() => generateKeyPair());
  const [msg, setMsg] = useState("B-1024-007 received at Shamshabad warehouse");
  const [sig, setSig] = useState("");
  const [check, setCheck] = useState(msg);
  const ok = sig ? verifyMessage("UG/demo", check, sig, k.publicKey) : null;
  return (
    <Card>
      <H2>Ed25519: only the private key can sign, anyone can check</H2>
      <div className="grid gap-3 md:grid-cols-2">
        <div><div className="text-xs text-mute">Private key (secret, stays in the browser)</div><Mono className="!text-coral">{k.secretKey}</Mono></div>
        <div><div className="text-xs text-mute">Public key (shared)</div><Mono>{k.publicKey}</Mono></div>
      </div>
      <div className="mt-4 grid gap-3">
        <Field label="Message"><Input value={msg} onChange={(e) => setMsg(e.target.value)} /></Field>
        <div className="flex gap-2"><Button onClick={() => { setSig(signMessage("UG/demo", msg, k.secretKey)); setCheck(msg); }}>Sign</Button><Button variant="soft" onClick={() => { setK(generateKeyPair()); setSig(""); }}>New key pair</Button></div>
        {sig && <><div className="text-xs text-mute">Signature (64 bytes)</div><Mono>{sig}</Mono></>}
        {sig && <Field label="Message the verifier received (try changing it)"><Input value={check} onChange={(e) => setCheck(e.target.value)} /></Field>}
        {ok != null && <Alert tone={ok ? "mint" : "coral"}>{ok ? "Signature valid: this exact message was signed by this key." : "Signature invalid: the message was changed, or another key signed it."}</Alert>}
      </div>
      <Code>shared/crypto.ts → generateKeyPair, signMessage, verifyMessage (uses @noble/curves ed25519)</Code>
    </Card>
  );
}

function MapDemo({ o }: { o: any }) {
  const hm = o.hashmap;
  return (
    <Card>
      <H2 right={<Badge tone="teal">{hm.size} keys · {hm.capacity} buckets · load {hm.loadFactor.toFixed(2)} · {hm.resizes} resizes</Badge>}>Key registry: party id → public key</H2>
      <p className="mb-3 text-sm text-mute">Every signature check looks up the signer here: hash the id (FNV-1a), take it mod the bucket count, scan that short bucket. When the load passes 0.75 the table doubles and every key is re-hashed.</p>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4 lg:grid-cols-8">
        {hm.buckets.map((b: string[], i: number) => (
          <div key={i} className={`rounded-lg border p-2 text-xs ${b.length ? "border-sea/50 bg-sea/10" : "border-line"}`}>
            <div className="text-mute">[{i}]</div>
            {b.map((k) => <div key={k} className="mono truncate text-sea" title={o.partyNames[k]}>{k}</div>)}
          </div>
        ))}
      </div>
      <p className="mt-3 text-sm text-mute">Also used: the revocation set ({o.revoked.size} revoked) and the last-seen index for clone detection ({o.lastSeen.size} units).</p>
      <Code>shared/dsa/hashmap.ts → HashMap.set / get / grow, HashSet · server/indexes.ts</Code>
    </Card>
  );
}

function ChainDemo({ o }: { o: any }) {
  const [id, setId] = useState(o.samples.item ?? "");
  const [tamper, setTamper] = useState<number | null>(null);
  const [r, setR] = useState<any>(null);
  useEffect(() => {
    if (id) api(`/dsa/chain/${id}${tamper != null ? "?tamper=" + tamper : ""}`, { auth: false }).then(setR).catch(() => setR(null));
  }, [id, tamper]);
  return (
    <Card>
      <H2>Custody records linked by hashes</H2>
      <div className="flex gap-2"><Input value={id} onChange={(e) => { setId(e.target.value.toUpperCase()); setTamper(null); }} placeholder="Unit id" /></div>
      {r && (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {r.records.map((rec: any, i: number) => {
              const broken = r.check.brokenAt != null && i >= r.check.brokenAt;
              return (
                <div key={i} className="flex items-center gap-2">
                  <button onClick={() => setTamper(tamper === i ? null : i)} className={`rounded-xl border p-2.5 text-left text-xs transition ${broken ? "border-coral bg-coral/10" : "border-mint/50 bg-mint/5"}`}>
                    <div className="font-semibold">{rec.type}</div>
                    <div className="text-mute">{rec.actor}</div>
                    <div className="mono text-[10px]">prev {rec.prev.slice(0, 8)}</div>
                    <div className="mono text-[10px]">hash {rec.hash.slice(0, 8)}</div>
                  </button>
                  {i < r.records.length - 1 && <span className={broken ? "text-coral" : "text-mint"}>→</span>}
                </div>
              );
            })}
          </div>
          <div className="mt-3">{r.check.ok ? <Alert tone="mint">Chain intact: every link and signature checks out.</Alert> : <Alert>Broken at record {r.check.brokenAt + 1}: {r.check.reason}. Everything after it is no longer trusted.</Alert>}</div>
          <p className="mt-2 text-xs text-mute">Click a record to simulate someone editing its time by one hour in the database. Click again to undo. (This is a what-if: nothing is saved.)</p>
        </>
      )}
      <Code>shared/events.ts → eventHash, verifyChain · server/app.ts → appendEvent</Code>
    </Card>
  );
}

function MerkleDemo({ o }: { o: any }) {
  const [carton, setCarton] = useState(o.samples.cartons[0] ?? "");
  const [item, setItem] = useState<string | undefined>();
  const [r, setR] = useState<any>(null);
  useEffect(() => {
    if (carton) api(`/dsa/merkle/${carton}${item ? "?item=" + item : ""}`, { auth: false }).then(setR);
  }, [carton, item]);
  if (!o.samples.cartons.length) return <Card>No cartons yet.</Card>;
  const pathIdx = new Set<string>();
  if (r) {
    let i = r.pick;
    r.levels.forEach((lv: string[], li: number) => { pathIdx.add(li + ":" + i); i = Math.floor(i / 2); });
  }
  const ok = r && verifyProof(r.leaves[r.pick], r.proof, r.signedRoot);
  return (
    <Card>
      <H2>Merkle tree over a carton's contents</H2>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Carton"><Select value={carton} onChange={(e) => { setCarton(e.target.value); setItem(undefined); }}>{o.samples.cartons.map((c: string) => <option key={c}>{c}</option>)}</Select></Field>
        {r && <Field label="Prove this item is inside"><Select value={r.leaves[r.pick]} onChange={(e) => setItem(e.target.value)}>{r.leaves.map((l: string) => <option key={l}>{l}</option>)}</Select></Field>}
      </div>
      {r && (
        <>
          <div className="mt-4 space-y-1.5 overflow-x-auto">
            {[...r.levels].reverse().map((lv: string[], ri: number) => {
              const li = r.levels.length - 1 - ri;
              const sib = new Set(r.proof.map((_: any, k: number) => k).filter((k: number) => k === li).map(() => null));
              void sib;
              return (
                <div key={li} className="flex justify-center gap-1">
                  {lv.map((h, i) => {
                    const onPath = pathIdx.has(li + ":" + i);
                    const myIdx = [...pathIdx].find((p) => p.startsWith(li + ":"));
                    const mine = myIdx ? Number(myIdx.split(":")[1]) : -1;
                    const isSib = li < r.levels.length - 1 && (mine % 2 ? i === mine - 1 : i === mine + 1 || (i === mine && mine === lv.length - 1 && lv.length % 2));
                    return <div key={i} title={h} className={`mono shrink-0 rounded px-1 py-0.5 text-[9px] ${onPath ? "bg-mint text-abyss" : isSib ? "bg-amber/80 text-abyss" : "bg-white/5 text-mute"}`}>{li === 0 ? r.leaves[i].slice(-3) : h.slice(0, 4)}</div>;
                  })}
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-sm text-mute"><span className="text-mint">Green</span>: the path from the item to the root. <span className="text-amber">Amber</span>: the {r.proof.length} sibling hashes that make up the proof. {r.leaves.length} items, but only {r.proof.length} hashes are needed (log₂).</p>
          <div className="mt-2 text-xs text-mute">Signed root on the carton QR</div><Mono>{r.signedRoot}</Mono>
          <div className="mt-3">{ok ? <Alert tone="mint">Proof verified in your browser: {r.leaves[r.pick]} is inside {carton}.</Alert> : <Alert>Proof failed.</Alert>}</div>
        </>
      )}
      <Code>shared/dsa/merkle.ts → buildLevels, merkleRoot, merkleProof, verifyProof</Code>
    </Card>
  );
}

function TreeDemo({ o }: { o: any }) {
  const [id, setId] = useState(o.samples.container ?? "");
  const [r, setR] = useState<any>(null);
  useEffect(() => {
    if (id) api(`/dsa/tree/${id}`, { auth: false }).then(setR).catch(() => setR(null));
  }, [id]);
  const order = new Map<string, number>((r?.order ?? []).map((x: string, i: number) => [x, i + 1]));
  const node = (x: string, depth: number): ReactNode => (
    <div key={x} style={{ marginLeft: depth * 18 }}>
      <span className="mr-2 inline-block w-8 text-right text-xs text-amber">#{order.get(x)}</span>
      <span className="mono text-xs">{x}</span> <span className="text-xs text-mute">{r.kind[x]}</span>
      {(r.kids[x] ?? []).slice(0, depth >= 1 ? 4 : 99).map((c: string) => node(c, depth + 1))}
      {depth >= 1 && (r.kids[x]?.length ?? 0) > 4 && <div style={{ marginLeft: 18 * (depth + 1) }} className="text-xs text-mute">… {r.kids[x].length - 4} more</div>}
    </div>
  );
  return (
    <Card>
      <H2>Packaging tree and depth-first search</H2>
      <Input value={id} onChange={(e) => setId(e.target.value.toUpperCase())} placeholder="Pallet or carton id" />
      {r && <><Alert tone="mint">DFS from {id} visited {r.order.length} units and found {r.items} items. One scan of {id} updates all of them.</Alert><div className="mt-3 max-h-96 overflow-y-auto">{node(r.root, 0)}</div><p className="mt-2 text-xs text-mute">The # numbers are the DFS visit order (explicit stack: go deep into one carton before the next).</p></>}
      <Code>shared/dsa/tree.ts → dfsCollect, ancestors · server/logic.ts → subtree, history (walks parent pointers up)</Code>
    </Card>
  );
}

function BfsDemo({ o }: { o: any }) {
  const [batch, setBatch] = useState(o.samples.batches.includes("B-1024") ? "B-1024" : o.samples.batches[0]);
  const [r, setR] = useState<any>(null);
  useEffect(() => {
    if (batch) api(`/dsa/recall/${batch}`, { auth: false }).then(setR);
  }, [batch]);
  return (
    <Card>
      <H2>Recall: breadth-first search over real shipments</H2>
      <Field label="Batch"><Select value={batch} onChange={(e) => setBatch(e.target.value)}>{o.samples.batches.map((b: string) => <option key={b}>{b}</option>)}</Select></Field>
      <div className="mt-4">{r ? <BfsGraph graph={r.graph} bfs={r.bfs} /> : <Spinner />}</div>
      <p className="mt-3 text-sm text-mute">Edges come from dispatch and receive records of every carton or pallet that held the batch. The queue shown is the real FIFO queue at each step. O(V + E).</p>
      <Code>shared/dsa/graph.ts → Graph, bfs · server/logic.ts → recallAnalysis</Code>
    </Card>
  );
}

function DijkstraDemo({ o }: { o: any }) {
  const r = o.routes;
  return (
    <Card>
      <H2>Expected arrival: Dijkstra over measured delivery times</H2>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-mute">Edges learned from deliveries</div>
          <ul className="space-y-1 text-sm">{r.edges.map((e: any, i: number) => <li key={i}>{e.fromName.split(",")[0]} → {e.toName.split(",")[0]}: <b>{fmtHours(e.hours)}</b> <span className="text-mute">avg of {e.n}</span></li>)}</ul>
        </div>
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-mute">Shortest times from {r.source?.name}</div>
          <ul className="space-y-1 text-sm">{r.dist.map((d: any) => <li key={d.id}><b>{Number.isFinite(d.hours) ? fmtHours(d.hours) : "∞"}</b> {d.name} <span className="text-xs text-mute">{d.path.length > 2 ? "via " + d.path.slice(1, -1).join(", ") : ""}</span></li>)}</ul>
          <p className="mt-2 text-xs text-mute">Settled in this order (closest first, from a min-heap): {r.settled.join(" → ")}</p>
        </div>
      </div>
      <p className="mt-3 text-sm text-mute">When a warehouse dispatches, this gives the expected arrival date. A shipment past that date plus a margin (from the spread of past deliveries) raises an overdue alert.</p>
      <Code>shared/dsa/graph.ts → dijkstra · server/logic.ts → routeGraph, estimateArrival</Code>
    </Card>
  );
}

function HeapDemo({ o }: { o: any }) {
  const a = o.heap.array;
  const draw = (i: number, x: number, y: number, dx: number): ReactNode => {
    if (i >= a.length) return null;
    const kids = [2 * i + 1, 2 * i + 2];
    return (
      <g key={i}>
        {kids.map((k, j) => k < a.length && <line key={k} x1={x} y1={y} x2={x + (j ? dx : -dx)} y2={y + 60} stroke="#2a5357" />)}
        {kids.map((k, j) => draw(k, x + (j ? dx : -dx), y + 60, dx / 2))}
        <circle cx={x} cy={y} r={18} fill="#062c30" stroke={["", "#8fb3ae", "#00A896", "#E8A33D", "#8E7CC3", "#D96C6C"][a[i].severity]} strokeWidth={2} />
        <text x={x} y={y + 4} textAnchor="middle" fontSize="12" fill="#e7f4f2" fontWeight="600">{a[i].severity}</text>
        <text x={x} y={y + 32} textAnchor="middle" fontSize="9" fill="#8fb3ae">{a[i].kind}</text>
      </g>
    );
  };
  return (
    <Card>
      <H2>Alerts priority queue (binary max-heap by severity, then age)</H2>
      {a.length === 0 ? <p className="text-mute">No open alerts.</p> : (
        <>
          <svg viewBox={`0 0 760 ${Math.floor(Math.log2(a.length)) * 60 + 70}`} className="w-full">{draw(0, 380, 30, 180)}</svg>
          <div className="mt-2 flex flex-wrap gap-1">{a.map((x: any, i: number) => <span key={i} className="rounded border border-line px-2 py-0.5 text-xs"><span className="text-mute">[{i}]</span> {x.severity}</span>)}</div>
          <p className="mt-3 text-sm text-mute">Stored as an array: index i has children 2i+1 and 2i+2. Each parent is at least as urgent as its children, so the top is always the next alert to handle. Popping order: {o.heap.ordered.map((x: any) => x.severity).join(", ")}.</p>
        </>
      )}
      <p className="mt-2 text-sm text-mute">The same heap merges an item's own records with its carton's and pallet's records into one timeline (k-way merge, O(N log k)).</p>
      <Code>shared/dsa/heap.ts → BinaryHeap.push / pop, kWayMerge · server/logic.ts → alertHeap, history</Code>
    </Card>
  );
}

function KnapDemo() {
  const [items, setItems] = useState([
    { id: "R1", cost: 6, staff: 1, risk: 30 },
    { id: "R2", cost: 5, staff: 1, risk: 24 },
    { id: "R3", cost: 5, staff: 2, risk: 22 },
    { id: "R4", cost: 4, staff: 1, risk: 15 },
  ]);
  const [B, setB] = useState(10);
  const [S, setS] = useState(3);
  const dp = useMemo(() => knapsack2D(items, B, S), [items, B, S]);
  const gr = useMemo(() => greedyAllocate(items, B, S), [items, B, S]);
  const upd = (i: number, k: string, v: number) => setItems(items.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  return (
    <Card>
      <H2>Two-limit 0/1 knapsack: dynamic programming vs greedy</H2>
      <p className="mb-3 text-sm text-mute">dp[i][b][s] = max(dp[i−1][b][s], dp[i−1][b − costᵢ][s − staffᵢ] + riskᵢ). Edit the numbers; the answer is recomputed live. The Regulator → Recall page runs this on real recall data.</p>
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase text-mute"><tr><th>Site</th><th>Cost ₹k</th><th>Inspectors</th><th>Risk</th><th>DP</th><th>Greedy</th></tr></thead>
        <tbody>
          {items.map((x, i) => (
            <tr key={x.id} className="border-t border-line">
              <td className="py-1">{x.id}</td>
              {(["cost", "staff", "risk"] as const).map((k) => <td key={k}><Input type="number" className="!w-20 !py-1" value={x[k]} onChange={(e) => upd(i, k, Math.max(0, Number(e.target.value)))} /></td>)}
              <td className="text-mint">{dp.result.chosen.includes(x.id) ? "✓" : ""}</td>
              <td className="text-amber">{gr.chosen.includes(x.id) ? "✓" : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <Field label={`Budget ₹${B}k`}><input type="range" min={1} max={25} value={B} onChange={(e) => setB(Number(e.target.value))} className="w-full accent-[#02C39A]" /></Field>
        <Field label={`Inspectors ${S}`}><input type="range" min={1} max={6} value={S} onChange={(e) => setS(Number(e.target.value))} className="w-full accent-[#02C39A]" /></Field>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-mint/40 bg-mint/10 p-3"><div className="text-xs text-mint">DP (exact)</div><div className="font-display text-2xl">{dp.result.risk}</div><div className="text-xs text-mute">{dp.result.chosen.join(" + ") || "none"} · {dp.cells} cells</div></div>
        <div className="rounded-xl border border-amber/40 bg-amber/10 p-3"><div className="text-xs text-amber">Greedy</div><div className="font-display text-2xl">{gr.risk}</div><div className="text-xs text-mute">{gr.chosen.join(" + ") || "none"}</div></div>
      </div>
      <Code>shared/dsa/knapsack.ts → knapsack2D (table + walk-back), greedyAllocate</Code>
    </Card>
  );
}

function TrieDemo() {
  const [q, setQ] = useState("B-10");
  const [r, setR] = useState<any>(null);
  useEffect(() => {
    api(`/dsa/trie?q=${encodeURIComponent(q)}`, { auth: false }).then(setR);
  }, [q]);
  const draw = (n: any, d: number): ReactNode => n && (
    <div style={{ marginLeft: d ? 16 : 0 }} key={n.label + d}>
      <span className={`mono text-xs ${d === 0 ? "text-mint" : "text-sea"}`}>{n.label}</span> <span className="text-[10px] text-mute">({n.count}{n.end ? ", end" : ""})</span>
      {n.children.map((c: any) => draw(c, d + 1))}
    </div>
  );
  return (
    <Card>
      <H2>Trie: prefix search over every batch, item, carton and pallet id</H2>
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type a prefix" className="mono" />
      {r && (
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <div><div className="text-xs text-mute">Walked {q.length} edges, found {r.search.total} ids below that node</div><ul className="mt-1 space-y-0.5">{r.search.keys.map((k: string) => <li key={k} className="mono text-sm">{k}</li>)}</ul></div>
          <div className="max-h-80 overflow-y-auto rounded-xl border border-line bg-abyss/60 p-3"><div className="mb-1 text-xs text-mute">The trie below “{q || "root"}”, 3 levels (count = ids underneath)</div>{draw(r.subtree, 0)}</div>
        </div>
      )}
      <Code>shared/dsa/trie.ts → Trie.insert, search, subtree · server/app.ts → /search</Code>
    </Card>
  );
}

function AvlDemo({ o }: { o: any }) {
  const [sandbox] = useState(() => new AVLTree<string>());
  const [, force] = useState(0);
  const [d, setD] = useState("2027-01-10");
  const draw = (n: any, x: number, y: number, dx: number): ReactNode => n && (
    <g key={n.key + y}>
      {n.left && <line x1={x} y1={y} x2={x - dx} y2={y + 56} stroke="#2a5357" />}
      {n.right && <line x1={x} y1={y} x2={x + dx} y2={y + 56} stroke="#2a5357" />}
      {draw(n.left, x - dx, y + 56, dx / 2)}
      {draw(n.right, x + dx, y + 56, dx / 2)}
      <rect x={x - 38} y={y - 14} width={76} height={28} rx={8} fill="#062c30" stroke={Math.abs(n.balance) > 1 ? "#D96C6C" : "#00A896"} />
      <text x={x} y={y + 2} textAnchor="middle" fontSize="10" fill="#e7f4f2">{n.key}</text>
      <text x={x} y={y + 24} textAnchor="middle" fontSize="8" fill="#8fb3ae">bal {n.balance}</text>
    </g>
  );
  return (
    <div className="grid gap-6">
      <Card>
        <H2 right={<Badge tone="teal">height {o.avl.height}</Badge>}>Live index: batches by expiry date</H2>
        <svg viewBox="0 0 760 240" className="w-full">{draw(o.avl.tree, 380, 24, 170)}</svg>
        <p className="text-sm text-mute">Used by Regulator → Expiring for “what expires in the next N days” range queries.</p>
      </Card>
      <Card>
        <H2>Try it: insert dates and watch the rotations</H2>
        <div className="flex gap-2">
          <Input type="date" value={d} onChange={(e) => setD(e.target.value)} />
          <Button onClick={() => { sandbox.insert(d, d); const n = new Date(d); n.setDate(n.getDate() + 10); setD(n.toISOString().slice(0, 10)); force((x) => x + 1); }}>Insert</Button>
        </div>
        <p className="mt-2 text-sm text-mute">Insert dates in increasing order: a plain binary search tree would turn into a chain, but AVL rotates to keep the height near log₂ n.</p>
        <svg viewBox="0 0 760 260" className="w-full">{draw(sandbox.snapshot(), 380, 24, 170)}</svg>
        <div className="text-sm">Height {sandbox.height}. Rotations: {sandbox.rotations.slice(-4).join("; ") || "none yet"}</div>
      </Card>
      <Code>shared/dsa/avl.ts → AVLTree.insert (rotLeft / rotRight), range · server/app.ts → /expiring</Code>
    </div>
  );
}

function GeoDemo() {
  const [a, setA] = useState({ lat: 17.39, lng: 78.49 });
  const [b, setB] = useState({ lat: 28.61, lng: 77.21 });
  const [mins, setMins] = useState(40);
  const km = haversineKm(a, b);
  const speed = impliedSpeedKmh({ ...a, ts: 0 }, { ...b, ts: mins * 60_000 });
  return (
    <Card>
      <H2>Haversine distance and the impossible-travel check</H2>
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Scan 1 (lat, lng)"><div className="flex gap-1"><Input value={a.lat} onChange={(e) => setA({ ...a, lat: Number(e.target.value) })} /><Input value={a.lng} onChange={(e) => setA({ ...a, lng: Number(e.target.value) })} /></div></Field>
        <Field label="Scan 2 (lat, lng)"><div className="flex gap-1"><Input value={b.lat} onChange={(e) => setB({ ...b, lat: Number(e.target.value) })} /><Input value={b.lng} onChange={(e) => setB({ ...b, lng: Number(e.target.value) })} /></div></Field>
        <Field label={`Minutes between scans: ${mins}`}><input type="range" min={5} max={2880} value={mins} onChange={(e) => setMins(Number(e.target.value))} className="w-full accent-[#02C39A]" /></Field>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-line p-3"><div className="text-xs text-mute">Distance</div><div className="font-display text-2xl">{Math.round(km).toLocaleString()} km</div></div>
        <div className={`rounded-xl border p-3 ${speed > 900 ? "border-violet bg-violet/10" : "border-mint/40 bg-mint/10"}`}><div className="text-xs text-mute">Implied speed (limit 900 km/h)</div><div className="font-display text-2xl">{Math.round(speed).toLocaleString()} km/h</div><div className="text-xs">{speed > 900 ? "Impossible for one item: flagged as Suspicious Clone" : "Possible"}</div></div>
      </div>
      <Code>shared/geo.ts → haversineKm, impliedSpeedKmh · server/logic.ts → verifyScan (T1 checks)</Code>
    </Card>
  );
}
