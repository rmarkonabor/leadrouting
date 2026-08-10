"use client";

import {
  markNotificationReadAction,
  markAssignmentViewedAction,
  acceptAssignmentAction,
  declineAssignmentAction,
} from "@/modules/notifications/actions";

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
    <li>
      <strong>{notification.title}</strong>
      <p>{notification.body}</p>
      {notification.read_at === null ? (
        <form action={markReadAction} style={{ display: "inline" }}>
          <button type="submit">Mark read</button>
        </form>
      ) : (
        <span> (read)</span>
      )}
      {notification.assignment_id ? (
        <>
          {" "}
          <form
            action={markAssignmentViewedAction.bind(
              null,
              orgSlug,
              notification.assignment_id,
            )}
            style={{ display: "inline" }}
          >
            <button type="submit">Mark viewed</button>
          </form>{" "}
          <form
            action={acceptAssignmentAction.bind(
              null,
              orgSlug,
              notification.assignment_id,
            )}
            style={{ display: "inline" }}
          >
            <button type="submit">Accept</button>
          </form>{" "}
          <form
            action={declineAssignmentAction.bind(
              null,
              orgSlug,
              notification.assignment_id,
            )}
            style={{ display: "inline" }}
          >
            <button type="submit">Decline</button>
          </form>
        </>
      ) : null}
    </li>
  );
}
