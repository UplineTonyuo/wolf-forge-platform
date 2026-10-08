import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "./lib/supabase/database.types";
import { readPublicEnvironment } from "./lib/env/public-env";
import { hardenAuthCookieOptions } from "./lib/supabase/auth-cookie-options";
import { ensureLocalQaSession } from "./lib/qa/local-ui-bypass";
import {
  CORRELATION_HEADER,
  createCorrelationId,
} from "./domain/security/correlation-id";
import { TENANT_SELECTOR_HEADER, toTenantSelector } from "./domain/tenancy/tenant-selector";
import { LOOPBACK_HOSTS, normalizeRequestHost } from "./domain/tenancy/request-host";
import { WOLF_FORGE_TENANT_ID } from "./domain/tenancy/wolf-forge-tenant";

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
   *
   * ponytail: one anonymous RPC per request; add a short per-host cache if
   * proxy latency matters (disabling a host would then lag by its TTL).
   */
  const host = normalizeRequestHost(request.headers.get("host"));
  let tenantId: string | null = null;
  if (host && LOOPBACK_HOSTS.has(host) && process.env.VERCEL !== "1") {
    tenantId = WOLF_FORGE_TENANT_ID;
  } else if (host) {
    const { data, error } = await createClient<Database>(environment.SUPABASE_URL, environment.SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    }).rpc("app_resolve_tenant_host", { p_host: host });
    if (error) return workspaceUnavailable(503);
    tenantId = data;
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

  const supabase = createServerClient<Database>(
    environment.SUPABASE_URL,
    environment.SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
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
      },
    },
  );

  const claims = await supabase.auth.getClaims();

  /*
   * Local-only, opt-in (NODE_ENV=development + LOCAL_UI_QA_BYPASS=true) and
   * loopback-only, and only when the check just above found no session:
   * transparently signs the genuine local QA account in via the same real
   * password grant `/login` uses, on this same request-scoped client — so
   * its cookie writes above persist the resulting session exactly like any
   * other sign-in. A no-op everywhere else, including once a session exists.
   */
  if (!claims.data) await ensureLocalQaSession(supabase, request);

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
    // A request carrying a forged selector always passes through the proxy, so
    // an excluded path can never deliver a browser value to server code.
    { source: "/:path*", has: [{ type: "header", key: "x-wf-tenant" }] },
  ],
};

