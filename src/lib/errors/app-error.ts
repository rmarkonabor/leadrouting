/**
 * Consistent application error format (docs/api-specification.md §4).
 * Every error surfaced to a client uses this shape; the `message` field is
 * always safe to display (no personal data, no internal detail).
 */
export type AppErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "invalid_input"
  | "no_organization_membership"
  | "organization_not_found_or_forbidden"
  | "conflict"
  | "internal_error";

const DEFAULT_STATUS_BY_CODE: Record<AppErrorCode, number> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  invalid_input: 422,
  no_organization_membership: 403,
  organization_not_found_or_forbidden: 403,
  conflict: 409,
  internal_error: 500,
};

export interface AppErrorDetails {
  field?: string;
  message: string;
}

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly status: number;
  readonly details?: AppErrorDetails[];

  constructor(
    code: AppErrorCode,
    message: string,
    options?: { details?: AppErrorDetails[]; cause?: unknown },
  ) {
    super(message, { cause: options?.cause });
    this.name = "AppError";
    this.code = code;
    this.status = DEFAULT_STATUS_BY_CODE[code];
    this.details = options?.details;
  }

  toSafeResponse(): {
    error: AppErrorCode;
    message: string;
    details?: AppErrorDetails[];
  } {
    return {
      error: this.code,
      message: this.message,
      ...(this.details ? { details: this.details } : {}),
    };
  }
}

/**
 * Normalizes any thrown value into a safe, non-PII AppError. Unexpected
 * errors are collapsed into a generic "internal_error" so their (possibly
 * unsafe) message never reaches a client response; callers are expected to
 * log the original `cause` server-side via lib/logging before discarding it.
 */
export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }

  return new AppError("internal_error", "Something went wrong. Please try again.", {
    cause: error,
  });
}
