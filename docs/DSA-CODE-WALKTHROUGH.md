# UniGenome: DSA code walkthrough

This document explains every data structure and algorithm in UniGenome, and shows the exact code that implements it. For each topic you get:

- **Why we need it**: the problem in the app that it solves.
- **Where it is**: the file and function, so you can open it.
- **The code**, with an explanation of what each part does.
- **Complexity**.
- **Where it is used**: the places in the app that call it.
- **See it live**: where to show it in the running app (load the demo data from the home page first).

All the data structures are written by hand in `shared/dsa/`. They are not library calls. The only library code is the raw SHA-256 and Ed25519 maths (`@noble/hashes`, `@noble/curves`), because writing your own cryptography is unsafe.

## Map of topics

| # | Topic | File | Main functions | Used for |
|---|---|---|---|---|
| 1 | SHA-256 hashing | `shared/crypto.ts`, `shared/identity.ts` | `sha256Hex`, `hashOf`, `dnaOf` | Each item's DNA0 fingerprint, record hashes, Merkle nodes |
| 2 | Digital signatures (Ed25519) | `shared/crypto.ts` | `signMessage`, `verifyMessage` | Signing items, records, logins, approvals |
| 3 | Hash map / hash set | `shared/dsa/hashmap.ts` | `HashMap.set/get/grow`, `HashSet` | Key registry, revoked keys, last-scan index |
| 4 | Hash chain (linked list by hashes) | `shared/events.ts`, `server/app.ts` | `eventHash`, `verifyChain`, `appendEvent` | Tamper-evident custody history |
| 5 | Merkle tree | `shared/dsa/merkle.ts` | `buildLevels`, `merkleRoot`, `merkleProof`, `verifyProof` | One carton QR stands for all items inside; spot checks |
| 6 | Tree + DFS | `shared/dsa/tree.ts`, `server/logic.ts` | `dfsCollect`, `ancestors`, `subtree` | One pallet/carton scan updates every item |
| 7 | Graph + BFS | `shared/dsa/graph.ts`, `server/logic.ts` | `Graph`, `bfs`, `recallAnalysis` | Recall: who received the batch |
| 8 | Dijkstra | `shared/dsa/graph.ts`, `server/logic.ts` | `dijkstra`, `estimateArrival` | Expected arrival date, overdue alerts |
| 9 | Binary heap (priority queue) + k-way merge | `shared/dsa/heap.ts`, `server/logic.ts` | `BinaryHeap.push/pop`, `kWayMerge`, `alertHeap`, `history` | Alerts by urgency; merged timelines |
| 10 | 0/1 knapsack (DP) vs greedy | `shared/dsa/knapsack.ts` | `knapsack2D`, `greedyAllocate` | Choosing which sites to inspect in a recall |
| 11 | Trie | `shared/dsa/trie.ts` | `Trie.insert`, `search` | Search by id prefix |
| 12 | AVL tree | `shared/dsa/avl.ts` | `AVLTree.insert`, `rotLeft/rotRight`, `range` | "What expires in the next N days" |
| 13 | Haversine + speed check | `shared/geo.ts`, `server/logic.ts` | `haversineKm`, `impliedSpeedKmh`, `verifyScan` | Clone detection (impossible travel) |

The in-memory indexes that hold structures 3, 11 and 12 are built in `server/indexes.ts` from the database when the server starts.

---

## 1. SHA-256 hashing

**Why we need it.** We need a short fingerprint of an item's details (product, batch, dates, a random salt) that changes completely if even one character changes. That fingerprint is the item's **DNA0**. The same idea gives each custody record a hash, and builds the Merkle tree.

**Where it is.** `shared/crypto.ts` and `shared/identity.ts`

```ts
// shared/crypto.ts
export const sha256Hex = (data: string | Uint8Array): string =>
  toHex(sha256(typeof data === "string" ? utf8(data) : data));

export const hashOf = (domain: string, body: unknown): string =>
  sha256Hex(domain + "\n" + canonical(body));

// shared/identity.ts
export const dnaOf = (f: UnitFields): string => hashOf(DOMAIN[f.kind], f);
```

**How it works.**

- `canonical(body)` (in `shared/bytes.ts`) turns the object into JSON with its keys **sorted**. Without that, `{a:1,b:2}` and `{b:2,a:1}` would give different hashes for the same data.
- A **domain tag** such as `"UG/item"` is put in front, so an item hash can never be confused with a record hash.
- `sha256` gives 32 bytes, shown as 64 hex characters.
- The random **salt** in each item stops anyone from guessing valid item details and computing their hashes.

**Complexity.** O(n) in the length of the input. The output is always 32 bytes.

