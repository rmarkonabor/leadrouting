import { listNotifications } from "@/modules/notifications/notifications";
import { NotificationItem } from "./notification-item";
import { toAppError } from "@/lib/errors/app-error";

export default async function NotificationsPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;

  const [notifications, loadError] = await listNotifications(orgSlug).then(
    (data) => [data, null] as const,
    (error: unknown) => [null, toAppError(error).message] as const,
  );

  if (loadError || !notifications) {
    return (
      <main>
        <h1>Notifications</h1>
        <p>{loadError}</p>
      </main>
    );
  }

  return (
    <main>
      <h1>Notifications</h1>
      <ul>
        {notifications.map((notification) => (
          <NotificationItem
            key={notification.id}
            orgSlug={orgSlug}
            notification={notification}
          />
        ))}
        {notifications.length === 0 ? <li>No notifications.</li> : null}
      </ul>
    </main>
  );
}
