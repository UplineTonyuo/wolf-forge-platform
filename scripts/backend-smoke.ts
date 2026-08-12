import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { assertLocalSupabaseUrl, readServerEnvironment, type ServerEnvironment } from "../src/lib/env/index.js";
import type { Database } from "../src/lib/supabase/database.types.js";
import { createTrustedServerSupabaseClient } from "../src/lib/supabase/trusted-server-client.js";
import { ActivityRepository } from "../src/repositories/activity-repository.js";
import { CompanyRepository } from "../src/repositories/company-repository.js";
import { ContactRepository } from "../src/repositories/contact-repository.js";
import { OrderRepository } from "../src/repositories/order-repository.js";
import { ServiceRepository } from "../src/repositories/service-repository.js";
import { TaskRepository } from "../src/repositories/task-repository.js";
import { ActivityService } from "../src/services/activity-service.js";
import { CatalogService } from "../src/services/catalog-service.js";
import { CompanyService } from "../src/services/company-service.js";
import { ContactService } from "../src/services/contact-service.js";
import { OrderService } from "../src/services/order-service.js";
import { TaskService } from "../src/services/task-service.js";

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
  const { data: authData, error: authError } = await authAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (authError || !authData.user) throw authError ?? new Error("Synthetic user was not created.");

  const actorProfileId = authData.user.id;
  const { data: ownerRole, error: roleError } = await trustedClient.from("roles").select("id").eq("name", "owner").single();
  if (roleError || !ownerRole) throw roleError ?? new Error("Owner role was not found.");
  const { error: profileError } = await trustedClient.from("profiles").update({ role_id: ownerRole.id }).eq("id", actorProfileId);
  if (profileError) throw profileError;

  const activity = new ActivityService(new ActivityRepository(trustedClient));
  const context = { actorProfileId };
  const companies = new CompanyService({ repository: new CompanyRepository(trustedClient), activity });
  const contacts = new ContactService({ repository: new ContactRepository(trustedClient), activity });
  const catalog = new CatalogService({ repository: new ServiceRepository(trustedClient), activity });
  const orders = new OrderService({ repository: new OrderRepository(trustedClient), activity });
  const tasks = new TaskService({ repository: new TaskRepository(trustedClient), activity });

  const company = await companies.create({ name: `Synthetic Smoke Company ${suffix}` }, context);
  const contact = await contacts.create({ company_id: company.id, name: "Synthetic Smoke Contact", email: `contact-${suffix}@example.invalid`, is_primary: true }, context);
  const catalogService = await catalog.create({ name: `Synthetic Smoke Service ${suffix}`, description: "Local-only Phase 2A smoke record." }, context);
  const order = await orders.create({ company_id: company.id, service_id: catalogService.id, title: "Synthetic smoke order", assigned_to_profile_id: actorProfileId }, context);
  const firstTask = await tasks.create({ order_id: order.id, title: "Synthetic smoke task one", assigned_to_profile_id: actorProfileId, sort_position: 0 }, context);
  const secondTask = await tasks.create({ order_id: order.id, title: "Synthetic smoke task two", assigned_to_profile_id: actorProfileId, sort_position: 1 }, context);
  await orders.changeStatus(order.id, { status: "working" }, context);
  await tasks.changeStatus(firstTask.id, { status: "complete" }, context);
  const orderActivity = await activity.listTimeline("order", order.id);
  const taskActivity = await activity.listTimeline("order_task", firstTask.id);

  // Application tables intentionally have no casual hard-delete path. Archive
  // the top-level smoke records after exercising them; tasks become hidden with
  // their archived parent order and all activity history remains intact.
  await orders.archive(order.id, context);
  await contacts.archive(contact.id, context);
  await catalog.archive(catalogService.id, context);
  await companies.archive(company.id, context);
  const { error: authCleanupError } = await authAdmin.auth.admin.deleteUser(actorProfileId);
  if (authCleanupError) throw authCleanupError;

  console.log(JSON.stringify({
    ok: true,
    localOnly: true,
    syntheticIds: { company: company.id, contact: contact.id, service: catalogService.id, order: order.id, tasks: [firstTask.id, secondTask.id] },
    orderNumber: order.order_number,
    activityEvents: orderActivity.length + taskActivity.length,
    archivedAfterRun: true,
    syntheticAuthUserRemoved: true,
  }, null, 2));
}

main().catch((error: unknown) => {
  console.error("Local backend smoke workflow failed.");
  console.error(error);
  process.exitCode = 1;
});
