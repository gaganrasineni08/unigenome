// GSTIN format and check-digit validation, used to screen company registrations.
// A GSTIN is 15 characters: 2-digit state code, 10-character PAN, entity number, "Z", check character.

const CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const FORMAT = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** The check character for the first 14 characters (mod-36 weighted sum, weights 1, 2, 1, 2, ...). */
export function gstinCheckChar(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const p = CHARS.indexOf(first14[i]) * (i % 2 ? 2 : 1);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return CHARS[(36 - (sum % 36)) % 36];
}

export function checkGstin(raw: string): { ok: boolean; reason?: string; state?: string; pan?: string } {
  const g = raw.trim().toUpperCase();
  if (!FORMAT.test(g)) return { ok: false, reason: "not in GSTIN format" };
  if (gstinCheckChar(g.slice(0, 14)) !== g[14]) return { ok: false, reason: "check digit is wrong (typo or made up)" };
  return { ok: true, state: STATES[g.slice(0, 2)] ?? "state code " + g.slice(0, 2), pan: g.slice(2, 12) };
}

const STATES: Record<string, string> = {
  "07": "Delhi", "09": "Uttar Pradesh", "19": "West Bengal", "24": "Gujarat", "27": "Maharashtra",
  "29": "Karnataka", "32": "Kerala", "33": "Tamil Nadu", "36": "Telangana", "37": "Andhra Pradesh",
};
