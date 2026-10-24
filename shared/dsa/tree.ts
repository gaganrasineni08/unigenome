// Packaging tree: pallet -> cartons -> items (DSA topic 6).

/** Iterative depth-first search below `root`, using an explicit stack. Returns every unit in DFS order. */
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

/** Follow parent pointers up to the root. O(depth). */
export function ancestors(id: string, parent: (id: string) => string | null): string[] {
  const out: string[] = [];
  let p = parent(id);
  while (p) {
    out.push(p);
    p = parent(p);
  }
  return out;
}
