// AVL tree keyed by expiry date, for range queries (DSA topic 12).

interface Node<V> {
  key: string; // YYYY-MM-DD sorts correctly as a string
  values: V[];
  left: Node<V> | null;
  right: Node<V> | null;
  height: number;
}

const h = (n: Node<any> | null) => (n ? n.height : 0);
const fix = (n: Node<any>) => {
  n.height = 1 + Math.max(h(n.left), h(n.right));
};
const balanceOf = (n: Node<any>) => h(n.left) - h(n.right);

export class AVLTree<V> {
  root: Node<V> | null = null;
  rotations: string[] = []; // log of rotations, newest last

  private rotRight(y: Node<V>): Node<V> {
    const x = y.left!;
    y.left = x.right;
    x.right = y;
    fix(y);
    fix(x);
    this.rotations.push(`right rotation at ${y.key}`);
    return x;
  }

  private rotLeft(x: Node<V>): Node<V> {
    const y = x.right!;
    x.right = y.left;
    y.left = x;
    fix(x);
    fix(y);
    this.rotations.push(`left rotation at ${x.key}`);
    return y;
  }

  insert(key: string, value: V) {
    const ins = (n: Node<V> | null): Node<V> => {
      if (!n) return { key, values: [value], left: null, right: null, height: 1 };
      if (key === n.key) {
        n.values.push(value);
        return n;
      }
      if (key < n.key) n.left = ins(n.left);
      else n.right = ins(n.right);
      fix(n);
      const b = balanceOf(n);
      if (b > 1) {
        if (key > n.left!.key) n.left = this.rotLeft(n.left!); // left-right case
        return this.rotRight(n);
      }
      if (b < -1) {
        if (key < n.right!.key) n.right = this.rotRight(n.right!); // right-left case
        return this.rotLeft(n);
      }
      return n;
    };
    this.root = ins(this.root);
  }

  /** All values with lo <= key <= hi, in key order. O(log n + k). */
  range(lo: string, hi: string): Array<{ key: string; value: V }> {
    const out: Array<{ key: string; value: V }> = [];
    const visit = (n: Node<V> | null) => {
      if (!n) return;
      if (n.key > lo) visit(n.left);
      if (n.key >= lo && n.key <= hi) for (const v of n.values) out.push({ key: n.key, value: v });
      if (n.key < hi) visit(n.right);
    };
    visit(this.root);
    return out;
  }

  get height() {
    return h(this.root);
  }

  snapshot(): any {
    const draw = (n: Node<V> | null): any =>
      n ? { key: n.key, count: n.values.length, balance: balanceOf(n), left: draw(n.left), right: draw(n.right) } : null;
    return draw(this.root);
  }
}
