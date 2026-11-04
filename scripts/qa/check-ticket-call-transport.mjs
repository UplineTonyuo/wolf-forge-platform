// Integration acceptance, not a browser/media-quality test. No provider requests.
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

const tenant = "f0f0f0f0-0000-4000-8000-000000000001";
const app = "http://127.0.0.1:3059";
let step = "runner isolation", database, server;
const streams = new Set();
const clients = [];
const need = (value, message) => assert.ok(value, message);

export async function endedCallWasRead(response) {
  const payload = await response.json();
  return response.status === 200 && payload.ok === true && payload.data?.call === null;
}

// Captured child output may contain keys or session cookies. Never print it.
function captured(command, args, input) {
  return new Promise((accept, reject) => {
    const child = execFile(command, args, { timeout: 30000, maxBuffer: 2 ** 20 }, (error, stdout) => {
      if (error) reject(new Error("Captured runner-local command failed"));
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
    args.push("-v", `${key}=${value}`);
  }
  return captured("docker", args, statement);
}
function localUrl(value, protocol) {
  const url = new URL(value);
  need(url.protocol === protocol && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname), "Only runner-loopback endpoints are permitted");
  return url;
}
async function okay(operation, label) {
  const result = await operation;
  need(!result.error, `${label} failed`);
  return result.data;
}
async function until(check, label, timeout = 15000) {
  const deadline = Date.now() + timeout;
  do {
    if (await check()) return;
    await delay(150);
  } while (Date.now() < deadline);
  throw new Error(`${label} was not observed within its deadline`);
}

async function main() {
  need(process.env.GITHUB_ACTIONS === "true" && process.env.CI === "true" && process.platform === "linux", "Requires a disposable GitHub Actions Linux runner");
  for (const name of ["SUPABASE_ACCESS_TOKEN", "DATABASE_URL", "SUPABASE_URL", "SUPABASE_SECRET_KEY", "VERCEL", "DAILY_API_KEY", "DOCKER_HOST", "DOCKER_CONTEXT", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]) {
    need(!process.env[name], `External configuration is forbidden: ${name}`);
  }
  need(!process.env.LOCAL_UI_QA_BYPASS, "Auth bypass is forbidden");
  const docker = JSON.parse(await captured("docker", ["context", "inspect"]));
  need(docker.length === 1 && docker[0].Endpoints?.docker?.Host?.startsWith("unix://"), "Requires the runner-local Docker socket");
  step = "runner-local backend identity and migration ledger";
  const status = JSON.parse(await captured(resolve("node_modules/.bin/supabase"), ["status", "--output", "json"]));
  const api = localUrl(status.API_URL, "http:");
  const db = localUrl(status.DB_URL, "postgresql:");
  need(api.pathname === "/" && !api.username && !api.password && !api.search && !api.hash && db.pathname === "/postgres" && db.port === "54322", "Unexpected local endpoints");
  const publicKey = status.PUBLISHABLE_KEY || status.ANON_KEY;
  const serverKey = status.SECRET_KEY || status.SERVICE_ROLE_KEY;
  need(publicKey && serverKey, "Local keys missing");
  const matches = (await captured("docker", ["ps", "--format", "{{.Names}}\t{{.Ports}}"])).split(/\r?\n/)
    .map(line => line.split("\t")).filter(([name, ports]) => /^supabase_db_[A-Za-z0-9_-]+$/.test(name) && ports?.includes(`:${db.port}->5432/tcp`));
  need(matches.length === 1, "Local database container is ambiguous");
  database = matches[0][0];
  need(await sql("select current_setting('server_version_num')::int >= 170000 and current_setting('server_version_num')::int < 180000;") === "t", "Requires PostgreSQL 17");
  need(await sql("select exists(select 1 from supabase_migrations.schema_migrations where version='20261103161636');") === "t", "Follow-up migration was not applied");
  need(await sql("select exists(select 1 from supabase_migrations.schema_migrations where version='20261103225429');") === "t", "Stream lease migration was not applied");
  need(await sql(`select not exists(select 1 from auth.users) and not exists(select 1 from public.tickets)
    and not exists(select 1 from private.push_subscriptions) and not exists(select 1 from private.studio_push_configuration where enabled);`) === "t", "Requires an empty synthetic database with delivery disabled");
  need(await sql("select 'pgrst.db_pre_request=public.app_apply_client_support_context'=any(rolconfig) from pg_roles where rolname='authenticator';") === "t", "The real authorization hook must remain enabled");
  const boundedFetch = (input, init = {}) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    need(url.origin === api.origin, "Supabase request escaped loopback");
    return fetch(input, { ...init, redirect: "error", signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000) });
  };
  const makeClient = key => {
    const client = createClient(api.origin, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: boundedFetch, headers: { "x-wf-tenant": tenant } } });
    clients.push(client);
    return client;
  };
  const admin = makeClient(serverKey);
  const company = randomUUID(), ticket = randomUUID();
  const accounts = [];
  step = "real synthetic Auth users and memberships";
  for (const role of ["client", "admin"]) {
    const email = `call-transport-${randomUUID()}@example.invalid`;
    const password = randomBytes(32).toString("base64url");
    const created = await okay(admin.auth.admin.createUser({ email, password, email_confirm: true }), "Synthetic account creation");
    need(created.user?.id, "Synthetic user missing");
    accounts.push({ id: created.user.id, role, email, password });
  }
  const [caller, callee] = accounts;
  await sql(`begin;
    insert into public.companies(id,tenant_id,name,status) values(:'company','${tenant}','Synthetic transport Company','client');
    update public.profiles set role_id=(select id from public.roles where name='client'),company_id=:'company',display_name='Synthetic transport client' where id=:'caller';
    update public.profiles set role_id=(select id from public.roles where name='admin'),company_id=null,display_name='Synthetic transport admin' where id=:'callee';
    insert into public.tickets(id,tenant_id,company_id,client_profile_id,subject,assigned_to_profile_id)
      values(:'ticket','${tenant}',:'company',:'caller','Synthetic transport Ticket',:'callee');
    insert into private.ticket_inbox_memberships(ticket_id,profile_id) values(:'ticket',:'callee');
    update private.ticket_call_environment set enabled=true,backend_ref='ci',environment='test',verified_at=clock_timestamp(),media_enabled=true,account_exclusive=true,account_exclusive_verified_at=clock_timestamp();
    insert into private.ticket_call_account_usage(month,unmapped_seconds,verified_at) values(date_trunc('month',clock_timestamp() at time zone 'UTC')::date,0,clock_timestamp());
    insert into private.ticket_call_settings(tenant_id,enabled,fallback_team_profile_id,monthly_minutes) values('${tenant}',true,:'callee',600);
    commit;`, { company, ticket, caller: caller.id, callee: callee.id });
  for (const account of accounts) {
    const jar = new Map();
    account.api = createServerClient(api.origin, publicKey, {
      global: { fetch: boundedFetch, headers: { "x-wf-tenant": tenant } },
      cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: values => values.forEach(({ name, value }) => jar.set(name, value)) },
    });
    clients.push(account.api);
    await okay(account.api.auth.signInWithPassword({ email: account.email, password: account.password }), "Synthetic password sign-in");
    account.cookie = [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
    need(account.cookie, "Real Auth cookies missing");
  }
  need(await sql("select count(*)=2 from auth.sessions;") === "t", "Expected two real Auth sessions");
  step = "compiled local application";
  await readFile(resolve(".next-studio-qa/BUILD_ID"), "utf8");
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "3059"], {
    env: { ...process.env, NODE_ENV: "production", WOLF_FORGE_STUDIO_QA_BUILD: "1", SUPABASE_URL: api.origin, SUPABASE_PUBLISHABLE_KEY: publicKey,
      DAILY_CALLS_ENABLED: "1", DAILY_DOMAIN: "wolfforge.daily.co", DAILY_API_KEY: randomUUID(), TICKET_CALL_PUSH_ENABLED: "0" },
    stdio: ["ignore", "ignore", "ignore"],
  });
  server.on("error", () => {});
  const request = (path, account, init = {}) => fetch(`${app}${path}`, {
    ...init, redirect: "manual", headers: { Origin: app, ...(account ? { Cookie: account.cookie } : {}), ...init.headers }, signal: init.signal ?? AbortSignal.timeout(20000),
  });
  await until(async () => { try { return (await request("/api/ticket-calls?action=current")).status === 401; } catch { return false; } }, "Compiled server readiness", 30000);
  need((await request("/api/ticket-call-events", null)).status === 401, "Unauthenticated stream was accepted");
  need((await request("/api/ticket-call-events", callee, { headers: { Origin: "https://example.invalid" } })).status === 403, "Cross-origin stream was accepted");

  async function openStream(account) {
    const abort = new AbortController();
    const response = await request("/api/ticket-call-events", account, { signal: AbortSignal.any([abort.signal, AbortSignal.timeout(120000)]) });
    need(response.status === 200 && response.headers.get("content-type")?.includes("text/event-stream"), "Authenticated private stream did not open");
    need(response.headers.get("cache-control")?.includes("no-store"), "Stream was cacheable");
    const reader = response.body.getReader();
    const state = { abort, reader, events: 0, text: "", done: false };
    streams.add(state);
    state.reading = (async () => {
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          state.text += new TextDecoder().decode(value);
          need(state.text.length < 4096, "Unexpected stream volume");
          state.events = (state.text.match(/event: wake\ndata: \{\}\n\n/g) ?? []).length;
        }
      } catch (error) { if (!abort.signal.aborted) state.error = error; }
      finally { state.done = true; reader.releaseLock(); }
    })();
    await until(() => state.events === 1 || state.error, "Initial stream synchronization");
    need(!state.error, "Initial stream failed");
    return state;
  }
  const closeStream = async stream => {
    stream.abort.abort();
    await stream.reading;
    need(stream.done && !stream.error, "Disconnected stream failed to settle");
    streams.delete(stream);
  };
  step = "private Realtime broadcast to real SSE and fresh read";
  let stream = await openStream(callee);
  const call = await okay(caller.api.rpc("app_request_ticket_call", { p_ticket_id: ticket, p_request_id: randomUUID(), p_device_id: randomUUID(), p_mode: "audio", p_recipient_id: callee.id }), "Real authenticated invitation");
  need(call?.state === "ringing", "Invitation did not ring");
  await until(() => stream.events >= 2 || stream.error, "Database-triggered Realtime wake");
  need(!stream.error, "Realtime wake stream failed");
  const current = await (await request("/api/ticket-calls?action=current", callee)).json();
  need(current.ok && current.data?.call?.id === call.id, "Wake did not lead to authoritative incoming call read");
  need(/^retry: 10000\n\n(?:event: wake\ndata: \{\}\n\n)+$/.test(stream.text), "Stream exposed data beyond empty wake hints");
  console.log("PASS real Auth cookie → compiled SSE → private Realtime broadcast → fresh incoming call read; opaque hints only");
  await closeStream(stream);
  step = "disconnect and reconnect";
  stream = await openStream(callee);
  need((await (await request("/api/ticket-calls?action=current", callee)).json()).data?.call?.id === call.id, "Reconnect lost the active call");
  await okay(callee.api.rpc("app_ticket_call_command", { p_action: "decline", p_call_id: call.id }), "Callee decline");
  await until(() => stream.events >= 2 || stream.error, "Lifecycle Realtime wake after reconnect");
  need(!stream.error, "Reconnected stream failed");
  need(await endedCallWasRead(await request("/api/ticket-calls?action=current", callee)), "Ended invitation remained current or fresh read failed");
  await closeStream(stream);
  console.log("PASS disconnected readers settle; reconnect resynchronizes; decline broadcasts authoritative lifecycle state");
  step = "shared multi-tab admission, renewal and disconnect release";
  await until(async () => await sql("select count(*)=0 from private.ticket_call_signal_leases;") === "t", "Prior stream lease release");
  const tabs = await Promise.all([openStream(callee), openStream(callee), openStream(callee)]);
  need(await sql("select count(*)=3 from private.ticket_call_signal_leases;") === "t", "Three tabs did not retain exactly three leases");
  const overflow = await request("/api/ticket-call-events", callee);
  need(overflow.status === 429 && overflow.headers.get("retry-after") === "90", "Fourth same-session tab was not explicitly throttled");
  const firstExpiry = Number(await sql("select extract(epoch from min(expires_at)) from private.ticket_call_signal_leases;"));
  await until(async () => Number(await sql("select extract(epoch from min(expires_at)) from private.ticket_call_signal_leases;")) > firstExpiry + 20,
    "Real route-to-database lease renewal", 40000);
  need(tabs.every(tab => !tab.done && !tab.error), "An admitted tab ended before renewal");
  await closeStream(tabs.pop());
  await until(async () => await sql("select count(*)=2 from private.ticket_call_signal_leases;") === "t", "Disconnected tab releases its exact lease");
  tabs.push(await openStream(callee));
  for (const tab of tabs) await closeStream(tab);
  await until(async () => await sql("select count(*)=0 from private.ticket_call_signal_leases;") === "t", "All tab leases released");
  console.log("PASS three simultaneous real SSE/Realtime tabs; fourth 429; shared renewal; disconnect/replacement; all leases released");
  step = "revoked session authority";
  await sql("delete from auth.sessions where user_id=:'callee';", { callee: callee.id });
  const revoked = await request("/api/ticket-calls?action=current", callee);
  need([401, 403].includes(revoked.status), "Revoked session retained current-call authority");
  const revokedStream = await request("/api/ticket-call-events", callee);
  need([401, 403, 503].includes(revokedStream.status), "Revoked session opened an event stream");
  console.log("PASS revoked real session cannot read call state or open an event stream");
  need(await sql("select not exists(select 1 from private.ticket_calls where provider_state <> 'none') and not exists(select 1 from private.push_subscriptions);") === "t", "Provider operations or push subscriptions were created");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) try {
  await main();
  console.log("PASS call transport acceptance; browser ringing, media quality and OS delivery remain manual");
} catch (error) {
  console.error(`FAIL call transport acceptance at ${step}: ${error instanceof Error ? error.message : "Unknown failure"}`);
  process.exitCode = 1;
} finally {
  for (const stream of streams) { stream.abort.abort(); await stream.reading?.catch(() => {}); }
  for (const client of clients) await client.realtime.disconnect().catch(() => {});
  if (server && server.exitCode === null) {
    server.kill("SIGTERM");
    await Promise.race([new Promise(resolve => server.once("exit", resolve)), delay(5000)]);
    if (server.exitCode === null) server.kill("SIGKILL");
  }
}
