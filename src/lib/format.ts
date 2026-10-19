function formatCalendarDate(value: string, options: Intl.DateTimeFormatOptions): string {
  // ISO date-only strings parse at UTC midnight; retain their calendar day.
  const timeZone = /^\d{4}-\d{2}-\d{2}$/.test(value) ? "UTC" : undefined;
  return new Intl.DateTimeFormat("en", { ...options, timeZone }).format(new Date(value));
}

export function formatDate(value: string | null): string {
  if (!value) return "Not set";
  return formatCalendarDate(value, { day: "numeric", month: "short", year: "numeric" });
}

/** Compact "Aug 12" label used by dense operational tables. */
export function formatShortDate(value: string | null): string {
  if (!value) return "Not set";
  return formatCalendarDate(value, { month: "short", day: "numeric" });
}

export function formatDateTime(value: string | null, timeZone?: string): string {
  if (!value) return "Not set";
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(new Date(value));
}

export function isOverdue(value: string | null, status: string): boolean {
  return Boolean(value && new Date(value).getTime() < Date.now() && !["complete", "canceled"].includes(status));
}

export function formatCurrencyCents(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

/**
 * Renders a client identity for scanning, not for linking — many department
 * sheets record a client as a bare URL (`https://example.com/wp-admin`),
 * which is mostly protocol/path noise once a human just needs to recognize
 * the business. Strips scheme, a leading `www.`, and any path/query/hash,
 * leaving the bare host. Falls back to the original string unchanged when it
 * isn't a URL at all (a plain company name, for a future department that
 * doesn't record clients as links) — this is display-only, so the real
 * value must still be used as the link target wherever one exists.
 */
export function formatCleanDomain(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return value;
    return url.hostname.replace(/^www\./i, "");
  } catch {
    return value;
  }
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * "Updated just now" / "Updated 5m ago" — the realtime freshness line for a
 * department workflow header. Deliberately coarse (minutes, then hours, then
 * a date) rather than showing seconds: this ages quietly on a re-render
 * tick, not on every clock second, so it never flickers or draws the eye on
 * its own — it should only change when a viewer happens to glance at it.
 */
export function formatFreshness(lastSyncedAt: string | null, nowMs: number = Date.now()): string {
  if (!lastSyncedAt) return "Not yet synced";
  const syncedMs = new Date(lastSyncedAt).getTime();
  if (Number.isNaN(syncedMs)) return "Not yet synced";

  const ageMs = Math.max(0, nowMs - syncedMs);
  if (ageMs < MINUTE_MS) return "Updated just now";
  if (ageMs < HOUR_MS) return `Updated ${Math.floor(ageMs / MINUTE_MS)}m ago`;
  if (ageMs < DAY_MS) return `Updated ${Math.floor(ageMs / HOUR_MS)}h ago`;
  return `Updated ${formatShortDate(lastSyncedAt)}`;
}
