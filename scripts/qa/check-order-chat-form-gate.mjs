import { randomUUID } from "node:crypto";

// Called only after check-client-support-rest's disposable-runner and real Auth guards.
export async function checkOrderChatFormGate({ sql, tenant, owner, client, sibling, other, supportApi, need, success, denied, waitFor }) {
  const service = randomUUID(), emptyOrder = randomUUID(), attachment = randomUUID();
  await sql(`insert into public.services(id,tenant_id,name,price,currency,is_active,is_public,recurring)
    values(:'service'::uuid,:'tenant'::uuid,'Synthetic chat gate',10,'USD',true,true,false);
    insert into public.orders(id,tenant_id,company_id,service_id,title)
    values(:'order'::uuid,:'tenant'::uuid,:'company'::uuid,:'service'::uuid,'Synthetic no-required-forms order');
    update public.company_wallets set balance_cents=balance_cents+10000 where company_id=:'company'::uuid;`,
  { service, tenant, company: client.company, order: emptyOrder });
  const eligible = (api, order) => success(api.rpc("app_my_order_chat_available", { p_order_id: order }), "Authoritative chat eligibility");
  need(await eligible(client.api, emptyOrder) === true, "No-form order must remain available");
  await success(client.api.rpc("app_get_order_conversation_page", { p_order_id: emptyOrder }), "No-form conversation");

  const createRequirement = async (n) => {
    const field = randomUUID();
    const form = await success(owner.api.rpc("app_create_form", { p_request_id: randomUUID(), p_payload: {
      form_type: "intake", canonical_key: `chat-gate-${randomUUID()}`, definition: {
        name: `Synthetic chat requirement ${n}`, title: `Synthetic chat requirement ${n}`, visibility: "assigned", type_config: {},
        fields: [{ stable_field_key: field, sort_order: 0, field_type: "text", label: "Business", required: true }],
        rules: [], service_links: [{ service_id: service, role: "intake_assignment", sort_order: 0, configuration: {} }],
      },
    } }), "Chat-gate intake creation");
    await success(owner.api.rpc("app_publish_form", { p_request_id: randomUUID(), p_form_id: form.id }), "Chat-gate publication");
    return { form: form.id, field };
  };
  const requirements = [await createRequirement(0), await createRequirement(1)];
  await sql("insert into private.client_order_start_rollout(tenant_id,service_id,enabled) values(:'tenant'::uuid,:'service'::uuid,true);", { tenant, service });
  const purchased = await success(client.api.rpc("app_purchase_service_with_balance", { p_request_id: randomUUID(), p_service_id: service }), "Synthetic gated purchase");
  const order = purchased[0]?.order_id;
  need(typeof order === "string", "Purchase order missing");
  need(await sql("select count(*)=1 from public.project_messages where order_id=:'order'::uuid and author_type='system' and author_profile_id is null;", { order }) === "t", "Gated purchase must persist its trusted system receipt");
  const staffRequest = randomUUID();
  await success(owner.api.rpc("app_send_order_message", { p_order_id: order, p_request_id: staffRequest, p_body: "Staff can work before intake" }), "Staff access before intake");
  const source = await sql("select id from public.project_messages where order_id=:'order'::uuid and request_id=:'request'::uuid;", { order, request: staffRequest });
  need(/^[a-f0-9-]{36}$/u.test(source), "Saved staff message is missing");
  await sql(`insert into public.project_attachments(id,order_id,project_message_id,storage_object_key,original_name,mime_type,size_bytes,checksum_sha256,scan_status)
    values(:'attachment'::uuid,:'order'::uuid,:'message'::uuid,:'key','Synthetic.txt','text/plain',4,repeat('a',64),'clean');`,
  { attachment, order, message: source, key: `synthetic-chat-gate/${attachment}` });

  const blocked = async (api) => {
    need(await eligible(api, order) === false, "Incomplete requirements opened chat");
    for (const name of ["app_get_order_conversation_page", "app_get_order_conversation", "app_get_project_conversation"]) {
      await denied(api.rpc(name, { p_order_id: order }), "Locked conversation read");
    }
    await denied(api.rpc("app_send_order_message", { p_order_id: order, p_request_id: randomUUID(), p_body: "Blocked send" }), "Locked send");
    await denied(api.rpc("app_reply_to_order_message", { p_order_id: order, p_request_id: randomUUID(), p_body: "Blocked quote", p_reply_to_message_id: source }), "Locked reply");
    await denied(api.rpc("app_toggle_order_message_reaction", { p_order_id: order, p_message_id: source, p_reaction_code: "like" }), "Locked reaction");
    await denied(api.rpc("app_prepare_ticket_attachment", { p_order_id: order, p_request_id: randomUUID() }), "Locked attachment preparation");
    await denied(api.rpc("app_send_ticket_message_with_attachment", { p_order_id: order, p_request_id: randomUUID(), p_body: "Blocked attachment",
      p_original_name: "Synthetic.txt", p_mime_type: "application/pdf", p_size_bytes: 4, p_checksum_sha256: "a".repeat(64) }), "Locked attachment send");
    await denied(api.rpc("app_get_ticket_attachment_download", { p_attachment_id: attachment }), "Locked attachment metadata");
    await denied(api.rpc("app_set_client_conversation_presence", { p_conversation_type: "project", p_conversation_id: order, p_active: true }), "Locked presence");
  };
  await blocked(client.api);
  await blocked(sibling.api);
  await blocked(supportApi);
  await denied(client.api.rpc("app_order_call_history", { p_order_id: order }), "Locked call history");
  const foreign = await other.api.rpc("app_my_order_chat_available", { p_order_id: order });
  need(foreign.error?.code === "P0002", "Wrong company eligibility disclosed order");
  await success(client.api.rpc("app_request_my_order_start", { p_order_id: order }), "Persisted start request");
  need(await eligible(client.api, order) === false, "Start click opened chat");
  const assignments = await success(client.api.rpc("app_list_assigned_forms"), "Required intake navigation");
  const submit = async (requirement, targetOrder = order) => {
    const rows = await success(client.api.rpc("app_list_assigned_forms"), "Current required intake navigation");
    const assignment = rows.find(row => row.order_id === targetOrder && row.form_id === requirement.form);
    need(assignment, "Required assignment missing from existing workflow");
    const result = await success(client.api.rpc("app_submit_form", { p_request_id: randomUUID(), p_form_version_id: assignment.form_version_id,
      p_context: { assignment_id: assignment.assignment_id }, p_values: [{ field_key: requirement.field, value: "Synthetic business" }], p_files: [] }), "Required submission");
    return result;
  };
  await success(client.api.rpc("app_save_intake_draft", { p_assignment_id: assignments.find(a => a.order_id === order).assignment_id, p_values: [] }), "Draft is not submission");
  need(await eligible(client.api, order) === false, "Draft opened chat");
  await submit(requirements[0]);
  need(await eligible(client.api, order) === false, "Partial completion opened chat");
  await submit(requirements[1]);
  for (const api of [client.api, sibling.api, supportApi]) {
    need(await eligible(api, order) === true, "Final completion did not unlock company chat");
    const page = await success(api.rpc("app_get_order_conversation_page", { p_order_id: order }), "Unlocked paged conversation");
    need(page.messages.some(message => message.body === "Staff can work before intake") && page.messages.length <= 10, "Unlocked page lost bounded history");
  }
  await success(client.api.rpc("app_get_ticket_attachment_download", { p_attachment_id: attachment }), "Attachment metadata resumes after final submission");
  await success(client.api.rpc("app_prepare_ticket_attachment", { p_order_id: order, p_request_id: randomUUID() }), "Attachment preparation resumes after final submission");
  await success(client.api.rpc("app_order_call_history", { p_order_id: order }), "Call history resumes after final submission");
  await success(client.api.rpc("app_send_order_message", { p_order_id: order, p_request_id: randomUUID(), p_body: "Unlocked client send" }), "Unlocked write");
  // Body/payload input cannot choose authorship in any client-callable message writer.
  const claimedSystem = JSON.stringify({ author_type: "system", author_profile_id: null });
  const forgedTicket = await client.api.rpc("app_create_ticket", { p_request_id: randomUUID(), p_payload: {
    subject: "Synthetic forged author", message: claimedSystem, author_type: "system", author_profile_id: null,
  } });
  need(forgedTicket.error?.code === "22023", "Ticket payload accepted caller-chosen authorship");
  await denied(client.api.from("project_messages").insert({ order_id: order, author_type: "system", author_profile_id: null, body: claimedSystem }), "Raw Project system-message forgery");
  const nativeRequests = [randomUUID(), randomUUID()];
  await success(client.api.rpc("app_send_order_message", { p_order_id: order, p_request_id: nativeRequests[0], p_body: claimedSystem }), "Actor-owned native send");
  await success(client.api.rpc("app_reply_to_order_message", { p_order_id: order, p_request_id: nativeRequests[1], p_body: claimedSystem, p_reply_to_message_id: source }), "Actor-owned native reply");
  const ticketRequests = [randomUUID(), randomUUID(), randomUUID()];
  const ownTicket = await success(client.api.rpc("app_create_ticket", { p_request_id: ticketRequests[0], p_payload: {
    subject: "Synthetic actor-owned Ticket", message: claimedSystem,
  } }), "Actor-owned Ticket creation");
  need(typeof ownTicket.id === "string", "Actor-owned Ticket missing");
  const firstTicketMessage = await sql("select id from public.ticket_messages where ticket_id=:'ticket'::uuid and request_id=:'request'::uuid;", { ticket: ownTicket.id, request: ticketRequests[0] });
  await denied(client.api.from("ticket_messages").insert({ ticket_id: ownTicket.id, author_type: "system", author_profile_id: null, message_kind: "reply", visibility: "client", body: claimedSystem }), "Raw Ticket system-message forgery");
  await success(client.api.rpc("app_reply_to_ticket", { p_ticket_id: ownTicket.id, p_request_id: ticketRequests[1], p_body: claimedSystem }), "Actor-owned Ticket reply");
  await success(client.api.rpc("app_reply_to_ticket_message", { p_ticket_id: ownTicket.id, p_request_id: ticketRequests[2], p_body: claimedSystem, p_reply_to_message_id: firstTicketMessage }), "Actor-owned Ticket quoted reply");
  const attachmentRequests = [randomUUID(), randomUUID()];
  for (const [index, target] of [{ p_order_id: order }, { p_ticket_id: ownTicket.id }].entries()) {
    const request = attachmentRequests[index];
    const prepared = await success(client.api.rpc("app_prepare_ticket_attachment", { ...target, p_request_id: request }), "Actor-owned attachment preparation");
    need(typeof prepared.storage_key === "string", "Synthetic attachment key missing");
    await sql("insert into storage.objects(bucket_id,name) values('ticket-attachments',:'key');", { key: prepared.storage_key });
    await success(client.api.rpc("app_send_ticket_message_with_attachment", { ...target, p_request_id: request, p_body: claimedSystem,
      p_original_name: "Synthetic.pdf", p_mime_type: "application/pdf", p_size_bytes: 4, p_checksum_sha256: "a".repeat(64) }), "Actor-owned attachment send");
  }
  const authoredRequests = [...nativeRequests, ...ticketRequests, ...attachmentRequests];
  need(await sql(`select count(*)=7 and bool_and(author_type='client' and author_profile_id=:'client'::uuid)
    from (select author_type,author_profile_id,request_id from public.project_messages where order_id=:'order'::uuid
      union all select author_type,author_profile_id,request_id from public.ticket_messages where ticket_id=:'ticket'::uuid) authored
    where request_id in (select value::uuid from jsonb_array_elements_text(:'requests'::jsonb));`,
  { order, ticket: ownTicket.id, client: client.id, requests: authoredRequests }) === "t", "A client-callable message writer accepted forged system authorship");
  const extra = await createRequirement(2), extraAssignment = randomUUID(), blockedRequest = randomUUID();
  const lockName = `wf-chat-gate-${randomUUID()}`;
  const blocker = sql(`set application_name=:'name'; begin;
    select 1 from public.tenants where id=:'tenant'::uuid for update;
    insert into public.form_assignments(id,form_id,form_version_id,company_id,client_profile_id,order_id,assigned_by_profile_id)
    select :'assignment'::uuid,id,published_version_id,:'company'::uuid,:'client'::uuid,:'order'::uuid,:'owner'::uuid
      from public.forms where id=:'form'::uuid;
    select pg_sleep(6); commit;`,
  { name: lockName, tenant, assignment: extraAssignment, company: client.company, client: client.id, order, owner: owner.id, form: extra.form }).then(() => true, () => false);
  await waitFor(async () => await sql("select exists(select 1 from pg_stat_activity where application_name=:'name' and wait_event='PgSleep');", { name: lockName }) === "t", "Staff assignment holds the shared Tenant lock");
  const waitingSend = client.api.rpc("app_send_order_message", { p_order_id: order, p_request_id: blockedRequest, p_body: "Must not cross a newly committed requirement" }).then(result => result);
  await waitFor(async () => await sql("select exists(select 1 from pg_stat_activity where wait_event_type='Lock' and query like '%app_send_order_message%');") === "t", "Real client send waits after its early eligibility check");
  need(await blocker, "Synthetic assignment transaction failed");
  await denied(waitingSend, "Post-lock write trigger rechecks newly required intake");
  need(await sql("select not exists(select 1 from public.project_messages where order_id=:'order'::uuid and request_id=:'request'::uuid);", { order, request: blockedRequest }) === "t", "A stale admitted send persisted after the requirement committed");
  await submit(extra);
  need(await eligible(client.api, order) === true, "Later required submission did not restore chat");
  // The pre-rollout order has required intake but no frozen start row.
  await success(owner.api.rpc("app_assign_form", { p_request_id: randomUUID(), p_form_id: requirements[0].form, p_context: { order_id: emptyOrder, client_profile_id: client.id } }), "Legacy required assignment");
  need(await eligible(client.api, emptyOrder) === false, "Legacy intake failed open");
  const ticket = randomUUID();
  await sql(`insert into public.tickets(id,tenant_id,order_id,company_id,client_profile_id,subject,created_by_profile_id)
    values(:'ticket'::uuid,:'tenant'::uuid,:'order'::uuid,:'company'::uuid,:'client'::uuid,'Synthetic linked chat',:'owner'::uuid);`,
  { ticket, tenant, order: emptyOrder, company: client.company, client: client.id, owner: owner.id });
  const linkedRequest = randomUUID();
  await success(owner.api.rpc("app_reply_to_ticket", { p_request_id: linkedRequest, p_ticket_id: ticket, p_body: "Staff linked history before intake" }), "Staff linked Ticket access");
  const linkedMessage = await sql("select id from public.ticket_messages where ticket_id=:'ticket'::uuid and request_id=:'request'::uuid;", { ticket, request: linkedRequest });
  await denied(client.api.rpc("app_get_ticket_detail_with_avatars", { p_ticket_id: ticket }), "Locked linked Ticket reader");
  await denied(client.api.rpc("app_reply_to_ticket", { p_ticket_id: ticket, p_request_id: randomUUID(), p_body: "Blocked linked send" }), "Locked linked Ticket write");
  await denied(client.api.from("ticket_messages").select("id").eq("ticket_id", ticket), "Existing raw Ticket message ACL stays closed");
  await submit(requirements[0], emptyOrder);
  need(await eligible(client.api, emptyOrder) === true, "Legacy final submission did not unlock chat");
  const linkedPage = await success(client.api.rpc("app_get_order_conversation_page", { p_order_id: emptyOrder }), "Unlocked linked Ticket page");
  need(linkedPage.messages.some(row => row.id === linkedMessage), "Submitted intake did not reveal the formerly protected linked message");
  await denied(client.api.from("ticket_messages").select("id").eq("ticket_id", ticket), "Unlock does not broaden the raw Ticket message ACL");
  need(await sql("select not exists(select 1 from private.client_order_starts where order_id=:'order'::uuid);", { order: emptyOrder }) === "t", "Legacy acceptance backfilled a gate");
  console.log("PASS real Auth gated purchase receipt, client/company-member/support chat gate, direct reads/writes/quotes/reactions/attachments/presence, caller-authorship forgery denial, partial/final/legacy completion, post-lock admission race and linked Ticket authority/ACLs (disposable CI only)");
}
