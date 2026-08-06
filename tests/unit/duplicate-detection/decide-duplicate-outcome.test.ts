import { describe, expect, it } from "vitest";
import { decideDuplicateOutcome } from "@/modules/duplicate-detection/decide-duplicate-outcome";

describe("decideDuplicateOutcome", () => {
  it("returns unique with no action when there is no match", () => {
    expect(decideDuplicateOutcome(null, "flag_and_continue")).toEqual({
      duplicateStatus: "unique",
      action: null,
    });
  });

  it("flags a possible duplicate for flag_and_continue", () => {
    expect(decideDuplicateOutcome("email", "flag_and_continue")).toEqual({
      duplicateStatus: "possible_duplicate",
      action: "flag_and_continue",
    });
  });

  it("flags a possible duplicate for send_to_manual_review", () => {
    expect(decideDuplicateOutcome("phone", "send_to_manual_review")).toEqual({
      duplicateStatus: "possible_duplicate",
      action: "send_to_manual_review",
    });
  });

  it("marks a hard duplicate for update_existing", () => {
    expect(decideDuplicateOutcome("external_submission_id", "update_existing")).toEqual({
      duplicateStatus: "duplicate",
      action: "update_existing",
    });
  });

  it("marks a hard duplicate for reject_submission", () => {
    expect(decideDuplicateOutcome("email", "reject_submission")).toEqual({
      duplicateStatus: "duplicate",
      action: "reject_submission",
    });
  });
});
