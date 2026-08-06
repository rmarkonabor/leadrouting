import type { FieldMappingConfig } from "@/modules/field-mapping/map-payload";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[0-9]{7,15}$/;
const MAX_FIELD_LENGTH = 2000;

/**
 * Validates the mapped default lead fields against each field mapping's
 * `required` flag and basic format rules (spec §20 items 1-4, 7: required
 * fields, email format, phone format, maximum field lengths, date format).
 * Pure and unit-testable; shared by the intake pipeline and the mapping
 * tester.
 */
export function validateLeadFields(
  mappedFields: Record<string, unknown>,
  mappings: FieldMappingConfig[],
): string[] {
  const errors: string[] = [];

  for (const mapping of mappings) {
    if (mapping.destinationType !== "default_field" || !mapping.destinationField) {
      continue;
    }

    const field = mapping.destinationField;
    const value = mappedFields[field];
    const isEmpty = value === null || value === undefined || value === "";

    if (mapping.required && isEmpty) {
      errors.push(`${field} is required.`);
      continue;
    }

    if (isEmpty) {
      continue;
    }

    if (field === "email" && (typeof value !== "string" || !EMAIL_RE.test(value))) {
      errors.push("email must be a valid email address.");
    }

    if (
      field === "phone" &&
      (typeof value !== "string" || !PHONE_RE.test(value.replace(/[\s()-]/g, "")))
    ) {
      errors.push("phone must be a valid phone number.");
    }

    if (typeof value === "string" && value.length > MAX_FIELD_LENGTH) {
      errors.push(`${field} exceeds the maximum allowed length.`);
    }
  }

  if (
    typeof mappedFields.consent_timestamp === "string" &&
    mappedFields.consent_timestamp !== ""
  ) {
    if (Number.isNaN(Date.parse(mappedFields.consent_timestamp as string))) {
      errors.push("consent_timestamp must be a valid date.");
    }
  }

  return errors;
}
