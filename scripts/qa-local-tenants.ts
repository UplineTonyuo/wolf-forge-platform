import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/database.types";
import { assertLocalSupabaseUrl } from "../src/lib/env/public-env";
import { WOLF_FORGE_TENANT_ID } from "../src/domain/tenancy/wolf-forge-tenant";

const execFileAsync = promisify(execFile);

/**
 * Local-only Tenant B and host-domain seed for LAN/laptop QA (Instruction 03).
 *
 * Everything here runs against the LOCAL Supabase instance and refuses any
 * other URL (`assertLocalSupabaseUrl`). It is a seed script, never a
 * migration: `tenants`, `tenant_domains` and `tenant_memberships` revoke even
 * the service role (WL-2.22b / WL-2.15), so the rows are written through
 * `docker exec psql` as the database superuser — deliberately unavailable to
 * any hosted deployment.
 *
 * What it creates, idempotently:
 *   - Tenant B `tenants` row (fixed id, slug `tenant-b`).
 *   - Verified `tenant_domains` rows for the local QA hostnames:
 *       qa.wolf-forge.local  -> Wolf Forge
 *       qa-b.wolf-forge.local -> Tenant B
 *       192.168.1.95         -> Wolf Forge (the established LAN dev IP)
 *     Add these hostnames to the laptop's hosts file (or LAN DNS) once.
 *   - Two real auth identities with generated passwords in gitignored files,
 *     and their Tenant B membership rows:
 *       qa-local-b@wolf-forge.local        (staff, internal surface)
 *       qa-local-b-client@wolf-forge.local (client, /account surface, on the
 *                                           seeded "Tenant B Sample Client")
 *
 * B identities never write profiles.role_id / company_id: those are Wolf
 * Forge compatibility fields, and writing them for a profile that belongs to
 * another Tenant is refused by the membership mirror (WL-2.15). Their
 * memberships are inserted directly, which is exactly what Tenant B
 * provisioning does for its own identities.
 */

const TENANT_B_ID = "f0f0f0f0-0000-4000-8000-000000002601";
const TENANT_B_COMPANY_ID = "f0f0f0f0-0000-4000-8000-000000002602";

type QaCredentials = { email: string; password: string };

const QA_ACCOUNTS: { email: string; displayName: string; credentialsFile: string }[] = [
  {
    email: "qa-local-b@wolf-forge.local",
    displayName: "QA Local Tenant B Staff",
    credentialsFile: ".qa-local-credentials.tenant-b.json",
  },
  {
    email: "qa-local-b-client@wolf-forge.local",
    displayName: "QA Local Tenant B Sample Client Contact",
    credentialsFile: ".qa-local-credentials.tenant-b-client.json",
  },
];

