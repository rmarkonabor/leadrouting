import { describe, expect, it } from "vitest";
import { AppError, toAppError } from "@/lib/errors/app-error";

describe("AppError", () => {
  it("produces a safe response shape", () => {
    const error = new AppError("forbidden", "You cannot do that.");
    expect(error.toSafeResponse()).toEqual({
      error: "forbidden",
      message: "You cannot do that.",
    });
    expect(error.status).toBe(403);
  });

  it("includes details when provided", () => {
    const error = new AppError("invalid_input", "Bad input.", {
      details: [{ field: "email", message: "Invalid email." }],
    });
    expect(error.toSafeResponse().details).toEqual([
      { field: "email", message: "Invalid email." },
    ]);
  });
});

describe("toAppError", () => {
  it("passes through an existing AppError unchanged", () => {
    const original = new AppError("not_found", "Not found.");
    expect(toAppError(original)).toBe(original);
  });

  it("collapses an unknown error into a generic, safe internal_error", () => {
    const raw = new Error("leaked internal detail: connection string abc123");
    const wrapped = toAppError(raw);

    expect(wrapped.code).toBe("internal_error");
    expect(wrapped.status).toBe(500);
    expect(wrapped.message).not.toContain("connection string");
    expect(wrapped.cause).toBe(raw);
  });
});
