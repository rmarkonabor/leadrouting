import { describe, expect, it } from "vitest";
import { validateLeadFields } from "@/modules/lead-intake/validate-lead-fields";
import type { FieldMappingConfig } from "@/modules/field-mapping/map-payload";

function mapping(overrides: Partial<FieldMappingConfig>): FieldMappingConfig {
  return {
    sourceFieldName: "field",
    destinationType: "default_field",
    destinationField: "field",
    dataType: "text",
    required: false,
    defaultValue: null,
    transformation: null,
    validationRule: {},
    ...overrides,
  };
}

describe("validateLeadFields", () => {
  it("flags a required field that is missing", () => {
    const errors = validateLeadFields({}, [
      mapping({ destinationField: "email", required: true }),
    ]);
    expect(errors).toContain("email is required.");
  });

  it("flags an invalid email format", () => {
    const errors = validateLeadFields({ email: "not-an-email" }, [
      mapping({ destinationField: "email" }),
    ]);
    expect(errors).toContain("email must be a valid email address.");
  });

  it("accepts a valid email format", () => {
    const errors = validateLeadFields({ email: "person@example.com" }, [
      mapping({ destinationField: "email" }),
    ]);
    expect(errors).toEqual([]);
  });

  it("flags an invalid phone format", () => {
    const errors = validateLeadFields({ phone: "abc" }, [
      mapping({ destinationField: "phone" }),
    ]);
    expect(errors).toContain("phone must be a valid phone number.");
  });

  it("flags a field exceeding the maximum length", () => {
    const errors = validateLeadFields({ message: "x".repeat(2001) }, [
      mapping({ destinationField: "message" }),
    ]);
    expect(errors).toContain("message exceeds the maximum allowed length.");
  });

  it("flags an invalid consent_timestamp date", () => {
    const errors = validateLeadFields({ consent_timestamp: "not-a-date" }, []);
    expect(errors).toContain("consent_timestamp must be a valid date.");
  });
});
