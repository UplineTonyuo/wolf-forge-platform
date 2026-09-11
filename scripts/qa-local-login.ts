import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/database.types";
import { assertLocalSupabaseUrl } from "../src/lib/env/public-env";

const execFileAsync = promisify(execFile);

/**
 * Permanent, reusable local QA identity — one fixed email so a human (or a
 * browser automation script) can always sign in the same way, but never a
 * fixed or committed password. The password is generated once, on first run,
 * and persisted only to a gitignored local file; every later run reuses it
 * unchanged so an already-remembered browser session/password manager entry
 * keeps working. This provisions the account only — actual sign-in still
 * goes through the ordinary /login page and Supabase's real password grant.
 * There is no bypass anywhere in this file or in the app it targets.
 */
const QA_ACCOUNT = {
  email: "qa-local@wolf-forge.local",
  displayName: "QA Local",
} as const;

const CREDENTIALS_PATH = resolve(import.meta.dirname, "..", ".qa-local-credentials.json");

type QaCredentials = { email: string; password: string };

function parseStatus(output: string) {
  return Object.fromEntries(
    output
      .split(/\r?\n/u)
      .map((line) => line.match(/^([A-Z_]+)="(.*)"$/u))
      .filter((match): match is RegExpMatchArray => Boolean(match))
      .map((match) => [match[1], match[2]]),
  );
}

function generatePassword(): string {
  // 24 random bytes, base64url-encoded: long enough to be a real credential,
  // URL/JSON-safe, and never derived from any predictable seed.
  return randomBytes(24).toString("base64url");
}

async function readExistingCredentials(): Promise<QaCredentials | null> {
  try {
    const raw = await readFile(CREDENTIALS_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<QaCredentials>;
    if (typeof parsed.email === "string" && typeof parsed.password === "string" && parsed.email === QA_ACCOUNT.email) {
      return { email: parsed.email, password: parsed.password };
    }
    return null;
  } catch {
    return null;
  }
}

async function main() {
  const projectRoot = resolve(import.meta.dirname, "..");
  const cli = resolve(projectRoot, "node_modules", ".bin", "supabase.cmd");
  const commandShell = process.env.ComSpec ?? "C:\\Windows\\System32\\cmd.exe";
  const { stdout } = await execFileAsync(commandShell, ["/d", "/s", "/c", `${cli} status --output env`], {
    cwd: projectRoot,
  });
  const status = parseStatus(stdout);
  const apiUrl = status.API_URL;
  const secretKey = status.SECRET_KEY ?? status.SERVICE_ROLE_KEY;
  if (!apiUrl || !secretKey) {
    throw new Error("Local Supabase status did not return the required keys. Run `supabase start` first.");
  }

  // Hard fail before any network/auth call if this is ever pointed anywhere
  // but a local Supabase instance — the one non-negotiable safety rail for a
  // script that creates/updates a real auth account.
  assertLocalSupabaseUrl(apiUrl);

  const admin = createClient<Database>(apiUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  // Idempotent: reuse the previously generated password if this has already
  // run before, so re-running the bootstrap never silently invalidates a
  // password a human or a browser session already has.
  const existing = await readExistingCredentials();
  const password = existing?.password ?? generatePassword();

  const { data: usersData, error: usersError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (usersError) throw usersError;
  const { data: ownerRole, error: roleError } = await admin.from("roles").select("id").eq("name", "owner").single();
  if (roleError || !ownerRole) throw roleError ?? new Error("Owner role is missing.");

  let user = usersData.users.find((candidate) => candidate.email?.toLowerCase() === QA_ACCOUNT.email);

  if (user) {
    const { data, error } = await admin.auth.admin.updateUserById(user.id, {
      password,
      email_confirm: true,
    });
    if (error) throw error;
    user = data.user;
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email: QA_ACCOUNT.email,
      password,
      email_confirm: true,
    });
    if (error || !data.user) throw error ?? new Error(`Local QA user ${QA_ACCOUNT.email} was not created.`);
    user = data.user;
  }

  // private.handle_new_auth_user owns profile creation on signup; this only
  // ever updates the row it already created, matching the existing
  // setup-phase3a-local.ts convention.
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .update({
      role_id: ownerRole.id,
      display_name: QA_ACCOUNT.displayName,
      company_id: null,
      archived_at: null,
    })
    .eq("id", user.id)
    .select("id")
    .single();
  if (profileError || !profile) {
    throw profileError ?? new Error(`Local QA profile for ${QA_ACCOUNT.email} is missing.`);
  }

  // Written only when the password is new/changed, and only ever to this one
  // gitignored file — never to .env.local, a tracked script, stdout logs
  // that could be captured elsewhere, or any committed fixture.
  if (!existing) {
    await writeFile(
      CREDENTIALS_PATH,
      `${JSON.stringify({ email: QA_ACCOUNT.email, password } satisfies QaCredentials, null, 2)}\n`,
      "utf8",
    );
  }

  console.log("Local QA login is ready (real auth, no bypass).");
  console.log(`Sign in at /login with: ${QA_ACCOUNT.email}`);
  console.log(`Password stored in: ${CREDENTIALS_PATH} (gitignored)`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
