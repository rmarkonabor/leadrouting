import { describe, expect, it } from "vitest";
import { isWithinWorkingHours } from "@/modules/routing/working-hours";

describe("isWithinWorkingHours", () => {
  it("returns true inside the configured window in the user's timezone", () => {
    // 2026-08-06 is a Thursday. 15:00 UTC = 11:00 EDT (America/New_York, UTC-4 in August).
    const evaluatedAt = new Date("2026-08-06T15:00:00Z");
    const result = isWithinWorkingHours(evaluatedAt, "America/New_York", {
      thursday: { start: "09:00", end: "17:00" },
    });
    expect(result).toBe(true);
  });

  it("returns false outside the configured window in the user's timezone", () => {
    // 15:00 UTC = 11:00 EDT — outside a 09:00-10:00 window.
    const evaluatedAt = new Date("2026-08-06T15:00:00Z");
    const result = isWithinWorkingHours(evaluatedAt, "America/New_York", {
      thursday: { start: "09:00", end: "10:00" },
    });
    expect(result).toBe(false);
  });

  it("the same UTC instant can be within hours in one timezone and outside in another", () => {
    // 15:00 UTC = 11:00 EDT (within 09-17) but = 00:00 JST next day in Asia/Tokyo (outside 09-17).
    const evaluatedAt = new Date("2026-08-06T15:00:00Z");
    const workingHours = {
      thursday: { start: "09:00", end: "17:00" },
      friday: { start: "09:00", end: "17:00" },
    };
    expect(isWithinWorkingHours(evaluatedAt, "America/New_York", workingHours)).toBe(
      true,
    );
    expect(isWithinWorkingHours(evaluatedAt, "Asia/Tokyo", workingHours)).toBe(false);
  });

  it("returns false for a day with no configured window", () => {
    // 2026-08-08 is a Saturday.
    const evaluatedAt = new Date("2026-08-08T15:00:00Z");
    expect(
      isWithinWorkingHours(evaluatedAt, "America/New_York", {
        monday: { start: "09:00", end: "17:00" },
      }),
    ).toBe(false);
  });
});