**Where it is used.** `dnaOf` when an item is issued (`src/pages/portals/Manufacturer.tsx` → `Issue`) and when any QR is checked (`server/logic.ts` → `verifyScan`: `row.dna === dnaOf(f)`). `hashOf` is used by every record hash (`shared/events.ts` → `eventHash`) and the claim code hash (`server/logic.ts` → `hashClaim`).

**See it live.** Manufacturer → **2 · Issue items**: the browser computes each item's DNA0 as the SHA-256 of its fields. Change one letter of a field and the whole hash changes (the avalanche effect), which is why an edited QR fails on the buyer page.

---

## 2. Digital signatures (Ed25519)

**Why we need it.** Anyone can compute a hash, so a hash alone doesn't prove who made the item. A **signature** made with the manufacturer's **private key** can be checked by anyone with the **public key**, but cannot be made without the private key. That is why a phone can prove a QR is genuine, even offline.

**Where it is.** `shared/crypto.ts`

```ts
export function signMessage(domain: string, body: unknown, secretKeyHex: string): string {
  const msg = utf8(domain + "\n" + canonical(body));
  return toB64url(ed25519.sign(msg, fromHex(secretKeyHex)));
}

export function verifyMessage(domain: string, body: unknown, sigB64: string, publicKeyHex: string): boolean {
  try {
    const msg = utf8(domain + "\n" + canonical(body));
    return ed25519.verify(fromB64url(sigB64), msg, fromHex(publicKeyHex));
  } catch {
    return false;
  }
}
```

and in `shared/identity.ts`, the item's signature is over its DNA0:

```ts
export function signUnit(f: UnitFields, secretKeyHex: string): SignedUnit {
  return { f, sig: signMessage(DOMAIN[f.kind], { dna: dnaOf(f) }, secretKeyHex) };
}
```

**How it works.**

- Each company makes its own key pair **in the browser** when it registers (`src/pages/Register.tsx`). The private key is encrypted with the passphrase (PBKDF2 + AES-GCM, `shared/keystore.ts`) before it is stored, so the server never sees it in plain form.
- The domain tag (`UG/item`, `UG/event`, `UG/login`, `UG/endorse` ...) means a signature made for one purpose can't be reused for another.
- `verifyMessage` returns `false` instead of throwing on bad input, so a garbage QR just fails the check.

**Complexity.** Signing and verifying take constant time (a fixed amount of curve arithmetic), about 0.1 ms. Signature size: 64 bytes.

**Where it is used.** Issuing items and packing cartons (browser signs), every scan record (`src/lib/record.ts`), login challenge (`src/lib/session.tsx` + `server/app.ts` `/auth/login`), partner approval (`src/components/Approvals.tsx`), batch co-signing by the quality approver. The buyer's phone checks the item signature **offline** in `src/pages/portals/Buyer.tsx` (`verifyUnit(u, p.publicKey)` with cached public keys).

**See it live.** Buyer → scan any genuine item: "Signature checked on your phone (works offline)". Edit one letter of the code in the link and scan again: the signature fails and the verdict is Counterfeit.

---

## 3. Hash map and hash set

**Why we need it.** Every scan needs "who signed this, and what is their public key?" and "was their key revoked?". These lookups must be fast however many companies there are. A hash map gives average O(1) lookups.

**Where it is.** `shared/dsa/hashmap.ts`

```ts
function fnv1a(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

bucketOf(key: string) {
  return fnv1a(key) % this.buckets.length;
}

get(key: string): V | undefined {
  for (const [k, v] of this.buckets[this.bucketOf(key)]) if (k === key) return v;
  return undefined;
}

set(key: string, value: V) {
  const b = this.buckets[this.bucketOf(key)];
  for (const pair of b) {
    if (pair[0] === key) { pair[1] = value; return; }   // key exists: update
  }
  b.push([key, value]);                                  // new key: add to bucket
  this.count++;
  if (this.count / this.buckets.length > this.maxLoad) this.grow();
}

private grow() {
  const old = this.buckets;
  this.buckets = Array.from({ length: old.length * 2 }, () => []);
  this.resizes++;
  for (const b of old) for (const [k, v] of b) this.buckets[this.bucketOf(k)].push([k, v]);
}
```

**How it works.**

- **Hash function**: FNV-1a mixes every character of the key into a 32-bit number. `% buckets.length` picks the bucket.
- **Collisions** are handled by **separate chaining**: each bucket is a small list, and `get` scans only that one list.
- **Load factor** = keys / buckets. When it passes 0.75, `grow()` doubles the bucket count and **re-hashes** every key, so the lists stay short.
- `HashSet` (same file) is a hash map that stores only keys. It holds the revoked keys.

