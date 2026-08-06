import { applyTransformation } from "./transformations";
import type {
  FieldMappingDestinationType,
  FieldMappingTransformation,
} from "@/lib/supabase/database.types";

export interface FieldMappingConfig {
  sourceFieldName: string;
  destinationType: FieldMappingDestinationType;
  destinationField: string | null;
  dataType: string;
  required: boolean;
  defaultValue: unknown;
  transformation: FieldMappingTransformation | null;
  validationRule: {
    replacements?: Array<{ from: string; to: string }>;
    joinSeparator?: string;
  };
}

export interface MapPayloadResult {
  /** Default lead-field values, keyed by leads column name. */
  mappedFields: Record<string, unknown>;
  /** Custom-variable values, keyed by internal_key. */
  customValues: Record<string, unknown>;
  /** Source field names explicitly configured as `ignored`. */
  ignoredFields: string[];
  /** Source field names present in the payload with no configured mapping —
   * per spec §16's `store_for_review` default, these are preserved (in the
   * submission log's raw payload) but not written to any lead field. */
  unmappedFields: string[];
}

/**
 * Applies an organization's field-mapping configuration to one raw intake
 * payload. Pure and side-effect free so the mapping tester and the real
 * intake pipeline share identical, independently testable behavior.
 */
export function mapPayload(
  rawPayload: Record<string, unknown>,
  mappings: FieldMappingConfig[],
): MapPayloadResult {
  const mappedFields: Record<string, unknown> = {};
  const customValues: Record<string, unknown> = {};
  const ignoredFields: string[] = [];
  const mappedSourceFields = new Set(mappings.map((m) => m.sourceFieldName));

  for (const mapping of mappings) {
    const rawValue = rawPayload[mapping.sourceFieldName];

    if (mapping.destinationType === "ignored") {
      ignoredFields.push(mapping.sourceFieldName);
      continue;
    }

    const transformed = applyTransformation(mapping.transformation, rawValue, {
      replacements: mapping.validationRule.replacements,
      joinSeparator: mapping.validationRule.joinSeparator,
      defaultValue: mapping.defaultValue,
    });

    if (mapping.destinationType === "default_field" && mapping.destinationField) {
      if (
        mapping.transformation === "split_full_name" &&
        transformed &&
        typeof transformed === "object"
      ) {
        Object.assign(mappedFields, transformed);
      } else {
        mappedFields[mapping.destinationField] = transformed;
      }
    } else if (
      mapping.destinationType === "custom_variable" &&
      mapping.destinationField
    ) {
      customValues[mapping.destinationField] = transformed;
    }
  }

  const unmappedFields = Object.keys(rawPayload).filter(
    (key) => !mappedSourceFields.has(key),
  );

  return { mappedFields, customValues, ignoredFields, unmappedFields };
}
