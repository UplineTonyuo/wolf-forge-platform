import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "./lib/supabase/database.types";
import { readPublicEnvironment } from "./lib/env/public-env";
import { hardenAuthCookieOptions } from "./lib/supabase/auth-cookie-options";

export async function proxy(request: NextRequest) {
  const environment = readPublicEnvironment();
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    environment.SUPABASE_URL,
    environment.SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
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

  await supabase.auth.getClaims();
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};

