// Builds the feature walkthrough from one list of steps:
//   .tours/*.tour                  CodeTour files: VS Code jumps to each line and shows the explanation beside it
//   docs/FEATURE-WALKTHROUGH.md    the same walkthrough as a document, with the real code pasted in
// Each step names a file and a piece of text on the line where it starts, so line numbers are found
// automatically and stay right after the code changes. Run: npm run walkthrough
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";

const TOPIC = {
  1: "SHA-256 hashing",
  2: "Digital signatures (Ed25519)",
  3: "Hash map / hash set",
  4: "Hash chain (linked list by hashes)",
  5: "Merkle tree",
  6: "Tree + DFS",
  7: "Graph + BFS",
  8: "Dijkstra's shortest path",
  9: "Binary heap (priority queue)",
  10: "0/1 knapsack (dynamic programming) vs greedy",
  11: "Trie",
  12: "AVL tree",
  13: "Haversine distance + speed check",
};

const s = (file, at, lines, topics, title, ...text) => ({ file, at, lines, topics, title, text: text.join("\n") });

const FEATURES = [
  {
    slug: "double-scan-flag",
    title: "A QR scanned twice (a copied QR) gets flagged",
    show: [
      "1. Seller side: sell one item at the retailer (Shelf → Sell). Copy that item's QR link.",
      "2. Buyer A: open the link, and type the hidden code to claim the item. The verdict is Genuine.",
      "3. Buyer B: open the same link in a private (incognito) window. That counts as a different phone.",
      "4. The verdict is **Suspicious clone: already claimed by a buyer**. The regulator's Alerts tab shows a new 'clone' alert at the top.",
      "",
      "A second way to show it: scan in one city, then set the browser location far away (Chrome DevTools → Sensors) and scan again. The second scan is flagged as impossible travel.",
      "",
      "One honest point to make: scanning twice **from the same phone in the same place is not flagged**. A shopper often scans twice. The system flags a second scan only when it shows a copy: another phone after the item was claimed, travel that is too fast, a scan far from the shop, or too many phones.",
    ],
    steps: [
      s("src/pages/portals/Buyer.tsx", 'const r = await api("/verify"', 1, [13], "The buyer's phone sends the scan",
        "When a buyer opens a QR link, the phone sends the QR text, a **device id** (a random id saved on that phone) and its **GPS position** to the server.",
        "Every check below works on these three things."),
      s("src/lib/device.ts", 'let id = localStorage.getItem("ug.device");', 5, [], "How we tell two phones apart",
        "The first time a phone scans, it makes a random id and keeps it. A different phone (or a private window) gets a different id.",
        "This is how the server knows that *another* phone scanned the same QR."),
      s("server/app.ts", 'app.post("/verify"', 6, [], "The verify endpoint",
        "The server passes the scan to `verifyScan` with `record: true`, so this scan is saved and later scans are compared with it."),
      s("server/logic.ts", "if (row.claimed_ts && row.claimed_device !== ctx.device)", 4, [1],
        "Check 1: the item was already claimed by another phone",
        "Inside every pack there is a **hidden code**. The first genuine buyer types it in, and the server stores the time and that buyer's device id (`claimed_ts`, `claimed_device`).",
        "If the item is already claimed and **a different phone** scans it, someone has copied the printed QR. `clone = true` and the reason is written down.",
        "",
        "**Data structure:** the hidden code is never stored as plain text. Only its **SHA-256 hash** is stored (see the claim step), so even a database leak does not reveal the codes."),
      s("server/logic.ts", "const last = ix.lastSeen.get(row.id);", 12, [3, 13],
        "Check 2: impossible travel since the last scan",
        "`ix.lastSeen` is our own **hash map** (unit id → where and when it was last scanned). Looking up the last scan is O(1) on average, so this check stays fast with millions of items.",
        "",
        "`haversineKm` gives the distance on the Earth's surface between the last scan and this one. `impliedSpeedKmh` divides it by the time between the scans.",
        "If the item would have had to travel faster than **900 km/h** (`MAX_SPEED_KMH`, faster than a plane), one physical pack cannot be in both places: the QR was copied. Under 5 km is treated as GPS noise."),
      s("server/logic.ts", "if (here && f.kind === \"item\" && !row.sold_ts)", 15, [6, 13],
        "Check 3: an unsold item scanned far away from its shop",
        "If records say the item is still on a retailer's shelf (not sold), it should be near that shop. `effectiveCustody` walks **up the packaging tree** to find who holds it.",
        "If it is scanned more than **50 km** (`SHELF_RADIUS_KM`) away, the QR is being used somewhere it cannot be."),
      s("server/logic.ts", "const devices = (await d.query(\"SELECT COUNT(DISTINCT device)", 8, [],
        "Check 4: too many different phones",
        "Counts how many different phones have scanned this item. More than **5** (`MAX_DEVICES`) for one pack means the QR was photocopied and shared."),
      s("server/logic.ts", "if (clone && verdict !== \"RECALLED\") verdict = \"SUSPICIOUS_CLONE\";", 1, [],
        "Any failed check → Suspicious clone",
        "If any of the four checks set `clone = true`, the verdict becomes **SUSPICIOUS_CLONE** and the buyer sees the reasons."),
      s("server/logic.ts", "if (ctx.record) {", 11, [3, 9],
        "The scan is saved and an alert is raised",
        "The scan is stored (location rounded to about 1 km for the buyer's privacy), and `ix.lastSeen` is **updated in the hash map**, so the *next* scan is compared with this one. That is why the *second* scan is the one that gets caught.",
        "",
        "`raiseAlert` adds a **severity-4 'clone' alert**. Alerts are later ordered with a **binary heap** (see the Alerts tour), so this one shows near the top of the regulator's list. The `dedupe` key stops the same phone from raising the same alert twice."),
      s("server/app.ts", 'app.post("/claim"', 12, [1],
        "How an item gets claimed (the hidden code)",
        "If the item is already claimed, a different phone is told so (that is what makes check 1 work).",
        "Otherwise the typed code is hashed with **SHA-256** (`hashClaim`) and compared with the stored hash. Only the person holding the real pack can know the code, because it is printed *inside* the pack."),
    ],
  },
  {
    slug: "fake-qr",
    title: "A fake or edited QR is caught as counterfeit",
    show: [
      "Take any item's QR link, change one character in the part after `#`, and open it. The verdict is **Counterfeit**.",
      "Even with no internet, the first check runs on the phone.",
    ],
    steps: [
      s("src/pages/portals/Buyer.tsx", "function offlineCheck(", 12, [2, 3],
        "On the phone, even offline: check the signature",
        "The phone keeps a copy of every company's **public key**. It decodes the QR, finds the company that signed it, and checks the **Ed25519 signature**.",
        "If anyone changes even one character of the QR (product, batch, expiry), the signature no longer matches. Making a valid signature needs the manufacturer's private key, which never leaves their browser."),
      s("server/logic.ts", "const signer = ix.parties.get(signerOf(f));", 8, [2, 3],
        "On the server: who signed it, and is the signature right?",
        "`ix.parties` is our **hash map** from company id to public key. Finding the key is O(1) on average, which matters because every single scan needs it.",
        "`verifyUnit` re-computes the item's fingerprint and checks the signature against that public key."),
      s("shared/identity.ts", "export const dnaOf", 9, [1, 2],
        "The item's fingerprint (DNA0) and its signature",
        "`dnaOf` is the **SHA-256 hash** of all the item's details (product, batch, dates, and a random salt). Change one letter and the hash changes completely.",
        "`signUnit` signs that hash with the manufacturer's private key. `verifyUnit` checks it with the public key."),
      s("shared/crypto.ts", "export function signMessage", 13, [2],
        "Signing and verifying (Ed25519)",
        "Each message starts with a **domain tag** such as `UG/item` or `UG/event`, so a signature made for one purpose can never be reused for another.",
        "`canonical(body)` writes the object with sorted keys, so the same data always gives the same bytes."),
      s("server/logic.ts", "const registered = !!row && row.dna === dnaOf(f);", 2, [1],
        "Was this code ever really issued?",
        "Even a correctly signed code must be in the **issuance log** with the same DNA0. This catches codes made by a stolen key outside the normal issuing process."),
      s("server/logic.ts", "const revoked = !!signer && ix.revoked.has(signer.id);", 2, [3],
        "Has the company's key been revoked?",
        "`ix.revoked` is a **hash set**. Checking it is O(1). If a company's key was stolen, the regulator revokes it, and every code it signs is rejected from then on."),
      s("server/logic.ts", "let batch: any = null;", 8, [2],
        "Did a second person approve the batch?",
        "A batch needs two signatures: the manufacturer and a separate quality approver. Without the second one, items from the batch are counterfeit."),
    ],
  },
  {
    slug: "register-company",
    title: "A new company registers, and the regulator approves it",
    show: [
      "Register → pick Manufacturer, Warehouse or Retailer → fill in the company details and attach a certificate.",
      "The new account waits. Sign in as `regulator` → New companies → see the automatic checks and the document → approve or reject.",
      "The seeded **Fast Pharma Distributors** has a wrong GSTIN check digit and a licence number already used by another company, so its checks show red.",
    ],
    steps: [
      s("src/pages/Register.tsx", "const k = generateKeyPair();", 5, [2],
        "Keys are made in the browser",
        "The company's **Ed25519 key pair** is created on its own computer. The private key is encrypted with the passphrase *before* it is sent, so the server never sees it."),
      s("shared/keystore.ts", "export async function encryptSecretKey", 8, [1],
        "Encrypting the private key with the passphrase",
        "The passphrase is stretched with **PBKDF2 (SHA-256, 200,000 rounds)** into an AES key. This makes guessing passphrases slow."),
      s("server/app.ts", 'app.post("/register"', 25, [3],
        "The server stores the new company as 'pending'",
        "The account starts as **pending**: it cannot sign batches, dispatch or receive until approved.",
        "The company is also added to the `ix.parties` **hash map**, so its key can be found in O(1) later."),
      s("shared/gstin.ts", "export function gstinCheckChar", 8, [],
        "Checking the GSTIN check digit",
        "The last character of a GSTIN is a **check digit** computed from the first 14 (a mod-36 weighted sum). A typo or a made-up GSTIN almost always fails this."),
      s("server/app.ts", "const checks: Array<{ ok: boolean; label: string; detail?: string }> = [];", 11, [],
        "Automatic checks shown to the regulator",
        "For each pending company the server runs: the GSTIN check digit, whether another company already uses this licence number, whether another uses this GSTIN, and whether a document is attached."),
      s("server/app.ts", 'authed.post("/approvals/:id"', 15, [2, 3],
        "Approving = signing the company's key",
        "The regulator **signs** the new company's id, role and public key (`UG/endorse`). Anyone can check later who vouched for this company.",
        "The status changes to approved in the database and in the **hash map**."),
    ],
  },
  {
    slug: "login",
    title: "Signing in without sending a password",
    show: ["Sign in as any company with passphrase `demo1234`. The passphrase never leaves the browser."],
    steps: [
      s("server/app.ts", 'app.post("/auth/challenge"', 9, [],
        "Step 1: the server sends a one-time challenge",
        "The server returns the encrypted private key and a random **nonce** that expires in 2 minutes."),
      s("src/lib/session.tsx", "const signIn = async", 10, [2],
        "Step 2: the browser unlocks the key and signs the challenge",
        "Only the right passphrase decrypts the key. The browser then **signs the nonce** with it."),
      s("server/app.ts", 'app.post("/auth/login"', 10, [2, 3],
        "Step 3: the server checks the signature",
        "The nonce is deleted as it is used, so it cannot be replayed. The public key comes from the `ix.parties` **hash map**, and the signature must verify."),
    ],
  },
  {
    slug: "create-batch-and-items",
    title: "Creating a batch and issuing item QRs",
    show: [
      "Manufacturer (`sunpharma`) → Batches → create a batch. Sign in as `sunqa` to approve it.",
      "Back as `sunpharma` → Issue → pick the batch and a number of items → every item's QR appears, each with its hidden code.",
    ],
    steps: [
      s("server/app.ts", 'authed.post("/batches"', 21, [2, 11, 12],
        "Creating a batch",
        "The batch is **signed** by the manufacturer. Its id goes into the **trie** (for search by prefix), and its expiry date into the **AVL tree** (for 'what expires soon')."),
      s("server/app.ts", 'authed.post("/batches/:id/approve"', 13, [2],
        "A second person must approve",
        "A quality approver of the same manufacturer **co-signs** the batch. One person alone cannot issue items, which stops an insider from printing extra codes."),
      s("src/pages/portals/Manufacturer.tsx", "const f: ItemFields = { kind: \"item\"", 6, [1, 2, 4],
        "Each item is made and signed in the browser",
        "Each item gets a **random salt**, so no one can guess valid item details.",
        "A random **hidden code** is made for inside the pack. Only its **SHA-256 hash** is sent to the server.",
        "`signUnit` signs the item's fingerprint. The first custody record (`MANUFACTURED`) has `prev: \"0\"`: it is the **first link of the hash chain**."),
      s("server/app.ts", "if (batch.issued + items.length > batch.quantity)", 1, [],
        "Issuance limit",
        "The server never issues more items than the batch quantity."),
      s("server/app.ts", "if (!verifyUnit(it.unit, p.publicKey))", 4, [2],
        "Every item's signature is checked",
        "The server checks the signature on each item and on its first custody record before saving."),
      s("server/app.ts", "ix.ids.insert(it.unit.f.id);", 3, [11, 3],
        "Item ids go into the trie and the last-seen map",
        "Each item id is added to the **trie** (search) and its first location to the `lastSeen` **hash map** (used for clone detection)."),
    ],
  },
  {
    slug: "carton-qr",
    title: "One carton QR stands for every item inside",
    show: [
      "After issuing: Step 3 → choose items per carton → Pack. Each carton gets one QR.",
      "DSA page → Merkle tree: see the levels of hashes and the proof for one item.",
    ],
    steps: [
      s("src/pages/portals/Manufacturer.tsx", "async function packInto(", 9, [5],
        "Packing items into a carton",
        "The item ids are sorted and their **Merkle root** is put into the carton's signed QR. The root is one hash that depends on every item inside."),
      s("shared/dsa/merkle.ts", "export function buildLevels", 11, [5, 1],
        "Building the Merkle tree",
        "Each item id is hashed (a leaf). Pairs of hashes are hashed together, level by level, until one hash is left: the **root**. O(n) hashes."),
      s("server/app.ts", "if (merkleRoot(sorted) !== f.root)", 1, [5],
        "The server recomputes the root",
        "If the list of items does not match the signed root, packing is refused. So the carton's QR provably lists exactly these items."),
      s("server/app.ts", 'await q("UPDATE units SET parent_id = $1, custodian = NULL WHERE id = $2", [f.id, id]);', 2, [6],
        "Building the packaging tree",
        "Each item now points to its carton (`parent_id`), and each carton can point to a pallet. Together they form a **tree**: pallet → cartons → items."),
    ],
  },
  {
    slug: "dispatch",
    title: "Dispatching a carton to a chosen company",
    show: ["Manufacturer → Scan → scan the carton → Dispatch → choose the warehouse. The expected arrival time appears."],
    steps: [
      s("src/lib/record.ts", "export async function record(", 16, [2, 4],
        "Every scan is a signed record linked to the previous one",
        "The record holds who, what, when, where (GPS, snapped to the company's site) and `prev`: the **hash of the previous record** on this unit. Then it is **signed**."),
      s("server/app.ts", "async function appendEvent(", 13, [4, 1],
        "Appending to the hash chain",
        "The server refuses the record if `prev` is not the current head of the chain. The new record's hash becomes the new head.",
        "Changing any old record would change its hash and break every link after it, so the history cannot be edited quietly."),
      s("server/app.ts", "if (km > 2) flags.push", 1, [13],
        "GPS must match the registered site",
        "**Haversine** distance from the company's registered site. More than 2 km away and the record is flagged."),
      s("server/app.ts", 'case "DISPATCHED": {', 17, [8],
        "Dispatch: only the holder, only to an approved company",
        "The unit is marked as in transit **to that one company**. The expected arrival comes from `estimateArrival` (Dijkstra, next step)."),
      s("server/logic.ts", "export async function routeGraph()", 31, [8, 9, 13],
        "Expected arrival with Dijkstra",
        "Past deliveries form a **weighted graph**: companies are nodes, and each edge's weight is the average hours a delivery took.",
        "**Dijkstra** (using a min-**heap**) finds the fastest known route. With no history yet, it falls back to haversine distance ÷ road speed."),
      s("shared/dsa/graph.ts", "export function dijkstra(", 31, [8, 9],
        "Dijkstra's algorithm",
        "Always settle the closest unsettled node (taken from the heap), then relax its edges. O((V + E) log V)."),
    ],
  },
  {
    slug: "receive-destination-only",
    title: "Only the chosen company can receive (and one scan updates all items)",
    show: [
      "Sign in as a retailer the carton was **not** sent to and scan it: 'This belongs to another company's shipment.'",
      "Sign in as the right company and scan it: the Receive button appears, and all items inside move with it.",
    ],
    steps: [
      s("server/app.ts", 'authed.get("/units/:id"', 8, [6],
        "Other companies can't even see the shipment",
        "A company sees a unit only if it is involved: it holds it, the shipment is addressed to it, or it appears in the history. Everyone else gets only the id."),
      s("src/components/ScanAct.tsx", "const incoming = unit && unit.inTransitTo === me.id", 1, [],
        "The Receive button shows only for the destination",
        "The button appears only when the shipment's destination is the company that is signed in."),
      s("server/app.ts", "if (inTransitTo !== me.id) {", 4, [9],
        "The server enforces it, and reports attempts",
        "Even if someone calls the API directly, the server refuses with 403 and raises a severity-4 'diverted' alert."),
      s("server/logic.ts", "export async function subtree(", 21, [6],
        "One carton scan updates every item: DFS of the packaging tree",
        "Items don't need their own scan. Their holder is the holder of their **top container** (`topOf` walks up parent pointers). `subtree` collects every carton and item below a pallet with an iterative **DFS**."),
      s("shared/dsa/tree.ts", "export function dfsCollect(", 11, [6],
        "Depth-first search with a stack",
        "Pop a unit, record it, push its children. Every unit below the root is visited once: O(n)."),
      s("server/app.ts", "for (const id of (await subtree(unit.id)).order) ix.lastSeen.set", 1, [6, 3],
        "Every item's last location is updated",
        "The location of this carton scan is copied to every unit inside it, so clone detection works for each item too."),
    ],
  },
  {
    slug: "open-carton-spot-check",
    title: "Opening a carton and the random spot check",
    show: ["Retailer → Scan → scan a received carton → Open carton. The server picks a few items to check; scan them."],
    steps: [
      s("server/app.ts", 'case "UNPACKED": {', 20, [5],
        "Opening: items go on the shelf, and the server picks random items",
        "About 10% of the items are chosen at random **by the server**, so no one knows in advance which ones will be checked. Each comes with its **Merkle proof**."),
      s("shared/dsa/merkle.ts", "export function merkleProof(", 19, [5],
        "Merkle proof: proving one item was in the carton",
        "The proof is just the sibling hash at each level: O(log n) hashes. Hashing up from the item must reach the signed root."),
      s("src/components/ScanAct.tsx", "const okLocally = !!entry && verifyProof(id, entry.proof, result.root);", 1, [5],
        "The retailer's browser checks the proof",
        "If someone swapped a real item for a fake, its proof will not reach the root."),
      s("server/app.ts", 'kind: "swap", severity: 5', 1, [9],
        "A swapped item raises the most severe alert",
        "Severity 5 puts it at the top of the alert heap."),
    ],
  },
  {
    slug: "journey",
    title: "The buyer sees the full journey of the item",
    show: ["Open any sold item's QR link: the timeline shows factory → warehouse → shop, including what happened to its carton."],
    steps: [
      s("server/logic.ts", "async function historyLists(", 13, [6],
        "Collect the item's records and its cartons' records",
        "While an item was inside a carton, the carton's scans count for the item too. This collects one sorted list per container."),
      s("server/logic.ts", "const merged = kWayMerge(lists", 1, [9],
        "Merge them in time order with a heap",
        "**k-way merge**: put the first record of each list in a min-**heap**, repeatedly take the earliest. O(N log k)."),
      s("shared/dsa/heap.ts", "export function kWayMerge", 11, [9],
        "k-way merge code", "Each list contributes its next record when its current one is taken."),
      s("shared/events.ts", "export function verifyChain(", 12, [4, 2],
        "Proving the history was not changed",
        "Walk the chain from the first record: each `prev` must equal the previous hash, each hash must be recomputed exactly, and each signature must verify. O(k). The DSA page lets you tamper with a record and watch this fail."),
    ],
  },
  {
    slug: "alerts",
    title: "Alerts, most urgent first",
    show: ["Regulator → Alerts: the list and the heap array behind it."],
    steps: [
      s("server/logic.ts", "export async function alertHeap(", 10, [9],
        "Alerts in a max-priority heap",
        "Higher severity first; equal severity → older first. Overdue shipments are found first (`sweepOverdue`)."),
      s("shared/dsa/heap.ts", "push(x: T) {", 31, [9],
        "Heap push (sift up) and pop (sift down)",
        "Children of index i are 2i+1 and 2i+2. Push and pop are O(log n), and the most urgent alert is always at index 0."),
    ],
  },
  {
    slug: "complaints",
    title: "Buyer complaints",
    show: ["Buyer → scan → Report a problem. Regulator → Complaints and Alerts."],
    steps: [
      s("server/app.ts", 'app.post("/complaints"', 21, [1, 9],
        "Complaint severity",
        "Severity depends on the reason, +1 if the buyer proved they hold the pack (the hidden code matches its **SHA-256** hash), +1 if the scan was counterfeit or a clone.",
        "At most 3 complaints per phone per hour, to stop spam. Each complaint becomes an alert in the **heap**."),
    ],
  },
  {
    slug: "recall",
    title: "Recall: who received the batch, and whom to inspect",
    show: ["Regulator → Recall → pick a batch. See the BFS graph, the DP table and the greedy result side by side."],
    steps: [
      s("server/logic.ts", "export async function recallAnalysis(", 19, [7],
        "Build the shipment graph and run BFS",
        "Every shipment of a container that held the batch becomes an edge. **BFS** from the manufacturer finds every company the batch reached, level by level."),
      s("shared/dsa/graph.ts", "export function bfs(", 19, [7],
        "Breadth-first search with a queue", "O(V + E). `head` moves forward so dequeue is O(1)."),
      s("server/logic.ts", "risk: 10 * nComplaints + 5 * nAlerts + nHeld + 1,", 4, [10],
        "Pick sites to inspect: 0/1 knapsack",
        "Each site has a cost (budget), needs inspectors, and has a risk score. **Dynamic programming** picks the set with the highest total risk within both limits. Greedy is shown next to it, because it can miss the best answer."),
      s("shared/dsa/knapsack.ts", "export function knapsack2D(", 39, [10],
        "The DP table",
        "dp[i][b][s] = max(skip site i, take site i). O(n · B · S). Walking back through the table recovers which sites were chosen."),
    ],
  },
  {
    slug: "search-expiry",
    title: "Search by id and 'expiring soon'",
    show: ["DSA page → Trie and AVL tabs, or the search box in the portals."],
    steps: [
      s("server/app.ts", 'app.get("/search"', 5, [11], "Search by prefix", "Type 'B-10' and get every id starting with it."),
      s("shared/dsa/trie.ts", "search(prefix: string, limit = 20)", 14, [11],
        "Trie search", "Walk one node per character (O(p)), then collect the ids below that node."),
      s("server/app.ts", 'app.get("/expiring"', 10, [12], "What expires in the next N days", "A range query on the AVL tree."),
      s("shared/dsa/avl.ts", "insert(key: string, value: V) {", 23, [12],
        "AVL insert with rotations",
        "After each insert the tree re-balances with rotations, so its height stays O(log n)."),
      s("shared/dsa/avl.ts", "range(lo: string, hi: string)", 12, [12],
        "Range query", "Skips whole branches outside the range: O(log n + k)."),
    ],
  },
  {
    slug: "indexes",
    title: "The in-memory data structures behind the server",
    show: ["DSA page → Hash map tab shows the buckets live."],
    steps: [
      s("server/indexes.ts", "export interface Indexes {", 7, [3, 11, 12],
        "What is kept in memory", "Built from the database when the server starts, then updated on every write."),
      s("shared/dsa/hashmap.ts", "function fnv1a(", 8, [3], "The hash function", "FNV-1a turns an id into a bucket number."),
      s("shared/dsa/hashmap.ts", "set(key: string, value: V) {", 12, [3],
        "Insert with chaining, and doubling",
        "Collisions go into the same bucket's list. When the load factor passes 0.75 the table doubles, so lookups stay O(1) on average."),
    ],
  },
];

