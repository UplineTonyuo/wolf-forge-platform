import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

// Run from the repository root ONLY in its disposable local Supabase GitHub runner.
// No customer data, real destinations, email sends, trigger disabling or cleanup bypasses.
const need = (condition, label) => assert.ok(condition, label);
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const bucket = "invoice-payment-receipts";
const tenant = randomUUID(), foreignTenant = randomUUID(), company = randomUUID(), otherCompany = randomUUID();
const service = randomUUID();
let step = "CI isolation", database, sqlFailureState;

function captured(command, args, input = "") {
  return new Promise((accept, reject) => {
    const child = execFile(command, args, { encoding: "utf8", timeout: 30000, maxBuffer: 2 ** 20 }, (error, stdout, stderr) => {
      if (error) {
        sqlFailureState = /ERROR:\s+([0-9A-Z]{5})(?:\s|$)/u.exec(stderr)?.[1];
        reject(new Error("Local command failed; captured output withheld"));
      } else accept(stdout.trim());
    });
    child.stdin?.on("error", () => {});
    child.stdin?.end(input);
  });
}
async function sql(statement, variables = {}) {
  sqlFailureState = undefined;
  const args = ["exec", "-i", database, "psql", "-X", "-qAt", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=sqlstate"];
  for (const [key, value] of Object.entries(variables)) {
    need(/^[a-z_]+$/u.test(key), "Invalid fixture parameter");
    args.push("-v", `${key}=${typeof value === "string" ? value : JSON.stringify(value)}`);
  }
  return captured("docker", args, statement);
}
function loopback(value, protocol) {
  const url = new URL(value);
  need(url.protocol === protocol && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname), "Loopback endpoints required");
  return url;
}
async function success(request, label) {
  const result = await request;
  need(!result.error, `${label} refused`);
  return result.data;
}
async function denied(request, label, codes = ["42501"]) {
  const result = await request;
  need(result.error && codes.includes(result.error.code), `${label} did not refuse as expected`);
}
async function hiddenRows(request, label) {
  const result = await request;
  need(result.error?.code === "42501" || (!result.error && Array.isArray(result.data) && result.data.length === 0), `${label} disclosed rows`);
}
function one(data) {
  const item = Array.isArray(data) ? (need(data.length === 1, "One RPC row expected"), data[0]) : data;
  need(item && uuid.test(item.id), "RPC identifier missing");
  return item;
}

