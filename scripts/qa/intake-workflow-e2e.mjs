import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { createServer as createHttpsServer } from "node:https";
import { request as httpRequest } from "node:http";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { PDFDocument } from "pdf-lib";
import sanitizeHtml from "sanitize-html";
import { decodeHTML } from "entities";

const tenant = "f0f0f0f0-0000-4000-8000-000000000001";
const origin = "https://127.0.0.1:3443";
const bundle = resolve("data/intake-forms/20261028");
const output = resolve("artifacts/intake-workflow");
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNg4A38DwABzQFelLyDQQAAAABJRU5ErkJggg==", "base64");
const report = { status: "incomplete", scope: "Intake workflow using synthetic one-time balance offers for all 59 service IDs; recurring billing is not exercised. Agreement wording and production publication remain separate gates.", checks: [], cases: [], consoleErrors: [], blockedExternalRequests: 0 };
const secrets = [];
let step = "fixture checks", browser, page, proxy, server, temporary;
const need = (condition, message) => assert.ok(condition, message);
const check = (message) => report.checks.push(message);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const compact = (value) => decodeHTML(String(value)).normalize("NFKC").replace(/\s+/gu, "");
function htmlSegments(html) {
  const parts = [];
  sanitizeHtml(html || "", { allowedTags: [], allowedAttributes: {}, textFilter: (text) => { if (compact(text)) parts.push(decodeHTML(text)); return text; } });
  return parts;
}
function requirePdfText(text, expected, label) {
  const value = compact(expected);
  const escaped = Array.from(value).map((character) => {
    const notation = `\\u{${character.codePointAt(0).toString(16).toUpperCase()}}`;
    return text.includes(notation) ? notation : character;
  }).join("");
  need(text.includes(value) || text.includes(escaped), `Downloaded PDF lost ${label}`);
}
const scrub = (message) => secrets.reduce((text, secret) => text.split(secret).join("[redacted]"), String(message))
  .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[redacted session]").slice(0, 500);

async function fixtures() {
  const manifest = JSON.parse(await readFile(join(bundle, "manifest.json"), "utf8"));
  const catalog = JSON.parse(await readFile(join(bundle, "service-catalog.json"), "utf8"));
  need(manifest.templates.length === 37 && catalog.length === 59, "Expected the reviewed 37-template/59-service package");
  const templates = [];
  for (const meta of manifest.templates) {
    need(/^(intake|service)-\d+\.json$/.test(meta.file) && basename(meta.file) === meta.file, "Unsafe template filename");
    const bytes = await readFile(join(bundle, "drafts", meta.file));
    need(digest(bytes) === meta.sha256, `Template fingerprint differs: ${meta.file}`);
    const payload = JSON.parse(bytes);
    need(payload.form_type === "intake" && payload.definition.visibility === "assigned", "Assigned intake required");
    need(payload.definition.rules.length === 0, "Add browser coverage before introducing conditional rules");
    need(!payload.definition.type_config.automation && payload.definition.type_config.reminder_days === 0, "Provider-free intake required");
    assert.deepEqual(payload.definition.service_links.map((link) => link.service_id), meta.services);
    for (const field of payload.definition.fields) {
      need(["text", "textarea", "richtext", "signature", "secret", "file", "break"].includes(field.field_type), "Unsupported browser field type");
      if (field.field_type === "signature") need(field.settings.signature_mode === "drawn", "Drawn signature required");
      if (field.field_type === "secret") need(!field.required && field.settings.collection_mode === "disabled", "Credential collection must remain disabled");
    }
    templates.push({ meta, payload });
  }
  const links = templates.flatMap(({ meta }) => meta.services).sort();
  assert.deepEqual(links, catalog.map((service) => service.id).sort());
  need(new Set(links).size === 59 && links.every((id) => uuid.test(id)), "Service mapping must be unique and complete");
  report.templates = templates.length;
  report.serviceMappings = links.length;
  report.signatureTemplates = templates.filter(({ payload }) => payload.definition.fields.some((field) => field.field_type === "signature")).length;
  const cases = templates.flatMap((entry) => entry.meta.services.map((serviceId) => ({ entry, serviceId, sourceServiceId: catalog.find((service) => service.id === serviceId).source_service_id })));
  report.serviceCases = cases.length;
  report.expectedDrawnSignatures = cases.flatMap(({ entry }) => entry.payload.definition.fields).filter((field) => field.field_type === "signature").length;
  check("All 37 template hashes and all 59 unique service mappings match the package");
  return { templates, catalog, cases };
}

