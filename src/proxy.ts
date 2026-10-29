import { clearAuthCookiesAtScopes, createServerClient, type SetAllCookies } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "./lib/supabase/database.types";
import { readPublicEnvironment } from "./lib/env/public-env";
import { hardenAuthCookieOptions } from "./lib/supabase/auth-cookie-options";
import { ensureLocalQaSession, localUiQaBypassEnabled } from "./lib/qa/local-ui-bypass";
import { lanDeviceApproved } from "./lib/qa/lan-device-gate";
import { TenantHostCache } from "./lib/edge/tenant-host-cache";
import { isPublicActionPath } from "./lib/edge/public-action-path";
import { safeNextPath } from "./domain/auth/safe-next-path";
import {
  CORRELATION_HEADER,
  createCorrelationId,
} from "./domain/security/correlation-id";
import { TENANT_SELECTOR_HEADER, toTenantSelector } from "./domain/tenancy/tenant-selector";
import { LOOPBACK_HOSTS, normalizeRequestHost } from "./domain/tenancy/request-host";
import { WOLF_FORGE_TENANT_ID } from "./domain/tenancy/wolf-forge-tenant";

// Per proxy instance: disabling/remapping a host can lag by up to 60s; new hosts by 10s.
const tenantHostCache = new TenantHostCache();

/** Neutral, uncached, unbranded: names no Tenant and sets no cookie. */
function workspaceUnavailable(status: 404 | 503) {
  return new NextResponse("This workspace is not available.", {
    status,
    headers: { "cache-control": "private, no-store, max-age=0" },
  });
}

