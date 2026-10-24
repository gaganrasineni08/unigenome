import L from "leaflet";
import { useEffect, useRef } from "react";
import { EVENT_LABEL, fmtDateTime, fmtHours } from "../lib/format";
import { Badge } from "./ui";

export interface HistoryEntry {
  hash: string;
  unit: string;
  via: string | null;
  type: string;
  actor: string;
  actorName: string;
  ts: number;
  lat: number | null;
  lng: number | null;
  siteName: string | null;
  data: any;
  flags: string[];
}

const COLORS: Record<string, string> = {
  MANUFACTURED: "#02C39A",
  PACKED: "#00A896",
  DISPATCHED: "#E8A33D",
  RECEIVED: "#4fc3f7",
  STORED: "#8fb3ae",
  CONDITION: "#8fb3ae",
  UNPACKED: "#00A896",
  SPOT_CHECK: "#8E7CC3",
  SOLD: "#f48fb1",
};

/** Map with a pin per located record and a line through them in time order. */
export function JourneyMap({ history, height = 320 }: { history: HistoryEntry[]; height?: number }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!el.current) return;
    const pts = history.filter((h) => h.lat != null && h.lng != null);
    const map = L.map(el.current, { zoomControl: false, attributionControl: false, scrollWheelZoom: false });
    L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", { maxZoom: 18 }).addTo(map);
    // Merge pins that sit at the same place.
    const places: Array<{ lat: number; lng: number; items: HistoryEntry[] }> = [];
    for (const p of pts) {
      const near = places.find((x) => Math.abs(x.lat - p.lat!) < 0.01 && Math.abs(x.lng - p.lng!) < 0.01);
      if (near) near.items.push(p);
      else places.push({ lat: p.lat!, lng: p.lng!, items: [p] });
    }
    const line = places.map((p) => [p.lat, p.lng] as [number, number]);
    if (line.length > 1) {
      L.polyline(line, { color: "#02C39A", weight: 3, opacity: 0.85, dashArray: "6 8" }).addTo(map);
    }
    places.forEach((p, i) => {
      const last = i === places.length - 1;
      const icon = L.divIcon({
        className: "",
        html: `<div style="width:${last ? 22 : 16}px;height:${last ? 22 : 16}px;border-radius:999px;background:${last ? "#02C39A" : "#013A40"};border:3px solid #02C39A;box-shadow:0 0 0 6px rgba(2,195,154,.18)"></div>`,
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      });
      const html = p.items.map((h) => `<b>${EVENT_LABEL[h.type] ?? h.type}</b> · ${h.actorName}<br/><span style="color:#5B6F6C">${fmtDateTime(h.ts)}</span>`).join("<hr style='margin:4px 0'/>");
      L.marker([p.lat, p.lng], { icon }).addTo(map).bindPopup(html);
    });
    if (line.length) map.fitBounds(L.latLngBounds(line).pad(0.35), { maxZoom: 12 });
    else map.setView([20.6, 78.9], 4);
    return () => {
      map.remove();
    };
  }, [history]);
  return <div ref={el} style={{ height }} className="w-full overflow-hidden rounded-2xl border border-line" />;
}

/** Vertical timeline. Records inherited from a carton or pallet are marked with where they came from. */
export function Timeline({ history }: { history: HistoryEntry[] }) {
  let lastDispatch: HistoryEntry | null = null;
  return (
    <ol className="relative space-y-4 border-l border-line pl-6">
      {history.map((h) => {
        const color = COLORS[h.type] ?? "#8fb3ae";
        let transit: string | null = null;
        if (h.type === "DISPATCHED") lastDispatch = h;
        if (h.type === "RECEIVED" && lastDispatch) {
          transit = fmtHours((h.ts - lastDispatch.ts) / 3600_000);
          lastDispatch = null;
        }
        return (
          <li key={h.hash} className="relative">
            <span className="absolute -left-[31px] top-1 h-3.5 w-3.5 rounded-full border-2" style={{ borderColor: color, background: "#011f22", boxShadow: `0 0 12px ${color}88` }} />
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold" style={{ color }}>
                {EVENT_LABEL[h.type] ?? h.type}
              </span>
              <span className="text-sm text-mute">{fmtDateTime(h.ts)}</span>
              {h.via && <Badge tone="teal">via {h.via}</Badge>}
              {transit && <Badge tone="amber">{transit} in transit</Badge>}
            </div>
            <div className="text-sm">
              {h.actorName}
              {h.siteName && <span className="text-mute"> · {h.siteName}</span>}
            </div>
            {h.type === "DISPATCHED" && h.data?.ref && <div className="text-xs text-mute">Reference {h.data.ref}</div>}
            {h.type === "CONDITION" && (
              <div className={`text-xs ${h.data?.ok === false ? "text-amber" : "text-mute"}`}>
                {h.data?.ok === false ? "Failed: " : "Passed: "}
                {h.data?.reading} {h.data?.note && `· ${h.data.note}`}
              </div>
            )}
            {h.type === "STORED" && h.data?.zone && <div className="text-xs text-mute">Location {h.data.zone}</div>}
            {h.flags?.length > 0 && <div className="mt-1 text-xs text-amber">⚑ {h.flags.join("; ")}</div>}
          </li>
        );
      })}
    </ol>
  );
}
