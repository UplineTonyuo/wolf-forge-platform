export type RevenueWindow = { from: string; to: string; today: string; earliest?: string | null };

/** Shift by one visible window, keeping its length and refusing future dates. */
export function shiftRevenueWindow(window: RevenueWindow, direction: -1 | 1) {
  const values = [window.from, window.to, window.today].map((date) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NaN;
    const stamp = Date.parse(`${date}T00:00:00Z`);
    return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === date ? stamp : NaN;
  });
  const [from = NaN, to = NaN, today = NaN] = values;
  const span = to - from + 86_400_000;
  if (values.some((value) => !Number.isFinite(value)) || span <= 0 || span > 366 * 86_400_000) return null;
  const earliest = window.earliest ? Date.parse(`${window.earliest}T00:00:00Z`) : NaN;
  if (direction === -1 && window.earliest !== undefined &&
    (!Number.isFinite(earliest) || from <= earliest)) return null;
  const end = direction === -1
    ? Math.max(to - span, Number.isFinite(earliest) ? earliest + span - 86_400_000 : -Infinity)
    : Math.min(today, to + span);
  if (direction === 1 && end <= to) return null;
  return {
    from: new Date(end - span + 86_400_000).toISOString().slice(0, 10),
    to: new Date(end).toISOString().slice(0, 10),
  };
}
