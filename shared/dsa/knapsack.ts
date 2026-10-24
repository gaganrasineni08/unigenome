// 0/1 knapsack with two limits, budget and inspectors, by dynamic programming (DSA topic 10),
// plus the greedy baseline it is compared against.

export interface Candidate {
  id: string;
  cost: number; // whole budget units, e.g. thousands of rupees
  staff: number; // inspectors needed
  risk: number; // value of visiting
}

export interface Allocation {
  chosen: string[];
  risk: number;
  cost: number;
  staff: number;
}

/**
 * dp[i][b][s] = best total risk using the first i candidates with budget b and s inspectors.
 * dp[i][b][s] = max(dp[i-1][b][s], dp[i-1][b-cost_i][s-staff_i] + risk_i). O(n * B * S).
 * Returns the answer and the final layer (all budgets) for the full inspector count, for display.
 */
export function knapsack2D(items: Candidate[], budget: number, staff: number) {
  const n = items.length;
  const B = Math.max(0, Math.floor(budget));
  const S = Math.max(0, Math.floor(staff));
  const dp: number[][][] = Array.from({ length: n + 1 }, () =>
    Array.from({ length: B + 1 }, () => new Array<number>(S + 1).fill(0)),
  );
  for (let i = 1; i <= n; i++) {
    const it = items[i - 1];
    for (let b = 0; b <= B; b++) {
      for (let s = 0; s <= S; s++) {
        let best = dp[i - 1][b][s]; // skip candidate i
        if (it.cost <= b && it.staff <= s) best = Math.max(best, dp[i - 1][b - it.cost][s - it.staff] + it.risk);
        dp[i][b][s] = best;
      }
    }
  }
  // Walk back through the table to recover which candidates were taken.
  const chosen: string[] = [];
  let b = B;
  let s = S;
  for (let i = n; i >= 1; i--) {
    if (dp[i][b][s] !== dp[i - 1][b][s]) {
      const it = items[i - 1];
      chosen.unshift(it.id);
      b -= it.cost;
      s -= it.staff;
    }
  }
  const pick = items.filter((x) => chosen.includes(x.id));
  const result: Allocation = {
    chosen,
    risk: dp[n][B][S],
    cost: pick.reduce((a, x) => a + x.cost, 0),
    staff: pick.reduce((a, x) => a + x.staff, 0),
  };
  const table = dp.map((layer) => layer.map((row) => row[S])); // rows: i, columns: budget b
  return { result, table, cells: (n + 1) * (B + 1) * (S + 1) };
}

/** Take candidates in order of risk per unit cost while they still fit. O(n log n). Fast, not always optimal. */
export function greedyAllocate(items: Candidate[], budget: number, staff: number): Allocation {
  const sorted = [...items].sort((a, b) => b.risk / Math.max(b.cost, 1e-9) - a.risk / Math.max(a.cost, 1e-9));
  const out: Allocation = { chosen: [], risk: 0, cost: 0, staff: 0 };
  for (const it of sorted) {
    if (out.cost + it.cost <= budget && out.staff + it.staff <= staff) {
      out.chosen.push(it.id);
      out.risk += it.risk;
      out.cost += it.cost;
      out.staff += it.staff;
    }
  }
  return out;
}
