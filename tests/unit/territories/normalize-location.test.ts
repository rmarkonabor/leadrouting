import { describe, expect, it } from "vitest";
import { normalizeLocation } from "@/modules/territories/normalize-location";

describe("normalizeLocation", () => {
  it("returns not_provided when no location fields are present", () => {
    const result = normalizeLocation({});
    expect(result.normalizationStatus).toBe("not_provided");
    expect(result.normalizedAddress).toBeNull();
  });

  it("returns confirmed for postal code plus country", () => {
    const result = normalizeLocation({ postalCode: "m5v 1j2", country: "Canada" });
    expect(result.normalizationStatus).toBe("confirmed");
    expect(result.geographicIdentifier).toBe("M5V 1J2");
  });

  it("returns confirmed for city + state + country", () => {
    const result = normalizeLocation({
      city: "Toronto",
      stateProvince: "Ontario",
      country: "Canada",
    });
    expect(result.normalizationStatus).toBe("confirmed");
  });

  it("returns ambiguous for a postal code with no country", () => {
    const result = normalizeLocation({ postalCode: "90210" });
    expect(result.normalizationStatus).toBe("ambiguous");
  });

  it("returns partial for a country alone", () => {
    const result = normalizeLocation({ country: "Canada" });
    expect(result.normalizationStatus).toBe("partial");
  });

  it("returns invalid for only street-level fields with no geographic identifier", () => {
    const result = normalizeLocation({ streetAddress: "123 Main St", unitNumber: "4B" });
    expect(result.normalizationStatus).toBe("invalid");
  });

  it("never alters the caller's original fields (preservation)", () => {
    const input = {
      streetAddress: "123 Main St",
      city: "Toronto",
      stateProvince: "Ontario",
      country: "Canada",
    };
    const snapshot = { ...input };
    normalizeLocation(input);
    expect(input).toEqual(snapshot);
  });
});
