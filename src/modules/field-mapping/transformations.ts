import type { FieldMappingTransformation } from "@/lib/supabase/database.types";

export interface TransformOptions {
  /** Used by `replace_values`: exact-match replacements, checked in order. */
  replacements?: Array<{ from: string; to: string }>;
  /** Used by `join_values`: separator placed between array elements. */
  joinSeparator?: string;
  /** Used by `apply_default`: value substituted when the input is empty. */
  defaultValue?: unknown;
}

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || value === "";
}

/**
 * Pure implementation of the twelve field-mapping transformations (spec
 * §19). Decoupled from any database/Supabase call so it can be unit tested
 * directly against fixture values, and reused identically by the mapping
 * tester and by the real intake pipeline.
 */
export function applyTransformation(
  transformation: FieldMappingTransformation | null | undefined,
  value: unknown,
  options: TransformOptions = {},
): unknown {
  if (!transformation) {
    return value;
  }

  switch (transformation) {
    case "trim":
      return typeof value === "string" ? value.trim() : value;

    case "lowercase":
      return typeof value === "string" ? value.toLowerCase() : value;

    case "uppercase":
      return typeof value === "string" ? value.toUpperCase() : value;

    case "normalize_email":
      return typeof value === "string" ? value.trim().toLowerCase() : value;

    case "normalize_phone":
      if (typeof value !== "string") return value;
      // Keep a leading "+" (international prefix) and digits only.
      return value
        .trim()
        .replace(/(?!^\+)[^\d]/g, "")
        .replace(/^(\+?)0*(?=\d)/, "$1");

    case "parse_number": {
      if (typeof value === "number") return value;
      if (typeof value !== "string") return null;
      const n = Number(value.trim());
      return Number.isFinite(n) ? n : null;
    }

    case "parse_currency": {
      if (typeof value === "number") return value;
      if (typeof value !== "string") return null;
      const cleaned = value.replace(/[^\d.-]/g, "");
      const n = Number(cleaned);
      return Number.isFinite(n) ? n : null;
    }

    case "to_boolean": {
      if (typeof value === "boolean") return value;
      if (typeof value === "number") return value !== 0;
      if (typeof value !== "string") return null;
      const normalized = value.trim().toLowerCase();
      if (["true", "yes", "y", "1", "on"].includes(normalized)) return true;
      if (["false", "no", "n", "0", "off"].includes(normalized)) return false;
      return null;
    }

    case "split_full_name": {
      if (typeof value !== "string" || value.trim() === "") {
        return { first_name: null, last_name: null };
      }
      const parts = value.trim().split(/\s+/);
      return {
        first_name: parts[0] ?? null,
        last_name: parts.length > 1 ? parts.slice(1).join(" ") : null,
      };
    }

    case "join_values": {
      const separator = options.joinSeparator ?? " ";
      if (Array.isArray(value)) {
        return value.filter((v) => !isEmpty(v)).join(separator);
      }
      return value;
    }

    case "replace_values": {
      if (typeof value !== "string" || !options.replacements) return value;
      const match = options.replacements.find((r) => r.from === value);
      return match ? match.to : value;
    }

    case "apply_default":
      return isEmpty(value) ? (options.defaultValue ?? null) : value;

    default:
      return value;
  }
}
