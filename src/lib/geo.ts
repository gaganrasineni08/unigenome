// Location for each scan: GPS when allowed, otherwise the user's registered site.
import { haversineKm } from "../../shared/geo";

export interface Fix {
  lat: number;
  lng: number;
  acc: number | null;
  source: "gps" | "site";
}

export function getGps(timeoutMs = 8000): Promise<Fix | null> {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy), source: "gps" }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60_000 },
    );
  });
}

/** The registered site nearest to a fix, if one is within `withinKm`. */
export function nearestSite<S extends { lat: number; lng: number }>(sites: S[], fix: { lat: number; lng: number }, withinKm = 1): S | null {
  let best: S | null = null;
  let bestKm = Infinity;
  for (const s of sites) {
    const km = haversineKm(s, fix);
    if (km < bestKm) {
      best = s;
      bestKm = km;
    }
  }
  return bestKm <= withinKm ? best : null;
}
