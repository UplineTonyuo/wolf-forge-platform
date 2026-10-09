import { execFile, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/database.types";
import { assertLocalSupabaseUrl } from "../src/lib/env/public-env";

const execFileAsync = promisify(execFile);

/**
 * Local-only synthetic Platform Admin for QA of Platform Admin surfaces
 * (WL-2.32, D-297).
 *
 * Creates (idempotently) a SEPARATE real auth identity with a generated
 * password in a gitignored file, gives it an ordinary Wolf Forge `admin`
 * membership (so it can open Settings), and grants the global Platform Admin
 * entitlement through `private.grant_platform_admin` as the database
 * superuser via `docker exec psql` — the same explicit, postgres-only path a
 * reviewed Production bootstrap would use, deliberately unavailable to any
 * hosted deployment.
 *
 * It never touches the passwordless Local QA Quick Access identity
 * (`.qa-local-credentials.json`) and refuses to run if that file names this
 * account. Sign in with this account through the normal `/login` form; Quick
 * Access also signs out any auto-login session that holds the entitlement.
 */

const ACCOUNT = {
  email: "qa-local-platform-admin@wolf-forge.local",
  displayName: "QA Local Platform Admin",
  credentialsFile: ".qa-local-credentials.platform-admin.json",
} as const;

type QaCredentials = { email: string; password: string };

const projectRoot = resolve(import.meta.dirname, "..");

async function readCredentials(file: string): Promise<Partial<QaCredentials> | null> {
  try {
    return JSON.parse(await readFile(resolve(projectRoot, file), "utf8")) as Partial<QaCredentials>;
  } catch {
    return null;
  }
}

function parseStatus(output: string) {
  return Object.fromEntries(
    output
      .split(/\r?\n/u)
      .map((line) => line.match(/^([A-Z_]+)="(.*)"$/u))
      .filter((match): match is RegExpMatchArray => Boolean(match))
      .map((match) => [match[1], match[2]]),
  );
}

async function findLocalDbContainer(dbPort: string): Promise<string> {
  // Same rule as qa-local-tenants.ts: match this project's DB by its port.
  const { stdout } = await execFileAsync("docker", ["ps", "--format", "{{.Names}}\t{{.Ports}}"], { encoding: "utf8" });
  const candidates = stdout
    .split(/\r?\n/u)
    .map((line) => line.split("\t"))
    .filter(([, ports]) => ports?.includes("->5432/tcp") && ports.includes(`:${dbPort}->`))
    .map(([name]) => name);
  if (candidates.length !== 1) {
    throw new Error(`Expected exactly one local database container on port ${dbPort}, found ${candidates.length}.`);
  }
  return candidates[0]!;
}

async function main() {
  const quickAccess = await readCredentials(".qa-local-credentials.json");
  if (quickAccess?.email?.toLowerCase() === ACCOUNT.email) {
    throw new Error("The Quick Access credentials file names the Platform Admin account; refusing to grant.");
  }

  const cli = resolve(projectRoot, "node_modules", ".bin", "supabase.cmd");
  const commandShell = process.env.ComSpec ?? "C:\\Windows\\System32\\cmd.exe";
  const { stdout } = await execFileAsync(commandShell, ["/d", "/s", "/c", `${cli} status --output env`], { cwd: projectRoot });
  const status = parseStatus(stdout);
  const apiUrl = status.API_URL;
  const secretKey = status.SECRET_KEY ?? status.SERVICE_ROLE_KEY;
  const dbPort = status.DB_URL?.match(/:(\d+)\/[^/]*$/u)?.[1];
  if (!apiUrl || !secretKey || !dbPort) {
    throw new Error("Local Supabase status did not return the required values. Run `supabase start` first.");
  }
  assertLocalSupabaseUrl(apiUrl);

  const admin = createClient<Database>(apiUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const existing = await readCredentials(ACCOUNT.credentialsFile);
  const password = existing?.email === ACCOUNT.email && existing.password ? existing.password : randomBytes(24).toString("base64url");

  const { data: usersData, error: usersError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (usersError) throw usersError;
  const found = usersData.users.find((candidate) => candidate.email?.toLowerCase() === ACCOUNT.email);
  const { data: userData, error: userError } = found
    ? await admin.auth.admin.updateUserById(found.id, { password, email_confirm: true })
    : await admin.auth.admin.createUser({ email: ACCOUNT.email, password, email_confirm: true });
  if (userError || !userData.user) throw userError ?? new Error(`Could not provision ${ACCOUNT.email}.`);
  const userId = userData.user.id.toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(userId)) {
    throw new Error(`Expected a UUID user id, got: ${userId}`);
  }

  // Ordinary Wolf Forge admin membership (mirrored from profiles.role_id) so
  // the identity can open Settings; the Tenant role grants no platform rights.
  const { data: roleRow, error: roleError } = await admin.from("roles").select("id").eq("name", "admin").single();
  if (roleError || !roleRow) throw roleError ?? new Error('Role "admin" is missing.');
  const { error: profileError } = await admin
    .from("profiles")
    .update({ role_id: roleRow.id, display_name: ACCOUNT.displayName, company_id: null })
    .eq("id", userId);
  if (profileError) throw profileError;

  if (!existing || existing.email !== ACCOUNT.email || existing.password !== password) {
    await writeFile(
      resolve(projectRoot, ACCOUNT.credentialsFile),
      `${JSON.stringify({ email: ACCOUNT.email, password } satisfies QaCredentials, null, 2)}\n`,
      "utf8",
    );
  }

  const container = await findLocalDbContainer(dbPort);
  const psql = spawnSync(
    "docker",
    ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-X", "-q"],
    {
      input: `select private.grant_platform_admin('${userId}', 'Local QA synthetic Platform Admin (scripts/qa-local-platform-admin.ts)')
where not exists (select 1 from private.platform_admins where profile_id = '${userId}' and revoked_at is null);\n`,
      encoding: "utf8",
    },
  );
  if (psql.status !== 0) throw new Error(`Platform Admin grant failed: ${(psql.stderr || psql.stdout).trim()}`);

  console.log(`Local synthetic Platform Admin is ready (local database only): ${ACCOUNT.email}`);
  console.log(`  Password stored in ${ACCOUNT.credentialsFile} (gitignored). Sign in through /login; Quick Access never uses it.`);
  console.log("  Revoke: select private.revoke_platform_admin('<profile id>', '<reason>'); as postgres.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
