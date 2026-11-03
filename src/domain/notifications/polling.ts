export const NOTIFICATION_POLL_TICK_MS = 4_000;

export function notificationPollDelay(open: boolean, failures: number): number {
  const base = open ? NOTIFICATION_POLL_TICK_MS : 60_000;
  return Math.min(300_000, base * 2 ** Math.min(failures, 7));
}
