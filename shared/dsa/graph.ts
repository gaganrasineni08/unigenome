// Directed graph as an adjacency list, BFS for recall (topic 7) and Dijkstra for arrival estimates (topic 8).
import { BinaryHeap } from "./heap";

export class Graph {
  readonly adj = new Map<string, Array<{ to: string; w: number }>>();

  addNode(id: string) {
    if (!this.adj.has(id)) this.adj.set(id, []);
  }

  addEdge(from: string, to: string, w = 1) {
    this.addNode(from);
    this.addNode(to);
    const list = this.adj.get(from)!;
    if (!list.some((e) => e.to === to)) list.push({ to, w });
  }

  get nodes() {
    return [...this.adj.keys()];
  }

  get edges() {
    return [...this.adj.entries()].flatMap(([from, l]) => l.map((e) => ({ from, to: e.to, w: e.w })));
  }
}

export interface BfsStep {
  visit: string;
  queue: string[]; // queue contents after this node's neighbours were added
}

/** Level-order traversal with a real FIFO queue. Returns visit order, distances and every step. O(V + E). */
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

/** Shortest paths by edge weight from `src`, using a min-heap. O((V + E) log V). */
export function dijkstra(g: Graph, src: string) {
  const dist = new Map<string, number>();
  const prev = new Map<string, string>();
  const settled: string[] = [];
  for (const n of g.nodes) dist.set(n, Infinity);
  dist.set(src, 0);
  const heap = new BinaryHeap<[number, string]>((a, b) => a[0] < b[0]);
  heap.push([0, src]);
  const done = new Set<string>();
  while (heap.size) {
    const [d, u] = heap.pop()!;
    if (done.has(u)) continue; // stale heap entry
    done.add(u);
    settled.push(u);
    for (const { to, w } of g.adj.get(u) ?? []) {
      const nd = d + w;
      if (nd < (dist.get(to) ?? Infinity)) {
        dist.set(to, nd);
        prev.set(to, u);
        heap.push([nd, to]);
      }
    }
  }
  const pathTo = (t: string): string[] => {
    if (!Number.isFinite(dist.get(t) ?? Infinity)) return [];
    const p = [t];
    while (p[0] !== src) p.unshift(prev.get(p[0])!);
    return p;
  };
  return { dist: Object.fromEntries(dist), pathTo, settled };
}