export async function proxy(request: NextRequest) {
  const environment = readPublicEnvironment();

  /*
   * WL-2.22b (KI-125). The request's Tenant comes from the `Host` header only,
   * matched exactly against verified `tenant_domains` rows. `X-Forwarded-Host`,
   * a browser `x-wf-tenant`, cookies and the body are never consulted. An
   * unknown, unverified or disabled host is refused here, before any session
   * work, with no Wolf Forge fallback. The result is a selector only: the
   * database still requires an active membership in that active Tenant.
   */
  const host = normalizeRequestHost(request.headers.get("host"));

  // Local LAN QA (Instruction 03): a non-loopback peer in development requires
  // explicit allowlisting before any Tenant lookup. Loopback and every
  // production path are untouched (the gate itself checks the environment and
  // returns true for them).
  if (host && !lanDeviceApproved(request.headers.get("x-forwarded-for"), process.env)) {
    return workspaceUnavailable(404);
  }

  let tenantId: string | null = null;
  if (host && LOOPBACK_HOSTS.has(host) && process.env.VERCEL !== "1") {
    tenantId = WOLF_FORGE_TENANT_ID;
  } else if (host) {
    const cached = tenantHostCache.get(host);
    if (cached !== undefined) {
      tenantId = cached;
    } else {
      const { data, error } = await createClient<Database>(environment.SUPABASE_URL, environment.SUPABASE_PUBLISHABLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      }).rpc("app_resolve_tenant_host", { p_host: host });
      if (error) return workspaceUnavailable(503);
      tenantId = data;
      tenantHostCache.set(host, tenantId);
    }
  }
  if (!tenantId) return workspaceUnavailable(404);
  const tenantSelector = toTenantSelector(tenantId);

  /*
   * One correlation id per request, minted here because the proxy is the only
   * thing that runs on every matched request before anything else does
   * (Security C2-4).
   *
   * It is SET, never adopted: an inbound `x-wolf-forge-request-id` from the
   * browser is overwritten unconditionally. A client that could pin the id
   * could make a burst of requests read as one, or reuse someone else's id to
   * poison an investigation. Readers validate the shape again anyway
   * (`normalizeCorrelationId`), so nothing client-controlled can reach a log
   * line even if this were bypassed.
   */
  const correlationId = createCorrelationId();

  /*
   * The header has to be stamped on a COPY of the request headers taken at the
   * moment of the call: `request.cookies.set()` below writes the refreshed
   * session back into the request's own `cookie` header, and a snapshot taken
   * earlier would forward the stale one. Copying per call keeps the C2-2 cookie
   * refresh behaviour byte-for-byte identical.
   */
  const forwardRequest = () => {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set(CORRELATION_HEADER, correlationId);
    // A browser-sent Tenant selector is never application input (D-6b): it is
    // overwritten with the Tenant resolved from the verified host above.
    requestHeaders.set(TENANT_SELECTOR_HEADER, tenantSelector);
    return NextResponse.next({ request: { headers: requestHeaders } });
  };

  let response = forwardRequest();

  const cookieMethods = {
    getAll: () => request.cookies.getAll(),
    setAll: (cookiesToSet: Parameters<SetAllCookies>[0]) => {
      cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
      response = forwardRequest();
      // Every write here is an auth-session cookie: the proxy's refresh
      // writes AND the maxAge:0 removals that logout emits. Both go
      // through the policy (D-114) — removals included, because a
      // deletion that differs in attributes is still a Set-Cookie.
      cookiesToSet.forEach(({ name, value, options }) =>
        response.cookies.set(name, value, hardenAuthCookieOptions(options)),
      );
    },
  };
  const supabase = createServerClient<Database>(
    environment.SUPABASE_URL,
    environment.SUPABASE_PUBLISHABLE_KEY,
    { cookies: cookieMethods },
  );

  let claims = await supabase.auth.getClaims();

  /*
   * Local-only, opt-in (NODE_ENV=development + LOCAL_UI_QA_BYPASS=true) and
   * loopback-only, and only when the check just above found no session:
   * transparently signs the genuine local QA account in via the same real
   * password grant `/login` uses, on this same request-scoped client — so
   * its cookie writes above persist the resulting session exactly like any
   * other sign-in. A no-op everywhere else, including once a session exists.
   */
  if (!claims.data && await localUiQaBypassEnabled(request)) {
    await ensureLocalQaSession(supabase, request);
    claims = await supabase.auth.getClaims();
  }

  const hasSessionClaims = !claims.error && !!claims.data?.claims?.sub;
  const pathname = request.nextUrl.pathname;
  let earlyResponse: NextResponse | undefined;
  if (!hasSessionClaims && request.method === "POST" && request.headers.has("next-action") && !isPublicActionPath(pathname)) {
    const next = safeNextPath(`${pathname}${request.nextUrl.search}`);
    // Next's action client consumes this header on a successful, non-HTTP-redirect response.
    earlyResponse = new NextResponse(null, {
      status: 200,
      headers: { "x-action-redirect": `/login?${new URLSearchParams({ next })};replace` },
    });
    // Expired sign-out actions stop here too; remove their local session without running the action.
    await clearAuthCookiesAtScopes({
      ...cookieMethods,
      storageKey: `sb-${new URL(environment.SUPABASE_URL).hostname.split(".")[0]}-auth-token`,
      scopes: [{ path: "/" }],
    });
  } else if (!hasSessionClaims && !claims.error && request.method === "GET" && pathname === "/") {
    // getInternalContext redirects anonymous root visits to /login without a next parameter.
    earlyResponse = NextResponse.redirect(new URL("/login", request.url));
  }
  if (earlyResponse) {
    earlyResponse.headers.set("cache-control", "no-store");
    response.cookies.getAll().forEach((cookie) => earlyResponse.cookies.set(cookie));
    return earlyResponse;
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|webmanifest|txt|xml|js|map|woff|woff2|ttf|otf|css|mp3|mp4|webm)$).*)",
    // A request carrying a forged selector always passes through the proxy, so
    // an excluded path can never deliver a browser value to server code.
    { source: "/:path*", has: [{ type: "header", key: "x-wf-tenant" }] },
    // Server Action IDs can be dispatched on other paths, including asset-suffix paths.
    { source: "/:path*", has: [{ type: "header", key: "next-action" }] },
  ],
};

