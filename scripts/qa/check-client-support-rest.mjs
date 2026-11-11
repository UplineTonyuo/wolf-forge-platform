import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createClient } from "@supabase/supabase-js";
import { checkOrderChatFormGate } from "./check-order-chat-form-gate.mjs";

const tenant = "f0f0f0f0-0000-4000-8000-000000000001";
const hook = "public.app_apply_client_support_context";
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const need = (condition, message) => assert.ok(condition, message);
let step = "runner isolation", database, recoveryProof, restoreRequired = false, restoreFailed = false;
let sqlFailureState = null;

// Child output can contain local keys, JWTs or fixture data; never forward it.
function captured(command, args, input) {
  return new Promise((accept, reject) => {
    const child = execFile(command, args, { encoding: "utf8", timeout: 30000, maxBuffer: 2 ** 20 }, (error, stdout, stderr) => {
      if (error) {
        if (args.includes("psql")) sqlFailureState = /ERROR:\s+([0-9A-Z]{5})(?:\s|$)/.exec(stderr)?.[1] ?? null;
        reject(new Error("Captured local command failed; output withheld"));
      }
      else accept(stdout.trim());
    });
    child.stdin?.on("error", () => {});
    child.stdin?.end(input ?? "");
  });
}

async function sql(statement, variables = {}) {
  sqlFailureState = null;
  const args = ["exec", "-i", database, "psql", "-X", "-qAt", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=sqlstate"];
  for (const [key, value] of Object.entries(variables)) {
    need(/^[a-z_]+$/.test(key), "Invalid fixture parameter");
    args.push("-v", `${key}=${typeof value === "string" ? value : JSON.stringify(value)}`);
  }
  return captured("docker", args, statement);
}

function loopback(value, protocol) {
  const url = new URL(value);
  need(url.protocol === protocol && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname), "Only a loopback Supabase endpoint is allowed");
  return url;
}

async function success(request, label) {
  const result = await request;
  need(!result.error, `${label} was refused`);
  return result.data;
}

async function denied(request, label) {
  const result = await request;
  need(result.error?.code === "42501", `${label} did not refuse with an authorization error`);
}

async function noRows(request, label) {
  const result = await request;
  need(result.error?.code === "42501" || (!result.error && Array.isArray(result.data) && result.data.length === 0), `${label} disclosed data or failed for an unrelated reason`);
}

async function waitFor(test, label) {
  const deadline = Date.now() + 15000;
  do {
    if (await test()) return;
    await delay(250);
  } while (Date.now() < deadline);
  throw new Error(`${label} was not observed within the bounded reload wait`);
}

async function restoreHook() {
  await sql("alter role authenticator set pgrst.db_pre_request='public.app_apply_client_support_context'; notify pgrst,'reload config';");
}

