import { listNotifications } from "@/modules/notifications/notifications";
import { NotificationItem } from "./notification-item";
import { toAppError } from "@/lib/errors/app-error";
import { PageContainer, PageTitle } from "@/components/PageContainer";

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
      <PageContainer>
        <PageTitle>Notifications</PageTitle>
        <p className="text-sm text-danger-text">{loadError}</p>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageTitle>Notifications</PageTitle>
      <div className="flex flex-col gap-3">
        {notifications.map((notification) => (
          <NotificationItem
            key={notification.id}
            orgSlug={orgSlug}
            notification={notification}
          />
        ))}
        {notifications.length === 0 ? (
          <p className="text-sm text-muted">No notifications.</p>
        ) : null}
      </div>
    </PageContainer>
  );
}