// ---------------------------------------------------------------- build

const files = new Map();
const read = (f) => files.get(f) ?? (files.set(f, readFileSync(f, "utf8").split("\n")), files.get(f));
const resolve = (st) => {
  const lines = read(st.file);
  const hits = lines.flatMap((l, i) => (l.includes(st.at) ? [i + 1] : []));
  if (hits.length === 0) throw new Error(`Not found in ${st.file}: ${st.at}`);
  if (hits.length > 1) throw new Error(`Found ${hits.length} times in ${st.file} (make it unique): ${st.at}`);
  const start = hits[0];
  const end = Math.min(lines.length, start + st.lines - 1);
  return { ...st, start, end, code: lines.slice(start - 1, end) };
};
const topicLine = (t) => (t.length ? "**DSA topic:** " + t.map((n) => `${n}. ${TOPIC[n]}`).join(", ") : "");
const dedent = (code) => {
  const pad = Math.min(...code.filter((l) => l.trim()).map((l) => l.match(/^ */)[0].length));
  return code.map((l) => l.slice(pad));
};

rmSync(".tours", { recursive: true, force: true });
mkdirSync(".tours");
const md = [
  "# UniGenome: how each feature works, line by line",
  "",
  "For every feature of the website: how to show it, then each line of code involved, the DSA topic used there, and why it is needed.",
  "",
  "**In VS Code:** install the **CodeTour** extension (VS Code suggests it when you open this folder). Open the CodeTour panel at the bottom of the Explorer and pick a tour. It opens each file at the right line, highlights it, and shows the explanation next to it. Use the arrows to go step by step.",
  "",
  "Every `file:line` below is a link. Click it in VS Code's Markdown preview to open the file there.",
  "",
  "This file and the tours are generated by `npm run walkthrough`, which finds the lines again if the code changes.",
  "",
  "## Features",
  "",
  ...FEATURES.map((f, i) => `${i + 1}. [${f.title}](#${i + 1}-${f.title.toLowerCase().replace(/[^a-z0-9 -]/g, "").replace(/ /g, "-")})`),
  "",
];