**Complexity.** Average O(1) for get/set/delete; worst case O(n) if every key landed in one bucket. Growing costs O(n), but it happens rarely, so the cost per insert averages out to O(1).

**Where it is used.** `server/indexes.ts` builds three of them:

- `parties`: party id → name, role, public key. Used in `verifyScan` (`ix.parties.get(signerOf(f))`) and when checking every record's signature.
- `revoked`: a `HashSet` of revoked party ids (`ix.revoked.has(signer.id)`), filled by the regulator's **Revoke** button.
- `lastSeen`: unit id → last place and time it was scanned, for the clone check in topic 13.

**See it live.** It has no screen of its own: every portal lookup by id (scan, shipments, alerts) goes through these maps. The unit tests (`npm test`) check growing and collisions.

---

## 4. Hash chain (custody history)

**Why we need it.** The history of an item (manufactured, dispatched, received, sold) must be **tamper-evident**: if someone edits or deletes an old record in the database, it must show. Each record stores the hash of the record before it, like a linked list where the "pointer" is a hash.

**Where it is.** `shared/events.ts` and `server/app.ts`

When a record is added (`server/app.ts` → `appendEvent`):

```ts
const unit = (await q("SELECT id, head FROM units WHERE id = $1 FOR UPDATE", [body.unit]))[0];
if (body.prev !== unit.head) bad("Someone else recorded a scan on this unit first. Scan again.", 409);
const hash = eventHash(body, sig);
// ... insert the record ...
await q("UPDATE units SET head = $1 WHERE id = $2", [hash, body.unit]);
```

When the chain is checked (`shared/events.ts` → `verifyChain`):

```ts
export function verifyChain(records, publicKeyOf): ChainCheck {
  let prev = "0";
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (r.body.prev !== prev) return { ok: false, brokenAt: i, reason: "link to previous record does not match" };
    if (eventHash(r.body, r.sig) !== r.hash) return { ok: false, brokenAt: i, reason: "record content was changed" };
    const pk = publicKeyOf(r.body.actor);
    if (!pk || !verifyEvent(r.body, r.sig, pk)) return { ok: false, brokenAt: i, reason: "signature does not verify" };
    prev = r.hash;
  }
  return { ok: true, brokenAt: null };
}
```

**How it works.**

- `units.head` is the hash of the newest record, like the **tail pointer** of a linked list.
- A new record must say `prev = head`. If two people scan at the same moment, the second gets a 409 error and must rescan. That way the list never branches.
- Each record also has the GPS location, time, site and the person's **signature**, so nobody can add a record in someone else's name.
- `verifyChain` walks from the first record and recomputes each hash. Changing record *i* changes its hash, so record *i+1*'s `prev` no longer matches, and the break is found.

**Complexity.** Adding a record: O(1). Checking a chain of k records: O(k).

**Where it is used.** Every scan (`POST /api/events`), and the chain check shown on each unit card ("Hash chain intact") in `server/app.ts` → `unitView`.

**See it live.** Buyer → scan an item: "Custody records unbroken (hash chain of N records)". The e2e test (`npm run e2e`) edits one record through `GET /dsa/chain/:id?tamper=1` and shows the check fail from that record on.

---

## 5. Merkle tree (one carton QR for many items)

**Why we need it.** A carton holds 24 or 48 items. We want **one QR on the carton** that the manufacturer signs once and that commits to exactly which items are inside. Later, anyone can prove one item belongs to that carton with only a few hashes.

**Where it is.** `shared/dsa/merkle.ts`

```ts
export const leafHash = (id: string) => sha256Hex("leaf:" + id);
const nodeHash = (l: string, r: string) => sha256Hex("node:" + l + r);

export function buildLevels(leafIds: string[]): string[][] {
  const levels: string[][] = [leafIds.map(leafHash)];
  while (levels[levels.length - 1].length > 1) {
    const prev = levels[levels.length - 1];
    const next: string[] = [];
    for (let i = 0; i < prev.length; i += 2) next.push(nodeHash(prev[i], prev[i + 1] ?? prev[i]));
    levels.push(next);
  }
  return levels;
}

export function merkleProof(leafIds: string[], index: number): ProofStep[] {
  const levels = buildLevels(leafIds);
  const proof: ProofStep[] = [];
  let i = index;
  for (let lv = 0; lv < levels.length - 1; lv++) {
    const level = levels[lv];
    const isRight = i % 2 === 1;
    const sib = isRight ? level[i - 1] : level[i + 1] ?? level[i];
    proof.push({ hash: sib, side: isRight ? "L" : "R" });
    i = Math.floor(i / 2);
  }
  return proof;
}

export function verifyProof(leafId: string, proof: ProofStep[], root: string): boolean {
  let h = leafHash(leafId);
  for (const step of proof) h = step.side === "L" ? nodeHash(step.hash, h) : nodeHash(h, step.hash);
  return h === root;
}
```

