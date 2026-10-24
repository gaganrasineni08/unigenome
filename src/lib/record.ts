// Build, sign and send one custody record. Location comes from GPS, snapped to a registered site.
import { signEvent, type EventBody, type EventType } from "../../shared/events";
import { decodePayload, payloadFromScan } from "../../shared/identity";
import { api } from "./api";
import { getGps, nearestSite, type Fix } from "./geo";
import type { Me } from "./session";

export interface Located {
  fix: Fix;
  site: { id: string; name: string } | null;
}

export async function locate(me: Me): Promise<Located> {
  const gps = await getGps();
  if (gps) return { fix: gps, site: nearestSite(me.sites, gps, 1) };
  const s = me.sites[0];
  return { fix: { lat: s.lat, lng: s.lng, acc: null, source: "site" }, site: s };
}

export async function record(me: Me, secretKey: string, unit: string, head: string, type: EventType, data: Record<string, unknown>, where: Located) {
  const body: EventBody = {
    unit,
    type,
    actor: me.id,
    ts: Date.now(),
    lat: where.fix.lat,
    lng: where.fix.lng,
    acc: where.fix.acc,
    site: where.site?.id ?? null,
    prev: head,
    data,
  };
  const sig = signEvent(body, secretKey);
  return api<any>("/events", { body: { body, sig } });
}

/** A scan can be a verify URL, a bare payload, or a typed unit id. */
export function unitIdFromScan(text: string): string {
  const t = text.trim();
  if (/^[A-Z]-[A-Z0-9-]+$/i.test(t)) return t.toUpperCase();
  try {
    return decodePayload(payloadFromScan(t)).f.id;
  } catch {
    return t.toUpperCase();
  }
}
