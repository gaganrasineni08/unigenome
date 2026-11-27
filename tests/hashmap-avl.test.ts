import { describe, expect, it } from "vitest";
import { HashMap, HashSet } from "../shared/dsa/hashmap";
import { AVLTree } from "../shared/dsa/avl";

describe("HashMap", () => {
  it("has() finds a key stored with an undefined value", () => {
    const m = new HashMap<string | undefined>();
    m.set("pending", undefined);
    expect(m.has("pending")).toBe(true);
    expect(m.has("missing")).toBe(false);
    expect(m.size).toBe(1);
  });

  it("overwriting a key keeps the size and does not resize", () => {
    const m = new HashMap<number>(4);
    m.set("a", 1);
    m.set("a", 2);
    m.set("a", 3);
    expect(m.size).toBe(1);
    expect(m.get("a")).toBe(3);
    expect(m.resizes).toBe(0);
  });

  it("doubles once the load factor passes 0.75 and keeps every entry", () => {
    const m = new HashMap<number>(4);
    for (let i = 0; i < 3; i++) m.set("k" + i, i);
    expect(m.capacity).toBe(4); // 3/4 is not over 0.75
    m.set("k3", 3);
    expect(m.capacity).toBe(8);
    expect(m.resizes).toBe(1);
    expect([...m.entries()].map(([k]) => k).sort()).toEqual(["k0", "k1", "k2", "k3"]);
  });

  it("delete removes only the named key and reports misses", () => {
    const m = new HashMap<number>();
    m.set("x", 1);
    m.set("y", 2);
    expect(m.delete("x")).toBe(true);
    expect(m.delete("x")).toBe(false);
    expect(m.has("x")).toBe(false);
    expect(m.get("y")).toBe(2);
    expect(m.size).toBe(1);
    m.set("x", 5);
    expect(m.get("x")).toBe(5);
  });

  it("snapshot lists every key in its bucket", () => {
    const m = new HashMap<number>(8);
    ["a", "b", "c"].forEach((k, i) => m.set(k, i));
    const snap = m.snapshot();
    expect(snap.size).toBe(3);
    expect(snap.loadFactor).toBeCloseTo(3 / 8);
    for (const k of ["a", "b", "c"]) expect(snap.buckets[m.bucketOf(k)]).toContain(k);
  });
});

describe("HashSet", () => {
  it("adds, ignores duplicates and deletes", () => {
    const s = new HashSet();
    s.add("rev-1");
    s.add("rev-1");
    expect(s.size).toBe(1);
    expect(s.has("rev-1")).toBe(true);
    expect(s.delete("rev-1")).toBe(true);
    expect(s.has("rev-1")).toBe(false);
  });
});

describe("AVLTree", () => {
  const days = Array.from({ length: 31 }, (_, i) => `2027-01-${String(i + 1).padStart(2, "0")}`);

  it("stays balanced when expiry dates arrive in sorted order", () => {
    const t = new AVLTree<number>();
    days.forEach((d, i) => t.insert(d, i));
    expect(t.height).toBeLessThanOrEqual(Math.ceil(1.44 * Math.log2(days.length + 2)));
    expect(t.rotations.length).toBeGreaterThan(0);
  });

  it("range is inclusive at both ends and in key order", () => {
    const t = new AVLTree<string>();
    [...days].reverse().forEach((d) => t.insert(d, d));
    const got = t.range("2027-01-05", "2027-01-08").map((r) => r.key);
    expect(got).toEqual(["2027-01-05", "2027-01-06", "2027-01-07", "2027-01-08"]);
    expect(t.range("2027-02-01", "2027-02-28")).toEqual([]);
  });

  it("keeps every unit that shares an expiry date", () => {
    const t = new AVLTree<string>();
    t.insert("2027-03-01", "u1");
    t.insert("2027-03-01", "u2");
    t.insert("2027-02-01", "u3");
    expect(t.range("2027-03-01", "2027-03-01").map((r) => r.value)).toEqual(["u1", "u2"]);
    expect(t.snapshot().count + (t.snapshot().left?.count ?? 0) + (t.snapshot().right?.count ?? 0)).toBe(3);
  });
});
