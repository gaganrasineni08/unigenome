export const fmtDate = (ts: number | string) => new Date(ts).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
export const fmtDateTime = (ts: number | string) =>
  new Date(ts).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
// Thresholds are checked after rounding, so 59.7 min reads "1.0 h" (not "60 min")
// and 9.97 h reads "10 h" (not "10.0 h").
export function fmtHours(h: number) {
  if (!Number.isFinite(h)) return "unknown";
  const mins = Math.round(h * 60);
  if (mins < 60) return `${Math.max(0, mins)} min`;
  if (Math.round(h * 10) < 100) return `${h.toFixed(1)} h`;
  if (Math.round(h) < 48) return `${h.toFixed(0)} h`;
  return `${(h / 24).toFixed(1)} days`;
}
export const short = (s: string, n = 10) => (s.length > n * 2 ? s.slice(0, n) + "…" + s.slice(-6) : s);

export const EVENT_LABEL: Record<string, string> = {
  MANUFACTURED: "Manufactured",
  PACKED: "Packed",
  DISPATCHED: "Dispatched",
  RECEIVED: "Received",
  STORED: "Stored",
  CONDITION: "Condition check",
  UNPACKED: "Unpacked",
  SPOT_CHECK: "Spot check",
  SOLD: "Sold",
};

export const ROLE_LABEL: Record<string, string> = {
  regulator: "Regulator",
  manufacturer: "Manufacturer",
  qa: "Quality approver",
  warehouse: "Warehouse",
  retailer: "Retailer",
};
