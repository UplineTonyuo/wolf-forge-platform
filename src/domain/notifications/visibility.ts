import type { NotificationUnreadCounts, WalletNotificationItem } from "../../app/actions/notifications";

export function visibleNotificationUnreadCount(
  total: number | null,
  counts: NotificationUnreadCounts | null,
  ticketsAvailable: boolean,
  projectsAvailable: boolean,
): number | null {
  if (ticketsAvailable && projectsAvailable) return total;
  if (!counts) return null;
  return ticketsAvailable ? counts.withoutProjects : projectsAvailable ? counts.withoutTickets : counts.withoutConversations;
}

export function notificationVisibleWithModules(
  item: WalletNotificationItem,
  ticketsAvailable: boolean,
  projectsAvailable: boolean,
): boolean {
  return (ticketsAvailable || (item.category !== "ticket" && item.entityType !== "ticket"))
    && (projectsAvailable || (item.entityType !== "order" && item.entityType !== "order_task"));
}