async function main() {
  need(process.env.GITHUB_ACTIONS === "true" && process.env.CI === "true" && process.platform === "linux", "Requires a disposable GitHub Actions Linux runner");
  need(!process.env.SUPABASE_ACCESS_TOKEN && !process.env.DATABASE_URL && !process.env.SUPABASE_URL && !process.env.VERCEL, "Hosted credentials or endpoint configuration are forbidden");
  step = "captured local Supabase status";
  const status = JSON.parse(await captured(resolve("node_modules/.bin/supabase"), ["status", "--output", "json"]));
  const api = loopback(status.API_URL, "http:");
  need(!api.username && !api.password && api.pathname === "/" && !api.search && !api.hash, "Unexpected local API URL");
  const db = loopback(status.DB_URL, "postgresql:");
  need(db.pathname === "/postgres" && /^\d+$/.test(db.port), "Unexpected local database URL");
  const publicKey = status.PUBLISHABLE_KEY || status.ANON_KEY;
  const serverKey = status.SECRET_KEY || status.SERVICE_ROLE_KEY;
  need(publicKey && serverKey, "Local Supabase keys are unavailable");
  const containers = (await captured("docker", ["ps", "--format", "{{.Names}}\t{{.Ports}}"]))
    .split(/\r?\n/).map((line) => line.split("\t"))
    .filter(([name, ports]) => /^supabase_db_[A-Za-z0-9_-]+$/.test(name) && ports?.includes(`:${db.port}->5432/tcp`));
  need(containers.length === 1, "Cannot uniquely match this local Supabase database container");
  database = containers[0][0];
  step = "empty migrated database and hook guards";
  need(await sql(`select (not exists(select 1 from auth.users)
    and not exists(select 1 from public.orders) and not exists(select 1 from public.tickets)
    and not exists(select 1 from public.form_submissions)
    and not exists(select 1 from private.studio_push_configuration where enabled)
    and not exists(select 1 from private.push_subscriptions))::text;`) === "true", "Requires an empty disposable migrated database without provider delivery configuration");
  const configuredHooks = JSON.parse(await sql(`select coalesce(jsonb_agg(jsonb_build_object('scope',s.setdatabase::bigint,'value',split_part(setting,'=',2))),'[]'::jsonb)
    from pg_db_role_setting s join pg_roles r on r.oid=s.setrole
    cross join lateral unnest(s.setconfig) setting
    where r.rolname='authenticator' and s.setdatabase in (0,(select oid from pg_database where datname=current_database()))
      and setting like 'pgrst.db_pre_request=%';`));
  need(configuredHooks.length === 1 && configuredHooks[0].scope === 0 && configuredHooks[0].value === hook, "Unexpected existing request hook or database-specific override; refusing to alter it");

  const boundedFetch = (input, init = {}) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    need(url.origin === api.origin, "Supabase request escaped the local API");
    return fetch(input, { ...init, redirect: "error", signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000) });
  };
  const makeClient = (key, token, capability, selectedTenant = tenant) => createClient(api.origin, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: boundedFetch, headers: {
      "x-wf-tenant": selectedTenant,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(capability ? { "x-wf-client-support": capability } : {}),
    } },
  });
  const admin = makeClient(serverKey);
  const accounts = [];
  step = "synthetic Auth users";
  for (const role of ["owner", "client", "client", "client"]) {
    const email = `client-support-ci-${randomUUID()}@example.invalid`;
    const password = randomBytes(32).toString("base64url");
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    need(!created.error && uuid.test(created.data.user?.id ?? ""), "Synthetic Auth provisioning failed");
    accounts.push({ id: created.data.user.id, email, password, role, company: role === "client" ? randomUUID() : null });
  }
  const [owner, client, other, sibling] = accounts;
  sibling.company = client.company;
  const ticket = randomUUID();
  const otherTicket = randomUUID();
  const foreignTenant = randomUUID();
  const foreignCompany = randomUUID();
  const forms = [
    { id: randomUUID(), version: randomUUID(), tenant },
    { id: randomUUID(), version: randomUUID(), tenant: foreignTenant },
  ];
  const formCases = [
    { client: client.id, company: client.company, form: forms[0].id, version: forms[0].version },
    { client: sibling.id, company: sibling.company, form: forms[0].id, version: forms[0].version },
    { client: other.id, company: other.company, form: forms[0].id, version: forms[0].version },
    { client: other.id, company: foreignCompany, form: forms[1].id, version: forms[1].version },
  ].map((fixture) => ({ ...fixture, assignment: randomUUID(), submission: randomUUID() }));
  step = "synthetic memberships and Tickets";
  await sql(`begin;
    insert into public.companies(id,tenant_id,name,status)
      select distinct (a->>'company')::uuid, '${tenant}'::uuid, 'Synthetic Client Support CI', 'client'
      from jsonb_array_elements(:'actors'::jsonb) a where a->>'role'='client';
    update public.profiles p set role_id=r.id,company_id=(a->>'company')::uuid,display_name='Synthetic Client Support CI'
      from jsonb_array_elements(:'actors'::jsonb) a,public.roles r where p.id=(a->>'id')::uuid and r.name=a->>'role';
    insert into public.tickets(id,tenant_id,company_id,client_profile_id,subject,created_by_profile_id)
      values(:'ticket'::uuid,'${tenant}',:'company'::uuid,:'client'::uuid,'Synthetic support Ticket',:'client'::uuid),
        (:'other_ticket'::uuid,'${tenant}',:'other_company'::uuid,:'other'::uuid,'Synthetic other Ticket',:'other'::uuid);
    insert into public.tenants(id,slug,display_name,status)
      values(:'foreign_tenant'::uuid,'support-ci-'||:'foreign_tenant','Synthetic Foreign Support CI','active');
    insert into public.companies(id,tenant_id,name,status)
      values(:'foreign_company'::uuid,:'foreign_tenant'::uuid,'Synthetic Foreign Support Company','client');
    insert into public.tenant_memberships(tenant_id,profile_id,account_class,role_id,company_id)
      select :'foreign_tenant'::uuid,p.id,case when p.id=:'owner'::uuid then 'internal' else 'client' end,p.role_id,
        case when p.id=:'owner'::uuid then null else :'foreign_company'::uuid end
      from public.profiles p where p.id in (:'owner'::uuid,:'other'::uuid);
    insert into public.forms(id,tenant_id,form_type,canonical_key,name,status,visibility,created_by_profile_id,updated_by_profile_id)
      select (f->>'id')::uuid,(f->>'tenant')::uuid,'onboarding','support-ci-'||(f->>'id'),
        'Synthetic Support Onboarding','published','assigned',:'owner'::uuid,:'owner'::uuid
      from jsonb_array_elements(:'forms'::jsonb) f;
    insert into public.form_versions(id,form_id,version_number,lifecycle_state,title,visibility,schema_hash,
        created_by_profile_id,published_by_profile_id,published_at)
      select (f->>'version')::uuid,(f->>'id')::uuid,1,'published','Synthetic Support Onboarding','assigned',
        repeat('a',64),:'owner'::uuid,:'owner'::uuid,now() from jsonb_array_elements(:'forms'::jsonb) f;
    update public.forms f set published_version_id=(fixture->>'version')::uuid
      from jsonb_array_elements(:'forms'::jsonb) fixture where f.id=(fixture->>'id')::uuid;
    insert into public.form_assignments(id,form_id,form_version_id,company_id,client_profile_id,assigned_by_profile_id)
      select (f->>'assignment')::uuid,(f->>'form')::uuid,(f->>'version')::uuid,(f->>'company')::uuid,
        (f->>'client')::uuid,:'owner'::uuid from jsonb_array_elements(:'form_cases'::jsonb) f;
    insert into public.form_submissions(id,form_id,form_version_id,form_assignment_id,company_id,client_profile_id,
        root_submission_id,submitted_by_profile_id)
      select (f->>'submission')::uuid,(f->>'form')::uuid,(f->>'version')::uuid,(f->>'assignment')::uuid,
        (f->>'company')::uuid,(f->>'client')::uuid,(f->>'submission')::uuid,(f->>'client')::uuid
      from jsonb_array_elements(:'form_cases'::jsonb) f;
    update public.form_assignments a set status='completed',completed_at=now(),latest_submission_id=(f->>'submission')::uuid
      from jsonb_array_elements(:'form_cases'::jsonb) f where a.id=(f->>'assignment')::uuid;
    commit;`, {
    actors: accounts.map(({ id, role, company }) => ({ id, role, company })), ticket, other_ticket: otherTicket,
    company: client.company, client: client.id, other_company: other.company, other: other.id, owner: owner.id,
    foreign_tenant: foreignTenant, foreign_company: foreignCompany, forms, form_cases: formCases,
  });
  need(await sql(`select count(*)=4 from public.tenant_memberships where tenant_id='${tenant}' and archived_at is null;`) === "t", "Synthetic real memberships were not established");
  step = "real password sign-ins";
  for (const account of accounts) {
    const signed = await makeClient(publicKey).auth.signInWithPassword({ email: account.email, password: account.password });
    need(!signed.error && signed.data.session?.access_token && signed.data.user?.id === account.id, "Real synthetic password sign-in failed");
    account.token = signed.data.session.access_token;
    account.api = makeClient(publicKey, account.token);
  }
  const anotherOwner = await makeClient(publicKey).auth.signInWithPassword({ email: owner.email, password: owner.password });
  need(!anotherOwner.error && anotherOwner.data.session?.access_token, "Second synthetic Owner session failed");
  const otherOwnerApi = makeClient(publicKey, anotherOwner.data.session.access_token);
  const sessionSnapshot = () => sql(`select coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]'::jsonb)
    from auth.sessions s where user_id in (:'client'::uuid,:'other'::uuid,:'sibling'::uuid);`,
  { client: client.id, other: other.id, sibling: sibling.id });
  const beforeSessions = await sessionSnapshot();
  need(JSON.parse(beforeSessions).length === 3, "Expected one real session for each synthetic client");
  const ownMembership = async (actor) => success(actor.rpc("app_current_tenant_membership"), "Current membership read");
  const baseline = await ownMembership(owner.api);
  need(baseline.length === 1 && baseline[0].role_name === "owner", "Owner baseline membership differs");
  const beforeProfile = await success(owner.api.from("profiles").select("id").eq("id", owner.id), "Owner profile baseline");
  need(beforeProfile.length === 1 && beforeProfile[0].id === owner.id, "Owner baseline profile is unavailable");

  step = "bound support capability and effective client context";
  const secret = randomBytes(32).toString("hex");
  const started = await success(owner.api.rpc("app_begin_client_support", {
    p_client_id: client.id, p_capability_hash: createHash("sha256").update(secret).digest("hex"),
  }), "Support begin");
  need(uuid.test(started?.id ?? ""), "Support begin returned no session identifier");
  const capability = `${started.id}.${secret}`;
  const supportApi = makeClient(publicKey, owner.token, capability);
  const replyOrderIds = [];
  const delegatedReplyStates = () => supportApi.rpc("app_list_my_order_response_states", { p_order_ids: replyOrderIds });
  const proof = () => supportApi.rpc("app_get_client_support_context").abortSignal(AbortSignal.timeout(2000));
  recoveryProof = proof;
  const assertProof = (value) => need(value?.id === started.id && value.administratorId === owner.id && value.clientId === client.id
    && value.tenantId === tenant && value.companyId === client.company, "Support proof differs from the bound administrator/client/Tenant");
  assertProof(await success(proof(), "Support proof"));
  const context = await success(supportApi.rpc("app_get_client_account_context"), "Effective client account read");
  need(context.length === 1 && context[0].profile_id === client.id && context[0].company_id === client.company, "Support account context is not the selected client");
  const supportMembership = await ownMembership(supportApi);
  need(supportMembership.length === 1 && supportMembership[0].account_class === "client" && supportMembership[0].role_name === "client", "Support membership retained administrator authority");
  need(JSON.stringify(await success(delegatedReplyStates(), "Delegated client reply metadata entry")) === "[]", "Empty delegated metadata differs");
  await denied(owner.api.rpc("app_list_my_order_response_states", { p_order_ids: [] }), "Internal owner cannot call client metadata without delegation");
  await denied(makeClient(publicKey, anotherOwner.data.session.access_token, capability).rpc("app_list_my_order_response_states", { p_order_ids: [] }), "Reply metadata rejects another Owner Auth session");
  await denied(makeClient(publicKey, owner.token, capability, foreignTenant).rpc("app_list_my_order_response_states", { p_order_ids: [] }), "Reply metadata rejects foreign Tenant support selector");
  const profiles = await success(supportApi.from("profiles").select("id"), "Supported profile read");
  need(profiles.length === 1 && profiles[0].id === client.id, "Support profile read disclosed another identity");
  step = "delegated notification snapshot isolation and replay";
  const supportNotification = randomUUID(), otherNotification = randomUUID();
  await sql(`insert into public.notifications(id,recipient_profile_id,tenant_id,audience,category,title,body,href,event_key)
    values (:'target'::uuid,:'client'::uuid,'${tenant}','client','client','Synthetic support notification','Synthetic activity','/account',:'target'),
      (:'other'::uuid,:'other_client'::uuid,'${tenant}','client','client','Synthetic other notification','Synthetic activity','/account',:'other');`,
  { target: supportNotification, client: client.id, other: otherNotification, other_client: other.id });
  const delegatedNotifications = () => supportApi.rpc("app_client_notification_feed");
  const notificationOpening = { p_request_id: randomUUID(), p_requested_at: new Date().toISOString() };
  const delegatedOpening = () => supportApi.rpc("app_open_client_notifications", notificationOpening);
  const supportFeed = await success(delegatedNotifications(), "Delegated notification feed");
  need(supportFeed.notifications.some(row => row.id === supportNotification)
    && supportFeed.notifications.every(row => row.id !== otherNotification), "Support notification feed crossed recipient scope");
  const openingReceipt = await success(delegatedOpening(), "Delegated notification opening");
  need(openingReceipt.requestId === notificationOpening.p_request_id && openingReceipt.readCount >= 1, "Support opening did not acknowledge its selected-client snapshot");
  need(JSON.stringify(await success(delegatedOpening(), "Delegated notification replay")) === JSON.stringify(openingReceipt), "Support opening replay changed the receipt");
  need((await success(delegatedNotifications(), "Delegated notification badge")).unreadCount === 0, "Support notification badge did not acknowledge the snapshot");
  need(await sql(`select (select read_at is not null from public.notifications where id=:'target'::uuid)
    and (select read_at is null from public.notifications where id=:'other'::uuid);`,
  { target: supportNotification, other: otherNotification }) === "t", "Support opening mutated another recipient");
  await denied(makeClient(publicKey, anotherOwner.data.session.access_token, capability).rpc("app_open_client_notifications", notificationOpening), "Notification opening rejects another Owner Auth session");
  await denied(makeClient(publicKey, owner.token, capability, foreignTenant).rpc("app_client_notification_feed"), "Notification feed rejects foreign Tenant support selector");
  const companies = await success(supportApi.from("companies").select("id"), "Supported company read");
  need(companies.length === 1 && companies[0].id === client.company, "Support company read disclosed another company");
  const state = await success(owner.api.rpc("app_get_own_client_support_state", { p_support_id: started.id }), "Own support state");
  need(state?.id === started.id && state.active === true, "Support state is not bound and active");
  need(await success(otherOwnerApi.rpc("app_get_own_client_support_state", { p_support_id: started.id }), "Other Owner session support state") === null, "Support state crossed Owner Auth sessions");
  await denied(makeClient(publicKey, other.token, capability).rpc("app_get_client_support_context"), "Other client capability replay");
  await denied(makeClient(publicKey, anotherOwner.data.session.access_token, capability).rpc("app_get_client_support_context"), "Other Owner session capability replay");
  await denied(makeClient(publicKey, owner.token, `${started.id}.${randomBytes(32).toString("hex")}`).rpc("app_get_client_support_context"), "Invalid support secret");
  await denied(supportApi.rpc("app_reply_to_ticket", { p_request_id: randomUUID(), p_ticket_id: otherTicket, p_body: "Synthetic denied cross-company reply" }), "Other client Ticket reply");
  const ownerStill = await ownMembership(owner.api);
  need(ownerStill.length === 1 && ownerStill[0].role_name === "owner", "A request without support header changed Owner authority");
  const clientContext = await success(client.api.rpc("app_get_client_account_context"), "Original client session context");
  need(clientContext.length === 1 && clientContext[0].profile_id === client.id, "The original client session changed identity");

  // loadFormsVisibility("client") also reaches the repository's nested availability read.
  const formsVisibility = async (actor) => {
    await success(actor.rpc("app_require_module_access", { p_module_key: "portal_forms" }), "Client Forms module entry");
    const [enabled, submissions, assignments] = await Promise.all([
      success(actor.rpc("app_forms_work_enabled"), "Forms visibility availability"),
      success(actor.rpc("app_list_form_submissions", {}), "Forms visibility submission summaries"),
      (async () => {
        const rows = await success(actor.rpc("app_list_assigned_forms"), "Forms visibility assignments");
        need(await success(actor.rpc("app_forms_work_enabled"), "Assignment repository availability") === true, "Forms collection unexpectedly paused");
        return rows;
      })(),
    ]);
    need(enabled === true, "Forms visibility unexpectedly paused");
    return { submissions, assignments };
  };
  const assertForms = (visible, fixture) => {
    need(visible.submissions.length === 1 && visible.submissions[0].id === fixture.submission
      && visible.submissions[0].client_profile_id === fixture.client && visible.submissions[0].company_id === fixture.company,
    "Forms visibility disclosed or omitted a submission outside the selected client");
    need(visible.assignments.length === 1 && visible.assignments[0].assignment_id === fixture.assignment
      && visible.assignments[0].latest_submission_id === fixture.submission
      && visible.assignments[0].client_profile_id === fixture.client && visible.assignments[0].company_id === fixture.company,
    "Forms visibility disclosed or omitted an assignment outside the selected client");
  };
  step = "real client Forms visibility sequence and assignee isolation";
  assertForms(await formsVisibility(supportApi), formCases[0]);
  assertForms(await formsVisibility(client.api), formCases[0]);
  assertForms(await formsVisibility(sibling.api), formCases[1]);
  assertForms(await formsVisibility(other.api), formCases[2]);
  assertForms(await formsVisibility(makeClient(publicKey, other.token, undefined, foreignTenant)), formCases[3]);
  const filtered = await success(supportApi.rpc("app_list_form_submissions", { p_form_id: forms[0].id, p_order_id: undefined }), "Selected Form submission filter");
  need(filtered.length === 1 && filtered[0].id === formCases[0].submission, "Form filter widened selected-client visibility");
  await noRows(supportApi.rpc("app_list_form_submissions", { p_form_id: forms[1].id }), "Foreign Form submission filter");
  await denied(makeClient(publicKey, owner.token, capability, foreignTenant).rpc("app_list_form_submissions", {}), "Support capability across Tenant selector");

  let pdfSubmissionId = formCases[0].submission;
  const delegatedPdf = () => supportApi.rpc("app_get_form_submission_pdf", { p_submission_id: pdfSubmissionId, p_include_project: true });

  step = "legitimate client reply and actual administrator audit";
  const replyRequest = randomUUID();
  const reply = await success(supportApi.rpc("app_reply_to_ticket", { p_request_id: replyRequest, p_ticket_id: ticket, p_body: "Synthetic delegated client reply" }), "Delegated client Ticket reply");
  need(reply?.author_profile_id === client.id && reply.author_type === "client" && reply.ticket_id === ticket, "Delegated reply was not attributed to the client business identity");
  need(await sql(`select (exists(select 1 from public.ticket_messages where id=:'reply'::uuid and ticket_id=:'ticket'::uuid
    and author_profile_id=:'client'::uuid and author_type='client' and request_id=:'request'::uuid)
    and exists(select 1 from public.security_audit_events where resource_id=:'support'::uuid
      and event_code='authorization.client_support.action' and actor_profile_id=:'owner'::uuid
      and target_actor_id=:'client'::uuid and metadata->>'operation' ~ '(^|/)rpc/app_reply_to_ticket$'))::text;`,
  { reply: reply.id, ticket, client: client.id, request: replyRequest, support: started.id, owner: owner.id }) === "true", "Delegated reply or real administrator audit did not persist");

  step = "missing pre-request hook fail-closed checks";
  restoreRequired = true;
  await sql("alter role authenticator reset pgrst.db_pre_request; notify pgrst,'reload config';");
  await waitFor(async () => (await proof()).error?.code === "42501", "Missing-hook proof rejection");
  await noRows(supportApi.rpc("app_current_tenant_membership"), "Missing-hook ordinary membership read");
  await noRows(supportApi.rpc("app_get_my_profile"), "Missing-hook self-profile RPC");
  await noRows(supportApi.from("profiles").select("id"), "Missing-hook direct profile read");
  await noRows(supportApi.from("companies").select("id"), "Missing-hook direct company read");
  await denied(supportApi.rpc("app_forms_work_enabled"), "Missing-hook Forms availability");
  await denied(supportApi.rpc("app_list_assigned_forms"), "Missing-hook Forms visibility assignments");
  await denied(supportApi.rpc("app_list_form_submissions", {}), "Missing-hook Forms visibility submission summaries");
  await denied(delegatedPdf(), "Missing-hook PDF receipt");
  await denied(delegatedReplyStates(), "Missing-hook client reply metadata");
  await denied(delegatedNotifications(), "Missing-hook notification feed");
  await denied(delegatedOpening(), "Missing-hook notification opening");
  const blockedRequest = randomUUID();
  await denied(supportApi.rpc("app_reply_to_ticket", { p_request_id: blockedRequest, p_ticket_id: ticket, p_body: "Synthetic missing-hook reply must never persist" }), "Missing-hook ordinary business mutation");
  need(await sql("select not exists(select 1 from public.ticket_messages where request_id=:'request'::uuid);", { request: blockedRequest }) === "t", "A missing-hook business mutation persisted");
  const withoutHeader = await ownMembership(owner.api);
  need(withoutHeader.length === 1 && withoutHeader[0].role_name === "owner", "Missing-hook control request lost ordinary Owner authority");

  step = "request hook restoration and explicit exit";
  await restoreHook();
  await waitFor(async () => {
    const result = await proof();
    return !result.error && result.data?.id === started.id && result.data?.clientId === client.id;
  }, "Restored support context");
  assertProof(await success(proof(), "Restored support proof"));
  need(await sql("select setting from pg_db_role_setting s join pg_roles r on r.oid=s.setrole cross join lateral unnest(s.setconfig) setting where r.rolname='authenticator' and s.setdatabase=0 and setting like 'pgrst.db_pre_request=%';") === `pgrst.db_pre_request=${hook}`, "Restored request hook did not persist");
  restoreRequired = false;
  assertForms(await formsVisibility(supportApi), formCases[0]);
  step = "revoked selected-client Forms permissions";
  await sql(`insert into public.profile_permission_overrides(tenant_id,profile_id,permission_key,allowed)
    select '${tenant}',:'client'::uuid,permission,false from unnest(array['forms.view','forms.submissions_view']) permission;`, { client: client.id });
  assertProof(await success(proof(), "Support proof after Forms permission revocation"));
  await denied(supportApi.rpc("app_forms_work_enabled"), "Revoked client Forms availability");
  await denied(supportApi.rpc("app_list_assigned_forms"), "Revoked client Forms visibility assignments");
  await denied(supportApi.rpc("app_list_form_submissions", {}), "Revoked client Forms visibility submission summaries");
  await denied(delegatedPdf(), "Revoked client PDF receipt");
  need(await sql(`with restored as (delete from public.profile_permission_overrides where tenant_id='${tenant}'
    and profile_id=:'client'::uuid and permission_key in ('forms.view','forms.submissions_view') and allowed=false returning 1)
    select count(*)=2 from restored;`, { client: client.id }) === "t", "Synthetic Forms permission overrides were not restored exactly");
  assertForms(await formsVisibility(supportApi), formCases[0]);
  step = "delegated PDF project fixture creation";
  const pdfService = randomUUID(), pdfOrder = randomUUID(), pdfField = randomUUID();
  await sql(`begin;
    insert into public.services(id,tenant_id,name,price,currency,is_active,is_public,recurring)
      values(:'service'::uuid,'${tenant}','Synthetic PDF context service',10,'USD',true,true,false);
    insert into public.orders(id,tenant_id,company_id,service_id,title)
      values(:'order'::uuid,'${tenant}',:'company'::uuid,:'service'::uuid,'Synthetic support project');
    commit;`, { service: pdfService, order: pdfOrder, company: client.company });
  replyOrderIds.push(pdfOrder);
  const assertReplyFlag = (rows, expected) => need(rows.length === 1 && rows[0].order_id === pdfOrder
    && rows[0].unanswered === expected && Object.keys(rows[0]).sort().join(",") === "order_id,unanswered", "Client reply projection differs");
  assertReplyFlag(await success(client.api.rpc("app_list_my_order_response_states", { p_order_ids: replyOrderIds }), "Normal client empty order metadata"), false);
  assertReplyFlag(await success(delegatedReplyStates(), "Delegated empty order metadata"), false);
  await noRows(other.api.rpc("app_list_my_order_response_states", { p_order_ids: replyOrderIds }), "Other client reply metadata exclusion");
  await success(owner.api.rpc("app_send_order_message", { p_request_id: randomUUID(), p_order_id: pdfOrder, p_body: "Synthetic staff message awaiting client", p_internal_note: false }), "Public staff message on synthetic order");
  assertReplyFlag(await success(delegatedReplyStates(), "Delegated client Unanswered flag"), true);
  assertReplyFlag(await success(client.api.rpc("app_list_my_order_response_states", { p_order_ids: replyOrderIds }), "Normal client Unanswered flag"), true);
  await success(supportApi.rpc("app_send_order_message", { p_request_id: randomUUID(), p_order_id: pdfOrder, p_body: "Synthetic client public response", p_internal_note: false }), "Delegated public order reply");
  assertReplyFlag(await success(delegatedReplyStates(), "Answered after delegated public response"), false);
  assertReplyFlag(await success(client.api.rpc("app_list_my_order_response_states", { p_order_ids: replyOrderIds }), "Normal client answered after delegated response"), false);
  const pdfForm = await success(owner.api.rpc("app_create_form", { p_request_id: randomUUID(), p_payload: {
    form_type: "intake", canonical_key: `support-pdf-${randomUUID()}`, definition: {
      name: "Synthetic project receipt", title: "Synthetic project receipt", visibility: "assigned", type_config: {},
      fields: [{ stable_field_key: pdfField, sort_order: 0, field_type: "text", label: "Synthetic answer", required: true }],
      rules: [], service_links: [{ service_id: pdfService, role: "intake_assignment", sort_order: 0, configuration: {} }],
    },
  } }), "Project PDF Form creation");
  const pdfVersion = await success(owner.api.rpc("app_publish_form", { p_request_id: randomUUID(), p_form_id: pdfForm.id }), "Project PDF Form publication");
  const pdfAssignment = await success(owner.api.rpc("app_assign_form", { p_request_id: randomUUID(), p_form_id: pdfForm.id,
    p_context: { order_id: pdfOrder, client_profile_id: client.id } }), "Project PDF Form assignment");
  step = "delegated PDF receipt and authorized project context";
  const pdfSubmission = await success(supportApi.rpc("app_submit_form", { p_request_id: randomUUID(), p_form_version_id: pdfVersion.id,
    p_context: { assignment_id: pdfAssignment.id }, p_values: [{ field_key: pdfField, value: "Synthetic receipt answer" }], p_files: [] }), "Delegated project Form submission");
  need(uuid.test(pdfSubmission?.id ?? ""), "Project PDF submission is unavailable");
  pdfSubmissionId = pdfSubmission.id;
  const projectReceipt = await success(delegatedPdf(), "Delegated project PDF receipt");
  const { project: pdfProject, ...originalReceipt } = projectReceipt;
  need(pdfProject?.title === "Synthetic support project" && Number.isInteger(pdfProject.number)
    && originalReceipt.original?.id === pdfSubmissionId, "Supported PDF lost its selected-client receipt or project identity");
  const legacyReceipt = await success(supportApi.rpc("app_get_form_submission_pdf", { p_submission_id: pdfSubmissionId }), "Compatible original PDF overload");
  need(JSON.stringify(originalReceipt) === JSON.stringify(legacyReceipt), "Project context changed the original PDF agreement evidence");
  for (const fixture of formCases.slice(1)) {
    await denied(supportApi.rpc("app_get_form_submission_pdf", { p_submission_id: fixture.submission, p_include_project: true }), "PDF selected-client and Tenant isolation");
  }
  await sql(`insert into public.profile_permission_overrides(tenant_id,profile_id,permission_key,allowed)
    values('${tenant}',:'client'::uuid,'projects.view',false);`, { client: client.id });
  need((await success(delegatedPdf(), "Supported PDF after Project access revocation")).project === null, "Supported PDF disclosed a denied project");
  await denied(delegatedReplyStates(), "Revoked project permission rejects reply metadata");
  need(await sql(`with restored as (delete from public.profile_permission_overrides where tenant_id='${tenant}'
    and profile_id=:'client'::uuid and permission_key='projects.view' and allowed=false returning 1)
    select count(*)=1 from restored;`, { client: client.id }) === "t", "Synthetic Project permission override was not restored exactly");
  step = "real delegated encrypted credential capture and submission";
  const secretField = randomUUID();
  const secretLabel = "Synthetic WordPress password";
  const secretForm = await success(owner.api.rpc("app_create_form", {
    p_request_id: randomUUID(), p_payload: {
      form_type: "onboarding", canonical_key: `support-secret-${randomUUID()}`,
      definition: { name: "Synthetic credential request", title: "Synthetic credential request", visibility: "assigned",
        type_config: { reuse_policy: "company_profile" },
        fields: [{ stable_field_key: secretField, sort_order: 0, field_type: "secret", label: secretLabel,
          required: true, settings: { collection_mode: "encrypted" } }], rules: [], service_links: [] },
    },
  }), "Owner credential Form creation");
  need(uuid.test(secretForm?.id ?? ""), "Credential Form creation returned no identifier");
  const secretVersion = await success(owner.api.rpc("app_publish_form", { p_request_id: randomUUID(), p_form_id: secretForm.id }), "Required encrypted field publication");
  need(uuid.test(secretVersion?.id ?? ""), "Credential Form publication returned no version");
  const secretAssignment = await success(owner.api.rpc("app_assign_form", {
    p_request_id: randomUUID(), p_form_id: secretForm.id, p_context: { client_profile_id: client.id },
  }), "Owner credential Form assignment");
  need(uuid.test(secretAssignment?.id ?? ""), "Credential Form assignment returned no identifier");
  const wordpressPassword = randomBytes(32).toString("base64url");
  const secretReference = await success(supportApi.rpc("app_capture_intake_secret", {
    p_request_id: randomUUID(), p_assignment_id: secretAssignment.id, p_field_key: secretField, p_secret: wordpressPassword,
  }), "Delegated encrypted password capture");
  need(uuid.test(secretReference?.credential_id ?? "") && Object.keys(secretReference).length === 1, "Capture returned more than an opaque credential reference");
  const rejectedRequest = randomUUID();
  const rawSubmission = await supportApi.rpc("app_submit_form", {
    p_request_id: rejectedRequest, p_form_version_id: secretVersion.id,
    p_context: { assignment_id: secretAssignment.id }, p_values: [{ field_key: secretField, value: wordpressPassword }], p_files: [],
  });
  need(rawSubmission.error?.code === "23514", "Ordinary submission did not reject a raw password");
  const secretValues = [{ field_key: secretField, value: secretReference }];
  await success(supportApi.rpc("app_save_intake_draft", { p_assignment_id: secretAssignment.id, p_values: secretValues }), "Opaque credential draft save");
  const secretDraft = await success(supportApi.rpc("app_get_intake_draft", { p_assignment_id: secretAssignment.id }), "Opaque credential draft reload");
  need(Array.isArray(secretDraft?.values) && secretDraft.values.length === 1 && secretDraft.values[0].field_key === secretField
    && secretDraft.values[0].value?.credential_id === secretReference.credential_id && Object.keys(secretDraft.values[0].value).length === 1
    && !JSON.stringify(secretDraft).includes(wordpressPassword), "Credential draft did not preserve only the reference");
  const secretSubmission = await success(supportApi.rpc("app_submit_form", {
    p_request_id: randomUUID(), p_form_version_id: secretVersion.id,
    p_context: { assignment_id: secretAssignment.id }, p_values: secretValues, p_files: [],
  }), "Opaque credential Form submission");
  need(uuid.test(secretSubmission?.id ?? ""), "Credential Form submission returned no identifier");
  const genericReceipt = await success(supportApi.rpc("app_get_form_submission", { p_submission_id: secretSubmission.id }), "Credential-safe generic receipt");
  need(genericReceipt?.has_saved_credentials === true && Array.isArray(genericReceipt.values)
    && !JSON.stringify(genericReceipt).includes(wordpressPassword)
    && !JSON.stringify(genericReceipt.values).includes(secretReference.credential_id)
    && genericReceipt.values.every((value) => value.field_type !== "secret"), "Generic receipt disclosed credential data or lost its safe presence flag");
  const listedSecrets = await success(owner.api.rpc("app_list_intake_secret_references", { p_submission_id: secretSubmission.id }), "Explicit Owner credential reference listing");
  need(listedSecrets.length === 1 && listedSecrets[0].credential_id === secretReference.credential_id
    && listedSecrets[0].field_key === secretField && listedSecrets[0].label === secretLabel, "Owner credential metadata differs from the submitted field");
  need(await success(owner.api.rpc("app_reveal_intake_secret", { p_credential_id: secretReference.credential_id }), "Explicit Owner credential reveal") === wordpressPassword, "Explicit Owner reveal did not roundtrip the exact password");
  for (const actor of [client.api, other.api, supportApi]) {
    await denied(actor.rpc("app_list_intake_secret_references", { p_submission_id: secretSubmission.id }), "Non-internal credential metadata lookup");
    await denied(actor.rpc("app_reveal_intake_secret", { p_credential_id: secretReference.credential_id }), "Non-internal credential reveal");
  }
  need(await sql(`select exists(select 1 from private.intake_secret_references where id=:'credential'::uuid
    and assignment_id=:'assignment'::uuid and submission_id=:'submission'::uuid and profile_id=:'client'::uuid
    and company_id=:'company'::uuid and captured_by_administrator_id=:'owner'::uuid)
    and exists(select 1 from public.security_audit_events where resource_type='intake_secret' and resource_id=:'credential'::uuid
      and event_code='integration.intake_secret.captured' and actor_profile_id=:'owner'::uuid and target_actor_id=:'client'::uuid)
    and exists(select 1 from public.security_audit_events where resource_type='intake_secret' and resource_id=:'credential'::uuid
      and event_code='integration.intake_secret.revealed' and actor_profile_id=:'owner'::uuid and target_actor_id=:'client'::uuid)
    and not exists(select 1 from private.form_submission_requests where request_id=:'rejected'::uuid);`,
  { credential: secretReference.credential_id, assignment: secretAssignment.id, submission: secretSubmission.id,
    client: client.id, company: client.company, owner: owner.id, rejected: rejectedRequest }) === "t", "Credential binding, actual-administrator audit or raw-value rejection did not persist");
  step = "legacy collection policy transaction serialization";
  const legacyField = randomUUID();
  const legacyForm = await success(owner.api.rpc("app_create_form", { p_request_id: randomUUID(), p_payload: {
    form_type: "onboarding", canonical_key: `legacy-policy-${randomUUID()}`, definition: {
      name: "Legacy policy fixture", title: "Legacy policy fixture", visibility: "assigned", type_config: {},
      fields: [{ stable_field_key: legacyField, sort_order: 0, field_type: "secret", label: "WordPress access",
        required: false, settings: { collection_mode: "disabled" } }], rules: [], service_links: [],
    },
  } }), "Legacy policy fixture creation");
  const legacyVersion = await success(owner.api.rpc("app_publish_form", { p_request_id: randomUUID(), p_form_id: legacyForm.id }), "Legacy policy fixture publication");
  const legacyAssignment = await success(owner.api.rpc("app_assign_form", {
    p_request_id: randomUUID(), p_form_id: legacyForm.id, p_context: { client_profile_id: client.id },
  }), "Legacy policy fixture assignment");
  need([legacyForm.id, legacyVersion.id, legacyAssignment.id].every((id) => uuid.test(id)), "Legacy policy fixture IDs are invalid");
  const enableLegacy = () => sql(`insert into private.intake_secret_collection_policy(form_version_id,field_key,schema_hash)
    select id,:'field'::uuid,schema_hash from public.form_versions where id=:'version'::uuid on conflict do nothing;`,
  { version: legacyVersion.id, field: legacyField });
  await enableLegacy();
  const legacyReference = await success(client.api.rpc("app_capture_intake_secret", {
    p_request_id: randomUUID(), p_assignment_id: legacyAssignment.id, p_field_key: legacyField, p_secret: wordpressPassword,
  }), "Legacy policy encrypted capture");
  const legacyValues = [{ field_key: legacyField, value: legacyReference }];
  const session = await sql("select id from auth.sessions where user_id=:'client'::uuid order by created_at desc limit 1;", { client: client.id });
  need(uuid.test(session), "Legacy policy race requires a legitimate current client session");
  const raceParams = { version: legacyVersion.id, assignment: legacyAssignment.id, field: legacyField, values: legacyValues,
    claims: { sub: client.id, role: "authenticated", session_id: session }, headers: { "x-wf-tenant": tenant }, request: randomUUID() };
  const raceAuth = "set local role authenticated; set local request.jwt.claims=:'claims'; set local request.headers=:'headers';";
  const saveLegacy = "select public.app_save_intake_draft(:'assignment'::uuid,:'values'::jsonb);";
  const submitLegacy = "select public.app_submit_form(:'request'::uuid,:'version'::uuid,jsonb_build_object('assignment_id',:'assignment'::uuid),:'values'::jsonb);";
  const settle = (operation) => operation.then(() => ({ ok: true }), () => ({ ok: false, code: sqlFailureState }));
  const sleeping = (name) => sql("select exists(select 1 from pg_stat_activity where application_name=:'name' and wait_event='PgSleep');", { name });
  const blocked = (name, blocker) => sql(`select exists(select 1 from pg_stat_activity waiter
    join pg_stat_activity holder on holder.pid=any(pg_blocking_pids(waiter.pid))
    where waiter.application_name=:'name' and waiter.wait_event_type='Lock' and holder.application_name=:'blocker');`, { name, blocker });
  for (const [kind, operation] of [["save", saveLegacy], ["submit", submitLegacy]]) {
    await enableLegacy();
    const writerName = `wf-legacy-${kind}-writer`, revokeName = `wf-legacy-${kind}-revoke`;
    const finish = kind === "save" ? "commit" : "rollback";
    const writer = settle(sql(`set application_name='${writerName}'; begin; ${raceAuth} ${operation} select pg_sleep(8); ${finish};`, raceParams));
    await waitFor(async () => await sleeping(writerName) === "t", `Legacy ${kind} writer holding its transaction`);
    const revoke = settle(sql(`set application_name='${revokeName}'; delete from private.intake_secret_collection_policy where form_version_id=:'version'::uuid;`, raceParams));
    await waitFor(async () => await blocked(revokeName, writerName) === "t", `Legacy ${kind} policy deletion blocked by the writer`);
    need((await writer).ok && (await revoke).ok, `Legacy ${kind} serialization failed`);
    need(await sql("select not exists(select 1 from private.intake_secret_collection_policy where form_version_id=:'version'::uuid);", raceParams) === "t", "Revocation did not persist after the write transaction ended");
  }
  await enableLegacy();
  const revoker = settle(sql("set application_name='wf-legacy-revoke-first'; begin; delete from private.intake_secret_collection_policy where form_version_id=:'version'::uuid; select pg_sleep(8); commit;", raceParams));
  await waitFor(async () => await sleeping("wf-legacy-revoke-first") === "t", "Policy revocation holding its transaction");
  need((await sql(`begin; set local statement_timeout='1000ms'; ${raceAuth}
    select (public.app_get_assigned_form_schema(:'assignment'::uuid)->'schema'->'fields'->0->>'encrypted_collection_allowed')::boolean; rollback;`, raceParams)) === "t", "Read-only schema unexpectedly blocked on the policy write lock");
  const waitingWriter = settle(sql(`set application_name='wf-legacy-write-after-revoke'; begin; ${raceAuth} ${saveLegacy} commit;`, raceParams));
  await waitFor(async () => await blocked("wf-legacy-write-after-revoke", "wf-legacy-revoke-first") === "t", "Writer waiting for the policy revocation transaction");
  need((await revoker).ok, "Policy revocation transaction failed");
  const refusedWrite = await waitingWriter;
  need(!refusedWrite.ok && refusedWrite.code === "42501", "Writer did not recheck policy after revocation committed");
  await denied(client.api.rpc("app_capture_intake_secret", {
    p_request_id: randomUUID(), p_assignment_id: legacyAssignment.id, p_field_key: legacyField, p_secret: wordpressPassword,
  }), "Capture after committed policy revocation");
  need(await sql(`select not exists(select 1 from public.form_submissions where form_assignment_id=:'assignment'::uuid)
    and exists(select 1 from private.intake_secret_references where id=:'credential'::uuid and submission_id is null)
    and exists(select 1 from public.form_assignments where id=:'assignment'::uuid and status='assigned')
    and exists(select 1 from private.intake_drafts where assignment_id=:'assignment'::uuid and answers=:'values'::jsonb);`,
  { ...raceParams, credential: legacyReference.credential_id }) === "t", "Race probes changed the fixture assignment or consumed its reference");
  step = "required-form conversation gate with real authenticated sessions";
  await checkOrderChatFormGate({ sql, tenant, owner, client, sibling, other, supportApi, need, success, denied, waitFor });
  step = "explicit support exit";
  await success(owner.api.rpc("app_end_client_support", { p_support_id: started.id }), "Explicit support exit");
  const ended = await success(owner.api.rpc("app_get_own_client_support_state", { p_support_id: started.id }), "Exited support state");
  need(ended?.id === started.id && ended.active === false, "Support exit did not persist");
  await denied(proof(), "Exited support capability");
  await denied(delegatedPdf(), "Exited support PDF receipt");
  await denied(delegatedReplyStates(), "Exited support client reply metadata");
  await denied(delegatedNotifications(), "Exited support notification feed");
  await denied(delegatedOpening(), "Exited support notification opening");
  const finalOwner = await ownMembership(owner.api);
  need(finalOwner.length === 1 && finalOwner[0].role_name === "owner", "Support exit changed the original Owner session");
  need(await sessionSnapshot() === beforeSessions, "Support changed an existing client Auth session");
  need(await sql(`select count(*) filter(where event_code in ('authorization.client_support.started','authorization.client_support.ended'))=2
    and bool_and(actor_profile_id=:'owner'::uuid and target_actor_id=:'client'::uuid
      and actor_class='internal' and resource_type='client_support' and outcome='succeeded')
    from public.security_audit_events where resource_id=:'support'::uuid;`,
  { support: started.id, owner: owner.id, client: client.id }) === "t", "Support start/exit real-administrator audits differ");
  console.log("PASS real PostgREST support identity, client reply metadata/parity/isolation, Forms visibility/assignee isolation/revocation, encrypted credential roundtrip, legacy policy transaction races and nonblocking reads, delegated reply/audit, missing-hook fail-closed behavior, restored hook/exit, and unchanged client Auth sessions (disposable CI only)");
}

try {
  await main();
} catch (error) {
  const detail = error instanceof assert.AssertionError ? ` (${error.message})` : "";
  console.error(`FAIL client support REST integration during ${step}${detail}${sqlFailureState ? ` (SQLSTATE ${sqlFailureState})` : ""}; command, credential and response details withheld`);
  process.exitCode = 1;
} finally {
  if (restoreRequired) {
    try {
      await restoreHook();
      await waitFor(async () => !(await recoveryProof()).error, "Recovery hook restoration");
    }
    catch { restoreFailed = true; }
  }
  if (restoreFailed) {
    console.error("FAIL request hook restoration in disposable CI database");
    process.exitCode = 1;
  }
}
