import type { WalletNotificationItem } from "../../app/actions/notifications";

export function notificationVisibleWithModules(
  item: WalletNotificationItem,
  ticketsAvailable: boolean,
  projectsAvailable: boolean,
): boolean {
  return (ticketsAvailable || (item.category !== "ticket" && item.entityType !== "ticket"))
    && (projectsAvailable || (item.entityType !== "order" && item.entityType !== "order_task"));
}
