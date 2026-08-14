import type { ReactNode } from "react";

export type BadgeVariant = "success" | "warning" | "danger" | "info" | "neutral";

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  success: "bg-success-bg text-success-text",
  warning: "bg-warning-bg text-warning-text",
  danger: "bg-danger-bg text-danger-text",
  info: "bg-info-bg text-info-text",
  neutral: "bg-neutral-bg text-neutral-text",
};

export function Badge({
  variant = "neutral",
  children,
}: {
  variant?: BadgeVariant;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${VARIANT_CLASSES[variant]}`}
    >
      {children}
    </span>
  );
}

const STATUS_VARIANT_MAP: Record<string, BadgeVariant> = {
  assigned: "success",
  accepted: "success",
  active: "success",
  succeeded: "success",
  completed: "success",
  resolved: "success",
  converted: "success",
  read: "success",
  pending: "warning",
  notified: "warning",
  viewed: "warning",
  invited: "warning",
  in_progress: "warning",
  possible_duplicate: "warning",
  unread: "warning",
  declined: "danger",
  expired: "danger",
  failed: "danger",
  cancelled: "danger",
  suspended: "danger",
  dead_letter: "danger",
  duplicate: "danger",
  lost: "danger",
  unassigned: "neutral",
  inactive: "neutral",
  new: "neutral",
  none: "neutral",
  draft: "neutral",
  dismissed: "neutral",
  manual_review: "info",
  open: "info",
  published: "info",
};

/**
 * Best-effort status -> color mapping for the many free-text status/outcome
 * strings across the app (assignment_status, lead_status, notification
 * state, manual_review reason, etc.) — falls back to neutral for anything
 * unrecognized rather than guessing wrong.
 */
export function StatusBadge({ status }: { status: string | null | undefined }) {
  if (!status) return <Badge variant="neutral">—</Badge>;
  const variant = STATUS_VARIANT_MAP[status.toLowerCase()] ?? "neutral";
  return <Badge variant={variant}>{status.replace(/_/g, " ")}</Badge>;
}
