// Signed identities printed as QR codes: items, cartons and pallets.
import { fromB64url, fromUtf8, toB64url, utf8 } from "./bytes";
import { hashOf, signMessage, verifyMessage } from "./crypto";

export interface ItemFields {
  kind: "item";
  id: string; // item id, e.g. I-B1024-0007
  batch: string;
  mfr: string; // manufacturer party id
  product: string; // product code
  mfg: string; // YYYY-MM-DD
  exp?: string; // YYYY-MM-DD, optional
  salt: string; // random hex
}

export interface ContainerFields {
  kind: "carton" | "pallet";
  id: string;
  by: string; // party that packed and signed it
  count: number; // direct children
  root: string; // Merkle root over the children's ids
  packed: string; // ISO time
}

export type UnitFields = ItemFields | ContainerFields;

export interface SignedUnit {
  f: UnitFields;
  sig: string;
}

const DOMAIN = { item: "UG/item", carton: "UG/container", pallet: "UG/container" } as const;

/** DNA0: the SHA-256 fingerprint of an item's (or container's) canonical fields. */
export const dnaOf = (f: UnitFields): string => hashOf(DOMAIN[f.kind], f);

export function signUnit(f: UnitFields, secretKeyHex: string): SignedUnit {
  return { f, sig: signMessage(DOMAIN[f.kind], { dna: dnaOf(f) }, secretKeyHex) };
}

export function verifyUnit(u: SignedUnit, signerPublicKeyHex: string): boolean {
  return verifyMessage(DOMAIN[u.f.kind], { dna: dnaOf(u.f) }, u.sig, signerPublicKeyHex);
}

export const signerOf = (f: UnitFields): string => (f.kind === "item" ? f.mfr : f.by);

// ---- QR payload: compact JSON, base64url, placed after "#" in the verify URL ----

type Packed = [string, ...unknown[]];

function pack(u: SignedUnit): Packed {
  const f = u.f;
  if (f.kind === "item") return ["I", f.id, f.batch, f.mfr, f.product, f.mfg, f.exp ?? "", f.salt, u.sig];
  return [f.kind === "carton" ? "C" : "P", f.id, f.by, f.count, f.root, f.packed, u.sig];
}

function unpack(p: Packed): SignedUnit {
  const [t, ...r] = p as [string, ...any[]];
  if (t === "I") {
    const [id, batch, mfr, product, mfg, exp, salt, sig] = r;
    const f: ItemFields = { kind: "item", id, batch, mfr, product, mfg, salt };
    if (exp) f.exp = exp;
    return { f, sig };
  }
  if (t === "C" || t === "P") {
    const [id, by, count, root, packed, sig] = r;
    return { f: { kind: t === "C" ? "carton" : "pallet", id, by, count, root, packed }, sig };
  }
  throw new Error("unknown QR type");
}

export const encodePayload = (u: SignedUnit): string => toB64url(utf8(JSON.stringify(pack(u))));

export function decodePayload(s: string): SignedUnit {
  const json = JSON.parse(fromUtf8(fromB64url(s.trim())));
  if (!Array.isArray(json)) throw new Error("not a UniGenome code");
  return unpack(json as Packed);
}

/** Accepts a full verify URL, a bare payload, or anything with "#payload" at the end. */
export function payloadFromScan(text: string): string {
  const hash = text.lastIndexOf("#");
  return hash >= 0 ? text.slice(hash + 1) : text;
}