async function main() {
  need(process.env.GITHUB_ACTIONS === "true" && process.env.CI === "true" && process.platform === "linux", "Disposable GitHub Actions Linux required");
  for (const name of ["SUPABASE_ACCESS_TOKEN", "DATABASE_URL", "SUPABASE_URL", "VERCEL", "DOCKER_HOST", "DOCKER_CONTEXT", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy", "npm_config_proxy", "npm_config_https_proxy"]) {
    need(!process.env[name], "Hosted, proxy or remote Docker configuration forbidden");
  }
  step = "local Supabase and database provenance";
  const dockerContext=JSON.parse(await captured("docker",["context","inspect"]));
  need(Array.isArray(dockerContext) && dockerContext.length===1 && dockerContext[0].Endpoints?.docker?.Host?.startsWith("unix:///"),"Docker context must use a local Unix socket");
  const status = JSON.parse(await captured(resolve("node_modules/.bin/supabase"), ["status", "--output", "json"]));
  const api = loopback(status.API_URL, "http:"), db = loopback(status.DB_URL, "postgresql:");
  need(!api.username && !api.password && api.pathname === "/" && !api.search && !api.hash && db.pathname === "/postgres" && /^\d+$/u.test(db.port), "Unexpected local endpoints");
  const publicKey = status.PUBLISHABLE_KEY || status.ANON_KEY, serverKey = status.SECRET_KEY || status.SERVICE_ROLE_KEY;
  need(publicKey && serverKey, "Local keys missing");
  const containers = (await captured("docker", ["ps", "--format", "{{.Names}}\t{{.Ports}}"]))
    .split(/\r?\n/u).map(line => line.split("\t"))
    .filter(([name, ports]) => /^supabase_db_[A-Za-z0-9_-]+$/u.test(name) && ports?.includes(`:${db.port}->5432/tcp`));
  need(containers.length === 1, "Local Supabase container not uniquely identified");
  database = containers[0][0];
  need(await sql(`select (to_regprocedure('public.app_review_invoice_manual_payment_claim(uuid,uuid,text,timestamptz,text,text)') is not null
    and to_regprocedure('public.app_submit_invoice_manual_payment_claim(uuid,uuid,uuid,text,text,bigint)') is not null
    and to_regprocedure('public.app_get_public_invoice_share(text)') is not null
    and to_regprocedure('private.fulfill_manual_invoice_claim(uuid)') is not null
    and not exists(select 1 from private.studio_push_configuration where enabled)
    and not exists(select 1 from private.push_subscriptions))::text;`) === "true", "Complete migrated disposable database without provider delivery required");
  need(await sql(`select count(*)=1 and bool_and(s.setdatabase=0 and setting='pgrst.db_pre_request=public.app_apply_client_support_context')
    from pg_db_role_setting s join pg_roles r on r.oid=s.setrole cross join lateral unnest(s.setconfig) setting
    where r.rolname='authenticator' and s.setdatabase in(0,(select oid from pg_database where datname=current_database())) and setting like 'pgrst.db_pre_request=%';`) === "t", "Existing request hook must remain active");
  const boundedFetch = (input, init = {}) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    need(url.origin === api.origin && !url.username && !url.password, "Request escaped owned local API");
    return fetch(input, { ...init, redirect: "error", signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000) });
  };
  const make = (key, token, selectedTenant = tenant) => createClient(api.origin, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: boundedFetch, headers: { "x-wf-tenant": selectedTenant, ...(token ? { Authorization: `Bearer ${token}` } : {}) } },
  });
  const trusted = make(serverKey), anonymous = make(publicKey);
  const accounts = [];
  step = "owned synthetic Auth identities";
  for (const [name, role, accountClass, targetCompany] of [["owner", "owner", "internal", null], ["reviewer", "staff", "internal", null], ["client", "client", "client", company], ["other", "client", "client", otherCompany], ["publisher", "staff", "internal", null]]) {
    const email = `invoice-rest-${name}-${randomUUID()}@example.invalid`, password = randomBytes(32).toString("base64url");
    const created = await trusted.auth.admin.createUser({ email, password, email_confirm: true });
    need(!created.error && uuid.test(created.data.user?.id ?? ""), "Synthetic Auth creation failed");
    accounts.push({ id: created.data.user.id, email, password, name, role, accountClass, company: targetCompany });
  }
  const [owner, reviewer, client, other, publisher] = accounts;
  await sql(`begin;
    insert into public.tenants(id,slug,display_name,status) values(:'tenant'::uuid,'invoice-rest-'||:'tenant','Synthetic Invoice REST','active'),(:'foreign'::uuid,'invoice-rest-'||:'foreign','Synthetic Foreign Invoice REST','active');
    insert into public.companies(id,tenant_id,name,status) values(:'company'::uuid,:'tenant'::uuid,'Synthetic invoice buyer','client'),(:'other_company'::uuid,:'tenant'::uuid,'Synthetic other invoice buyer','client');
    insert into public.tenant_memberships(tenant_id,profile_id,account_class,role_id,company_id)
      select :'tenant'::uuid,(a->>'id')::uuid,a->>'accountClass',r.id,(a->>'company')::uuid
      from jsonb_array_elements(:'actors'::jsonb) a join public.roles r on r.name=a->>'role';
    insert into public.profile_permission_overrides(tenant_id,profile_id,permission_key,allowed) values
      (:'tenant'::uuid,:'reviewer'::uuid,'invoices.view',true),(:'tenant'::uuid,:'reviewer'::uuid,'invoices.mark_paid',true),(:'tenant'::uuid,:'reviewer'::uuid,'projects.create',false);
    insert into public.services(id,tenant_id,name,price,currency,is_active,is_public,recurring)
      values(:'service'::uuid,:'tenant'::uuid,'Synthetic manually paid service',10,'USD',true,true,false);
    update public.company_wallets set balance_cents=10000 where company_id=:'company'::uuid;
    commit;`, { tenant, foreign: foreignTenant, company, other_company: otherCompany, reviewer: reviewer.id, service, actors: accounts.map(({ id, role, accountClass, company: actorCompany }) => ({ id, role, accountClass, company: actorCompany })) });
  for (const account of accounts) {
    const signed = await make(publicKey).auth.signInWithPassword({ email: account.email, password: account.password });
    need(!signed.error && signed.data.user?.id === account.id && signed.data.session?.access_token, "Real password sign-in failed");
    account.token = signed.data.session.access_token; account.api = make(publicKey, account.token);
  }
  const foreignClient = make(publicKey, client.token, foreignTenant);
  need((await success(owner.api.rpc("app_current_tenant_membership"), "Owner identity"))[0]?.role_name === "owner", "Owner membership mismatch");
  step = "published intake and manual collection configuration";
  const field = randomUUID();
  const form = one(await success(owner.api.rpc("app_create_form", { p_request_id: randomUUID(), p_payload: {
    form_type: "intake", canonical_key: `manual-rest-${randomUUID()}`, definition: { name: "Synthetic manual intake", title: "Synthetic manual intake", visibility: "assigned", type_config: {},
      fields: [{ stable_field_key: field, sort_order: 0, field_type: "text", label: "Brief", required: true, settings: {}, options: [], service_links: [] }], rules: [],
      service_links: [{ service_id: service, role: "intake_assignment", sort_order: 0, configuration: {} }] },
  } }), "Create synthetic intake"));
  await success(owner.api.rpc("app_publish_form", { p_request_id: randomUUID(), p_form_id: form.id }), "Publish intake");
  const version = await sql("select published_version_id from public.forms where id=:'form'::uuid;", { form: form.id }); need(uuid.test(version), "Published version absent");
  await success(owner.api.rpc("app_save_invoice_manual_payment_settings", { p_enabled: true, p_paypal_url: null, p_instructions: "Synthetic CI instructions only; do not send money." }), "Enable synthetic instructions");
  async function invoice(withService = false) {
    const item = { service_id: withService ? service : null, name: "Synthetic manual invoice", description: "Synthetic service scope", quantity: 1, unit_price_cents: 1000, unit_discount_cents: 0, is_taxable: false };
    const created = one(await success(owner.api.rpc("app_create_invoice", { p_request_id: randomUUID(), p_payload: { company_id: company, client_profile_id: client.id, currency: "USD", billing_reason: "manual", due_at: null, tax_total_cents: 0, items: [item] } }), "Create synthetic invoice"));
    await success(owner.api.rpc("app_issue_invoice", { p_invoice_id: created.id }), "Issue synthetic invoice");
    return created.id;
  }
  const mainInvoice = await invoice(true), duplicateInvoice = await invoice(), staleInvoice = await invoice(), raceInvoice = await invoice();
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jO+0AAAAASUVORK5CYII=", "base64");
  need(png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])), "Real PNG fixture signature");
  const checksum = sha256(png);
  async function prepare(id) {
    return one(await success(client.api.rpc("app_prepare_invoice_payment_receipt", { p_invoice_id: id, p_request_id: randomUUID(), p_filename: "manual-receipt.png", p_mime_type: "image/png", p_size_bytes: png.length, p_checksum_sha256: checksum }), "Reserve receipt"));
  }
  async function upload(receipt) {
    await success(trusted.storage.from(bucket).upload(receipt.path, png, { contentType: "image/png", upsert: false }), "Trusted private PNG upload");
    const bytes = await success(trusted.storage.from(bucket).download(receipt.path), "Trusted uploaded PNG readback");
    need(sha256(Buffer.from(await bytes.arrayBuffer())) === checksum, "Uploaded bytes changed");
  }
  const verify = receipt => trusted.rpc("app_verify_invoice_payment_receipt", { p_receipt_id: receipt.id, p_uploader_profile_id: client.id, p_checksum_sha256: checksum });
  async function receipt(id) { const reserved = await prepare(id); await upload(reserved); await success(verify(reserved), "Trusted verification"); return reserved; }
  const submit = (id, reserved, reference = null, expectedBalance = 1000, requestId = randomUUID()) => client.api.rpc("app_submit_invoice_manual_payment_claim", { p_request_id: requestId, p_invoice_id: id, p_receipt_id: reserved.id, p_method: "paypal", p_reference: reference, p_expected_balance_cents: expectedBalance });
  async function override(profile, permission, allowed) {
    await sql(`insert into public.profile_permission_overrides(tenant_id,profile_id,permission_key,allowed) values(:'tenant'::uuid,:'profile'::uuid,:'permission',:'allowed'::boolean)
      on conflict(tenant_id,profile_id,permission_key) do update set allowed=excluded.allowed;`, { tenant, profile, permission, allowed: String(allowed) });
  }
  step = "receipt authorization and live revocation checks";
  const firstReceipt = await prepare(mainInvoice); await upload(firstReceipt);
  need((await trusted.storage.from(bucket).upload(firstReceipt.path,png,{contentType:"image/png",upsert:false})).error,"Receipt object was overwritten");
  await denied(trusted.rpc("app_verify_invoice_payment_receipt",{p_receipt_id:firstReceipt.id,p_uploader_profile_id:client.id,p_checksum_sha256:"0".repeat(64)}),"Trusted verifier rejects checksum mismatch");
  await denied(client.api.rpc("app_verify_invoice_payment_receipt", { p_receipt_id: firstReceipt.id, p_uploader_profile_id: client.id, p_checksum_sha256: checksum }), "Client cannot verify receipt");
  await denied(owner.api.rpc("app_verify_invoice_payment_receipt", { p_receipt_id: firstReceipt.id, p_uploader_profile_id: client.id, p_checksum_sha256: checksum }), "Business Owner cannot use trusted-only verifier");
  await denied(submit(mainInvoice, firstReceipt), "Unverified receipt cannot report", ["55000"]);
  await denied(client.api.rpc("app_submit_invoice_manual_payment_claim", { p_request_id: randomUUID(), p_invoice_id: mainInvoice, p_receipt_id: null, p_method: "paypal", p_reference: null, p_expected_balance_cents: 1000 }), "Mandatory receipt", ["22023"]);
  await override(client.id, "invoices.view", false);
  for (let pass=0;pass<2;pass++) {
    await denied(client.api.rpc("app_get_invoice_manual_payment", { p_invoice_id: mainInvoice }), "Current client permission revocation");
    await denied(verify(firstReceipt), "Trusted verifier respects revoked owner");
  }
  await override(client.id, "invoices.view", true);
  await success(verify(firstReceipt), "Verification after permission restore");
  await sql("update public.tenant_memberships set archived_at=now() where tenant_id=:'tenant'::uuid and profile_id=:'client'::uuid;", { tenant, client: client.id });
  await denied(client.api.rpc("app_get_invoice_manual_payment", { p_invoice_id: mainInvoice }), "Archived client membership");
  await denied(verify(firstReceipt), "Trusted verification of inactive client");
  await sql("update public.tenant_memberships set archived_at=null where tenant_id=:'tenant'::uuid and profile_id=:'client'::uuid;", { tenant, client: client.id });
  await denied(other.api.rpc("app_get_invoice_manual_payment", { p_invoice_id: mainInvoice }), "Cross-company claims");
  await denied(foreignClient.rpc("app_get_invoice_manual_payment", { p_invoice_id: mainInvoice }), "Wrong Tenant claims");
  const rawUpload = await client.api.storage.from(bucket).upload(`${tenant}/${mainInvoice}/forbidden-${randomUUID()}`, png, { contentType: "image/png", upsert: false }); need(rawUpload.error, "Authenticated raw upload unexpectedly succeeded");
  const rawRead = await client.api.storage.from(bucket).download(firstReceipt.path); need(rawRead.error, "Authenticated raw receipt read unexpectedly succeeded");
  const ownerRawRead = await owner.api.storage.from(bucket).download(firstReceipt.path); need(ownerRawRead.error, "Owner raw Storage read unexpectedly succeeded");
  step = "pending declaration changes no financial or fulfillment state";
  const before = await sql(`select jsonb_build_object('wallet',(select balance_cents from public.company_wallets where company_id=:'company'::uuid),
    'payments',(select count(*) from public.invoice_payments where invoice_id=:'invoice'::uuid),'orders',(select count(*) from public.orders where tenant_id=:'tenant'::uuid))::text;`, { company, invoice: mainInvoice, tenant });
  await denied(submit(mainInvoice,firstReceipt,null,null),"Missing rendered balance guard",["22023"]);
  await denied(submit(mainInvoice,firstReceipt,null,900),"Stale rendered balance900 against actual1000",["55000"]);
  need(await sql(`select (select count(*) from private.invoice_manual_payment_claims where invoice_id=:'invoice'::uuid)=0
    and (select count(*) from public.invoice_payments where invoice_id=:'invoice'::uuid)=0
    and (select count(*) from public.orders where tenant_id=:'tenant'::uuid)=0;`,{invoice:mainInvoice,tenant}) === "t","Stale render created a claim/payment/Order");
  const mainClaimRequest=randomUUID();
  const claim = await success(submit(mainInvoice, firstReceipt,null,1000,mainClaimRequest), "Report externally paid invoice");
  need(claim.status === "pending" && claim.amount_cents === 1000 && claim.currency === "USD" && claim.reference === null, "Full balance/optional client reference differs");
  need(await sql(`select jsonb_build_object('wallet',(select balance_cents from public.company_wallets where company_id=:'company'::uuid),
    'payments',(select count(*) from public.invoice_payments where invoice_id=:'invoice'::uuid),'orders',(select count(*) from public.orders where tenant_id=:'tenant'::uuid))::text;`, { company, invoice: mainInvoice, tenant }) === before, "Pending claim changed money or Orders");
  need(await sql("select status='unpaid' from public.invoices where id=:'invoice'::uuid;", { invoice: mainInvoice }) === "t", "Pending report marked invoice paid");
  await success(client.api.rpc("app_get_invoice_payment_receipt", { p_receipt_id: firstReceipt.id }), "Claimant receipt metadata");
  await denied(other.api.rpc("app_get_invoice_payment_receipt", { p_receipt_id: firstReceipt.id }), "Other company receipt");
  await hiddenRows(client.api.from("invoice_payments").select("id").eq("invoice_id",mainInvoice), "Client raw ledger");
  need((await client.api.schema("private").from("invoice_manual_payment_claims").select("id")).error, "Private claims exposed through API");
  need((await client.api.schema("auth").from("users").select("id")).error, "Auth rows exposed through API");
  step = "two simultaneous distinct authorized reviews";
  const paidAt = new Date(Math.floor(Date.now()/1000)*1000).toISOString(), reference = `SYNTHETIC-${randomUUID()}`;
  const reviewArgs = actor => ({ p_request_id: randomUUID(), p_claim_id: claim.id, p_decision: "approve", p_paid_at: paidAt, p_reference: reference, p_reason: null, actor });
  const decisions = [reviewArgs(reviewer), reviewArgs(owner)];
  const decisionResults = await Promise.all(decisions.map(({actor,...args}) => actor.api.rpc("app_review_invoice_manual_payment_claim",args)));
  need(decisionResults.filter(result=>!result.error).length === 1, "Concurrent reviewers did not produce exactly one accepted decision");
  need(decisionResults.filter(result=>result.error).every(result=>result.error.code === "55000"), "Losing reviewer failed for unrelated reason");
  const winnerIndex = decisionResults.findIndex(result=>!result.error), approved = decisionResults[winnerIndex].data;
  need(approved.claim.status === "approved" && approved.order_ids.length === 1, "Approval did not provision one service Order");
  const {actor:winner,...sameDecision} = decisions[winnerIndex];
  assert.deepEqual(await success(winner.api.rpc("app_review_invoice_manual_payment_claim",sameDecision), "Exact approval retry"),approved,"Approval retry changed its receipt");
  const claimReplay=await success(submit(mainInvoice,firstReceipt,null,1000,mainClaimRequest),"Original rendered-balance claim retry after payment");
  need(claimReplay.id===claim.id && claimReplay.status==="approved" && claimReplay.payment_id===approved.claim.payment_id,"Accepted claim replay lost its original balance decision");
  await denied(submit(mainInvoice,firstReceipt,null,999,mainClaimRequest),"Changed expected balance on claim retry",["23505"]);
  need(await sql(`select (select count(*) from public.invoice_payments where invoice_id=:'invoice'::uuid and status='succeeded')=1
    and (select count(*) from public.invoice_items where invoice_id=:'invoice'::uuid and order_id=:'order'::uuid and fulfillment_status='provisioned')=1
    and (select count(*) from public.form_assignments where order_id=:'order'::uuid and client_profile_id=:'client'::uuid and form_version_id=:'version'::uuid and required)=1
    and (select count(*) from private.client_order_starts where order_id=:'order'::uuid)=1
    and (select count(*) from public.orders where tenant_id=:'tenant'::uuid)=1;`, { invoice: mainInvoice, order: approved.order_ids[0], client: client.id, version, tenant }) === "t", "Concurrent approval duplicated payment/Order or lost frozen intake");
  const gate = await success(client.api.rpc("app_request_my_order_start", {p_order_id:approved.order_ids[0]}),"Request manual Order start"); need(gate.started === false && gate.forms.length === 1,"Required intake did not gate Start");
  const formSubmission=one(await success(client.api.rpc("app_submit_form",{p_request_id:randomUUID(),p_form_version_id:version,
    p_context:{assignment_id:gate.forms[0].id},p_values:[{field_key:field,value:"Synthetic manually paid service brief"}],p_files:[]}),"Submit frozen manual-service intake"));
  const started=await success(client.api.rpc("app_reconcile_my_order_start",{p_assignment_id:gate.forms[0].id}),"Reconcile completed manual-service intake");
  need(started.started===true && started.status==="working","Completed required intake did not start requested Order");
  await override(reviewer.id,"invoices.mark_paid",false);
  for(let pass=0;pass<2;pass++) {
    await denied(reviewer.api.rpc("app_get_invoice_payment_receipt",{p_receipt_id:firstReceipt.id}),"Revoked reviewer receipt access");
    const {actor:ignored,...args}=decisions[0]; void ignored;
    await denied(reviewer.api.rpc("app_review_invoice_manual_payment_claim",args),"Current revoked reviewer approval/replay");
  }
  await override(reviewer.id,"invoices.mark_paid",true);
  step = "duplicate actual reconciliation reference";
  const duplicateReceipt = await receipt(duplicateInvoice), duplicateClaim = await success(submit(duplicateInvoice,duplicateReceipt,"Client reference is optional"),"Second report");
  await denied(owner.api.rpc("app_review_invoice_manual_payment_claim", { p_request_id:randomUUID(),p_claim_id:duplicateClaim.id,p_decision:"approve",p_paid_at:paidAt,p_reference:` ${reference.toUpperCase()} `,p_reason:null }),"Duplicate actual transfer reference",["23505"]);
  need(await sql("select count(*)=0 from public.invoice_payments where invoice_id=:'invoice'::uuid;",{invoice:duplicateInvoice}) === "t","Duplicate reconciliation wrote a payment");
  await success(owner.api.rpc("app_review_invoice_manual_payment_claim",{p_request_id:randomUUID(),p_claim_id:duplicateClaim.id,p_decision:"reject",p_paid_at:null,p_reference:null,p_reason:"Synthetic duplicate transfer review"}),"Reject duplicate report");
  await success(owner.api.rpc("app_void_invoice",{p_invoice_id:duplicateInvoice}),"Resolve synthetic duplicate Invoice");
  step = "wallet settlement makes reported balance stale";
  const staleReceipt=await receipt(staleInvoice),staleClaim=await success(submit(staleInvoice,staleReceipt),"Stale candidate report");
  await success(client.api.rpc("app_pay_invoice_with_wallet",{p_request_id:randomUUID(),p_invoice_id:staleInvoice}),"Owned synthetic wallet settlement");
  await denied(owner.api.rpc("app_review_invoice_manual_payment_claim",{p_request_id:randomUUID(),p_claim_id:staleClaim.id,p_decision:"approve",p_paid_at:paidAt,p_reference:`SYNTHETIC-${randomUUID()}`,p_reason:null}),"Stale approval after wallet settlement",["55000"]);
  await success(owner.api.rpc("app_review_invoice_manual_payment_claim",{p_request_id:randomUUID(),p_claim_id:staleClaim.id,p_decision:"reject",p_paid_at:null,p_reference:null,p_reason:"Synthetic wallet already settled"}),"Reject stale report");
  step = "actual wallet versus manual review race";
  const raceReceipt=await receipt(raceInvoice),raceClaim=await success(submit(raceInvoice,raceReceipt),"Race candidate report");
  const walletBeforeRace=Number(await sql("select balance_cents from public.company_wallets where company_id=:'company'::uuid;",{company}));
  const economicResults=await Promise.all([
    owner.api.rpc("app_review_invoice_manual_payment_claim",{p_request_id:randomUUID(),p_claim_id:raceClaim.id,p_decision:"approve",p_paid_at:paidAt,p_reference:`SYNTHETIC-${randomUUID()}`,p_reason:null}),
    client.api.rpc("app_pay_invoice_with_wallet",{p_request_id:randomUUID(),p_invoice_id:raceInvoice}),
  ]);
  need(economicResults.filter(result=>!result.error).length===1,"Wallet/review race did not accept exactly one settlement");
  if(economicResults[0].error) need(economicResults[0].error.code==="55000","Losing manual review failed for unrelated reason");
  if(economicResults[1].error) need(economicResults[1].error.code==="P0001" && economicResults[1].error.message.includes("WF_CARD_INVOICE_NOT_COLLECTIBLE"),"Losing wallet payment failed for unrelated reason");
  need(await sql("select count(*)=1 from public.invoice_payments where invoice_id=:'invoice'::uuid and status='succeeded';",{invoice:raceInvoice}) === "t","Wallet/review race overpaid");
  const walletWon=!economicResults[1].error;
  need(Number(await sql("select balance_cents from public.company_wallets where company_id=:'company'::uuid;",{company}))===walletBeforeRace-(walletWon?1000:0),"Losing race debited wallet or accepted wallet debit differs");
  need(Number(await sql("select count(*) from public.company_wallet_transactions where invoice_id=:'invoice'::uuid;",{invoice:raceInvoice}))===(walletWon?1:0),"Wallet race ledger entry count differs");
  if(economicResults[0].error) await success(owner.api.rpc("app_review_invoice_manual_payment_claim",{p_request_id:randomUUID(),p_claim_id:raceClaim.id,p_decision:"reject",p_paid_at:null,p_reference:null,p_reason:"Synthetic wallet won race"}),"Resolve losing manual race claim");
  step = "public hashed-only capability and limited projection";
  const token=randomBytes(32).toString("hex"),tokenHash=sha256(token);
  const link=await success(owner.api.rpc("app_create_invoice_share_link",{p_request_id:randomUUID(),p_invoice_id:mainInvoice,p_token_sha256:tokenHash}),"Create synthetic public capability");
  const publicInvoice=await success(anonymous.rpc("app_get_public_invoice_share",{p_token:token}),"Limited anonymous invoice read");
  assert.deepEqual(Object.keys(publicInvoice).sort(),["invoice","settings"]);
  assert.deepEqual(Object.keys(publicInvoice.settings).sort(),["enabled","instructions","paypal_url"]);
  const allowedInvoiceKeys=["id","tenant_id","number","company_name","status","currency","subtotal_cents","discount_total_cents","tax_total_cents","total_cents","balance_due_cents","successful_paid_cents","issued_at","due_at","payment_reported","items"];
  need(Object.keys(publicInvoice.invoice).every(key=>allowedInvoiceKeys.includes(key)),"Public projection added an unauthorized field");
  need(publicInvoice.invoice.id===mainInvoice && publicInvoice.invoice.total_cents===1000 && publicInvoice.invoice.balance_due_cents===0,"Public projection is not the paid synthetic invoice");
  need(publicInvoice.invoice.items.every(item=>Object.keys(item).every(key=>["name","description","quantity","unit_price_cents","total_cents"].includes(key))),"Public item exposed workspace or private data");
  const publicText=JSON.stringify(publicInvoice);
  need(!publicText.includes(firstReceipt.path) && !publicText.includes(firstReceipt.id) && !publicText.includes(checksum) && !publicText.includes(client.id) && !publicText.includes(client.email),"Public capability exposed proof or client identity");
  need(!/"(?:receipt|receipt_id|receipt_name|pdf|wallet|history|payment_id|token_sha256|client_profile_id|address|email)"/u.test(publicText),"Private fields exposed publicly");
  need(await sql("select token_sha256=:'hash' and token_sha256<>:'token' and expires_at-created_at=interval '30 days' from private.invoice_share_links where id=:'link'::uuid;",{hash:tokenHash,token,link:link.id}) === "t","Share storage or TTL differs");
  await hiddenRows(anonymous.from("invoices").select("id").eq("id",mainInvoice),"Anonymous raw Invoice");
  await denied(anonymous.rpc("app_get_invoice_payment_receipt",{p_receipt_id:firstReceipt.id}),"Anonymous receipt API");
  await denied(anonymous.rpc("app_get_form_submission_pdf",{p_submission_id:formSubmission.id,p_include_project:true}),"Anonymous real submitted-form PDF API");
  need((await anonymous.storage.from(bucket).download(firstReceipt.path)).error,"Anonymous Storage proof readable");
  await success(owner.api.rpc("app_save_invoice_manual_payment_settings",{p_enabled:false,p_paypal_url:null,p_instructions:"Synthetic CI instructions only; do not send money."}),"Disable manual instructions");
  const disabled=await success(anonymous.rpc("app_get_public_invoice_share",{p_token:token}),"Public invoice with collection disabled");
  need(disabled.settings.enabled===false && disabled.settings.paypal_url===null && disabled.settings.instructions==="","Disabled collection exposed instructions");
  await sql("update public.tenants set status='suspended' where id=:'tenant'::uuid;",{tenant});
  await denied(anonymous.rpc("app_get_public_invoice_share",{p_token:token}),"Suspended Tenant public capability",["P0002"]);
  await sql("update public.tenants set status='active' where id=:'tenant'::uuid;",{tenant});
  step = "published Invoice module disables an existing public link";
  // A separate owned publisher uses the existing privileged writer and real synthetic Auth identity.
  const publisherClaims=JSON.parse(Buffer.from(publisher.token.split(".")[1],"base64url").toString("utf8"));
  need(publisherClaims.sub===publisher.id,"Synthetic publisher identity mismatch");
  await sql("select private.grant_platform_admin(:'publisher'::uuid,'Synthetic Invoice REST publisher');",{publisher:publisher.id});
  await sql(`begin;
    select set_config('request.jwt.claim.sub',:'publisher',true);
    select set_config('request.jwt.claims',:'claims',true);
    select set_config('request.headers',jsonb_build_object('x-wf-tenant',:'tenant')::text,true);
    select private.publish_tenant_modules(:'tenant'::uuid,0,array_agg(module_key order by module_key) filter(where module_key not in('subscriptions','invoices','coupons')),'Synthetic Invoice REST OFF fixture') from private.white_label_modules;
    commit;`,{tenant,publisher:publisher.id,claims:publisherClaims});
  await denied(anonymous.rpc("app_get_public_invoice_share",{p_token:token}),"Invoice module OFF public capability",["P0002"]);
  await sql(`begin;
    select set_config('request.jwt.claim.sub',:'publisher',true);
    select set_config('request.jwt.claims',:'claims',true);
    select set_config('request.headers',jsonb_build_object('x-wf-tenant',:'tenant')::text,true);
    select private.publish_tenant_modules(:'tenant'::uuid,1,array_agg(module_key order by module_key),'Synthetic Invoice REST restored fixture') from private.white_label_modules;
    commit;`,{tenant,publisher:publisher.id,claims:publisherClaims});
  await success(anonymous.rpc("app_get_public_invoice_share",{p_token:token}),"Public capability after module restoration");
  await sql("select private.revoke_platform_admin(:'publisher'::uuid,'Synthetic Invoice REST publisher complete');",{publisher:publisher.id});
  step = "public capability revocation and expiry";
  await success(owner.api.rpc("app_revoke_invoice_share_link",{p_link_id:link.id}),"Revoke public capability");
  await denied(anonymous.rpc("app_get_public_invoice_share",{p_token:token}),"Revoked capability",["P0002"]);
  const expiredToken=randomBytes(32).toString("hex");
  await sql(`insert into private.invoice_share_links(tenant_id,invoice_id,created_by_profile_id,request_id,token_sha256,created_at,expires_at)
    values(:'tenant'::uuid,:'invoice'::uuid,:'owner'::uuid,:'request'::uuid,:'hash',now()-interval '31 days',now()-interval '1 day');`,{tenant,invoice:mainInvoice,owner:owner.id,request:randomUUID(),hash:sha256(expiredToken)});
  await denied(anonymous.rpc("app_get_public_invoice_share",{p_token:expiredToken}),"Expired capability",["P0002"]);
  need(await sql(`select not has_table_privilege('authenticated','private.invoice_manual_payment_claims','SELECT')
    and not has_table_privilege('authenticated','private.invoice_payment_receipts','SELECT')
    and not has_table_privilege('anon','private.invoice_share_links','SELECT')
    and not has_function_privilege('authenticated','public.app_verify_invoice_payment_receipt(uuid,uuid,text)','EXECUTE');`) === "t","Raw data/trusted verification grants widened");
  console.log("PASS disposable local Auth/receipt Storage authorization, live revocation, full manual claim/review, real concurrent reviewers and wallet race, exact-once Order/frozen intake, reference deduplication, and limited hashed/expiring/revoked public invoice capabilities");
}
try { await main(); }
catch { console.error(`FAIL invoice manual-payment REST integration during ${step}${sqlFailureState ? ` (SQLSTATE ${sqlFailureState})` : ""}; credential, command and response details withheld`); process.exitCode=1; }