FEATURES.forEach((f, i) => {
  const n = i + 1;
  const steps = f.steps.map(resolve);
  const tour = {
    $schema: "https://aka.ms/codetour-schema",
    title: `${String(n).padStart(2, "0")} · ${f.title}`,
    description: f.show.join("\n"),
    ...(n === 1 ? { isPrimary: true } : {}),
    steps: [
      { title: "How to show it", description: `## ${f.title}\n\n**How to show it in the app**\n\n${f.show.join("\n")}` },
      ...steps.map((st) => ({
        file: st.file,
        selection: { start: { line: st.start, character: 1 }, end: { line: st.end, character: read(st.file)[st.end - 1].length + 1 } },
        title: st.title,
        description: `### ${st.title}\n\n${topicLine(st.topics)}${st.topics.length ? "\n\n" : ""}${st.text}`,
      })),
    ],
  };
  writeFileSync(`.tours/${String(n).padStart(2, "0")}-${f.slug}.tour`, JSON.stringify(tour, null, 2) + "\n");

  md.push(`## ${n}. ${f.title}`, "", "**How to show it**", "", ...f.show, "");
  steps.forEach((st, j) => {
    const loc = st.start === st.end ? `${st.file}:${st.start}` : `${st.file}:${st.start}-${st.end}`;
    md.push(`### ${n}.${j + 1} ${st.title}`, "", `[${loc}](../${st.file}#L${st.start})`, "");
    if (st.topics.length) md.push(topicLine(st.topics), "");
    md.push("```" + (st.file.endsWith(".tsx") ? "tsx" : "ts"), ...dedent(st.code), "```", "", st.text, "");
  });
});

writeFileSync("docs/FEATURE-WALKTHROUGH.md", md.join("\n"));
console.log(`${FEATURES.length} tours, ${FEATURES.reduce((a, f) => a + f.steps.length, 0)} steps`);
