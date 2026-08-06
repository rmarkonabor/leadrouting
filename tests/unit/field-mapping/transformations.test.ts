import { describe, expect, it } from "vitest";
import { applyTransformation } from "@/modules/field-mapping/transformations";

describe("applyTransformation", () => {
  it("trims whitespace", () => {
    expect(applyTransformation("trim", "  hi  ")).toBe("hi");
  });

  it("converts to lowercase and uppercase", () => {
    expect(applyTransformation("lowercase", "HeLLo")).toBe("hello");
    expect(applyTransformation("uppercase", "HeLLo")).toBe("HELLO");
  });

  it("normalizes email", () => {
    expect(applyTransformation("normalize_email", "  John@Example.com ")).toBe(
      "john@example.com",
    );
  });

  it("normalizes phone, keeping a leading +", () => {
    expect(applyTransformation("normalize_phone", "+1 (416) 555-1234")).toBe(
      "+14165551234",
    );
    expect(applyTransformation("normalize_phone", "(416) 555-1234")).toBe("4165551234");
  });

  it("parses numbers and currency", () => {
    expect(applyTransformation("parse_number", "42")).toBe(42);
    expect(applyTransformation("parse_number", "not a number")).toBeNull();
    expect(applyTransformation("parse_currency", "$1,200.50")).toBe(1200.5);
  });

  it("converts common truthy/falsy strings to boolean", () => {
    expect(applyTransformation("to_boolean", "yes")).toBe(true);
    expect(applyTransformation("to_boolean", "no")).toBe(false);
    expect(applyTransformation("to_boolean", "maybe")).toBeNull();
  });

  it("splits a full name into first/last", () => {
    expect(applyTransformation("split_full_name", "John Smith Jr")).toEqual({
      first_name: "John",
      last_name: "Smith Jr",
    });
    expect(applyTransformation("split_full_name", "Cher")).toEqual({
      first_name: "Cher",
      last_name: null,
    });
  });

  it("joins array values with a separator", () => {
    expect(
      applyTransformation("join_values", ["a", "b", "c"], { joinSeparator: "-" }),
    ).toBe("a-b-c");
  });

  it("replaces exact-match values", () => {
    expect(
      applyTransformation("replace_values", "US", {
        replacements: [{ from: "US", to: "United States" }],
      }),
    ).toBe("United States");
    expect(
      applyTransformation("replace_values", "CA", {
        replacements: [{ from: "US", to: "United States" }],
      }),
    ).toBe("CA");
  });

  it("applies a default value only when the input is empty", () => {
    expect(applyTransformation("apply_default", "", { defaultValue: "unknown" })).toBe(
      "unknown",
    );
    expect(
      applyTransformation("apply_default", "present", { defaultValue: "unknown" }),
    ).toBe("present");
  });

  it("returns the value unchanged when no transformation is configured", () => {
    expect(applyTransformation(null, "value")).toBe("value");
  });
});
