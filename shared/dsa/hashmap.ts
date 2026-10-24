// Hash map with separate chaining and doubling (DSA topic 3).
// Used for the key registry, revocation set and last-scan index, instead of the built-in Map,
// so the buckets can be shown on the DSA page.

function fnv1a(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export class HashMap<V> {
  private buckets: Array<Array<[string, V]>>;
  private count = 0;
  resizes = 0;

  constructor(capacity = 8, private readonly maxLoad = 0.75) {
    this.buckets = Array.from({ length: capacity }, () => []);
  }

  get size() {
    return this.count;
  }

  get capacity() {
    return this.buckets.length;
  }

  bucketOf(key: string) {
    return fnv1a(key) % this.buckets.length;
  }

  get(key: string): V | undefined {
    for (const [k, v] of this.buckets[this.bucketOf(key)]) if (k === key) return v;
    return undefined;
  }

  has(key: string) {
    return this.get(key) !== undefined;
  }

  set(key: string, value: V) {
    const b = this.buckets[this.bucketOf(key)];
    for (const pair of b) {
      if (pair[0] === key) {
        pair[1] = value;
        return;
      }
    }
    b.push([key, value]);
    this.count++;
    if (this.count / this.buckets.length > this.maxLoad) this.grow();
  }

  delete(key: string): boolean {
    const b = this.buckets[this.bucketOf(key)];
    const i = b.findIndex(([k]) => k === key);
    if (i < 0) return false;
    b.splice(i, 1);
    this.count--;
    return true;
  }

  private grow() {
    const old = this.buckets;
    this.buckets = Array.from({ length: old.length * 2 }, () => []);
    this.resizes++;
    for (const b of old) for (const [k, v] of b) this.buckets[this.bucketOf(k)].push([k, v]);
  }

  *entries(): IterableIterator<[string, V]> {
    for (const b of this.buckets) for (const pair of b) yield pair;
  }

  /** Bucket layout for the DSA page. */
  snapshot() {
    return {
      capacity: this.buckets.length,
      size: this.count,
      loadFactor: this.count / this.buckets.length,
      resizes: this.resizes,
      buckets: this.buckets.map((b) => b.map(([k]) => k)),
    };
  }
}

/** A hash set is a hash map that only stores keys. */
export class HashSet {
  private m = new HashMap<true>();
  add(k: string) {
    this.m.set(k, true);
  }
  has(k: string) {
    return this.m.has(k);
  }
  delete(k: string) {
    return this.m.delete(k);
  }
  get size() {
    return this.m.size;
  }
  snapshot() {
    return this.m.snapshot();
  }
}
