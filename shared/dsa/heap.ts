// Binary heap priority queue (DSA topic 9) and k-way merge of sorted lists.

export class BinaryHeap<T> {
  private a: T[] = [];

  /** less(x, y) is true when x should come out before y. */
  constructor(private readonly less: (x: T, y: T) => boolean) {}

  get size() {
    return this.a.length;
  }

  peek(): T | undefined {
    return this.a[0];
  }

  push(x: T) {
    this.a.push(x);
    let i = this.a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
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
      this.a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
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

  /** The array exactly as stored: index i has children 2i+1 and 2i+2. */
  toArray(): T[] {
    return [...this.a];
  }
}

/** Merge k lists that are each sorted by key into one sorted list. O(N log k). */
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
