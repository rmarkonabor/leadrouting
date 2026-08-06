import type { AttributeFieldType } from "@/lib/supabase/database.types";

export interface CustomVariableDefinitionLike {
  internalKey: string;
  fieldType: AttributeFieldType;
  required: boolean;
  options: unknown[];
  validationRules: {
    minLength?: number;
    maxLength?: number;
    min?: number;
    max?: number;
    pattern?: string;
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[0-9]{7,15}$/;
const URL_RE = /^https?:\/\/[^\s]+$/i;

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || value === "";
}

/**
 * Validates one custom-variable value against its definition (spec §20 item
 * 9: "Custom variable validation rules"). Pure and unit-testable; shared by
 * the intake pipeline and the mapping tester.
 */
export function validateCustomValue(
  definition: CustomVariableDefinitionLike,
  value: unknown,
): string | null {
  if (isEmpty(value)) {
    return definition.required ? `${definition.internalKey} is required.` : null;
  }

  switch (definition.fieldType) {
    case "email":
      if (typeof value !== "string" || !EMAIL_RE.test(value)) {
        return `${definition.internalKey} must be a valid email address.`;
      }
      break;
    case "phone":
      if (typeof value !== "string" || !PHONE_RE.test(value.replace(/[\s()-]/g, ""))) {
        return `${definition.internalKey} must be a valid phone number.`;
      }
      break;
    case "url":
      if (typeof value !== "string" || !URL_RE.test(value)) {
        return `${definition.internalKey} must be a valid URL.`;
      }
      break;
    case "number":
    case "currency":
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return `${definition.internalKey} must be a number.`;
      }
      if (
        definition.validationRules.min !== undefined &&
        value < definition.validationRules.min
      ) {
        return `${definition.internalKey} must be at least ${definition.validationRules.min}.`;
      }
      if (
        definition.validationRules.max !== undefined &&
        value > definition.validationRules.max
      ) {
        return `${definition.internalKey} must be at most ${definition.validationRules.max}.`;
      }
      break;
    case "boolean":
      if (typeof value !== "boolean") {
        return `${definition.internalKey} must be true or false.`;
      }
      break;
    case "date":
    case "datetime":
      if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
        return `${definition.internalKey} must be a valid date.`;
      }
      break;
    case "single_select":
      if (definition.options.length > 0 && !definition.options.includes(value)) {
        return `${definition.internalKey} must be one of the configured options.`;
      }
      break;
    case "multi_select":
      if (!Array.isArray(value)) {
        return `${definition.internalKey} must be a list of values.`;
      }
      if (
        definition.options.length > 0 &&
        !value.every((v) => definition.options.includes(v))
      ) {
        return `${definition.internalKey} must only contain configured options.`;
      }
      break;
    case "text":
    case "long_text":
      if (typeof value !== "string") {
        return `${definition.internalKey} must be text.`;
      }
      if (
        definition.validationRules.minLength !== undefined &&
        value.length < definition.validationRules.minLength
      ) {
        return `${definition.internalKey} is too short.`;
      }
      if (
        definition.validationRules.maxLength !== undefined &&
        value.length > definition.validationRules.maxLength
      ) {
        return `${definition.internalKey} is too long.`;
      }
      break;
  }

  if (
    typeof value === "string" &&
    definition.validationRules.pattern &&
    !new RegExp(definition.validationRules.pattern).test(value)
  ) {
    return `${definition.internalKey} does not match the required format.`;
  }

  return null;
}
