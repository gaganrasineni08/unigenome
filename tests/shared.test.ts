import { describe, expect, it } from "vitest";
import { generateKeyPair } from "../shared/crypto";
import { decodePayload, dnaOf, encodePayload, signUnit, verifyUnit, type ItemFields } from "../shared/identity";
import { eventHash, signEvent, verifyChain, type EventBody } from "../shared/events";
import { merkleProof, merkleRoot, verifyProof } from "../shared/dsa/merkle";
import { HashMap } from "../shared/dsa/hashmap";
import { BinaryHeap, kWayMerge } from "../shared/dsa/heap";
import { Trie } from "../shared/dsa/trie";
import { AVLTree } from "../shared/dsa/avl";
import { Graph, bfs, dijkstra } from "../shared/dsa/graph";
import { greedyAllocate, knapsack2D } from "../shared/dsa/knapsack";
import { dfsCollect } from "../shared/dsa/tree";
import { haversineKm, impliedSpeedKmh } from "../shared/geo";

const item = (over: Partial<ItemFields> = {}): ItemFields => ({
  kind: "item", id: "I-1", batch: "B-1024", mfr: "M-07", product: "PCM-500", mfg: "2026-10-02", exp: "2028-10-01", salt: "9f3a", ...over,
});

describe("identity", () => {
  it("signs, round-trips through the QR payload and verifies", () => {
    const k = generateKeyPair();
    const u = signUnit(item(), k.secretKey);
    const back = decodePayload(encodePayload(u));
    expect(dnaOf(back.f)).toBe(dnaOf(u.f));
    expect(verifyUnit(back, k.publicKey)).toBe(true);
  });
  it("fails after tampering or with the wrong key", () => {
    const k = generateKeyPair();
    const u = signUnit(item(), k.secretKey);
    expect(verifyUnit({ ...u, f: item({ batch: "B-1025" }) }, k.publicKey)).toBe(false);
    expect(verifyUnit(u, generateKeyPair().publicKey)).toBe(false);
  });
});

describe("hash chain", () => {
  it("detects an edited record", () => {
    const k = generateKeyPair();
    const recs: any[] = [];
    let prev = "0";
    for (const type of ["MANUFACTURED", "DISPATCHED", "RECEIVED"] as const) {
      const body: EventBody = { unit: "I-1", type, actor: "M-07", ts: Date.now(), lat: 1, lng: 2, acc: 5, site: null, prev, data: {} };
      const sig = signEvent(body, k.secretKey);
      const hash = eventHash(body, sig);
      recs.push({ body, sig, hash });
      prev = hash;
    }
    const pk = () => k.publicKey;
    expect(verifyChain(recs, pk).ok).toBe(true);
    recs[1] = { ...recs[1], body: { ...recs[1].body, ts: 1 } };
    expect(verifyChain(recs, pk)).toMatchObject({ ok: false, brokenAt: 1 });
  });
});

describe("merkle", () => {
  it("proves every leaf, including odd counts", () => {
    for (const n of [1, 2, 3, 5, 48]) {
      const ids = Array.from({ length: n }, (_, i) => "I-" + i);
      const root = merkleRoot(ids);
      ids.forEach((id, i) => expect(verifyProof(id, merkleProof(ids, i), root)).toBe(true));
      expect(verifyProof("I-x", merkleProof(ids, 0), root)).toBe(false);
    }
    expect(merkleProof(Array.from({ length: 48 }, (_, i) => "I-" + i), 3).length).toBe(6);
  });
});

describe("structures", () => {
  it("hash map grows and keeps every key", () => {
    const m = new HashMap<number>(4);
    for (let i = 0; i < 100; i++) m.set("k" + i, i);
    expect(m.size).toBe(100);
    expect(m.get("k57")).toBe(57);
    expect(m.capacity).toBeGreaterThan(100 / 0.75);
    m.delete("k57");
    expect(m.has("k57")).toBe(false);
  });
  it("heap pops by priority and k-way merge sorts", () => {
    const h = new BinaryHeap<number>((a, b) => a > b);
    [2, 5, 3, 9, 1].forEach((x) => h.push(x));
    expect([h.pop(), h.pop(), h.pop()]).toEqual([9, 5, 3]);
    expect(kWayMerge([[1, 4, 7], [2, 5], [0, 9]], (x) => x)).toEqual([0, 1, 2, 4, 5, 7, 9]);
  });
  it("trie finds by prefix", () => {
    const t = new Trie();
    ["B-1024", "B-1025", "B-2001"].forEach((k) => t.insert(k));
    expect(t.search("b-10")).toMatchObject({ total: 2, keys: ["B-1024", "B-1025"] });
  });
  it("AVL stays balanced and answers ranges", () => {
    const t = new AVLTree<string>();
    ["2027-01-10", "2027-01-20", "2027-01-30"].forEach((d) => t.insert(d, d));
    expect(t.rotations[0]).toContain("left rotation");
    expect(t.snapshot().key).toBe("2027-01-20");
    for (let i = 1; i <= 28; i++) t.insert(`2027-02-${String(i).padStart(2, "0")}`, "x");
    expect(t.height).toBeLessThanOrEqual(6);
    expect(t.range("2027-01-15", "2027-01-25").map((r) => r.key)).toEqual(["2027-01-20"]);
  });
  it("BFS and Dijkstra match the doc examples", () => {
    const g = new Graph();
    g.addEdge("M", "W1"); g.addEdge("M", "W2"); g.addEdge("W1", "R1"); g.addEdge("W1", "R2"); g.addEdge("W2", "R3");
    expect(bfs(g, "M").order).toEqual(["M", "W1", "W2", "R1", "R2", "R3"]);
    const d = new Graph();
    d.addEdge("M", "W1", 2); d.addEdge("M", "W2", 1); d.addEdge("W2", "W1", 0.5); d.addEdge("W1", "R1", 1); d.addEdge("W2", "R1", 3);
    const r = dijkstra(d, "M");
    expect(r.dist.R1).toBe(2.5);
    expect(r.pathTo("R1")).toEqual(["M", "W2", "W1", "R1"]);
  });
  it("knapsack beats greedy on the doc example", () => {
    const items = [
      { id: "R1", cost: 6, staff: 1, risk: 30 }, { id: "R2", cost: 5, staff: 1, risk: 24 },
      { id: "R3", cost: 5, staff: 2, risk: 22 }, { id: "R4", cost: 4, staff: 1, risk: 15 },
    ];
    expect(knapsack2D(items, 10, 3).result).toMatchObject({ risk: 46, chosen: ["R2", "R3"] });
    expect(greedyAllocate(items, 10, 3)).toMatchObject({ risk: 45, chosen: ["R1", "R4"] });
  });
  it("DFS walks the packaging tree", () => {
    const kids: Record<string, string[]> = { P: ["C1", "C2"], C1: ["a", "b"], C2: ["c"] };
    expect(dfsCollect("P", (x) => kids[x] ?? [])).toEqual(["P", "C1", "a", "b", "C2", "c"]);
  });
  it("haversine Hyderabad to Delhi is about 1,250 km", () => {
    const km = haversineKm({ lat: 17.39, lng: 78.49 }, { lat: 28.61, lng: 77.21 });
    expect(km).toBeGreaterThan(1230);
    expect(km).toBeLessThan(1270);
    expect(impliedSpeedKmh({ lat: 17.39, lng: 78.49, ts: 0 }, { lat: 28.61, lng: 77.21, ts: 40 * 60_000 })).toBeGreaterThan(1800);
  });
});
