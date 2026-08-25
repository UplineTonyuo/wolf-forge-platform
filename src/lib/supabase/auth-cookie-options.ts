import "server-only";

/**
 * Auth-cookie policy — the single place HttpOnly and Secure are decided (D-114).
 *
 * ## The problem this fixes
 *
 * `@supabase/ssr` ships `DEFAULT_COOKIE_OPTIONS` with `httpOnly: false`, and
 * neither of this app's two SSR call sites passed a `cookieOptions` override.
 * The Supabase session cookie holds BOTH the access token and the refresh
 * token, so the default left the refresh token readable by any JavaScript on
 * the page. That is the difference between an XSS that lasts as long as the
 * script runs and one that hands the attacker a renewable session.
 *
 * ## What this helper does and, just as importantly, does not
 *
 * It overrides exactly TWO keys on top of whatever the library computed:
 *
 *   httpOnly  always true. Nothing in this codebase reads the session cookie
 *             from the browser — there is no `createBrowserClient` and no
 *             `document.cookie` access anywhere in `src`, an invariant pinned
 *             by `auth-cookie-policy.test.ts`. So there is no cost to it.
 *
 *   secure    true in production only. Vercel production and preview are
 *             HTTPS-only, so production always gets it. Development stays off
 *             deliberately: browsers refuse Secure cookies over plain http —
 *             Safari does so even on localhost — and forcing it would break
 *             local sign-in on `127.0.0.1` for no gain.
 *
 * Everything else is passed through untouched, ON PURPOSE: `sameSite: "lax"`,
 * `path: "/"`, host-only Domain, `maxAge`, and the library's own chunking. Two
 * consequences worth stating rather than discovering later:
 *
 *   - The 400-day `maxAge` is accepted. Cookie lifetime is not what keeps a
 *     session valid — token expiry and refresh-token revocation are enforced
 *     server-side, so a stale cookie buys nothing.
 *   - Deletion keeps working. Browsers match a deletion on name + path +
 *     domain, and this helper alters none of those, so the chunked `maxAge: 0`
 *     clears that logout emits still match the cookies they are clearing.
 *
 * The two wiring sites — `src/proxy.ts` response writes and
 * `createNextServerSupabaseClient`'s cookieStore writes — are the ONLY places a
 * session cookie can be written, so routing both through here covers login,
 * proxy refresh, token rotation and logout by construction rather than by
 * remembering.
 */

/**
 * True only under a real production build. Checked at call time rather than at
 * module load so a test can drive both branches without module-cache games.
 */
function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * Applies the policy to one set of cookie options.
 *
 * The return type removes `httpOnly` and `secure` from the input's own type
 * before re-adding them as concrete booleans. That is not decoration: it means
 * the policy OWNS those two keys, and a caller cannot pass a value for either
 * one and expect it to survive.
 */
export function hardenAuthCookieOptions<T extends Record<string, unknown>>(
  options: T | undefined,
): Omit<T, "httpOnly" | "secure"> & { httpOnly: true; secure: boolean } {
  return {
    ...((options ?? {}) as T),
    httpOnly: true,
    secure: isProduction(),
  };
}