**How it works.**

- **Leaves** are the hashes of the item ids (sorted, so the order is fixed). Each level hashes pairs from the level below. An odd node at the end is paired with itself. The single hash at the top is the **root**.
- The root goes into the carton's fields, and the manufacturer **signs** those fields, so the root is on the signed carton QR.
- A **proof** for one item is the sibling hash at each level, about log₂(n) hashes. `verifyProof` rebuilds the path to the root from the item and those siblings, and compares with the signed root.
- The `"leaf:"` and `"node:"` prefixes stop an attacker from passing an inner node off as a leaf.

**Complexity.** Building: O(n). Proof size and check: O(log n). For 48 items that is 6 hashes, not 48.

**Where it is used.**

- Packing: the browser computes `merkleRoot(children)` (`src/pages/portals/Manufacturer.tsx` → `Pack`), and the server recomputes and rejects a mismatch (`server/app.ts`: `if (merkleRoot(sorted) !== f.root) bad(...)`).
- **Random spot checks**: when a retailer opens a carton, the server picks random items and sends `merkleProof` for each (`server/app.ts`, `UNPACKED`). The retailer scans those items and the browser checks `verifyProof` locally (`src/components/ScanAct.tsx` → `spotScan`). This catches an item swapped into the carton.

**See it live.** Manufacturer → **3 · Pack**: the carton QR carries the Merkle root of its items. Warehouse → scan the carton → **Receive**: the server asks for a spot check of random items, each proved with its Merkle path.

---

## 6. Tree and depth-first search (one scan updates every item)

**Why we need it.** Items sit in cartons, cartons sit on pallets: a **tree**. When a warehouse scans the **pallet's** QR, every carton and item inside must be updated, and later each item's history must include what happened to its pallet.

**Where it is.** `shared/dsa/tree.ts` and `server/logic.ts`

```ts
// shared/dsa/tree.ts
export function dfsCollect(root: string, children: (id: string) => string[]): string[] {
  const order: string[] = [];
  const stack = [root];
  while (stack.length) {
    const u = stack.pop()!;
    order.push(u);
    const kids = children(u);
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]); // keep left-to-right order
  }
  return order;
}

export function ancestors(id: string, parent: (id: string) => string | null): string[] {
  const out: string[] = [];
  let p = parent(id);
  while (p) { out.push(p); p = parent(p); }
  return out;
}
```

```ts
// server/logic.ts → subtree
const order = dfsCollect(id, (x) => kids.get(x) ?? []);
return { order, items: order.filter((x) => kind.get(x) === "item"), kind, kids };
```

**How it works.**

- Each unit row has a `parent_id`, so the tree is stored as **parent pointers**. `subtree` loads the rows below a container and builds a children list for each node.
- `dfsCollect` is **iterative DFS** with an explicit **stack**: pop a node, record it, push its children (in reverse, so they come out left to right). It goes deep into one carton before moving to the next.
- **The scan itself is one record on the pallet.** Items don't each get a copy. Instead, an item's history includes its containers' records for the time it was inside them (see `historyLists` in topic 9). That is why one scan "updates" 48 items at O(1) write cost, and the DFS gives the count ("48 items updated by this one scan") and refreshes the last-seen index for every item.
- `ancestors` walks the **other** way, item → carton → pallet, to find who effectively holds an item while it is packed.

**Complexity.** DFS: O(n) for n units in the subtree. Ancestors: O(depth), at most 2 here.

**Where it is used.** `server/app.ts` scan endpoint (`itemsInside: sub.items.length`, and the `lastSeen` update loop), `server/logic.ts` → `effectiveCustody`, `topOf`, and the recall analysis.

**See it live.** Scan a carton in the warehouse portal and press **Receive**: "12 items updated by this one scan".

---

## 7. Graph and breadth-first search (recall)

**Why we need it.** When a batch is recalled, the regulator must find **every company the batch reached**, in order of distance from the factory. The companies and the shipments between them form a **directed graph**.

**Where it is.** `shared/dsa/graph.ts` and `server/logic.ts` → `recallAnalysis`

