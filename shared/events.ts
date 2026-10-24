// Custody records: one signed, hash-chained record per scan (DSA topic 4).
import { hashOf, signMessage, verifyMessage } from "./crypto";

export const EVENT_TYPES = [
  "MANUFACTURED",
  "PACKED",
  "DISPATCHED",
  "RECEIVED",
  "STORED",
  "CONDITION",
  "UNPACKED",
  "SPOT_CHECK",
  "SOLD",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export interface EventBody {
  unit: string; // id of the scanned item, carton or pallet
  type: EventType;
  actor: string; // party id
  ts: number; // device time, ms
  lat: number | null;
  lng: number | null;
  acc: number | null; // GPS accuracy in metres
  site: string | null; // registered site id the scan snapped to
  prev: string; // hash of the previous record on this unit's chain, "0" for the first
  data: Record<string, unknown>; // dispatch destination, condition reading, ...
}

export const EVENT_DOMAIN = "UG/event";
export const eventHash = (b: EventBody, sig: string) => hashOf(EVENT_DOMAIN, { ...b, sig });
export const signEvent = (b: EventBody, sk: string) => signMessage(EVENT_DOMAIN, b, sk);
export const verifyEvent = (b: EventBody, sig: string, pk: string) => verifyMessage(EVENT_DOMAIN, b, sig, pk);

export interface ChainRecord {
  body: EventBody;
  sig: string;
  hash: string;
}

export interface ChainCheck {
  ok: boolean;
  brokenAt: number | null; // index of the first bad record
  reason?: string;
}

/** Walk a unit's chain from the first record, recomputing every hash, link and signature. O(k). */
export function verifyChain(records: ChainRecord[], publicKeyOf: (party: string) => string | undefined): ChainCheck {
  let prev = "0";
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (r.body.prev !== prev) return { ok: false, brokenAt: i, reason: "link to previous record does not match" };
    if (eventHash(r.body, r.sig) !== r.hash) return { ok: false, brokenAt: i, reason: "record content was changed" };
    const pk = publicKeyOf(r.body.actor);
    if (!pk || !verifyEvent(r.body, r.sig, pk)) return { ok: false, brokenAt: i, reason: "signature does not verify" };
    prev = r.hash;
  }
  return { ok: true, brokenAt: null };
}
