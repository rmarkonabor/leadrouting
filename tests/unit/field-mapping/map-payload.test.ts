import { describe, expect, it } from "vitest";
import { mapPayload, type FieldMappingConfig } from "@/modules/field-mapping/map-payload";

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

describe("mapPayload", () => {
  it("maps incoming fields that don't match internal names, per a configured mapping", () => {
    const result = mapPayload(
      { fname: "John", lname: "Smith", contact_email: "JOHN@EXAMPLE.COM" },
      [
        mapping({ sourceFieldName: "fname", destinationField: "first_name" }),
        mapping({ sourceFieldName: "lname", destinationField: "last_name" }),
        mapping({
          sourceFieldName: "contact_email",
          destinationField: "email",
          transformation: "normalize_email",
        }),
      ],
    );

    expect(result.mappedFields).toEqual({
      first_name: "John",
      last_name: "Smith",
      email: "john@example.com",
    });
  });

  it("routes a mapping to a custom variable by internal_key", () => {
    const result = mapPayload({ budget: "900000" }, [
      mapping({
        sourceFieldName: "budget",
        destinationType: "custom_variable",
        destinationField: "estimated_budget",
        transformation: "parse_currency",
      }),
    ]);

    expect(result.customValues).toEqual({ estimated_budget: 900000 });
    expect(result.mappedFields).toEqual({});
  });

  it("records ignored fields separately and excludes them from mapped output", () => {
    const result = mapPayload({ utm_noise: "x" }, [
      mapping({
        sourceFieldName: "utm_noise",
        destinationType: "ignored",
        destinationField: null,
      }),
    ]);

    expect(result.ignoredFields).toEqual(["utm_noise"]);
    expect(result.mappedFields).toEqual({});
  });

  it("reports payload fields with no configured mapping as unmapped", () => {
    const result = mapPayload({ known: "a", surprise_field: "b" }, [
      mapping({ sourceFieldName: "known", destinationField: "message" }),
    ]);

    expect(result.unmappedFields).toEqual(["surprise_field"]);
  });

  it("merges split_full_name's object output directly into mapped fields", () => {
    const result = mapPayload({ full_name: "Jane Doe" }, [
      mapping({
        sourceFieldName: "full_name",
        destinationField: "full_name",
        transformation: "split_full_name",
      }),
    ]);

    expect(result.mappedFields).toEqual({ first_name: "Jane", last_name: "Doe" });
  });
});