```ts
// shared/dsa/graph.ts
export class Graph {
  readonly adj = new Map<string, Array<{ to: string; w: number }>>();   // adjacency list
  addEdge(from: string, to: string, w = 1) { ... }
}

export function bfs(g: Graph, start: string) {
  const dist = new Map<string, number>([[start, 0]]);
  const order: string[] = [];
  const steps: BfsStep[] = [];
  const queue: string[] = [start];
  let head = 0; // index of the queue's front, so dequeue is O(1)
  while (head < queue.length) {
    const u = queue[head++];
    order.push(u);
    for (const { to } of g.adj.get(u) ?? []) {
      if (!dist.has(to)) {
        dist.set(to, dist.get(u)! + 1);
        queue.push(to);
      }
    }
    steps.push({ visit: u, queue: queue.slice(head) });
  }
  return { order, dist: Object.fromEntries(dist), steps };
}
```

```ts
// server/logic.ts → recallAnalysis
const ships = await d.query("SELECT * FROM shipments WHERE unit_id = ANY($1)", [[...touched]]);
const g = new Graph();
g.addNode(batch.mfr);
for (const s of ships) g.addEdge(s.from_party, s.received_by ?? s.to_party);
const result = bfs(g, batch.mfr);
```

**How it works.**

- **Nodes** are companies; an **edge** A → B means A shipped a carton or pallet holding this batch to B. The edges come from real dispatch/receive records, not from a guess.
- `touched` first finds every container that ever held an item of the batch (walking pack links upward), so shipments of whole pallets count too.
- **BFS** uses a FIFO **queue**: it visits the factory (distance 0), then everyone the factory shipped to (distance 1), then their customers (distance 2), and so on. `dist` doubles as the "visited" set so no company is visited twice.
- `steps` records the queue after each visit so the page can replay it.

**Complexity.** O(V + E).

**Where it is used.** Regulator portal → **Recall** (`src/pages/portals/Regulator.tsx`), `GET /api/recall/:batch`.

**See it live.** Regulator → Recall: press **Replay BFS** or step through it, with the real queue shown below the graph.

---

## 8. Dijkstra's shortest path (expected arrival)

**Why we need it.** When a warehouse dispatches a pallet, we want an **expected arrival date**, so a late or missing shipment raises an alert. The travel time between two companies is learned from past deliveries, and a shipment may go through a hub, so we need the **fastest route** in a weighted graph.

**Where it is.** `shared/dsa/graph.ts` → `dijkstra`, used in `server/logic.ts` → `routeGraph`, `estimateArrival`

```ts
export function dijkstra(g: Graph, src: string) {
  const dist = new Map<string, number>();
  const prev = new Map<string, string>();
  const settled: string[] = [];
  for (const n of g.nodes) dist.set(n, Infinity);
  dist.set(src, 0);
  const heap = new BinaryHeap<[number, string]>((a, b) => a[0] < b[0]);  // min-heap on distance
  heap.push([0, src]);
  const done = new Set<string>();
  while (heap.size) {
    const [d, u] = heap.pop()!;
    if (done.has(u)) continue; // stale heap entry
    done.add(u);
    settled.push(u);
    for (const { to, w } of g.adj.get(u) ?? []) {
      const nd = d + w;
      if (nd < (dist.get(to) ?? Infinity)) {   // relaxation
        dist.set(to, nd);
        prev.set(to, u);
        heap.push([nd, to]);
      }
    }
  }
  // pathTo(t) follows prev[] back from t to src
  ...
}
```

**How it works.**

- **Edge weight** = average hours between a dispatch and its receipt for that pair of companies, computed in SQL in `routeGraph` from real shipments.
- Dijkstra always takes the **closest unsettled** company from a **min-heap** (topic 9), fixes its distance, and **relaxes** its outgoing edges: if going through it is faster, update the neighbour.
- Instead of a decrease-key operation, it pushes a new heap entry and skips old ones (`done` check). That is simpler and has the same complexity.
- `prev` lets `pathTo` rebuild the route (e.g. Pune → Mumbai → Hyderabad).
- If there is no history yet for a pair, `estimateArrival` falls back to distance ÷ 40 km/h + 12 h, and says so on screen.
- The alert margin is based on the spread (standard deviation) of past delivery times, so routes that vary a lot get more slack.

**Complexity.** O((V + E) log V).

**Where it is used.** Dispatch form (shows "Expected arrival ..."), `POST /api/events` with `DISPATCHED` stores `eta_ts`, and `sweepOverdue` raises an **overdue** alert when a shipment is past its ETA plus margin.

**See it live.** Dispatch a carton from any portal: the result shows "Expected arrival … fastest known route: A → B → C". The Deliveries list has an "Expected by" column, and late shipments raise an overdue alert.

---

## 9. Binary heap (priority queue) and k-way merge

**Why we need it.** (a) Alerts arrive all the time (counterfeit scans, possible copies, cold-chain failures, complaints). The regulator must always see the **most urgent first**, and the oldest first among equally urgent ones. (b) An item's timeline is several sorted lists (its own records, its carton's records, its pallet's records) that must be merged into one sorted list.