function sql(statement, variables = {}) {
  const args = ["exec", "-i", "supabase_db_Wolf-Forge-Platform", "psql", "-U", "postgres", "-d", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1"];
  for (const [key, value] of Object.entries(variables)) {
    need(/^[a-z_]+$/.test(key), "Invalid SQL parameter");
    args.push("-v", `${key}=${JSON.stringify(value)}`);
  }
  try { return execFileSync("docker", args, { input: statement, encoding: "utf8", timeout: 30000, stdio: ["pipe", "pipe", "pipe"] }).trim(); }
  catch { throw new Error(`Local fixture SQL failed during ${step}; database output withheld`); }
}

async function rpc(client, name, args) {
  const response = await client.rpc(name, args);
  need(!response.error, `${name} refused during ${step} (${response.error?.code ?? "no code"})`);
  return response.data;
}

async function main() {
  const { templates, catalog, cases } = await fixtures();
  if (process.argv.includes("--check-fixtures")) {
    console.log(JSON.stringify({ templates: report.templates, serviceMappings: report.serviceMappings, serviceCases: cases.length, signatureTemplates: report.signatureTemplates, drawnSignatureCases: report.expectedDrawnSignatures, scope: "Static package checks only; no services started or contacted" }));
    return;
  }
  need(process.env.GITHUB_ACTIONS === "true" && process.env.CI === "true" && process.platform === "linux", "This destructive disposable fixture runs only on a GitHub Linux runner");
  need((process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME) === "codex/intake-publication-20261028", "Unapproved workflow branch");
  need(!process.env.SUPABASE_ACCESS_TOKEN && !process.env.VERCEL && !process.env.LOCAL_UI_QA_BYPASS, "Hosted credentials or an auth bypass are forbidden");
  step = "reviewed-template deployment trace";
  const build = process.env.WOLF_FORGE_STUDIO_QA_BUILD === "1" ? ".next-studio-qa" : ".next";
  const tracePath = resolve(build, "server/app/(internal)/forms/new/page.js.nft.json");
  const trace = JSON.parse(await readFile(tracePath, "utf8"));
  const tracedFiles = new Set(trace.files.map((file) => resolve(dirname(tracePath), file)));
  for (const file of [join(bundle, "manifest.json"), ...templates.map((entry) => join(bundle, "drafts", entry.meta.file))]) {
    need(tracedFiles.has(file), `Reviewed-template page trace omitted ${basename(file)}`);
    need((await readFile(file)).length > 0, "A traced reviewed-template file is unavailable");
  }
  check("The /forms/new deployment trace packages the manifest and all 37 allowlisted reviewed template files");
  step = "local Supabase status";
  const status = JSON.parse(execFileSync(resolve("node_modules/.bin/supabase"), ["status", "--output", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
  need(status.API_URL === "http://127.0.0.1:54321", "Only the fresh loopback Supabase API is allowed");
  const publicKey = status.PUBLISHABLE_KEY || status.ANON_KEY;
  const serverKey = status.SECRET_KEY || status.SERVICE_ROLE_KEY;
  need(publicKey && serverKey, "Local keys unavailable");
  secrets.push(publicKey, serverKey);
  step = "fresh database guard";
  need(sql("select (not exists(select 1 from auth.users) and not exists(select 1 from public.orders) and not exists(select 1 from public.form_submissions))::text;") === "true", "Requires an empty, newly migrated test database");
  need(Number(sql("select count(*) from supabase_migrations.schema_migrations;")) === 182, "Expected all 182 migrations before seeding");
  await mkdir(output, { recursive: true });
  const boundedFetch = (input, init = {}) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    need(url.origin === status.API_URL, "Supabase request escaped the local API");
    return fetch(input, { ...init, redirect: "error", signal: init.signal || AbortSignal.timeout(20000) });
  };
  const clientOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: boundedFetch, headers: { "x-wf-tenant": tenant } } };
  const admin = createClient(status.API_URL, serverKey, clientOptions);
  const accounts = [];
  step = "synthetic Auth provisioning";
  for (let index = 0; index < 8; index++) {
    const password = randomBytes(32).toString("base64url");
    secrets.push(password);
    const email = `intake-ci-${index}@example.invalid`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    need(!created.error && uuid.test(created.data.user?.id ?? ""), "Synthetic Auth provisioning failed");
    accounts.push({ id: created.data.user.id, email, password, company: index ? randomUUID() : null, owner: index === 0 });
  }
  step = "synthetic membership and catalog fixture";
  sql(`begin;
    insert into public.companies(id,tenant_id,name,status)
      select (a->>'company')::uuid, '${tenant}', 'Synthetic Intake CI '||(a->>'id'), 'client'
      from jsonb_array_elements(:'actors'::jsonb) a where (a->>'owner')::boolean is false;
    update public.profiles p set role_id=r.id,company_id=(a->>'company')::uuid,display_name='Synthetic Intake CI'
      from jsonb_array_elements(:'actors'::jsonb) a, public.roles r
      where p.id=(a->>'id')::uuid and r.name=case when (a->>'owner')::boolean then 'owner' else 'client' end;
    insert into public.services(id,tenant_id,name,price,currency,is_active,is_public,recurring)
      select (s->>'id')::uuid,'${tenant}','Synthetic CI '||(s->>'name'),1,'USD',true,true,false from jsonb_array_elements(:'catalog'::jsonb) s
      on conflict(id) do update set name=excluded.name,price=1,currency='USD',is_active=true,is_public=true,recurring=false,
        recurring_price=null,recurring_interval_length=null,recurring_interval_unit=null,recurring_action=null,
        archived_at=null,description=null,image_url=null;
    update public.services set description=null,image_url=null where tenant_id='${tenant}';
    commit;`, { actors: accounts.map(({ id, company, owner }) => ({ id, company, owner })), catalog });
  need(Number(sql("select count(*) from public.tenant_memberships where archived_at is null;")) === accounts.length, "Real synthetic tenant memberships were not established");
  need(Number(sql(`select count(*) from public.services service
    join jsonb_array_elements(:'catalog'::jsonb) fixture on service.id=(fixture->>'id')::uuid
    where service.tenant_id='${tenant}' and service.price=1 and service.currency='USD'
      and service.is_active and service.is_public and service.archived_at is null and not service.recurring
      and service.recurring_price is null and service.recurring_interval_length is null
      and service.recurring_interval_unit is null and service.recurring_action is null;`, { catalog })) === catalog.length,
    "Synthetic one-time service fixture was not fully established");
  for (const account of accounts) {
    account.cookies = [];
    account.client = createServerClient(status.API_URL, publicKey, {
      ...clientOptions,
      cookies: { getAll: () => account.cookies, setAll: (items) => {
        for (const item of items) {
          const previous = account.cookies.findIndex((cookie) => cookie.name === item.name);
          if (previous >= 0) account.cookies.splice(previous, 1);
          account.cookies.push(item);
        }
      } },
    });
    const signed = await account.client.auth.signInWithPassword({ email: account.email, password: account.password });
    need(!signed.error && signed.data.user?.id === account.id, "Normal password grant failed");
    if (signed.data.session) secrets.push(signed.data.session.access_token, signed.data.session.refresh_token);
  }
  check("Eight real password-grant sessions have real owner/client memberships; no auth bypass");
  const owner = accounts[0], buyers = accounts.slice(1, 7), foreign = accounts[7];
  for (const account of accounts.slice(1)) await rpc(owner.client, "app_adjust_company_balance", { p_request_id: randomUUID(), p_company_id: account.company, p_amount_cents: 10000, p_reason: "Synthetic local CI funds only" });
  step = "authorized form import and publication";
  for (const entry of templates) {
    const { request_id, ...payload } = entry.payload;
    const created = await rpc(owner.client, "app_create_form", { p_request_id: request_id, p_payload: payload });
    entry.formId = created.id;
    entry.publishRequest = randomUUID();
    entry.version = await rpc(owner.client, "app_publish_form", { p_request_id: entry.publishRequest, p_form_id: created.id });
    if (entry === templates[0]) {
      need((await rpc(owner.client, "app_create_form", { p_request_id: request_id, p_payload: payload })).id === created.id, "Create replay duplicated a form");
      need((await rpc(owner.client, "app_publish_form", { p_request_id: entry.publishRequest, p_form_id: created.id })).id === entry.version.id, "Publish replay duplicated a version");
    }
  }
  check("All 37 forms imported/published through the authenticated owner RPCs; create/publish replay verified");
  const legacyBuyer = buyers.at(-1);
  need(cases.filter((_, index) => index % buyers.length === buyers.length - 1).length + 1 <= 10, "Legacy buyer would exceed its real purchase quota");
  const legacy = (await rpc(legacyBuyer.client, "app_purchase_service_with_balance", { p_request_id: randomUUID(), p_service_id: templates[0].meta.services[0] }))[0];
  need(await rpc(legacyBuyer.client, "app_get_my_order_start", { p_order_id: legacy.order_id }) === null, "Rollout-off purchase unexpectedly gated");
  sql(`insert into private.client_order_start_rollout(tenant_id,service_id,enabled)
    select '${tenant}',(s->>'id')::uuid,true from jsonb_array_elements(:'catalog'::jsonb) s;`, { catalog });
  need(await rpc(legacyBuyer.client, "app_get_my_order_start", { p_order_id: legacy.order_id }) === null, "Enabling future purchases retroactively gated an existing order");
  check("Rollout-off purchase stays legacy after all 59 service flags are enabled");

  step = "production Next server";
  temporary = await mkdtemp(join(tmpdir(), "intake-ci-"));
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(temporary, "key.pem"), "-out", join(temporary, "cert.pem"), "-days", "1", "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1"], { stdio: "ignore" });
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "3000"], {
    env: { ...process.env, NODE_ENV: "production", WOLF_FORGE_STUDIO_QA_BUILD: "1", SUPABASE_URL: status.API_URL, SUPABASE_PUBLISHABLE_KEY: publicKey, SUPABASE_SECRET_KEY: serverKey, NEXT_TELEMETRY_DISABLED: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.resume(); server.stderr.resume();
  for (let attempt = 0; attempt < 60; attempt++) {
    need(server.exitCode === null, "Production Next server exited");
    try { if ((await fetch("http://127.0.0.1:3000/login", { signal: AbortSignal.timeout(2000) })).ok) break; }
    catch { /* The owned production process may still be starting. */ }
    need(attempt < 59, "Production Next server did not become ready");
    await delay(1000);
  }
  // HTTPS preserves the application's production Secure cookies and same-origin action checks.
  proxy = createHttpsServer({ key: await readFile(join(temporary, "key.pem")), cert: await readFile(join(temporary, "cert.pem")) }, (request, response) => {
    if (request.headers.host !== new URL(origin).host) { response.writeHead(403).end(); return; }
    const upstream = httpRequest({ hostname: "127.0.0.1", port: 3000, path: request.url, method: request.method, headers: { ...request.headers, "x-forwarded-host": new URL(origin).host, "x-forwarded-proto": "https" } }, (received) => {
      response.writeHead(received.statusCode, received.headers); received.pipe(response);
    });
    upstream.on("error", () => { if (!response.headersSent) response.writeHead(502); response.end(); });
    request.pipe(upstream);
  });
  await new Promise((done) => proxy.listen(3443, "127.0.0.1", done));
  const { chromium } = await import("playwright");
  browser = await chromium.launch({ headless: true });
  async function contextFor(account) {
    const context = await browser.newContext({ ignoreHTTPSErrors: true, acceptDownloads: true, viewport: { width: 1280, height: 900 } });
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.origin === origin || ["data:", "blob:"].includes(url.protocol)) return route.continue();
      report.blockedExternalRequests++;
      return route.abort("blockedbyclient");
    });
    if (account) await context.addCookies(account.cookies.map((cookie) => ({ name: cookie.name, value: cookie.value, domain: "127.0.0.1", path: "/", httpOnly: true, secure: true, sameSite: "Lax" })));
    return context;
  }
  for (const account of accounts) account.context = await contextFor(account);
  const anonymous = await contextFor(null);
  need((await buyers[0].client.rpc("app_publish_form", { p_request_id: randomUUID(), p_form_id: templates[0].formId })).error, "A client account could publish an internal form");
  const deniedPage = await buyers[0].context.newPage();
  await deniedPage.goto(`${origin}/forms/${templates[0].formId}`, { waitUntil: "networkidle" });
  need(!new URL(deniedPage.url()).pathname.startsWith("/forms/"), "A client account entered the internal form builder");
  await deniedPage.close();
  check("Client roles cannot publish forms or enter the internal form builder");
  const ownerPage = await owner.context.newPage();
  page = ownerPage;
  ownerPage.on("pageerror", (error) => report.consoleErrors.push(scrub(error.message)));
  step = "owner reviewed-template draft";
  const reviewed = templates.find((entry) => entry.meta.file === "intake-147.json");
  const definition = reviewed.payload.definition;
  need(definition.rules.length === 0 && definition.fields.every((field) => field.options.length === 0 && field.service_links.length === 0), "Extend reviewed-template smoke coverage before adding nested choices or rules");
  const beforeDraft = await owner.client.from("forms").select("id", { count: "exact", head: true });
  need(!beforeDraft.error && beforeDraft.count === templates.length, "Reviewed-template smoke requires the 37 published fixture forms");
  await ownerPage.goto(`${origin}/forms/new?${new URLSearchParams({ template: "../manifest.json" })}`, { waitUntil: "networkidle" });
  await ownerPage.getByRole("heading", { name: "404", exact: true }).waitFor();
  need(await ownerPage.getByRole("button", { name: "Create draft", exact: true }).count() === 0, "An invalid template path exposed draft creation");
  const afterInvalid = await owner.client.from("forms").select("id", { count: "exact", head: true });
  need(!afterInvalid.error && afterInvalid.count === beforeDraft.count, "An invalid template path created a form");
  const createResponse = await ownerPage.goto(`${origin}/forms/new?template=${reviewed.meta.file}`, { waitUntil: "networkidle" });
  need(createResponse?.ok(), "The authorized reviewed-template creation page did not render");
  const createHtml = await createResponse.text();
  const selectedKeys = new Set(definition.fields.map((field) => field.stable_field_key));
  need([...selectedKeys].every((key) => createHtml.includes(key)), "The selected template definition was not delivered to its creation page");
  need(templates.flatMap((entry) => entry.payload.definition.fields).every((field) => selectedKeys.has(field.stable_field_key) || !createHtml.includes(field.stable_field_key)), "The creation page sent an unselected template definition to the browser");
  await ownerPage.locator("dl dd").filter({ hasText: "13 fields · 6 linked services" }).waitFor();
  await ownerPage.getByLabel("Form name", { exact: true }).fill("Synthetic reviewed-template copy");
  await ownerPage.getByLabel("Public slug", { exact: true }).fill("synthetic-reviewed-template-copy");
  await ownerPage.getByRole("button", { name: "Create draft", exact: true }).click();
  await ownerPage.waitForURL((url) => /^\/forms\/[0-9a-f-]{36}$/i.test(url.pathname) && url.searchParams.get("created") === "1");
  const copiedId = new URL(ownerPage.url()).pathname.split("/").at(-1);
  const copied = await owner.client.from("forms").select("id,name,canonical_key,form_type,status,visibility,created_by_profile_id,published_version_id,current_draft_version_id").eq("id", copiedId).single();
  need(!copied.error && uuid.test(copied.data?.current_draft_version_id || ""), "The owner-created draft could not be read through owner permissions");
  assert.deepEqual(copied.data, { id: copiedId, name: "Synthetic reviewed-template copy", canonical_key: "synthetic-reviewed-template-copy", form_type: "intake", status: "draft", visibility: "assigned", created_by_profile_id: owner.id, published_version_id: null, current_draft_version_id: copied.data.current_draft_version_id });
  const draftId = copied.data.current_draft_version_id;
  const copiedParts = await Promise.all([
    owner.client.from("form_versions").select("form_id,lifecycle_state,title,information_html,visibility,type_config,created_by_profile_id,published_by_profile_id,published_at,schema_hash").eq("id", draftId).single(),
    owner.client.from("form_version_fields").select().eq("form_version_id", draftId).order("sort_order"),
    owner.client.from("form_service_links").select("service_id,role,sort_order,configuration,form_version_field_id").eq("form_version_id", draftId).order("sort_order"),
    owner.client.from("form_rules").select("id", { count: "exact", head: true }).eq("form_version_id", draftId),
  ]);
  for (const result of copiedParts) need(!result.error, "The owner could not read a saved reviewed-template draft component");
  const [copiedVersion, copiedFields, copiedLinks, copiedRules] = copiedParts;
  assert.deepEqual(copiedVersion.data, { form_id: copiedId, lifecycle_state: "draft", title: definition.title, information_html: definition.information_html, visibility: definition.visibility, type_config: definition.type_config, created_by_profile_id: owner.id, published_by_profile_id: null, published_at: null, schema_hash: null });
  need(copiedFields.data.length === definition.fields.length, "The reviewed-template draft lost fields");
  for (const [index, expected] of definition.fields.entries()) {
    const keys = Object.keys(expected).filter((key) => !["options", "service_links"].includes(key));
    assert.deepEqual(Object.fromEntries(keys.map((key) => [key, copiedFields.data[index][key]])), Object.fromEntries(keys.map((key) => [key, expected[key]])), "The reviewed-template draft changed frozen field content, keys or settings");
  }
  need(copiedLinks.data.every((link) => link.form_version_field_id === null), "The reviewed-template draft added a field-specific service mapping");
  assert.deepEqual(copiedLinks.data.map((link) => Object.fromEntries(["service_id", "role", "sort_order", "configuration"].map((key) => [key, link[key]]))), definition.service_links, "The reviewed-template draft changed one of its six service mappings");
  const copiedOptions = await owner.client.from("form_field_options").select("id", { count: "exact", head: true }).in("form_version_field_id", copiedFields.data.map((field) => field.id));
  need(!copiedOptions.error && copiedOptions.count === 0 && copiedRules.count === 0, "The reviewed-template draft added unreviewed choices or rules");
  const afterDraft = await owner.client.from("forms").select("id", { count: "exact", head: true });
  need(!afterDraft.error && afterDraft.count === templates.length + 1, "The creation UI did not save exactly one additional unpublished draft");
  report.reviewedTemplateDraft = { template: reviewed.meta.file, formId: copiedId, fields: copiedFields.data.length, serviceMappings: copiedLinks.data.length, status: "draft", invalidPathRejected: true, unselectedDefinitionsExcludedFromInitialPayload: true };
  check("Normal owner creation preserves the selected 147 template in one unpublished draft; invalid paths fail closed and other definitions stay out of its initial payload");
  for (const file of ["intake-147.json", "intake-165.json"]) {
    step = `owner builder service links: ${file}`;
    const entry = templates.find((template) => template.meta.file === file);
    await ownerPage.goto(`${origin}/forms/${entry.formId}`, { waitUntil: "networkidle" });
    const manage = ownerPage.locator("summary").filter({ hasText: "Manage" });
    await manage.click();
    const links = manage.locator("..");
    await links.locator("li").first().waitFor({ state: "visible" });
    need(await links.locator("li").count() === entry.meta.services.length, "Manage hides linked services");
    for (const id of entry.meta.services) {
      const name = `Synthetic CI ${catalog.find((service) => service.id === id).name}`;
      const label = `Remove ${name} (Intake assignment)`;
      const linkedRow = links.locator(`li[data-service-id="${id}"]`);
      const remove = linkedRow.getByRole("button", { name: label, exact: true });
      try {
        await linkedRow.waitFor({ state: "visible", timeout: 10000 });
        need(await linkedRow.count() === 1 && await linkedRow.locator("strong").textContent() === name, "Service mapping row identity or name differs");
        await remove.waitFor({ state: "visible", timeout: 10000 });
        need(await remove.count() === 1, "Expected one service removal control");
      } catch {
        const labels = await links.locator('button[aria-label^="Remove "]').evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label")));
        report.builderServiceMappingFailure = { template: file, expectedServiceId: id, expectedAriaLabel: label,
          actualRemoveAriaLabels: labels.map((value) => value?.startsWith("Remove Synthetic CI ") || /^Remove Unavailable service \([0-9a-f-]{36}\)/i.test(value || "") ? scrub(value) : "[non-synthetic label withheld]") };
        throw new Error("Manage lost an existing service mapping; see synthetic label diagnostics");
      }
    }
    await manage.click();
  }
  need((await ownerPage.title()).includes("Form Builder"), "Real owner builder did not render");
  step = "owner builder responsive layout";
  const builder = ownerPage.locator('[class*="builderRoot"]').first();
  for (const width of [320, 360, 390, 430, 768, 1280, 1440]) {
    await ownerPage.setViewportSize({ width, height: 1000 });
    await builder.getByRole("heading", { level: 1 }).scrollIntoViewIfNeeded();
    need(await ownerPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "Builder overflows its viewport");
    for (const label of ["Form name", "Title"]) {
      const bounds = await builder.getByLabel(label, { exact: true }).boundingBox();
      need(bounds && bounds.height >= 36 && bounds.height <= 52, "Builder metadata controls are stretched or too small");
    }
    await ownerPage.screenshot({ path: join(output, `builder-${width}.png`), fullPage: true });
    if (width <= 760) {
      for (const label of ["Add field", "Field settings"]) {
        const trigger = builder.getByRole("button", { name: label, exact: true });
        await trigger.click();
        const dialog = ownerPage.getByRole("dialog");
        await dialog.waitFor();
        await ownerPage.waitForFunction(() => {
          const element = document.querySelector('[role="dialog"]');
          if (!element) return false;
          const box = element.getBoundingClientRect();
          return box.left >= -1 && box.right <= innerWidth + 1 && box.top >= -1 && box.bottom <= innerHeight + 1;
        });
        need(await dialog.evaluate((element) => { const box = element.getBoundingClientRect(); return box.left >= -1 && box.right <= innerWidth + 1 && box.top >= -1 && box.bottom <= innerHeight + 1; }), "Builder sheet leaves the viewport");
        if (width === 390) await ownerPage.screenshot({ path: join(output, `builder-${label === "Add field" ? "palette" : "settings"}-390.png`), fullPage: true });
        await ownerPage.keyboard.press("Escape");
        await dialog.waitFor({ state: "detached" });
        need(await trigger.evaluate((element) => document.activeElement === element), "Builder sheet did not return keyboard focus");
      }
    } else {
      const publish = await builder.getByRole("button", { name: "Publish", exact: true }).boundingBox();
      const header = await builder.locator(":scope > header").boundingBox();
      need(publish && header && header.x + header.width - publish.x - publish.width <= 40, "Desktop builder actions are not aligned to the right");
      await builder.locator("article").nth(8).scrollIntoViewIfNeeded();
      const panels = builder.locator("aside");
      await panels.first().waitFor({ state: "visible" });
      need(await panels.count() === 2, "Desktop palette or settings panel disappeared");
      for (const panel of await panels.all()) need(await panel.evaluate((element) => { const box = element.getBoundingClientRect(); return box.top >= -1 && box.top < innerHeight - 44 && box.height <= innerHeight; }), "Desktop side panel does not remain visible after scrolling");
      await ownerPage.screenshot({ path: join(output, `builder-scrolled-${width}.png`), fullPage: false });
    }
  }
  await ownerPage.close();
  page = null;
  check("Owner builder passes all seven widths, mobile sheet/Escape/focus checks, desktop sticky-panel/action geometry, and all 147/165 service links");
  let signatures = 0, uploads = 0;
  const previewed = new Set();
  const ordinary = templates.find(({ meta, payload }) => meta.file.startsWith("intake-") && !["intake-231.json", "intake-165.json"].includes(meta.file)
    && payload.definition.fields.some((field) => field.field_type === "signature" && /no\s+refund/i.test(field.help_html || "")))?.meta.file;
  need(ordinary, "An ordinary No Refund agreement is needed for representative PDF review");
  report.pdfPreviews = [];
  for (const [index, { entry, serviceId, sourceServiceId }] of cases.entries()) {
    const buyer = buyers[index % buyers.length];
    step = `${entry.meta.file}, service ${sourceServiceId}`;
    page = await buyer.context.newPage();
    page.setDefaultTimeout(20000);
    page.on("pageerror", (error) => report.consoleErrors.push(scrub(error.message)));
    page.on("console", (message) => { if (message.type() === "error") report.consoleErrors.push(scrub(message.text())); });
    await page.goto(`${origin}/account/store/${serviceId}`, { waitUntil: "networkidle" });
    need((await page.title()).length > 0 && !(await page.locator("nextjs-portal").count()), "Store page is blank or shows a framework overlay");
    await page.getByRole("button", { name: "Purchase with Wolf Forge Balance", exact: true }).click();
    const actionRequest = page.waitForRequest((request) => request.method() === "POST" && Boolean(request.headers()["next-action"]) && (request.postData() ?? "").includes(serviceId));
    await page.getByRole("button", { name: "Confirm purchase", exact: true }).click();
    const request = await actionRequest;
    const purchaseRequest = (request.postData() ?? "").match(/"requestId":"([0-9a-f-]{36})"/i)?.[1];
    need(purchaseRequest && uuid.test(purchaseRequest), "Stable purchase request UUID was not captured");
    await page.getByText("Purchase confirmed", { exact: true }).waitFor();
    const sale = JSON.parse(sql(`select json_build_object('id',o.id,'status',o.status,'assignments',
      (select json_agg(json_build_object('id',a.id,'version',a.form_version_id,'form',a.form_id)) from public.form_assignments a where a.order_id=o.id))
      from public.orders o where o.company_id=(:'company'::jsonb#>>'{}')::uuid and o.service_id=(:'service'::jsonb#>>'{}')::uuid;`, { company: buyer.company, service: serviceId }));
    need(sale.status === "pending" && sale.assignments.length === 1 && sale.assignments[0].form === entry.formId, "Purchase did not assign exactly its intended required intake");
    const assignment = sale.assignments[0];
    if (index === 0) {
      const replay = (await rpc(buyer.client, "app_purchase_service_with_balance", { p_request_id: purchaseRequest, p_service_id: serviceId }))[0];
      need(replay.replayed && replay.order_id === sale.id, "Purchase replay produced a different order");
      await rpc(owner.client, "app_publish_form", { p_request_id: randomUUID(), p_form_id: entry.formId });
      need(await rpc(buyer.client, "app_my_intake_version_available", { p_assignment_id: assignment.id, p_version_id: assignment.version }), "Frozen purchased version became unavailable after republication");
      check("A real Next purchase replay returns its original order; republication preserves the purchased version");
    }
    await page.goto(`${origin}/account/projects/${sale.id}`, { waitUntil: "networkidle" });
    let state = await rpc(buyer.client, "app_get_my_order_start", { p_order_id: sale.id });
    need(state && !state.requested && !state.started, "Purchase or page load automatically requested a start");
    const requestFirst = index % 2 === 0;
    if (requestFirst) {
      await page.getByRole("button", { name: "Start order", exact: true }).click();
      await page.getByRole("heading", { name: "Complete your service form to begin", exact: true }).waitFor();
      state = await rpc(buyer.client, "app_get_my_order_start", { p_order_id: sale.id });
      need(state.requested && !state.started && state.status === "pending", "Start skipped required intake");
    }
    await page.goto(`${origin}/account/onboarding/${assignment.id}`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Submit Form", exact: true }).waitFor({ state: "visible" });
    await page.waitForFunction(() => [...document.querySelectorAll('form button[type="submit"]')].some((button) => button.textContent.includes("Submit Form") && !button.disabled));
    await page.getByRole("heading", { name: entry.payload.definition.title, exact: true }).waitFor();
    await page.getByRole("button", { name: "Submit Form", exact: true }).click();
    need(await page.locator("form :invalid").count() > 0, "Empty required fields were not blocked");
    const detail = await rpc(buyer.client, "app_get_assigned_form_schema", { p_assignment_id: assignment.id });
    need(detail.schema.form_version_id === assignment.version, "Browser assignment is not pinned to its purchased version");
    const fields = [...detail.schema.fields].sort((a, b) => a.sort_order - b.sort_order);
    const answers = new Map();
    for (const [fieldIndex, field] of fields.entries()) {
      const control = page.locator(`#form-field-${fieldIndex}`);
      if (["text", "textarea", "richtext"].includes(field.field_type) && !field.settings.display_only) {
        const value = `Synthetic CI ${basename(entry.meta.file, ".json")} answer ${fieldIndex}`;
        answers.set(field.stable_field_key, value);
        await control.fill(value);
      } else if (field.field_type === "file") {
        const fileName = `synthetic-${index}-${fieldIndex}.png`;
        await control.setInputFiles({ name: fileName, mimeType: "image/png", buffer: png });
        await page.getByRole("link", { name: fileName, exact: true }).waitFor();
        uploads++;
      } else if (field.field_type === "signature") await control.fill("Synthetic CI Signer");
    }
    if (index === 0 && fields.some((field) => field.field_type === "signature")) {
      await page.getByRole("button", { name: "Submit Form", exact: true }).click();
      await page.getByRole("alert").filter({ hasText: "Draw your signature and confirm consent" }).waitFor();
      check("Name alone cannot submit a required drawn signature");
    }
    for (const field of fields.filter((field) => field.field_type === "signature")) {
      const pad = page.getByRole("img", { name: `${field.label} drawing area`, exact: true });
      await pad.scrollIntoViewIfNeeded();
      const box = await pad.boundingBox();
      need(box && box.width > 0 && box.height > 0, "Signature pad has no drawable area");
      await page.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.6);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.2, { steps: 8 });
      await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.7, { steps: 8 });
      await page.mouse.up();
      await page.getByRole("checkbox", { name: "I agree to use this drawn signature as my electronic signature for this form.", exact: true }).check();
      signatures++;
    }
    if (index === 0) {
      await page.getByRole("button", { name: "Save and continue later", exact: true }).click();
      await page.getByText("Draft saved. You can close this form and continue later. Saved drafts expire after 30 days.", { exact: true }).waitFor();
      await page.reload({ waitUntil: "networkidle" });
      await page.getByText("Your saved draft has been restored.", { exact: true }).waitFor();
      for (const [fieldIndex, field] of fields.entries()) if (answers.has(field.stable_field_key)) need(await page.locator(`#form-field-${fieldIndex}`).inputValue() === answers.get(field.stable_field_key), "Real saved draft lost an answer");
      need(await page.locator('svg[aria-label$="drawing area"] polyline').count() > 0, "Real saved draft lost signature ink");
      need(await page.getByRole("checkbox", { name: "I agree to use this drawn signature as my electronic signature for this form.", exact: true }).isChecked(), "Real saved draft lost consent");
      check("Real server draft save/reload restores answers, ink and consent");
    }
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      need(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "Assigned form overflows its viewport");
      if (index === 0) await page.screenshot({ path: join(output, `assigned-form-${width}.png`), fullPage: true });
    }
    const attached = page.locator('a[href^="/api/intake-files/"]');
    const fileIds = await attached.evaluateAll((links) => links.map((link) => link.getAttribute("href").split("/").at(-1)));
    need(fileIds.length === fields.filter((field) => field.field_type === "file").length, "A selected or restored file was lost");
    if (fileIds.length) {
      const downloaded = await buyer.context.request.get(`${origin}/api/intake-files/${fileIds[0]}`);
      need(downloaded.status() === 200 && digest(await downloaded.body()) === digest(png), "Private uploaded bytes did not round-trip through the real route");
      const denied = await foreign.context.request.get(`${origin}/api/intake-files/${fileIds[0]}`);
      need([403, 404].includes(denied.status()), "Foreign client could download a private intake file");
      const info = await rpc(buyer.client, "app_get_intake_file", { p_id: fileIds[0] });
      const publicStorage = createClient(status.API_URL, publicKey, clientOptions);
      need((await publicStorage.storage.from("intake-files").download(info.path)).error, "Anonymous Storage download disclosed private bytes");
    }
    // Stay below the actual durable 10/minute PDF quota rather than changing it.
    buyer.pdfCalls = (buyer.pdfCalls ?? []).filter((time) => Date.now() - time < 65000);
    if (buyer.pdfCalls.length > 6) await delay(Math.max(0, 65000 - (Date.now() - buyer.pdfCalls[0])));
    buyer.pdfCalls = (buyer.pdfCalls ?? []).filter((time) => Date.now() - time < 65000);
    buyer.pdfCalls.push(Date.now(), Date.now(), Date.now());
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Submit Form", exact: true }).click();
    await page.getByRole("heading", { name: "Submitted", exact: true }).waitFor();
    const automatic = await download;
    const submissionId = automatic.suggestedFilename().match(/^form-submission-([0-9a-f-]{36})\.pdf$/i)?.[1];
    need(submissionId && uuid.test(submissionId), "Automatic download did not identify the saved submission");
    const pdfPath = join(output, `${basename(entry.meta.file, ".json")}-service-${sourceServiceId}.pdf`);
    await automatic.saveAs(pdfPath);
    const pdfBytes = await readFile(pdfPath);
    need(pdfBytes.subarray(0, 5).toString() === "%PDF-", "Downloaded receipt is not PDF bytes");
    const pdf = await PDFDocument.load(pdfBytes);
    need(pdf.getPageCount() > 0, "Downloaded PDF has no pages");
    if (!previewed.has(entry.meta.file)) {
      const previews = entry.meta.file === "intake-231.json" ? [["first", 1], ["last", pdf.getPageCount()]]
        : [ordinary, "intake-165.json", "service-571.json"].includes(entry.meta.file) ? [["last", pdf.getPageCount()]]
          : entry.meta.file === "intake-221.json" ? [["first", 1]] : [];
      for (const [label, sheet] of previews) {
        const file = `pdf-preview-${basename(entry.meta.file, ".json")}-${label}`;
        execFileSync("pdftoppm", ["-png", "-scale-to", "1400", "-f", String(sheet), "-singlefile", pdfPath, join(output, file)], { timeout: 20000, stdio: "ignore" });
        report.pdfPreviews.push({ file: `${file}.png`, template: entry.meta.file, sourceServiceId, page: sheet });
      }
      previewed.add(entry.meta.file);
    }
    const receipt = await rpc(buyer.client, "app_get_form_submission_pdf", { p_submission_id: submissionId });
    need(receipt.form.version_id === assignment.version && receipt.original.id === submissionId, "PDF receipt resolved the wrong saved version");
    need(receipt.original.values.every((value) => !["secret", "hidden", "password"].includes(value.field_type)), "PDF receipt disclosed protected fields");
    need(fileIds.every((id) => receipt.files.some((file) => file.id === id)), "PDF receipt lost an uploaded file reference");
    for (const [key, value] of answers) need(receipt.original.values.some((answer) => answer.stable_field_key === key && answer.value === value), "Saved PDF receipt lost an entered answer");
    for (const field of fields.filter((field) => field.field_type === "signature")) {
      const signed = receipt.original.values.find((value) => value.stable_field_key === field.stable_field_key)?.value;
      need(signed?.method === "drawn" && signed.consent && signed.name === "Synthetic CI Signer" && signed.signed_at && signed.drawing?.length, "Saved signature lacks server attestation or ink");
      need(receipt.form.fields.find((value) => value.key === field.stable_field_key)?.help_html === field.help_html, "PDF receipt changed the frozen agreement text");
    }
    const extracted = execFileSync("pdftotext", ["-layout", pdfPath, "-"], { encoding: "utf8", timeout: 15000, stdio: ["ignore", "pipe", "pipe"] });
    const pdfText = compact(extracted.replaceAll("SUBMISSION RECORD", "").replace(new RegExp(`${submissionId}\\s*\\|\\s*\\d+/\\d+`, "g"), ""));
    requirePdfText(pdfText, entry.payload.definition.title, "the frozen form title");
    requirePdfText(pdfText, receipt.original.submitted_at, "the server submission date");
    for (const value of answers.values()) requirePdfText(pdfText, value, "an entered answer");
    for (const field of fields.filter((field) => field.field_type === "signature")) {
      for (const segment of htmlSegments(field.help_html)) requirePdfText(pdfText, segment, "frozen agreement text");
      const signed = receipt.original.values.find((value) => value.stable_field_key === field.stable_field_key).value;
      requirePdfText(pdfText, signed.name, "the signer name");
      requirePdfText(pdfText, signed.signed_at, "the server signing date");
      requirePdfText(pdfText, "Consent: Recorded", "the recorded consent");
    }
    for (const file of receipt.files) requirePdfText(pdfText, file.name, "an attachment filename");
    const manualDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download PDF", exact: true }).click();
    need((await manualDownload).suggestedFilename() === automatic.suggestedFilename(), "Manual download resolved a different submission");
    const foreignPdf = await foreign.context.request.get(`${origin}/api/form-submissions/${submissionId}/pdf`);
    need(foreignPdf.status() === 404, "Foreign client could retrieve the PDF receipt");
    const anonymousPdf = await anonymous.request.get(`${origin}/api/form-submissions/${submissionId}/pdf`);
    need(anonymousPdf.status() === 401, "Anonymous PDF access did not require a session");
    need(foreignPdf.headers()["cache-control"]?.includes("no-store"), "Private PDF route lacks no-store");
    state = await rpc(buyer.client, "app_get_my_order_start", { p_order_id: sale.id });
    if (requestFirst) {
      // Reads only: a mutating replay here would conceal a broken submission reconciliation.
      for (let attempt = 0; !state.started && attempt < 15; attempt++) {
        await delay(5000);
        state = await rpc(buyer.client, "app_get_my_order_start", { p_order_id: sale.id });
      }
      need(state.started && state.requested && state.status === "working", "Saved start request was not reconciled automatically after intake");
    } else {
      need(!state.requested && !state.started && state.status === "pending", "Form submission started an order without explicit intent");
      await page.goto(`${origin}/account/projects/${sale.id}`, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: "Start order", exact: true }).click();
      await page.getByRole("heading", { name: "Your order is in progress", exact: true }).waitFor();
    }
    state = await rpc(buyer.client, "app_request_my_order_start", { p_order_id: sale.id });
    need(state.started && state.requested && state.status === "working", "Required completion and explicit intent did not start the order");
    need((await foreign.client.rpc("app_request_my_order_start", { p_order_id: sale.id })).error, "Foreign client could request order start");
    report.cases.push({ template: entry.meta.file, serviceId, sourceServiceId, pages: pdf.getPageCount(), pdfTextVerified: true, signatures: fields.filter((field) => field.field_type === "signature").length, uploads: fileIds.length, ordering: requestFirst ? "start then intake" : "intake then explicit start", status: "passed" });
    await writeFile(join(output, "summary.json"), JSON.stringify(report, null, 2));
    await page.close(); page = null;
    console.log(`Technical workflow passed: ${entry.meta.file}, service ${sourceServiceId}`);
  }
  step = "final authoritative readback";
  const counts = JSON.parse(sql(`select json_build_object('orders',(select count(*) from public.orders),
    'paid',(select count(*) from public.invoices where billing_reason='store_purchase' and status='paid'),
    'submissions',(select count(*) from public.form_submissions),
    'gated',(select count(*) from private.client_order_starts),
    'started',(select count(*) from private.client_order_starts where started_at is not null and requested_at is not null),
    'events',(select count(*) from public.activity_events where action='order.status_changed' and metadata->>'client_requested'='true'),
    'debits',(select count(*) from public.company_wallet_transactions where amount_cents<0));`));
  const purchased = cases.length + 1;
  assert.deepEqual(counts, { orders: purchased, paid: purchased, submissions: cases.length, gated: cases.length, started: cases.length, events: cases.length, debits: purchased });
  need(new Set(report.cases.map((entry) => entry.template)).size === templates.length, "Not every template was exercised");
  need(new Set(report.cases.map((entry) => entry.serviceId)).size === catalog.length, "Not every service mapping was exercised");
  need(report.pdfPreviews.length === 6, "The six representative downloaded-PDF page previews were not produced");
  need(signatures === report.expectedDrawnSignatures, "Not every drawn signature was exercised");
  need(report.consoleErrors.length === 0, "Browser runtime errors were captured");
  report.status = "passed";
  report.readback = counts;
  report.drawnSignatures = signatures;
  report.uploads = uploads;
  report.limitations = ["Chromium on a CI runner; no physical phone or pen test", "PDF text is independently extracted with Poppler; PDF ink is verified in the saved numeric signature and document validity, without independent raster stroke comparison", "Two original templates contain no signature field", "Foreign browser/API cases use different companies in the same tenant; cross-tenant receipt denial is separately covered by database suite 168", "Normal password grants and manually installed SSR sessions tested; interactive login/BotID UI and Next Set-Cookie policy are separate checks", "Technical acceptance does not approve agreement wording or production publication"];
  check("Fresh database readback proves exactly one debit/invoice/order per purchase and one start event per completed gated order");
}

try { await main(); }
catch (error) {
  report.failure = { step, reason: scrub(error instanceof Error ? error.message : "Unexpected failure") };
  process.exitCode = 1;
  console.error(`Intake workflow failed during ${step}; see the redacted summary.`);
  if (page) await page.screenshot({ path: join(output, "failure.png"), fullPage: true }).catch(() => {});
} finally {
  if (!process.argv.includes("--check-fixtures")) {
    await mkdir(output, { recursive: true });
    await writeFile(join(output, "summary.json"), JSON.stringify(report, null, 2));
  }
  if (browser) await browser.close();
  if (proxy) { proxy.closeAllConnections(); await new Promise((done) => proxy.close(done)); }
  if (server && server.exitCode === null) {
    server.kill("SIGTERM");
    await Promise.race([new Promise((done) => server.once("exit", done)), delay(5000)]);
    if (server.exitCode === null) server.kill("SIGKILL");
  }
  if (temporary) await rm(temporary, { recursive: true, force: true });
}
