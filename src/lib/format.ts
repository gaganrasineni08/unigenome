export const fmtDate = (ts: number | string) => new Date(ts).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
export const fmtDateTime = (ts: number | string) =>
  new Date(ts).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
export function fmtHours(h: number) {
  if (!Number.isFinite(h)) return "unknown";
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 48) return `${h.toFixed(h < 10 ? 1 : 0)} h`;
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
