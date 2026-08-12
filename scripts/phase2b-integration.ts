import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { assertLocalSupabaseUrl } from "../src/lib/env/public-env.js";
import { readServerEnvironment, type ServerEnvironment } from "../src/lib/env/server-env.js";
import type { Database } from "../src/lib/supabase/database.types.js";
import { createTrustedServerSupabaseClient } from "../src/lib/supabase/trusted-server-client.js";
import { createUserSupabaseClient, verifyActor } from "../src/lib/supabase/user-client.js";
import { ActivityRepository } from "../src/repositories/activity-repository.js";
import { CompanyRepository } from "../src/repositories/company-repository.js";
import { OrderRepository } from "../src/repositories/order-repository.js";
import { ServiceRepository } from "../src/repositories/service-repository.js";
import { TaskRepository } from "../src/repositories/task-repository.js";

function localEnvironment(): ServerEnvironment {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_PUBLISHABLE_KEY && process.env.SUPABASE_SECRET_KEY) {
    return readServerEnvironment();
  }
  const executable = process.platform === "win32" ? process.env.ComSpec ?? "cmd.exe" : "npx";
  const args = process.platform === "win32"
    ? ["/d", "/s", "/c", "npx.cmd supabase status -o env"]
    : ["supabase", "status", "-o", "env"];
  const output = execFileSync(executable, args, { encoding: "utf8", windowsHide: true });
  const values = Object.fromEntries(output.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^([A-Z_]+)="(.*)"$/);
    return match ? [[match[1], match[2]]] : [];
  }));
  return readServerEnvironment({
    SUPABASE_URL: values.API_URL,
    SUPABASE_PUBLISHABLE_KEY: values.PUBLISHABLE_KEY,
    SUPABASE_SECRET_KEY: values.SECRET_KEY,
  });
}

