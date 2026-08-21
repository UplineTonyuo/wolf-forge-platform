/**
 * When the notification bell is allowed to ring.
 *
 * The bell used to ring once per arriving notification, which on a busy morning
 * turned into a shaking icon. It now rings only as the unread count crosses a
 * milestone on the way up, so the motion marks "something new is waiting"
 * rather than narrating every individual arrival.
 */
export const bellRingMilestones = [1, 3, 5, 9] as const;

const milestones: ReadonlySet<number> = new Set(bellRingMilestones);

/**
 * True only when unread has *risen* into one of the milestones.
 *
 * Deliberately not "crossed or passed": a jump from 0 to 4 lands on no
 * milestone and stays silent, which keeps the rule something a person can hold
 * in their head — the bell rings at one, three, five and nine.
 *
 * Never rings on a decrease, so marking notifications read is always quiet, and
 * never rings when the count is unchanged, so a re-render or a poll that
 * returns the same feed cannot retrigger it. Counts above nine add no further
 * milestones.
 */
export function shouldRingForUnread(previous: number, next: number): boolean {
  if (next <= previous) return false;
  return milestones.has(next);
}