**Where it is.** `shared/dsa/heap.ts`

```ts
push(x: T) {
  this.a.push(x);                         // add at the end
  let i = this.a.length - 1;
  while (i > 0) {                         // sift up
    const p = (i - 1) >> 1;               // parent index
    if (!this.less(this.a[i], this.a[p])) break;
    [this.a[i], this.a[p]] = [this.a[p], this.a[i]];
    i = p;
  }
}

pop(): T | undefined {
  const n = this.a.length;
  if (n === 0) return undefined;
  const top = this.a[0];
  const last = this.a.pop()!;
  if (n > 1) {
    this.a[0] = last;                     // move last to the root
    let i = 0;
    for (;;) {                            // sift down
      const l = 2 * i + 1, r = l + 1;
      let best = i;
      if (l < this.a.length && this.less(this.a[l], this.a[best])) best = l;
      if (r < this.a.length && this.less(this.a[r], this.a[best])) best = r;
      if (best === i) break;
      [this.a[i], this.a[best]] = [this.a[best], this.a[i]];
      i = best;
    }
  }
  return top;
}

export function kWayMerge<T>(lists: T[][], key: (x: T) => number): T[] {
  const heap = new BinaryHeap<{ v: T; li: number; i: number }>((x, y) => key(x.v) < key(y.v));
  lists.forEach((l, li) => l.length && heap.push({ v: l[0], li, i: 0 }));
  const out: T[] = [];
  while (heap.size) {
    const { v, li, i } = heap.pop()!;
    out.push(v);
    if (i + 1 < lists[li].length) heap.push({ v: lists[li][i + 1], li, i: i + 1 });
  }
  return out;
}
```

**How it works.**

- The heap is stored as a plain **array**: index i has children 2i+1 and 2i+2, and parent ⌊(i−1)/2⌋. The **heap property**: every parent comes out before its children, so the top (index 0) is always next.
- `push` adds at the end and **sifts up**; `pop` moves the last element to the top and **sifts down**.
- The comparison is passed in, so the same class is a max-heap for alerts and a min-heap for Dijkstra and merging.
- **Alerts** (`server/logic.ts` → `alertHeap`):
  ```ts
  new BinaryHeap<any>((x, y) => x.severity > y.severity || (x.severity === y.severity && Number(x.ts) < Number(y.ts)));
  ```
  Severity 5 = counterfeit, 4 = possible copy or diverted shipment, 3 = failed condition check, complaints 1 to 5 (higher with the hidden code).
- **k-way merge**: put the first element of each list in a min-heap; repeatedly pop the smallest and push the next element from the same list.

**Complexity.** push/pop O(log n), peek O(1). k-way merge of N records from k lists: O(N log k).

**Where it is used.** Alerts queue in every portal (`src/components/Alerts.tsx`, with the raw heap array shown), Dijkstra (topic 8), and `server/logic.ts` → `history`:
```ts
const lists = await historyLists(unitId, 0, Number.MAX_SAFE_INTEGER, null);
const merged = kWayMerge(lists, (e) => Number(e.ts)); // O(N log k) merge with a heap
```
`historyLists` returns the item's own records plus each container's records **only for the time window the item was inside it** (from `pack_links.from_ts` to `to_ts`).

**See it live.** Regulator → Alerts shows the heap's stored array above the list, most severe first.

---

## 10. 0/1 knapsack with two limits (dynamic programming) vs greedy

**Why we need it.** In a recall, the regulator has a limited **budget** and a limited number of **inspectors**. Each site has a cost to visit (more for far sites), needs 1 or 2 inspectors, and has a **risk** score (complaints, alerts, units still on the shelf). Which sites should be inspected to cover the most risk? Each site is either visited or not: a **0/1 knapsack** with **two** capacity limits.

**Where it is.** `shared/dsa/knapsack.ts`

```ts
// dp[i][b][s] = best total risk using the first i candidates with budget b and s inspectors.
for (let i = 1; i <= n; i++) {
  const it = items[i - 1];
  for (let b = 0; b <= B; b++) {
    for (let s = 0; s <= S; s++) {
      let best = dp[i - 1][b][s];                                   // skip site i
      if (it.cost <= b && it.staff <= s)
        best = Math.max(best, dp[i - 1][b - it.cost][s - it.staff] + it.risk);   // take site i
      dp[i][b][s] = best;
    }
  }
}
// Walk back through the table to recover which candidates were taken.
let b = B, s = S;
for (let i = n; i >= 1; i--) {
  if (dp[i][b][s] !== dp[i - 1][b][s]) {     // value changed, so site i was taken
    chosen.unshift(items[i - 1].id);
    b -= items[i - 1].cost;
    s -= items[i - 1].staff;
  }
}
```

