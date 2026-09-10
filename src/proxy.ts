import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "./lib/supabase/database.types";
import { readPublicEnvironment } from "./lib/env/public-env";
import { hardenAuthCookieOptions } from "./lib/supabase/auth-cookie-options";
import { ensureLocalQaSession } from "./lib/qa/local-ui-bypass";
import {
  CORRELATION_HEADER,
  createCorrelationId,
} from "./domain/security/correlation-id";

export async function proxy(request: NextRequest) {
  const environment = readPublicEnvironment();

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
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};

