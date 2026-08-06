import type { LocationNormalizationStatus } from "@/lib/supabase/database.types";

export interface RawLocationInput {
  streetAddress?: string | null;
  unitNumber?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  county?: string | null;
  stateProvince?: string | null;
  postalCode?: string | null;
  country?: string | null;
}

export interface NormalizedLocation {
  normalizedAddress: string | null;
  geographicIdentifier: string | null;
  normalizationStatus: LocationNormalizationStatus;
  normalizationProvider: string | null;
}

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Rule-based location normalization (spec §22). No live geocoding provider
 * is configured in this milestone (`GEOCODING_PROVIDER_KEY` is optional and
 * unused) — this is a deterministic, provider-agnostic pass that decides how
 * confidently the submitted location can be placed geographically, which is
 * what territory matching depends on. The original submitted fields on
 * `leads` are never modified by this function; its output is written only
 * to `lead_locations_internal`.
 */
export function normalizeLocation(input: RawLocationInput): NormalizedLocation {
  const country = clean(input.country);
  const stateProvince = clean(input.stateProvince);
  const city = clean(input.city);
  const postalCode = clean(input.postalCode)?.toUpperCase() ?? null;

  const hasAnyField = [
    input.streetAddress,
    input.unitNumber,
    input.neighborhood,
    city,
    input.county,
    stateProvince,
    postalCode,
    country,
  ].some((value) => clean(value ?? null) !== null);

  if (!hasAnyField) {
    return {
      normalizedAddress: null,
      geographicIdentifier: null,
      normalizationStatus: "not_provided",
      normalizationProvider: null,
    };
  }

  const addressParts = [
    clean(input.streetAddress),
    clean(input.unitNumber),
    city,
    clean(input.county),
    stateProvince,
    postalCode,
    country,
  ].filter((part): part is string => part !== null);
  const normalizedAddress = addressParts.length > 0 ? addressParts.join(", ") : null;

  let normalizationStatus: LocationNormalizationStatus;
  // A postal code alone, with no country, is ambiguous — postal code formats
  // collide across countries (e.g. "90210" is valid in several).
  if (postalCode && !country) {
    normalizationStatus = "ambiguous";
  } else if (postalCode && country) {
    normalizationStatus = "confirmed";
  } else if (city && stateProvince && country) {
    normalizationStatus = "confirmed";
  } else if (country || stateProvince || city) {
    normalizationStatus = "partial";
  } else {
    // Only street-level fields (street_address/unit_number/neighborhood)
    // with no city/state/postal/country — nothing to geographically place.
    normalizationStatus = "invalid";
  }

  const geographicIdentifier = postalCode ?? city ?? stateProvince ?? country ?? null;

  return {
    normalizedAddress,
    geographicIdentifier,
    normalizationStatus,
    normalizationProvider: "internal-rule-based",
  };
}
