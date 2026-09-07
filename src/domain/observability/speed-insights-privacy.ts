/**
 * Privacy sanitizer for Vercel Speed Insights' `beforeSend` hook.
 *
 * The vendor event's `url` field carries the full `location.href` at the
 * time a Web Vital fires — query string, hash and all — and the app's own
 * routes embed database identifiers (client/order/invoice/ticket ids, a
 * form's `canonicalKey`) directly in the pathname. Speed Insights must stay
 * anonymous performance measurement, so every event is rebuilt from an
 * explicit allowlist of this app's real routes rather than trusting the
 * vendor's own `route` field: unrecognized or unmatched paths are dropped
 * (return null) instead of guessed at. Never throws.
 */

export interface SpeedInsightsBeforeSendEvent {
  // Matches the installed @vercel/speed-insights `EventTypes` union exactly
  // (currently just "vital") so this type stays structurally assignable to
  // its `BeforeSend` callback without importing the vendor package here.
  readonly type: "vital";
  readonly url: string;
  readonly route?: string;
}

type RouteSegment = string | { readonly param: string };

/**
 * Every real route this app serves, derived from a census of
 * `src/app/**\/page.tsx` and `route.ts` on current main. Route groups like
 * `(internal)` are omitted because Next does not include them in the URL.
 * Kept in sync manually — an unmatched route fails closed (the event is
 * dropped) rather than leaking a raw segment, so a route added to the app
 * and not to this list only loses telemetry, never privacy.
 */
const ROUTE_PATTERNS: readonly (readonly RouteSegment[])[] = [
  [],
  ["login"],
  ["dashboard"],
  ["team"],
  ["todo"],
  ["todo", "departments"],
  ["todo", "departments", "content"],
  ["todo", "departments", "podcast-seo"],
  ["clients"],
  ["clients", "new"],
  ["clients", { param: "companyId" }],
  ["companies", "new"],
  ["coupons"],
  ["coupons", "new"],
  ["coupons", { param: "couponId" }],
  ["forms"],
  ["forms", "new"],
  ["forms", "submissions", { param: "submissionId" }],
  ["forms", { param: "formId" }],
  ["forms", { param: "formId" }, "assign"],
  ["forms", { param: "formId" }, "submissions"],
  ["forms", { param: "formId" }, "versions", { param: "versionId" }],
  ["investment-intent"],
  ["invoices"],
  ["invoices", "new"],
  ["invoices", { param: "invoiceId" }],
  ["invoices", { param: "invoiceId" }, "edit"],
  ["orders"],
  ["orders", "new"],
  ["orders", { param: "orderId" }],
  ["orders", { param: "orderId" }, "edit"],
  ["reporting"],
  ["reporting", "new"],
  ["reporting", { param: "reportId" }],
  ["services"],
  ["services", "new"],
  ["services", "folders", "new"],
  ["services", "folders", { param: "folderId" }],
  ["services", { param: "serviceId" }],
  ["settings"],
  ["settings", "billing"],
  ["settings", "general"],
  ["settings", "integrations"],
  ["settings", "integrations", "gmail", "callback"],
  ["settings", "integrations", "gmail", "connect"],
  ["settings", "integrations", "gmail", "disconnect"],
  ["settings", "integrations", "gmail", "verify"],
  ["settings", "notifications"],
  ["settings", "security"],
  ["settings", "team"],
  ["subscriptions"],
  ["subscriptions", "new"],
  ["subscriptions", { param: "subscriptionId" }],
  ["subscriptions", { param: "subscriptionId" }, "edit"],
  ["tickets"],
  ["tickets", { param: "ticketId" }],
  ["accounts", "client", "new"],
  ["accounts", "member", "new"],
  ["account"],
  ["account", "invoices"],
  ["account", "invoices", { param: "invoiceId" }],
  ["account", "messages"],
  ["account", "messages", { param: "ticketId" }],
  ["account", "onboarding"],
  ["account", "onboarding", { param: "assignmentId" }],
  ["account", "payment-method"],
  ["account", "profile"],
  ["account", "projects"],
  ["account", "projects", { param: "projectId" }],
  ["account", "reporting"],
  ["account", "reporting", { param: "reportId" }],
  ["account", "store"],
  ["account", "store", { param: "serviceId" }],
  ["account", "subscriptions"],
  ["account", "subscriptions", { param: "subscriptionId" }],
  ["api", "team-live"],
  ["api", "team-presence", "disconnect"],
  ["api", "team-sync"],
  ["api", "team-typing"],
  ["api", "team-voice", "finalize"],
  ["api", "team-voice", "playback"],
  ["api", "team-voice", "upload-slot"],
  ["api", "internal", "team-voice-cleanup"],
  ["api", "operations", "podcast-seo", "snapshot"],
  ["api", "operations", "podcast-seo", "sync"],
  ["api", "operations", "podcast-seo", "version"],
  // `canonicalKey` is a public Form's access token, not merely a database
  // id — it must never travel even normalized-in-position, only masked.
  ["f", { param: "canonicalKey" }],
];

