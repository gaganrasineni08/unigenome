// In-memory data structures that sit in front of the database. Built from the database on first use
// (and again after a cold start), then kept up to date on every write.
import { HashMap, HashSet } from "../shared/dsa/hashmap";
import { Trie } from "../shared/dsa/trie";
import { AVLTree } from "../shared/dsa/avl";
import { db } from "./db";

export interface PartyEntry {
  id: string;
  name: string;
  role: string;
  org: string | null;
  publicKey: string;
  status: string;
}

export interface LastScan {
  lat: number;
  lng: number;
  ts: number;
  source: string;
}

export interface Indexes {
  parties: HashMap<PartyEntry>; // topic 3: party id -> public key and status, O(1) per signature check
  revoked: HashSet; // topic 3: revoked party ids
  lastSeen: HashMap<LastScan>; // topic 3 + 13: unit id -> last located scan, for clone detection
  ids: Trie; // topic 11: prefix search over batch, item, carton and pallet ids
  expiry: AVLTree<string>; // topic 12: batches keyed by expiry date
}

let built: Promise<Indexes> | null = null;

export function indexes(): Promise<Indexes> {
  return (built ??= build());
}

export function resetIndexes() {
  built = null;
}

async function build(): Promise<Indexes> {
  const d = await db();
  const ix: Indexes = {
    parties: new HashMap(),
    revoked: new HashSet(),
    lastSeen: new HashMap(),
    ids: new Trie(),
    expiry: new AVLTree(),
  };
  for (const p of await d.query("SELECT id, name, role, org, public_key, status FROM parties")) {
    ix.parties.set(p.id, { id: p.id, name: p.name, role: p.role, org: p.org, publicKey: p.public_key, status: p.status });
    if (p.status === "revoked") ix.revoked.add(p.id);
  }
  for (const b of await d.query("SELECT id, exp FROM batches ORDER BY created_at")) {
    ix.ids.insert(b.id);
    if (b.exp) ix.expiry.insert(b.exp, b.id);
  }
  for (const u of await d.query("SELECT id FROM units")) ix.ids.insert(u.id);
  // Newest located record per unit, from staff records and buyer scans.
  for (const r of await d.query(
    `SELECT unit_id, (body->>'lat')::float AS lat, (body->>'lng')::float AS lng, ts, 'custody' AS source
       FROM events WHERE body->>'lat' IS NOT NULL
     UNION ALL
     SELECT unit_id, lat, lng, ts, 'buyer' FROM scans WHERE lat IS NOT NULL AND unit_id IS NOT NULL
     ORDER BY ts`,
  )) {
    ix.lastSeen.set(r.unit_id, { lat: r.lat, lng: r.lng, ts: Number(r.ts), source: r.source });
  }
  return ix;
}
