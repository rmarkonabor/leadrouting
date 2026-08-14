"use client";

import Link from "next/link";
import {
  markNotificationReadAction,
  markAssignmentViewedAction,
  acceptAssignmentAction,
  declineAssignmentAction,
} from "@/modules/notifications/actions";
import { Card } from "@/components/Card";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";

export function NotificationItem({
  orgSlug,
  notification,
}: {
  orgSlug: string;
  notification: {
    id: string;
    title: string;
    body: string;
    read_at: string | null;
    assignment_id: string | null;
    lead_id: string | null;
  };
}) {
  const markReadAction = markNotificationReadAction.bind(null, orgSlug, notification.id);

  return (
    <Card className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <strong>{notification.title}</strong>
        <Badge variant={notification.read_at === null ? "warning" : "success"}>
          {notification.read_at === null ? "unread" : "read"}
        </Badge>
      </div>
      <p className="text-sm">{notification.body}</p>
      {notification.lead_id ? (
        <Link
          href={`/org/${orgSlug}/leads/${notification.lead_id}`}
          className="text-sm text-brand-600 hover:underline"
        >
          View lead
        </Link>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {notification.read_at === null ? (
          <form action={markReadAction}>
            <Button type="submit" variant="secondary">
              Mark read
            </Button>
          </form>
        ) : null}
        {notification.assignment_id ? (
          <>
            <form
              action={markAssignmentViewedAction.bind(
                null,
                orgSlug,
                notification.assignment_id,
              )}
            >
              <Button type="submit" variant="secondary">
                Mark viewed
              </Button>
            </form>
            <form
              action={acceptAssignmentAction.bind(
                null,
                orgSlug,
                notification.assignment_id,
              )}
            >
              <Button type="submit">Accept</Button>
            </form>
            <form
              action={declineAssignmentAction.bind(
                null,
                orgSlug,
                notification.assignment_id,
              )}
            >
              <Button type="submit" variant="danger">
                Decline
              </Button>
            </form>
          </>
        ) : null}
      </div>
    </Card>
  );
}
