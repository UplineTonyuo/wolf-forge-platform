import { randomUUID } from "node:crypto";

// Called only after check-client-support-rest's disposable-runner and real Auth guards.
export async function checkOrderChatFormGate({ sql, tenant, owner, client, sibling, other, supportApi, need, success, denied }) {
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

  const requirements = [];
  for (let n = 0; n < 2; n++) {
    const field = randomUUID();
    const form = await success(owner.api.rpc("app_create_form", { p_request_id: randomUUID(), p_payload: {
      form_type: "intake", canonical_key: `chat-gate-${randomUUID()}`, definition: {
        name: `Synthetic chat requirement ${n}`, title: `Synthetic chat requirement ${n}`, visibility: "assigned", type_config: {},
        fields: [{ stable_field_key: field, sort_order: 0, field_type: "text", label: "Business", required: true }],
        rules: [], service_links: [{ service_id: service, role: "intake_assignment", sort_order: 0, configuration: {} }],
      },
    } }), "Chat-gate intake creation");
    await success(owner.api.rpc("app_publish_form", { p_request_id: randomUUID(), p_form_id: form.id }), "Chat-gate publication");
    requirements.push({ form: form.id, field });
  }
  await sql("insert into private.client_order_start_rollout(tenant_id,service_id,enabled) values(:'tenant'::uuid,:'service'::uuid,true);", { tenant, service });
  const purchased = await success(client.api.rpc("app_purchase_service_with_balance", { p_request_id: randomUUID(), p_service_id: service }), "Synthetic gated purchase");
  const order = purchased[0]?.order_id;
  need(typeof order === "string", "Purchase order missing");
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
    const rows = targetOrder === order ? assignments : await success(client.api.rpc("app_list_assigned_forms"), "Legacy intake navigation");
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
  await success(client.api.rpc("app_order_call_history", { p_order_id: order }), "Call history resumes after final submission");
  await success(client.api.rpc("app_send_order_message", { p_order_id: order, p_request_id: randomUUID(), p_body: "Unlocked client send" }), "Unlocked write");
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
  const rows = await success(client.api.from("ticket_messages").select("id").eq("ticket_id", ticket), "Linked Ticket RLS");
  need(rows.length === 0, "Locked linked Ticket rows disclosed");
  await submit(requirements[0], emptyOrder);
  need(await eligible(client.api, emptyOrder) === true, "Legacy final submission did not unlock chat");
  await success(client.api.rpc("app_get_order_conversation_page", { p_order_id: emptyOrder }), "Unlocked linked Ticket page");
  const visibleRows = await success(client.api.from("ticket_messages").select("id").eq("ticket_id", ticket), "Unlocked linked Ticket RLS");
  need(visibleRows.some(row => row.id === linkedMessage), "Submitted intake did not reveal the formerly protected linked message");
  need(await sql("select not exists(select 1 from private.client_order_starts where order_id=:'order'::uuid);", { order: emptyOrder }) === "t", "Legacy acceptance backfilled a gate");
  console.log("PASS real Auth client/company-member/support chat gate, direct reads/writes/quotes/reactions/attachment metadata/presence, partial/final/legacy completion and linked Ticket RLS (disposable CI only)");
}