```ts
// greedyAllocate: sort by risk per rupee, take while it fits
const sorted = [...items].sort((a, b) => b.risk / b.cost - a.risk / a.cost);
for (const it of sorted) if (fits(it)) take(it);
```

**How it works.**

- **State**: `dp[i][b][s]` = the best risk using only the first i sites with budget b and s inspectors.
- **Choice** for site i: skip it (`dp[i-1][b][s]`) or take it if it fits (`dp[i-1][b-cost][s-staff] + risk`). Take the larger.
- **Answer**: `dp[n][B][S]`. **Walk-back** recovers the chosen sites.
- The inputs come from real data in `recallAnalysis` (topic 7): `risk = 10 × complaints + 5 × alerts + units held + 1`, `cost = 1 + round(km / 50)` thousand rupees, `staff = 2` if the site holds more than 20 units.
- **Greedy** is fast but can be wrong. Example (also in `tests/shared.test.ts`): budget 10, 3 inspectors, sites R1 (6, 1, 30), R2 (5, 1, 24), R3 (5, 2, 22), R4 (4, 1, 15). Greedy takes R1 + R4 = **45**; DP finds R2 + R3 = **46**.

**Complexity.** DP: O(n × B × S) time and space. Greedy: O(n log n).

**Where it is used.** Regulator → **Recall** (the table, DP vs greedy result, and the DP table itself).

**See it live.** Regulator → Recall → **2 · Who to inspect**: the knapsack answer and the greedy answer side by side.

---

## 11. Trie (prefix search)

**Why we need it.** Ids look like `B-1024-007`, `C-B8B081`, `P-1E20F0`. Staff often know only the start ("everything in batch B-1024"). A trie finds all ids with a given prefix by walking only as many steps as the prefix is long.

**Where it is.** `shared/dsa/trie.ts`

```ts
insert(key: string) {
  if (this.has(key)) return;
  let n = this.root;
  n.count++;
  for (const ch of key.toUpperCase()) {
    if (!n.children.has(ch)) n.children.set(ch, node());
    n = n.children.get(ch)!;
    n.count++;                      // how many keys are at or below this node
  }
  n.end = true;
}

search(prefix: string, limit = 20) {
  const p = prefix.toUpperCase();
  const start = this.walk(p);       // follow one edge per character: O(p)
  if (!start) return { total: 0, keys: [], path: [] };
  const keys: string[] = [];
  const stack: Array<[Node, string]> = [[start, p]];
  while (stack.length && keys.length < limit) {     // DFS below the prefix node
    const [n, s] = stack.pop()!;
    if (n.end) keys.push(s);
    for (const [ch, c] of sortedChildren(n)) stack.push([c, s + ch]);
  }
  return { total: start.count, keys, path: [...p] };
}
```

**How it works.**

- Each node is one character; a path from the root spells an id. `end` marks a complete id.
- Each node keeps a `count` of ids below it, so "how many ids start with B-10" is answered in O(p) without listing them.
- `search` walks down the prefix, then does a DFS below it to list up to `limit` ids in order.

**Complexity.** Insert O(L) for an id of length L. Search O(p + k) for prefix length p and k results.

**Where it is used.** `server/indexes.ts` inserts every batch, item, carton and pallet id. `GET /api/search?q=` uses `ix.ids.search(q, 15)`.

**See it live.** The server's `GET /search?q=<prefix>` returns the matching ids (the e2e test calls it). There is no search box on screen.

---

## 12. AVL tree (expiry date range queries)

**Why we need it.** The regulator asks "which batches expire in the next 30 days?". A balanced binary search tree keyed by expiry date answers range questions quickly. A plain BST would degrade to a linked list if batches are added in date order (which is normal), so we use an **AVL** tree, which re-balances with rotations.

**Where it is.** `shared/dsa/avl.ts`

```ts
private rotRight(y: Node<V>): Node<V> {
  const x = y.left!;
  y.left = x.right;
  x.right = y;
  fix(y); fix(x);                 // recompute heights, bottom first
  return x;                       // x is the new root of this subtree
}

insert(key: string, value: V) {
  const ins = (n: Node<V> | null): Node<V> => {
    if (!n) return { key, values: [value], left: null, right: null, height: 1 };
    if (key === n.key) { n.values.push(value); return n; }
    if (key < n.key) n.left = ins(n.left);
    else n.right = ins(n.right);
    fix(n);
    const b = balanceOf(n);         // height(left) - height(right)
    if (b > 1) {                    // left-heavy
      if (key > n.left!.key) n.left = this.rotLeft(n.left!);   // left-right case
      return this.rotRight(n);                                 // left-left case
    }
    if (b < -1) {                   // right-heavy
      if (key < n.right!.key) n.right = this.rotRight(n.right!); // right-left case
      return this.rotLeft(n);                                    // right-right case
    }
    return n;
  };
  this.root = ins(this.root);
}

range(lo: string, hi: string) {
  const out = [];
  const visit = (n) => {
    if (!n) return;
    if (n.key > lo) visit(n.left);                       // left subtree may have keys >= lo
    if (n.key >= lo && n.key <= hi) out.push(...n.values);
    if (n.key < hi) visit(n.right);                      // right subtree may have keys <= hi
  };
  visit(this.root);
  return out;
}
```

