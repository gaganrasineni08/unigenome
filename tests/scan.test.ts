import { describe, expect, it } from "vitest";
import { generateKeyPair } from "../shared/crypto";
import { encodePayload, signUnit, type ItemFields } from "../shared/identity";
import { nearestSite } from "../src/lib/geo";
import { unitIdFromScan } from "../src/lib/record";

const item: ItemFields = {
  kind: "item", id: "I-B1024-0007", batch: "B-1024", mfr: "M-07", product: "PCM-500", mfg: "2026-10-02", salt: "9f3a",
};

describe("unitIdFromScan", () => {
  const payload = encodePayload(signUnit(item, generateKeyPair().secretKey));

  it("takes a typed unit id as is, upper-cased and trimmed", () => {
    expect(unitIdFromScan("  i-b1024-0007 ")).toBe("I-B1024-0007");
    expect(unitIdFromScan("C-77")).toBe("C-77");
  });
  it("reads the id out of a bare QR payload", () => {
    expect(unitIdFromScan(payload)).toBe("I-B1024-0007");
  });
  it("reads the id out of a verify URL with the payload after #", () => {
    expect(unitIdFromScan(`https://example.test/verify#${payload}`)).toBe("I-B1024-0007");
  });
  it("falls back to the upper-cased text when it is not a payload", () => {
    expect(unitIdFromScan("not a code")).toBe("NOT A CODE");
  });
});

describe("nearestSite", () => {
  // Two sites in Hyderabad about 6 km apart.
  const office = { id: "S-1", lat: 17.4065, lng: 78.4772 };
  const plant = { id: "S-2", lat: 17.4401, lng: 78.4983 };

  it("picks the closest site within the radius", () => {
    expect(nearestSite([office, plant], { lat: 17.4400, lng: 78.4980 })).toBe(plant);
    expect(nearestSite([office, plant], { lat: 17.4066, lng: 78.4770 })).toBe(office);
  });
  it("returns null when every site is further than withinKm", () => {
    const between = { lat: 17.4233, lng: 78.4877 }; // ~3 km from each
    expect(nearestSite([office, plant], between)).toBeNull();
    expect(nearestSite([office, plant], between, 5)).not.toBeNull();
  });
  it("returns null with no sites", () => {
    expect(nearestSite([], { lat: 17.4, lng: 78.4 })).toBeNull();
  });
});