async function signIn(environment: ServerEnvironment, email: string, password: string) {
  const client = createClient<Database>(environment.SUPABASE_URL, environment.SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw error ?? new Error("Local integration sign-in failed.");
  return createUserSupabaseClient(environment, data.session.access_token);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main(): Promise<void> {
  const environment = localEnvironment();
  assertLocalSupabaseUrl(environment.SUPABASE_URL);
  const trusted = createTrustedServerSupabaseClient(environment);
  const authAdmin = createClient<Database>(environment.SUPABASE_URL, environment.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const suffix = randomUUID().slice(0, 8);
  const password = `Phase2B-${randomUUID()}`;
  const ownerEmail = `phase2b-owner-${suffix}@example.invalid`;
  const clientEmail = `phase2b-client-${suffix}@example.invalid`;
  const createdUserIds: string[] = [];
  const syntheticIds: {
    companies: string[];
    services: string[];
    orders: string[];
    tasks: string[];
  } = { companies: [], services: [], orders: [], tasks: [] };
  const cleanupErrors: unknown[] = [];
  let workflowError: unknown;

  try {
    for (const email of [ownerEmail, clientEmail]) {
      const { data, error } = await authAdmin.auth.admin.createUser({ email, password, email_confirm: true });
      if (error || !data.user) throw error ?? new Error("Local integration user creation failed.");
      createdUserIds.push(data.user.id);
    }
    const [ownerId, clientId] = createdUserIds;
    assert(ownerId && clientId, "Both integration user IDs are required.");
    const { data: ownerRole, error: roleError } = await trusted.from("roles").select("id").eq("name", "owner").single();
    if (roleError || !ownerRole) throw roleError ?? new Error("Owner role missing.");
    const { error: promoteError } = await trusted.from("profiles").update({ role_id: ownerRole.id }).eq("id", ownerId);
    if (promoteError) throw promoteError;

    const ownerClient = await signIn(environment, ownerEmail, password);
    const actor = await verifyActor(ownerClient);
    assert(actor.id === ownerId, "verifyActor must derive the local Auth user ID.");
    const companies = new CompanyRepository(ownerClient);
    const services = new ServiceRepository(ownerClient);
    const orders = new OrderRepository(ownerClient);
    const tasks = new TaskRepository(ownerClient);
    const activities = new ActivityRepository(ownerClient);

    const companyRequestId = randomUUID();
    const ownCompany = await companies.create({ request_id: companyRequestId, name: `Phase 2B Client Company ${suffix}` });
    syntheticIds.companies.push(ownCompany.id);
    const retriedCompany = await companies.create({ request_id: companyRequestId, name: `Phase 2B Client Company ${suffix}` });
    assert(retriedCompany.id === ownCompany.id, "Repeated create request must return the original client.");
    const otherCompany = await companies.create({ request_id: randomUUID(), name: `Phase 2B Other Company ${suffix}` });
    syntheticIds.companies.push(otherCompany.id);
    const service = await services.create({ request_id: randomUUID(), name: `Phase 2B Integration Service ${suffix}` });
    syntheticIds.services.push(service.id);
    const ownOrder = await orders.create({ request_id: randomUUID(), company_id: ownCompany.id, service_id: service.id, title: "Client-visible project" });
    syntheticIds.orders.push(ownOrder.id);
    const otherOrder = await orders.create({ request_id: randomUUID(), company_id: otherCompany.id, service_id: service.id, title: "Other-company project" });
    syntheticIds.orders.push(otherOrder.id);
    const task = await tasks.create({ request_id: randomUUID(), order_id: ownOrder.id, title: "Client-visible task" });
    syntheticIds.tasks.push(task.id);
    await orders.assign(ownOrder.id, ownerId);
    await tasks.assign(task.id, ownerId);
    await orders.changeStatus(ownOrder.id, "working");
    await tasks.changeStatus(task.id, "complete");
    await companies.update(ownCompany.id, { name: `Phase 2B Client ${suffix}` });
    await orders.update(ownOrder.id, { notes: "Atomic integration update." });
    await tasks.update(task.id, { description: "Atomic integration update." });
    await tasks.reorder(task.id, 2);

    const orderEvents = await activities.listForEntity("order", ownOrder.id);
    assert(orderEvents.length === 4, "Project create, assign, status, and update events must round-trip.");
    assert(orderEvents.every((event) => event.actor_profile_id === ownerId), "RPC event actors must equal the verified session user.");

    const forgedId = clientId;
    const { data: forgedEvent, error: forgedError } = await ownerClient.from("activity_events").insert({
      actor_profile_id: forgedId,
      entity_type: "order",
      entity_id: ownOrder.id,
      action: "integration.forgery_attempt",
      summary: "Actor normalization integration test",
    }).select().single();
    if (forgedError || !forgedEvent) throw forgedError ?? new Error("Forgery test event failed.");
    assert(forgedEvent.actor_profile_id === ownerId, "Direct authenticated activity insert must normalize a forged actor.");

    const { error: companyLinkError } = await trusted.from("profiles").update({ company_id: ownCompany.id }).eq("id", clientId);
    if (companyLinkError) throw companyLinkError;
    const clientScoped = await signIn(environment, clientEmail, password);
    const { data: visibleOrders, error: visibleOrdersError } = await clientScoped.from("orders").select("id");
    if (visibleOrdersError) throw visibleOrdersError;
    assert(visibleOrders.length === 1 && visibleOrders[0]?.id === ownOrder.id, "Real client JWT must see only its company order.");
    const { data: visibleTasks, error: visibleTasksError } = await clientScoped.from("order_tasks").select("id");
    if (visibleTasksError) throw visibleTasksError;
    assert(visibleTasks.length === 1 && visibleTasks[0]?.id === task.id, "Real client JWT must see only tasks under its company order.");
    const { error: clientMutationError } = await clientScoped.rpc("app_create_company", {
      p_request_id: randomUUID(),
      p_name: "Forbidden integration client",
    });
    assert(clientMutationError?.code === "42501", "Client JWT must be denied operational RPC mutation.");

    const { error: directUpdateError } = await ownerClient.from("orders").update({ title: "Bypassed audit" }).eq("id", ownOrder.id);
    assert(directUpdateError?.code === "42501", "Authenticated direct table updates must be denied.");

    await orders.archive(ownOrder.id);
    await orders.archive(otherOrder.id);
    await services.archive(service.id);
    await companies.archive(ownCompany.id);
    await companies.archive(otherCompany.id);

    console.log(JSON.stringify({
      ok: true,
      localOnly: true,
      verifiedActor: true,
      actorForgeryPrevented: true,
      atomicRoundTrips: true,
      clientRlsIsolation: true,
      clientMutationDenied: true,
      createRetryIdempotent: true,
      directWriteDenied: true,
    }, null, 2));
  } catch (error: unknown) {
    workflowError = error;
  } finally {
    const archiveAttempts: Array<() => Promise<unknown>> = [
      ...syntheticIds.tasks.map((id) => async () => trusted.from("order_tasks").update({ archived_at: new Date().toISOString() }).eq("id", id)),
      ...syntheticIds.orders.map((id) => async () => trusted.from("orders").update({ archived_at: new Date().toISOString() }).eq("id", id)),
      ...syntheticIds.services.map((id) => async () => trusted.from("services").update({ archived_at: new Date().toISOString(), is_active: false }).eq("id", id)),
      ...syntheticIds.companies.map((id) => async () => trusted.from("companies").update({ archived_at: new Date().toISOString() }).eq("id", id)),
    ];
    for (const attempt of archiveAttempts) {
      try {
        const result = await attempt() as { error?: unknown };
        if (result.error) cleanupErrors.push(result.error);
      } catch (error: unknown) {
        cleanupErrors.push(error);
      }
    }
    for (const userId of createdUserIds.reverse()) {
      try {
        const { error } = await authAdmin.auth.admin.deleteUser(userId);
        if (error) cleanupErrors.push(error);
      } catch (error: unknown) {
        cleanupErrors.push(error);
      }
    }
  }

  if (workflowError || cleanupErrors.length > 0) {
    throw new AggregateError(
      [...(workflowError ? [workflowError] : []), ...cleanupErrors],
      "Integration workflow or exact-ID cleanup failed.",
    );
  }
}

main().catch((error: unknown) => {
  console.error("Phase 2B local integration workflow failed.");
  console.error(error);
  process.exitCode = 1;
});
