import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/database.types";
import { assertLocalSupabaseUrl } from "../src/lib/env/public-env";
import { WOLF_FORGE_TENANT_ID } from "../src/domain/tenancy/wolf-forge-tenant";

const execFileAsync = promisify(execFile);

/**
 * Permanent, reusable local QA identities — one fixed email per surface so a
 * human (or a browser automation script) can always sign in the same way, but
 * never a fixed or committed password. Each password is generated once, on
 * first run, and persisted only to a gitignored local file; every later run
 * reuses it unchanged so an already-remembered browser session/password
 * manager entry keeps working. This provisions the accounts only — actual
 * sign-in still goes through the ordinary /login page and Supabase's real
 * password grant. There is no bypass anywhere in this file or in the app it
 * targets.
 *
 * Two identities, because the platform has two surfaces and they are separated
 * by authorization rather than by data store:
 *
 *   - `owner`  — src/app/(internal)/**, the staff workspace.
 *   - `client` — src/app/account/**, the client portal. It needs a real
 *     `companies` row and `roles.name = 'client'`, because
 *     `app_get_client_account_context()` joins both and returns nothing
 *     otherwise, which is what turns a staff session away from /account with
 *     `?reason=client-only`. Without this account the entire client portal is
 *     untestable.
 *
 * Neither account is a bypass: both are ordinary password-grant logins that
 * then pass the same server-side authorization every real user does.
 */
type QaAccountSpec = {
  email: string;
  displayName: string;
  /** Resolved by name from `public.roles`. */
  role: "owner" | "client";
  /**
   * Resolved by name from `public.companies` and attached to the profile.
   * Null for the staff account, which belongs to no company.
   */
  companyName: string | null;
  /** Gitignored, local-only. One file per identity, never shared. */
  credentialsFile: string;
};

const QA_ACCOUNTS: QaAccountSpec[] = [
  {
    email: "qa-local@wolf-forge.local",
    displayName: "QA Local",
    role: "owner",
    companyName: null,
    credentialsFile: ".qa-local-credentials.json",
  },
  {
    email: "qa-local-client@wolf-forge.local",
    displayName: "QA Local Sample Client Contact",
    role: "client",
    companyName: "QA Local Sample Client",
    credentialsFile: ".qa-local-credentials.client.json",
  },
];

type QaCredentials = { email: string; password: string };

function credentialsPath(account: QaAccountSpec) {
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
  // 24 random bytes, base64url-encoded: long enough to be a real credential,
  // URL/JSON-safe, and never derived from any predictable seed.
  return randomBytes(24).toString("base64url");
}

async function readExistingCredentials(account: QaAccountSpec): Promise<QaCredentials | null> {
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

type AdminClient = ReturnType<typeof createClient<Database>>;

/**
 * Creates or updates one auth user and the profile row it owns.
 *
 * `private.handle_new_auth_user` owns profile creation on signup; this only
 * ever updates the row it already created, matching the existing
 * `setup-phase3a-local.ts` convention.
 */
async function provisionAccount(
  admin: AdminClient,
  account: QaAccountSpec,
  password: string,
  emails: Set<string>,
) {
  const { data: roleRow, error: roleError } = await admin
    .from("roles")
    .select("id")
    .eq("name", account.role)
    .single();
  if (roleError || !roleRow) {
    throw roleError ?? new Error(`Role "${account.role}" is missing.`);
  }

  let companyId: string | null = null;
  if (account.companyName) {
    const { data: companyRow, error: companyError } = await admin
      .from("companies")
      .select("id")
      .eq("name", account.companyName)
      .is("archived_at", null)
      .single();
    if (companyError || !companyRow) {
      throw (
        companyError ??
        new Error(
          `Company "${account.companyName}" is missing. Run the local QA seed before provisioning the client identity.`,
        )
      );
    }
    companyId = companyRow.id;
  }

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
      /*
       * A row can exist in auth.users that GoTrue does not recognise — no
       * encrypted_password, not confirmed, and no auth.identities entry. That
       * happens when a fixture inserts the row directly instead of going
       * through the admin API, and it is invisible to listUsers, so the
       * lookup above cannot see it and createUser then conflicts with it.
       * GoTrue returns this same opaque "Database error creating new user"
       * for that case. Naming it here saves the next person the hour it cost.
       */
      throw new Error(
        `Could not create ${account.email}. If this account was seeded by inserting into auth.users directly, ` +
          `its row has no password and no auth.identities entry, which makes it invisible to GoTrue. ` +
          `Repair it by setting encrypted_password = crypt(<password>, gen_salt('bf')), email_confirmed_at = now(), ` +
          `instance_id = '00000000-0000-0000-0000-000000000000', and inserting the matching auth.identities row ` +
          `(provider 'email', provider_id = user id). Original error: ${error?.message ?? "unknown"}`,
      );
    }

    userId = data.user.id;
  }

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .update({
      role_id: roleRow.id,
      display_name: account.displayName,
      company_id: companyId,
      archived_at: null,
    })
    .eq("id", userId)
    .select("id")
    .single();
  if (profileError || !profile) {
    throw profileError ?? new Error(`Local QA profile for ${account.email} is missing.`);
  }
}