function credentialsPath(account: (typeof QA_ACCOUNTS)[number]) {
  return resolve(import.meta.dirname, "..", account.credentialsFile);
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

function generatePassword(): string {
  return randomBytes(24).toString("base64url");
}

async function readExistingCredentials(account: (typeof QA_ACCOUNTS)[number]): Promise<QaCredentials | null> {
  try {
    const raw = await readFile(credentialsPath(account), "utf8");
    const parsed = JSON.parse(raw) as Partial<QaCredentials>;
    if (typeof parsed.email === "string" && typeof parsed.password === "string" && parsed.email === account.email) {
      return { email: parsed.email, password: parsed.password };
    }
    return null;
  } catch {
    return null;
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireUuid(value: string): string {
  if (!UUID_PATTERN.test(value)) throw new Error(`Expected a UUID, got: ${value}`);
  return value.toLowerCase();
}

async function provisionAuthUser(
  admin: ReturnType<typeof createClient<Database>>,
  account: (typeof QA_ACCOUNTS)[number],
  password: string,
  emails: Set<string>,
): Promise<string> {
  let userId: string | null = null;

  if (emails.has(account.email)) {
    const { data: usersData, error: usersError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (usersError) throw usersError;
    const existingUser = usersData.users.find((candidate) => candidate.email?.toLowerCase() === account.email);
    if (existingUser) {
      const { data, error } = await admin.auth.admin.updateUserById(existingUser.id, {
        password,
        email_confirm: true,
      });
      if (error) throw error;
      userId = data.user.id;
    }
  }

  if (!userId) {
    const { data, error } = await admin.auth.admin.createUser({
      email: account.email,
      password,
      email_confirm: true,
    });
    if (error || !data.user) {
      throw new Error(`Could not create ${account.email}: ${error?.message ?? "unknown"}`);
    }
    userId = data.user.id;
  }

  // Display name only. role_id / company_id are deliberately untouched: they
  // are Wolf Forge compatibility fields and the membership mirror refuses a
  // profile that belongs to another Tenant (WL-2.15).
  const { error: profileError } = await admin
    .from("profiles")
    .update({ display_name: account.displayName, archived_at: null })
    .eq("id", userId);
  if (profileError) throw profileError;

  return requireUuid(userId);
}

async function findLocalDbContainer(dbPort: string): Promise<string> {
  // Match THIS project's database by the DB port `supabase status` reported,
  // never by container-name prefix alone: another local Supabase project would
  // otherwise receive Tenant B rows in its own unrelated database.
  const { stdout } = await execFileAsync("docker", ["ps", "--format", "{{.Names}}\t{{.Ports}}"], {
    encoding: "utf8",
  });
  const candidates = stdout
    .split(/\r?\n/u)
    .map((line) => line.split("\t"))
    .filter(([, ports]) => ports?.includes("->5432/tcp") && ports.includes(`:${dbPort}->`))
    .map(([name]) => name);
  if (candidates.length === 0) {
    throw new Error(
      "No running local Supabase database container publishes the DB port from `supabase status`. Run `supabase start` first.",
    );
  }
  if (candidates.length > 1) {
    throw new Error(
      `Multiple local database containers publish port ${dbPort}; refusing to guess which one is this project's.`,
    );
  }
  return candidates[0]!;
}

function seedSql(internalUserId: string, clientUserId: string): string {
  return `
insert into public.tenants (id, slug, display_name, status)
values ('${TENANT_B_ID}', 'tenant-b', 'Tenant B', 'active')
on conflict (id) do nothing;

insert into public.tenant_domains (host, tenant_id, verified_at)
values
  ('qa.wolf-forge.local', '${WOLF_FORGE_TENANT_ID}', now()),
  ('qa-b.wolf-forge.local', '${TENANT_B_ID}', now()),
  ('192.168.1.95', '${WOLF_FORGE_TENANT_ID}', now())
on conflict (host) do nothing;

insert into public.companies (id, name, status, tenant_id)
values ('${TENANT_B_COMPANY_ID}', 'Tenant B Sample Client', 'client', '${TENANT_B_ID}')
on conflict (tenant_id, id) do nothing;

insert into public.tenant_memberships (tenant_id, profile_id, account_class, role_id, company_id)
select
  '${TENANT_B_ID}',
  role_member.profile_id,
  preset_row.account_class,
  preset_row.role_id,
  role_member.company_id
from (
  select '${internalUserId}'::uuid as profile_id, null::uuid as company_id, 'staff' as role_name
  union all
  select '${clientUserId}'::uuid, '${TENANT_B_COMPANY_ID}'::uuid, 'client'
) as role_member
join public.roles as role_row on role_row.name = role_member.role_name
join public.permission_presets as preset_row on preset_row.role_id = role_row.id
on conflict (tenant_id, profile_id) do nothing;
`;
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
  const dbUrl = status.DB_URL;
  if (!apiUrl || !secretKey) {
    throw new Error("Local Supabase status did not return the required keys. Run `supabase start` first.");
  }
  const dbPort = dbUrl?.match(/:(\d+)\/[^/]*$/u)?.[1];
  if (!dbPort) {
    throw new Error("Local Supabase status did not return a DB_URL with a port. Run `supabase start` first.");
  }
  assertLocalSupabaseUrl(apiUrl);

  const admin = createClient<Database>(apiUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const { data: usersData, error: usersError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (usersError) throw usersError;
  const emails = new Set(
    usersData.users
      .map((candidate) => candidate.email?.toLowerCase())
      .filter((email): email is string => typeof email === "string"),
  );

  const provisionedIds: string[] = [];
  for (const account of QA_ACCOUNTS) {
    const existing = await readExistingCredentials(account);
    const password = existing?.password ?? generatePassword();
    const userId = await provisionAuthUser(admin, account, password, emails);
    provisionedIds.push(userId);

    if (!existing) {
      await writeFile(
        credentialsPath(account),
        `${JSON.stringify({ email: account.email, password } satisfies QaCredentials, null, 2)}\n`,
        "utf8",
      );
    }
  }

  const container = await findLocalDbContainer(dbPort);
  const psql = spawnSync(
    "docker",
    ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-X", "-q"],
    { input: seedSql(provisionedIds[0]!, provisionedIds[1]!), encoding: "utf8" },
  );
  if (psql.status !== 0) {
    throw new Error(`Local Tenant seed failed: ${(psql.stderr || psql.stdout).trim()}`);
  }

  console.log("Local Tenant B QA seed is ready (local database only, no bypass):");
  console.log(`  Tenant B id: ${TENANT_B_ID}`);
  console.log("  Host rows (verified): qa.wolf-forge.local -> Wolf Forge, qa-b.wolf-forge.local -> Tenant B, 192.168.1.95 -> Wolf Forge");
  for (const account of QA_ACCOUNTS) {
    console.log(`  ${account.email} — password stored in ${account.credentialsFile} (gitignored)`);
  }
  console.log("Add to the laptop hosts file: 127.0.0.1 qa.wolf-forge.local qa-b.wolf-forge.local");
  console.log("Loopback connections (localhost / hosts-file aliases) always pass the LAN gate.");
  console.log(
    "For QA phones/tablets, set LOCAL_QA_LAN_DEVICES to their LAN IPs when starting `dev:lan` — " +
      "they reach the app on 192.168.1.95 (host row -> Wolf Forge; Tenant B surfaces need LAN DNS for qa-b.wolf-forge.local). " +
      "Browsing the laptop through its own LAN IP needs an allowlist entry too.",
  );
  console.log("Sign in on the matching host; Tenant B surfaces resolve only via qa-b.wolf-forge.local.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