**How it works.**

- Keys are dates as `YYYY-MM-DD` strings, which sort correctly as text. Several batches with the same date share one node (`values`).
- After each insert, every node on the way back up updates its height and checks its **balance factor**. If it is +2 or −2, one of the **four cases** (LL, LR, RR, RL) is fixed with one or two rotations.
- `range` is an in-order traversal that **skips** subtrees that can't contain keys in [lo, hi].

**Complexity.** Height stays ≤ about 1.44 log₂ n, so insert is O(log n) and a range query is O(log n + k).

**Where it is used.** `server/indexes.ts` (`ix.expiry.insert(exp, batchId)` for every batch), `GET /api/expiring?days=` → Regulator → **Expiring**.

**See it live.** Regulator → **Expiring**: a range query on the AVL tree for batches expiring in the next N days.

---

## 13. Haversine distance and impossible-travel detection

**Why we need it.** A QR can be photocopied. A copy shows up somewhere the real item can't be. We compare where and when the item was last scanned with the new scan: if the implied speed is faster than an airliner, one of the two is a copy. We also check that an unsold item is scanned near the shop that holds it.

**Where it is.** `shared/geo.ts` and `server/logic.ts` → `verifyScan`

```ts
// shared/geo.ts
export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function impliedSpeedKmh(a, b): number {
  const km = haversineKm(a, b);
  const hours = Math.abs(b.ts - a.ts) / 3_600_000;
  if (hours === 0) return km < 1 ? 0 : Infinity;
  return km / hours;
}
```

```ts
// server/logic.ts → verifyScan (T1 checks)
const last = ix.lastSeen.get(row.id);                 // hash map lookup (topic 3)
if (here && last) {
  const km = haversineKm(last, here);
  const speed = impliedSpeedKmh(last, here);
  const ok = km < 5 || speed <= MAX_SPEED_KMH;        // under 5 km is GPS noise
  ...
}
// unsold item held by a retailer: must be within 50 km of that shop
const km = haversineKm(s, here);
const ok = km <= SHELF_RADIUS_KM;
```

**How it works.**

- The Earth is a sphere of radius 6371 km; the **haversine formula** gives the great-circle distance between two latitude/longitude points.
- Speed = distance ÷ time. Over **900 km/h** (`MAX_SPEED_KMH`) the verdict is **Suspicious Clone**.
- Other T1 checks in the same function: the hidden claim code was already used by a different phone, more than 5 different phones scanned it, and an unsold item turns up more than 50 km from its shop.
- Buyer locations are rounded to about 1 km (`roundForPrivacy`) before they are stored.

**Complexity.** O(1) per check.

**Where it is used.** Every buyer scan (`POST /api/verify`), and every staff scan updates `lastSeen` for all items inside (topic 6).

**See it live.** Hyderabad to Delhi is about 1,254 km; in 40 minutes that is about 1,880 km/h, flagged. In the app: scan a sold item's QR from the buyer page in Hyderabad, then again with the browser location set to Delhi.

---

## Tests

`tests/shared.test.ts` checks each structure with known answers (run `npm test`):

- identity sign/verify and tamper detection, hash chain break detection
- Merkle root and proofs (48 items → 6 proof steps)
- hash map growth, heap order and k-way merge, trie prefix counts, AVL rotations and range
- BFS levels and Dijkstra route (M → W2 → W1 → R1, 2.5 h), knapsack DP 46 vs greedy 45, DFS order, haversine (Hyderabad–Delhi ≈ 1,250 km)

## Honest limits

- A photocopied QR still passes the offline signature check (T0). Copies are caught by the online checks (T1: claim code, impossible travel, location vs shop, number of phones), which need the phone to be online at some point.
- GPS can be faked on a rooted phone. We reduce the impact by also recording the site, flagging scans more than 2 km from the registered site, and flagging device clocks more than 10 minutes off server time, but software alone cannot prove a location.
- The knapsack DP is exact but its table grows with budget × inspectors, so the budget is in whole thousands of rupees.
