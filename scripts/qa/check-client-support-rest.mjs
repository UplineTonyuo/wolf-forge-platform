import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createClient } from "@supabase/supabase-js";

const tenant = "f0f0f0f0-0000-4000-8000-000000000001";
const hook = "public.app_apply_client_support_context";
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const need = (condition, message) => assert.ok(condition, message);
let step = "runner isolation", database, recoveryProof, restoreRequired = false, restoreFailed = false;

// Child output can contain local keys, JWTs or fixture data; never forward it.
function captured(command, args, input) {
  return new Promise((accept, reject) => {
    const child = execFile(command, args, { encoding: "utf8", timeout: 30000, maxBuffer: 2 ** 20 }, (error, stdout) => {
      if (error) reject(new Error("Captured local command failed; output withheld"));
      else accept(stdout.trim());
    });
    child.stdin?.on("error", () => {});
    child.stdin?.end(input ?? "");
  });
}

async function sql(statement, variables = {}) {
  const args = ["exec", "-i", database, "psql", "-X", "-qAt", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"];
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
      select distinct (a->>'company')::uuid, '${tenant}', 'Synthetic Client Support CI', 'client'
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
  const proof = () => supportApi.rpc("app_get_client_support_context").abortSignal(AbortSignal.timeout(2000));
  recoveryProof = proof;
  const assertProof = (value) => need(value?.id === started.id && value.administratorId === owner.id && value.clientId === client.id
    && value.tenantId === tenant && value.companyId === client.company, "Support proof differs from the bound administrator/client/Tenant");
  assertProof(await success(proof(), "Support proof"));
  const context = await success(supportApi.rpc("app_get_client_account_context"), "Effective client account read");
  need(context.length === 1 && context[0].profile_id === client.id && context[0].company_id === client.company, "Support account context is not the selected client");
  const supportMembership = await ownMembership(supportApi);
  need(supportMembership.length === 1 && supportMembership[0].account_class === "client" && supportMembership[0].role_name === "client", "Support membership retained administrator authority");
  const profiles = await success(supportApi.from("profiles").select("id"), "Supported profile read");
  need(profiles.length === 1 && profiles[0].id === client.id, "Support profile read disclosed another identity");
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
  need(await sql(`with restored as (delete from public.profile_permission_overrides where tenant_id='${tenant}'
    and profile_id=:'client'::uuid and permission_key in ('forms.view','forms.submissions_view') and allowed=false returning 1)
    select count(*)=2 from restored;`, { client: client.id }) === "t", "Synthetic Forms permission overrides were not restored exactly");
  assertForms(await formsVisibility(supportApi), formCases[0]);
  step = "explicit support exit";
  await success(owner.api.rpc("app_end_client_support", { p_support_id: started.id }), "Explicit support exit");
  const ended = await success(owner.api.rpc("app_get_own_client_support_state", { p_support_id: started.id }), "Exited support state");
  need(ended?.id === started.id && ended.active === false, "Support exit did not persist");
  await denied(proof(), "Exited support capability");
  const finalOwner = await ownMembership(owner.api);
  need(finalOwner.length === 1 && finalOwner[0].role_name === "owner", "Support exit changed the original Owner session");
  need(await sessionSnapshot() === beforeSessions, "Support changed an existing client Auth session");
  need(await sql(`select count(*) filter(where event_code in ('authorization.client_support.started','authorization.client_support.ended'))=2
    and bool_and(actor_profile_id=:'owner'::uuid and target_actor_id=:'client'::uuid
      and actor_class='internal' and resource_type='client_support' and outcome='succeeded')
    from public.security_audit_events where resource_id=:'support'::uuid;`,
  { support: started.id, owner: owner.id, client: client.id }) === "t", "Support start/exit real-administrator audits differ");
  console.log("PASS real PostgREST support identity, Forms visibility/assignee isolation/revocation, delegated reply/audit, missing-hook fail-closed behavior, restored hook/exit, and unchanged client Auth sessions (disposable CI only)");
}

try {
  await main();
} catch (error) {
  const detail = error instanceof assert.AssertionError ? ` (${error.message})` : "";
  console.error(`FAIL client support REST integration during ${step}${detail}; command, credential and response details withheld`);
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
