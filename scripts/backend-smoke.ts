import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { assertLocalSupabaseUrl } from "../src/lib/env/public-env";
import { readServerEnvironment, type ServerEnvironment } from "../src/lib/env/server-env";
import type { Database } from "../src/lib/supabase/database.types";
import { createTrustedServerSupabaseClient } from "../src/lib/supabase/trusted-server-client";
import { createUserSupabaseClient, verifyActor } from "../src/lib/supabase/user-client";
import { ActivityRepository } from "../src/repositories/activity-repository";
import { CompanyRepository } from "../src/repositories/company-repository";
import { ContactRepository } from "../src/repositories/contact-repository";
import { OrderRepository } from "../src/repositories/order-repository";
import { ServiceRepository } from "../src/repositories/service-repository";
import { TaskRepository } from "../src/repositories/task-repository";
import { ActivityService } from "../src/services/activity-service";
import { CatalogService } from "../src/services/catalog-service";
import { CompanyService } from "../src/services/company-service";
import { ContactService } from "../src/services/contact-service";
import { OrderService } from "../src/services/order-service";
import { TaskService } from "../src/services/task-service";

function localEnvironment(): ServerEnvironment {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_PUBLISHABLE_KEY && process.env.SUPABASE_SECRET_KEY) {
    return readServerEnvironment();
  }

  const executable = process.platform === "win32" ? process.env.ComSpec ?? "cmd.exe" : "npx";
  const args = process.platform === "win32"
    ? ["/d", "/s", "/c", "npx.cmd supabase status -o env"]
    : ["supabase", "status", "-o", "env"];
  const output = execFileSync(executable, args, {
    encoding: "utf8",
    windowsHide: true,
  });
  const values = Object.fromEntries(
    output.split(/\r?\n/).flatMap((line) => {
      const match = line.match(/^([A-Z_]+)="(.*)"$/);
      return match ? [[match[1], match[2]]] : [];
    }),
  );
  return readServerEnvironment({
    SUPABASE_URL: values.API_URL,
    SUPABASE_PUBLISHABLE_KEY: values.PUBLISHABLE_KEY,
    SUPABASE_SECRET_KEY: values.SECRET_KEY,
  });
}