/**
 * Matches a decoded pathname against `ROUTE_PATTERNS`. Dynamic segments are
 * never inspected for their value — only their position and that a segment
 * exists there at all — so no identifier can leak through this function
 * regardless of what it contains. Returns null (fail closed) for anything
 * that does not match a known route exactly.
 *
 * A single trailing slash (`/dashboard/`, `/clients/<id>/`) normalizes
 * safely to its canonical route: `split("/")` produces exactly one empty
 * trailing segment, which the existing empty-segment filter drops the same
 * way it drops the leading empty segment every absolute path starts with —
 * deterministic, and never a source of ambiguity the way an interior `//`
 * is (see above).
 */
export function normalizeRoutePathname(pathname: string): string | null {
  // A doubled slash means the path contains an empty segment. Filtering it
  // out below would let "/clients//123" match the same pattern as the
  // genuine "/clients/123", inferring more structure than the input
  // actually has — ambiguous input fails closed instead.
  if (pathname.includes("//")) return null;

  const segments = pathname.split("/").filter((segment) => segment.length > 0);

  // Malformed percent-encoding (an incomplete escape, invalid hex digits,
  // or a byte sequence that isn't valid UTF-8) is ambiguous input under
  // this app's privacy policy and must drop the whole event — not just
  // fall through to "unknown route" for the one pattern branch that
  // happened to try decoding it. This is checked for EVERY segment,
  // including ones that will end up behind a dynamic `{ param }`
  // placeholder: a dynamic segment's decoded value is never used for
  // anything (only its position), but validating that it decodes at all
  // is what "standards-based decoding" means here — `decodeURIComponent`
  // already enforces real UTF-8 well-formedness, not just hex-digit shape,
  // so no separate regex is needed.
  for (const segment of segments) {
    try {
      decodeURIComponent(segment);
    } catch {
      return null;
    }
  }

  patternLoop: for (const pattern of ROUTE_PATTERNS) {
    if (pattern.length !== segments.length) continue;

    const normalized: string[] = [];
    for (let i = 0; i < pattern.length; i += 1) {
      const patternSegment = pattern[i];
      const actualSegment = segments[i];
      if (patternSegment === undefined || actualSegment === undefined) continue patternLoop;

      if (typeof patternSegment === "string") {
        // Already proven decodable above; a throw here is unreachable.
        if (decodeURIComponent(actualSegment) !== patternSegment) continue patternLoop;
        normalized.push(patternSegment);
      } else {
        normalized.push(`[${patternSegment.param}]`);
      }
    }

    return normalized.length === 0 ? "/" : `/${normalized.join("/")}`;
  }

  return null;
}

/**
 * Rebuilds a Speed Insights event `url` from nothing but its own origin and
 * a route-normalized pathname — the query string and hash are always
 * discarded outright, never selectively filtered, and an unrecognized path
 * drops the event. Never throws: any parse failure fails closed to null.
 */
function sanitizeUrl(rawUrl: string): { readonly url: string; readonly route: string } | null {
  // An empty or whitespace-only url carries no real path information. Left
  // unguarded, `new URL("", base)` resolves to the base itself and reports
  // "/" — silently claiming a specific route the input never actually
  // named. Ambiguous input fails closed instead.
  if (rawUrl.trim().length === 0) return null;

  let parsed: URL;
  try {
    parsed = new URL(rawUrl, "http://wolf-forge-speed-insights.invalid");
  } catch {
    return null;
  }

  const route = normalizeRoutePathname(parsed.pathname);
  if (route === null) return null;

  const origin = parsed.origin === "http://wolf-forge-speed-insights.invalid" ? "" : parsed.origin;
  return { url: `${origin}${route}`, route };
}

/**
 * The `beforeSend` implementation mounted by
 * `src/components/observability/speed-insights.tsx`. Returning null drops
 * the event entirely — Speed Insights never receives it.
 */
export function sanitizeSpeedInsightsEvent(
  event: SpeedInsightsBeforeSendEvent,
): SpeedInsightsBeforeSendEvent | null {
  try {
    const sanitized = sanitizeUrl(event.url);
    if (sanitized === null) return null;
    return { type: event.type, url: sanitized.url, route: sanitized.route };
  } catch {
    return null;
  }
}
