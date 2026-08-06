import { describe, expect, it } from "vitest";
import {
  validateCustomValue,
  type CustomVariableDefinitionLike,
} from "@/modules/field-mapping/validate-custom-value";

function definition(
  overrides: Partial<CustomVariableDefinitionLike>,
): CustomVariableDefinitionLike {
  return {
    internalKey: "field",
    fieldType: "text",
    required: false,
    options: [],
    validationRules: {},
    ...overrides,
  };
}

describe("validateCustomValue", () => {
  it("requires a value when the definition is required", () => {
    const error = validateCustomValue(definition({ required: true }), undefined);
    expect(error).toBe("field is required.");
  });

  it("allows a missing value when not required", () => {
    const error = validateCustomValue(definition({ required: false }), undefined);
    expect(error).toBeNull();
  });

  it("validates email format", () => {
    expect(
      validateCustomValue(definition({ fieldType: "email" }), "not-an-email"),
    ).not.toBeNull();
    expect(validateCustomValue(definition({ fieldType: "email" }), "a@b.com")).toBeNull();
  });

  it("validates number range", () => {
    const def = definition({ fieldType: "number", validationRules: { min: 0, max: 10 } });
    expect(validateCustomValue(def, 15)).not.toBeNull();
    expect(validateCustomValue(def, 5)).toBeNull();
  });

  it("validates single_select option membership", () => {
    const def = definition({ fieldType: "single_select", options: ["a", "b"] });
    expect(validateCustomValue(def, "c")).not.toBeNull();
    expect(validateCustomValue(def, "a")).toBeNull();
  });

  it("validates boolean type", () => {
    const def = definition({ fieldType: "boolean" });
    expect(validateCustomValue(def, "true")).not.toBeNull();
    expect(validateCustomValue(def, true)).toBeNull();
  });
});