async function main(): Promise<void> {
  const environment = localEnvironment();
  assertLocalSupabaseUrl(environment.SUPABASE_URL);
  const trustedClient = createTrustedServerSupabaseClient(environment);

  // auth.admin is intentionally isolated to synthetic local setup. The
  // application client itself has no profile INSERT privilege.
  const authAdmin = createClient<Database>(environment.SUPABASE_URL, environment.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const suffix = randomUUID().slice(0, 8);
  const email = `phase2a-smoke-${suffix}@example.invalid`;
  const password = `LocalSmoke-${randomUUID()}`;
  const syntheticIds: {
    company?: string;
    contact?: string;
    service?: string;
    order?: string;
    tasks: string[];
  } = { tasks: [] };
  let actorProfileId: string | undefined;
  let output: Record<string, unknown> | undefined;
  let workflowError: unknown;
  const cleanupErrors: unknown[] = [];

  try {
    const { data: authData, error: authError } = await authAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (authError || !authData.user) throw authError ?? new Error("Synthetic user was not created.");
    actorProfileId = authData.user.id;

    const { data: ownerRole, error: roleError } = await trustedClient.from("roles").select("id").eq("name", "owner").single();
    if (roleError || !ownerRole) throw roleError ?? new Error("Owner role was not found.");
    const { error: profileError } = await trustedClient.from("profiles").update({ role_id: ownerRole.id }).eq("id", actorProfileId);
    if (profileError) throw profileError;

    const authClient = createClient<Database>(environment.SUPABASE_URL, environment.SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data: sessionData, error: signInError } = await authClient.auth.signInWithPassword({ email, password });
    if (signInError || !sessionData.session) throw signInError ?? new Error("Synthetic user did not receive a local session.");
    const userClient = createUserSupabaseClient(environment, sessionData.session.access_token);
    const actor = await verifyActor(userClient);
    if (actor.id !== actorProfileId) throw new Error("Verified actor did not match the local Auth user.");

    const activity = new ActivityService(new ActivityRepository(userClient));
    const companies = new CompanyService({ repository: new CompanyRepository(userClient) });
    const contacts = new ContactService({ repository: new ContactRepository(userClient) });
    const catalog = new CatalogService({ repository: new ServiceRepository(userClient) });
    const orders = new OrderService({ repository: new OrderRepository(userClient) });
    const tasks = new TaskService({ repository: new TaskRepository(userClient) });

    const company = await companies.create({ request_id: randomUUID(), name: `Synthetic Smoke Company ${suffix}` }, actor);
    syntheticIds.company = company.id;
    const contact = await contacts.create({ request_id: randomUUID(), company_id: company.id, name: "Synthetic Smoke Contact", email: `contact-${suffix}@example.invalid`, is_primary: true }, actor);
    syntheticIds.contact = contact.id;
    const catalogService = await catalog.create({ request_id: randomUUID(), name: `Synthetic Smoke Service ${suffix}`, description: "Local-only Phase 2B smoke record." }, actor);
    syntheticIds.service = catalogService.id;
    const order = await orders.create({ request_id: randomUUID(), company_id: company.id, service_id: catalogService.id, title: "Synthetic smoke project", assigned_to_profile_id: actorProfileId }, actor);
    syntheticIds.order = order.id;
    const firstTask = await tasks.create({ request_id: randomUUID(), order_id: order.id, title: "Synthetic smoke task one", assigned_to_profile_id: actorProfileId, sort_position: 0 }, actor);
    syntheticIds.tasks.push(firstTask.id);
    const secondTask = await tasks.create({ request_id: randomUUID(), order_id: order.id, title: "Synthetic smoke task two", assigned_to_profile_id: actorProfileId, sort_position: 1 }, actor);
    syntheticIds.tasks.push(secondTask.id);
    await orders.update(order.id, { notes: "Atomic project update verified." }, actor);
    await tasks.reorder(secondTask.id, { sort_position: 2 }, actor);
    await orders.changeStatus(order.id, { status: "working" }, actor);
    await tasks.changeStatus(firstTask.id, { status: "complete" }, actor);
    const orderActivity = await activity.listTimeline("order", order.id);
    const taskActivity = await activity.listTimeline("order_task", firstTask.id);

    output = {
      ok: true,
      localOnly: true,
      syntheticIds,
      orderNumber: order.order_number,
      activityEvents: orderActivity.length + taskActivity.length,
      archivedAfterRun: true,
      syntheticAuthUserRemoved: true,
    };
  } catch (error: unknown) {
    workflowError = error;
  } finally {
    // Cleanup is exact-ID-only and uses the already local-asserted trusted
    // client. Archival preserves append-only activity while removing every
    // synthetic operational row from active application views.
    const cleanupAttempts: Array<() => Promise<unknown>> = [
      ...syntheticIds.tasks.map((id) => async () => trustedClient.from("order_tasks").update({ archived_at: new Date().toISOString() }).eq("id", id)),
      async () => syntheticIds.order && trustedClient.from("orders").update({ archived_at: new Date().toISOString() }).eq("id", syntheticIds.order),
      async () => syntheticIds.contact && trustedClient.from("client_contacts").update({ archived_at: new Date().toISOString(), is_primary: false }).eq("id", syntheticIds.contact),
      async () => syntheticIds.service && trustedClient.from("services").update({ archived_at: new Date().toISOString(), is_active: false }).eq("id", syntheticIds.service),
      async () => syntheticIds.company && trustedClient.from("companies").update({ archived_at: new Date().toISOString() }).eq("id", syntheticIds.company),
    ];
    for (const attempt of cleanupAttempts) {
      try {
        const result = await attempt() as { error?: unknown } | undefined;
        if (result?.error) cleanupErrors.push(result.error);
      } catch (error: unknown) {
        cleanupErrors.push(error);
      }
    }
    if (actorProfileId) {
      try {
        const { error } = await authAdmin.auth.admin.deleteUser(actorProfileId);
        if (error) cleanupErrors.push(error);
      } catch (error: unknown) {
        cleanupErrors.push(error);
      }
    }
  }

  if (workflowError || cleanupErrors.length > 0) {
    throw new AggregateError(
      [...(workflowError ? [workflowError] : []), ...cleanupErrors],
      "Smoke workflow or exact-ID cleanup failed.",
    );
  }
  console.log(JSON.stringify(output, null, 2));
}

main().catch((error: unknown) => {
  console.error("Local backend smoke workflow failed.");
  console.error(error);
  process.exitCode = 1;
});
