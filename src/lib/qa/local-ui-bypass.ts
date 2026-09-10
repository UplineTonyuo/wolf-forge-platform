import "server-only";

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { headers } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/database.types";

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;

  return LOOPBACK_HOSTNAMES.has(normalized.toLowerCase());
}

function isLoopbackAuthority(authority: string): boolean {
  if (
    !/^(?:(?:localhost|127\.0\.0\.1)(?::\d{1,5})?|\[::1\](?::\d{1,5})?|::1)$/i.test(
      authority,
    )
  ) {
    return false;
  }

  try {
    return isLoopbackHostname(new URL(`http://${authority}`).hostname);
  } catch {
    return false;
  }
}

function requestHostIsLoopback(request: Request): boolean {
  const host = request.headers.get("host");
  if (!host || !isLoopbackAuthority(host)) return false;

  const forwardedHost = request.headers.get("x-forwarded-host");
  if (forwardedHost && !isLoopbackAuthority(forwardedHost)) return false;

  try {
    return isLoopbackHostname(new URL(request.url).hostname);
  } catch {
    return false;
  }
}

/**
 * Local render-only escape hatch for the internal application.
 *
 * This never fabricates a Supabase session and does not change the real
 * internal-user boundary outside this local development-only path.
 */
export async function localUiQaBypassEnabled(request?: Request): Promise<boolean> {
  if (
    process.env.NODE_ENV !== "development" ||
    process.env.LOCAL_UI_QA_BYPASS !== "true"
  ) {
    return false;
  }

  if (request) return requestHostIsLoopback(request);

  try {
    const requestHeaders = await headers();
    const host = requestHeaders.get("host");
    if (!host || !isLoopbackAuthority(host)) return false;

    const forwardedHost = requestHeaders.get("x-forwarded-host");
    return !forwardedHost || isLoopbackAuthority(forwardedHost);
  } catch {
    return false;
  }
}

type LocalQaCredentials = { email: string; password: string };

/**
 * The same file `scripts/qa-local-login.ts` provisions: a real Supabase Auth
 * account's email/password, generated once and persisted only to this
 * gitignored local file — never committed, never an env value. Resolved
 * against the process cwd because this runs inside `proxy.ts`, which Next.js
 * always starts from the project root.
 */
const LOCAL_QA_CREDENTIALS_PATH = resolve(process.cwd(), ".qa-local-credentials.json");

async function readLocalQaCredentials(): Promise<LocalQaCredentials | null> {
  try {
    const parsed = JSON.parse(await readFile(LOCAL_QA_CREDENTIALS_PATH, "utf8")) as Partial<LocalQaCredentials>;
    if (typeof parsed.email === "string" && typeof parsed.password === "string") {
      return { email: parsed.email, password: parsed.password };
    }
  } catch {
    // No local QA credentials file yet — run `npm run qa:local-login` once. Fail closed.
  }
  return null;
}

/**
 * Auto-establishes the existing genuine local QA Supabase session — via the
 * real password grant (`signInWithPassword`), on the same request-scoped SSR
 * client whose cookie adapter already persists whatever session it holds —
 * so a human never has to type the QA account's credentials into `/login` on
 * this machine.
 *
 * This fabricates nothing: no token, no cookie value, no service-role
 * shortcut. It is the identical grant `/login`'s real sign-in action
 * performs, just triggered automatically. Every RPC and RLS policy still
 * authorizes the resulting session exactly as it would a human-typed one.
 *
 * Callers must have already confirmed no session exists (`proxy.ts` checks
 * once, via its own `getClaims()` call, before reaching this function) — a
 * human login or a prior auto-login is never overridden or re-checked here.
 *
 * No-ops (leaves the request exactly as it was) whenever: bypass is
 * ineligible for this request, the credentials file is absent, or the real
 * sign-in call itself fails (e.g. local Supabase is stopped) — in every one
 * of those cases the ordinary getSession()/verifyActor()/resolveInternalUser()
 * path downstream behaves exactly as it would with the bypass disabled
 * entirely, up to and including redirecting to `/login`.
 */
export async function ensureLocalQaSession(
  supabase: SupabaseClient<Database>,
  request: Request,
): Promise<void> {
  if (!(await localUiQaBypassEnabled(request))) return;

  const credentials = await readLocalQaCredentials();
  if (!credentials) return;

  await supabase.auth.signInWithPassword(credentials).catch(() => {
    // Local Supabase is stopped, or the QA account/password is stale.
  });
}
