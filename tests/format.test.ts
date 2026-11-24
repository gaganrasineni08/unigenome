import { describe, expect, it } from "vitest";
import { fmtHours, short } from "../src/lib/format";

describe("fmtHours", () => {
  it("shows minutes under an hour", () => {
    expect(fmtHours(0)).toBe("0 min");
    expect(fmtHours(0.5)).toBe("30 min");
  });
  it("does not print 60 min when it rounds up to an hour", () => {
    expect(fmtHours(0.995)).toBe("1.0 h");
  });
  it("uses one decimal below 10 h and none from 10 h", () => {
    expect(fmtHours(2.25)).toBe("2.3 h");
    expect(fmtHours(9.97)).toBe("10 h");
    expect(fmtHours(30)).toBe("30 h");
  });
  it("switches to days at 48 h", () => {
    expect(fmtHours(47.6)).toBe("2.0 days");
    expect(fmtHours(72)).toBe("3.0 days");
  });
  it("clamps tiny negative gaps and reports non-finite as unknown", () => {
    expect(fmtHours(-0.001)).toBe("0 min");
    expect(fmtHours(Infinity)).toBe("unknown");
    expect(fmtHours(NaN)).toBe("unknown");
  });
});

describe("short", () => {
  it("keeps short strings and elides long ones", () => {
    expect(short("abc")).toBe("abc");
    expect(short("a".repeat(10) + "b".repeat(20) + "cccccc")).toBe("a".repeat(10) + "…" + "cccccc");
  });
});
