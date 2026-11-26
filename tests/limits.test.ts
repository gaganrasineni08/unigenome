import { describe, expect, it } from "vitest";
import { ancestors } from "../shared/dsa/tree";
import { greedyAllocate, knapsack2D, type Candidate } from "../shared/dsa/knapsack";
import { impliedSpeedKmh, roundForPrivacy } from "../shared/geo";

describe("ancestors", () => {
  const parent: Record<string, string | null> = { a: "C1", C1: "P", P: null };
  const up = (id: string) => parent[id] ?? null;

  it("walks from the item up to the pallet, nearest first", () => {
    expect(ancestors("a", up)).toEqual(["C1", "P"]);
  });

  it("is empty for a root", () => {
    expect(ancestors("P", up)).toEqual([]);
  });
});

describe("roundForPrivacy", () => {
  it("keeps two decimal places", () => {
    expect(roundForPrivacy({ lat: 17.38712, lng: 78.49158 })).toEqual({ lat: 17.39, lng: 78.49 });
  });

  it("rounds negative coordinates too", () => {
    expect(roundForPrivacy({ lat: -33.86882, lng: 151.20929 })).toEqual({ lat: -33.87, lng: 151.21 });
  });
});

describe("impliedSpeedKmh with no time gap", () => {
  it("is 0 for the same place and Infinity for a far one", () => {
    const a = { lat: 17.39, lng: 78.49, ts: 1000 };
    expect(impliedSpeedKmh(a, { ...a })).toBe(0);
    expect(impliedSpeedKmh(a, { lat: 28.61, lng: 77.21, ts: 1000 })).toBe(Infinity);
  });
});

describe("knapsack limits", () => {
  const items: Candidate[] = [
    { id: "A", cost: 3, staff: 1, risk: 10 },
    { id: "B", cost: 2, staff: 2, risk: 7 },
  ];

  it("chooses nothing when no candidate fits", () => {
    const { result, cells } = knapsack2D(items, 1, 1);
    expect(result).toEqual({ chosen: [], risk: 0, cost: 0, staff: 0 });
    expect(cells).toBe(3 * 2 * 2);
    expect(greedyAllocate(items, 1, 1).chosen).toEqual([]);
  });

  it("is limited by inspectors as well as budget", () => {
    // Budget covers both, but only two inspectors are free.
    expect(knapsack2D(items, 10, 2).result).toMatchObject({ chosen: ["A"], risk: 10 });
    expect(knapsack2D(items, 10, 3).result).toMatchObject({ chosen: ["A", "B"], risk: 17, cost: 5, staff: 3 });
  });

  it("floors a fractional budget and treats a negative one as zero", () => {
    expect(knapsack2D(items, 4.9, 3).result.chosen).toEqual(["A"]);
    expect(knapsack2D(items, -5, 3).result.risk).toBe(0);
  });
});
