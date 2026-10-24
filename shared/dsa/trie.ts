// Trie for prefix search on ids (DSA topic 11).

interface Node {
  children: Map<string, Node>;
  end: boolean;
  count: number; // keys stored at or below this node
}

const node = (): Node => ({ children: new Map(), end: false, count: 0 });

export class Trie {
  private root = node();

  insert(key: string) {
    if (this.has(key)) return;
    let n = this.root;
    n.count++;
    for (const ch of key.toUpperCase()) {
      if (!n.children.has(ch)) n.children.set(ch, node());
      n = n.children.get(ch)!;
      n.count++;
    }
    n.end = true;
  }

  has(key: string): boolean {
    const n = this.walk(key.toUpperCase());
    return !!n && n.end;
  }

  private walk(prefix: string): Node | null {
    let n = this.root;
    for (const ch of prefix) {
      const next = n.children.get(ch);
      if (!next) return null;
      n = next;
    }
    return n;
  }

  /** Walk the prefix (O(p)), then collect up to `limit` keys below it. */
  search(prefix: string, limit = 20): { total: number; keys: string[]; path: string[] } {
    const p = prefix.toUpperCase();
    const start = this.walk(p);
    if (!start) return { total: 0, keys: [], path: [] };
    const keys: string[] = [];
    const stack: Array<[Node, string]> = [[start, p]];
    while (stack.length && keys.length < limit) {
      const [n, s] = stack.pop()!;
      if (n.end) keys.push(s);
      const kids = [...n.children.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
      for (const [ch, c] of kids) stack.push([c, s + ch]);
    }
    return { total: start.count, keys, path: [...p] };
  }

  /** The subtree under a prefix, a few levels deep, for drawing. */
  subtree(prefix: string, depth = 3) {
    const p = prefix.toUpperCase();
    const start = this.walk(p);
    const draw = (n: Node, label: string, d: number): any => ({
      label,
      count: n.count,
      end: n.end,
      children: d === 0 ? [] : [...n.children.entries()].sort().slice(0, 8).map(([ch, c]) => draw(c, ch, d - 1)),
    });
    return start ? draw(start, p || "root", depth) : null;
  }
}
