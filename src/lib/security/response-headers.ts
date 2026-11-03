/**
 * HTTP response security headers — the single authority (D-101).
 *
 * Every security header the platform sends is built here and applied in exactly
 * one place: `next.config.ts`'s `headers()`. There is deliberately no
 * `vercel.json`, no per-route header block and no proxy-side header writing, so
 * "what does this app send?" has one answer that can be read in one file.
 *
 * The Content-Security-Policy ships in TWO stages on purpose:
 *
 *   ENFORCED      a minimal policy that cannot break the app — framing, plugin
 *                 embedding, `<base>` hijacking and form exfiltration. None of
 *                 these depend on how Next.js emits scripts or styles, so they
 *                 are safe to enforce today.
 *
 *   REPORT-ONLY   the full load-time policy (default/script/style/img/font/
 *                 connect-src). It carries `'unsafe-inline'` because Next's
 *                 inline bootstrap requires either that or a per-request nonce,
 *                 and nonces force EVERY route into dynamic rendering. Flipping
 *                 this to enforcement is a separate decision (KI-023) that needs
 *                 a nonce-vs-SRI choice and an observation window first.
 *
 * Nothing here may contain a credential. The connect-src origin is derived from
 * the Supabase URL's ORIGIN only — never the key, and never the full URL.
 */

/** Non-production must not send HSTS: plain-http localhost would pin itself. */
export type SecurityHeaderEnvironment = {
  isProduction: boolean;
  supabaseUrl?: string | undefined;
  dailyCalls?: boolean;
};

export type ResponseHeader = { key: string; value: string };

/**
 * 180 days. Long enough to be a real commitment, short enough that a mistake
 * ages out inside a release cycle. `preload` is deliberately omitted: submitting
 * to the preload list is effectively irreversible and is a human decision, not
 * a config default.
 */
const HSTS_MAX_AGE_SECONDS = 60 * 60 * 24 * 180;

// daily-js can fail over to these domains; keep delegation workspace-specific.
const DAILY_FRAME_ORIGINS = [
  "https://wolfforge.daily.co",
  "https://wolfforge.dailywebrtc.com",
  "https://wolfforge.dailywebrtc.net",
];

/**
 * The enforced policy. Every directive here is independent of Next's script and
 * style emission. The exact Google origin permits the native OAuth POST/303
 * fallback, including after Next client navigation from another document.
 */
export const ENFORCED_CONTENT_SECURITY_POLICY = [
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self' https://accounts.google.com",
].join("; ");

/**
 * Extracts the origin of a Supabase URL for `connect-src`. Returns null rather
 * than throwing so a missing or malformed environment can never break the build
 * — the policy simply narrows to same-origin, which is the safe direction.
 */
function supabaseOrigin(supabaseUrl: string | undefined): string | null {
  if (!supabaseUrl) return null;
  try {
    return new URL(supabaseUrl).origin;
  } catch {
    return null;
  }
}

/**
 * The full load-time policy, shipped Report-Only until KI-023 is settled.
 *
 * `connect-src` includes the Supabase origin and its websocket form because the
 * browser bundle is allowed to reach Supabase directly in principle; today all
 * Supabase traffic is server-mediated, so this is headroom, not a dependency.
 */
export function buildReportOnlyContentSecurityPolicy(
  environment: SecurityHeaderEnvironment,
): string {
  const origin = supabaseOrigin(environment.supabaseUrl);
  const connect = ["'self'"];
  if (origin) {
    connect.push(origin);
    connect.push(origin.replace(/^http/, "ws"));
  }

  return [
    "default-src 'self'",
    // Next.js inlines its bootstrap and hydration payload. Without a nonce this
    // cannot be tightened; see KI-023.
    "script-src 'self' 'unsafe-inline'",
    // CSS Modules set custom properties through inline style attributes.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src ${connect.join(" ")}`,
    ...(environment.dailyCalls ? [`frame-src 'self' ${DAILY_FRAME_ORIGINS.join(" ")}`, "media-src 'self' blob:"] : []),
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self' https://accounts.google.com",
    "upgrade-insecure-requests",
  ].join("; ");
}

/**
 * The complete header set applied to every route.
 *
 * `X-Frame-Options: DENY` duplicates `frame-ancestors 'none'` on purpose — the
 * CSP directive is the modern authority, the legacy header covers user agents
 * that never implemented it.
 */
export function buildSecurityHeaders(
  environment: SecurityHeaderEnvironment,
): ResponseHeader[] {
  const headers: ResponseHeader[] = [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      // microphone=(self): the first-party Team voice recorder calls
      // getUserMedia({ audio: true }) from this app's own top-level page.
      // An empty `()` allowlist denies a feature to the page itself, not just
      // cross-origin frames — `(self)` keeps that same third-party denial
      // while unblocking the one feature this app actually uses.
      value: environment.dailyCalls
        ? `accelerometer=(), camera=(self ${DAILY_FRAME_ORIGINS.map((origin) => `"${origin}"`).join(" ")}), geolocation=(), gyroscope=(), magnetometer=(), microphone=(self ${DAILY_FRAME_ORIGINS.map((origin) => `"${origin}"`).join(" ")}), payment=(), usb=()`
        : "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(self), payment=(), usb=()",
    },
    { key: "X-DNS-Prefetch-Control", value: "off" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    { key: "Content-Security-Policy", value: ENFORCED_CONTENT_SECURITY_POLICY },
    {
      key: "Content-Security-Policy-Report-Only",
      value: buildReportOnlyContentSecurityPolicy(environment),
    },
  ];

  // Production only. A dev machine served over plain http would pin itself to
  // https for six months if this were unconditional.
  if (environment.isProduction) {
    headers.push({
      key: "Strict-Transport-Security",
      value: `max-age=${HSTS_MAX_AGE_SECONDS}; includeSubDomains`,
    });
  }

  return headers;
}

/** Reads the header environment from the process. Never reads a secret. */
export function readSecurityHeaderEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): SecurityHeaderEnvironment {
  return {
    isProduction: source.NODE_ENV === "production",
    supabaseUrl: source.SUPABASE_URL,
    dailyCalls: source.DAILY_CALLS_ENABLED === "1" && source.DAILY_DOMAIN === "wolfforge.daily.co",
  };
}

/** The `headers()` entry applied to every path. */
export function securityHeaderRules(environment: SecurityHeaderEnvironment) {
  return [
    { source: "/:path*", headers: buildSecurityHeaders(environment) },
    // All route headers stay in this authority; the last matching header wins.
    { source: "/share/invoices/:path*", headers: [
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "Cache-Control", value: "private, no-store, max-age=0, must-revalidate" },
      { key: "CDN-Cache-Control", value: "no-store" },
      { key: "Vercel-CDN-Cache-Control", value: "no-store" },
      { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive, nosnippet" },
    ] },
  ];
}