/**
 * Creates the local QA client company once, if it is missing. Re-running the
 * script is idempotent: an existing company is reused, never duplicated.
 * The company belongs to the Wolf Forge Tenant, matching the client identity
 * this script provisions (whose membership follows profiles.company_id).
 */
async function ensureQaCompany(admin: AdminClient, name: string) {
  const { data: existing, error: existingError } = await admin
    .from("companies")
    .select("id")
    .eq("name", name)
    .is("archived_at", null)
    // Ambiguity is not a reason to create another company: reuse the first.
    .limit(1)
    .maybeSingle();

  if (!existingError && existing) return;

  const { data: created, error: createError } = await admin
    .from("companies")
    // tenant_id is set explicitly: the column default calls
    // private.identity_tenant_id(), whose EXECUTE is revoked from every role
    // but postgres (WL-2.22a), so relying on the default fails for the service
    // role. The committed generated types predate the column, hence the cast.
    .insert({ name, status: "client", tenant_id: WOLF_FORGE_TENANT_ID } as never)
    .select("id")
    .single();
  if (createError || !created) {
    throw createError ?? new Error(`Local QA company "${name}" could not be created.`);
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

  // The client identity needs its company to exist before profiles.company_id
  // can mirror a Client membership; without this the client portal stays
  // untestable ("Run the local QA seed first").
  for (const companyName of new Set(QA_ACCOUNTS.map((account) => account.companyName).filter((name): name is string => typeof name === "string"))) {
    await ensureQaCompany(admin, companyName);
  }

  const { data: usersData, error: usersError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (usersError) throw usersError;
  const emails = new Set(
    usersData.users
      .map((candidate) => candidate.email?.toLowerCase())
      .filter((email): email is string => typeof email === "string"),
  );

  for (const account of QA_ACCOUNTS) {
    // Idempotent: reuse the previously generated password if this has already
    // run before, so re-running the bootstrap never silently invalidates a
    // password a human or a browser session already has.
    const existing = await readExistingCredentials(account);
    const password = existing?.password ?? generatePassword();

    await provisionAccount(admin, account, password, emails);

    // Written only when the password is new/changed, and only ever to these
    // gitignored files — never to .env.local, a tracked script, stdout logs
    // that could be captured elsewhere, or any committed fixture.
    if (!existing) {
      await writeFile(
        credentialsPath(account),
        `${JSON.stringify({ email: account.email, password } satisfies QaCredentials, null, 2)}\n`,
        "utf8",
      );
    }

    console.log(`Local QA ${account.role} login is ready (real auth, no bypass): ${account.email}`);
    console.log(`  password stored in ${account.credentialsFile} (gitignored)`);
  }

  console.log("Sign in at /login. Staff sees the workspace; the client identity sees /account.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
