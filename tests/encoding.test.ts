import { describe, expect, it } from "vitest";
import { canonical, fromB64url, fromHex, toB64url, toHex, utf8, fromUtf8 } from "../shared/bytes";
import { checkGstin, gstinCheckChar } from "../shared/gstin";

describe("GSTIN check", () => {
  it("accepts a valid GSTIN, ignoring case and spaces", () => {
    // Published sample GSTIN, so the check digit comes from outside this code.
    expect(checkGstin("27AAPFU0939F1ZV")).toEqual({ ok: true, state: "Maharashtra", pan: "AAPFU0939F" });
    expect(checkGstin("  27aapfu0939f1zv ").ok).toBe(true);
  });
  it("names unknown state codes instead of failing", () => {
    const g14 = "01ABCDE1234F1Z";
    expect(checkGstin(g14 + gstinCheckChar(g14))).toMatchObject({ ok: true, state: "state code 01" });
  });
  it("rejects a wrong check digit and a bad format", () => {
    expect(checkGstin("27AAPFU0939F1ZW")).toMatchObject({ ok: false, reason: expect.stringContaining("check digit") });
    expect(checkGstin("36ABCDE1234F1Z9")).toMatchObject({ ok: false }); // the seeded "Fast Pharma" typo
    expect(checkGstin("27AAPFU0939F1Z")).toMatchObject({ ok: false, reason: "not in GSTIN format" });
    expect(checkGstin("27AAPFU0939F0ZV")).toMatchObject({ ok: false, reason: "not in GSTIN format" });
  });
});

describe("byte helpers", () => {
  it("base64url matches Node for every padding length", () => {
    for (let n = 0; n <= 7; n++) {
      const b = Uint8Array.from({ length: n }, (_, i) => (250 - i * 37) & 255);
      expect(toB64url(b)).toBe(Buffer.from(b).toString("base64url"));
      expect(Array.from(fromB64url(toB64url(b)))).toEqual(Array.from(b));
    }
    expect(Array.from(fromB64url("-tU="))).toEqual([250, 213]);
    expect(() => fromB64url("ab+c")).toThrow("bad base64url");
  });
  it("hex round-trips and rejects odd or non-hex input", () => {
    const b = utf8("UniGenome ✓");
    expect(fromUtf8(fromHex(toHex(b)))).toBe("UniGenome ✓");
    expect(toHex(new Uint8Array([0, 15, 255]))).toBe("000fff");
    expect(() => fromHex("abc")).toThrow("bad hex");
    expect(() => fromHex("zz")).toThrow("bad hex");
  });
  it("canonical JSON sorts keys at every level and drops undefined", () => {
    expect(canonical({ b: 1, a: { d: [2, { y: 1, x: 0 }], c: undefined } })).toBe('{"a":{"d":[2,{"x":0,"y":1}]},"b":1}');
    expect(canonical({ x: 1, y: 2 })).toBe(canonical({ y: 2, x: 1 }));
  });
});
