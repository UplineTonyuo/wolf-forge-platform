begin;
select plan(20);

-- -----------------------------------------------------------------------------
-- Fixtures: two companies so client-side authorization can be exercised across
-- a real company boundary, matching the architecture's client access model.
-- -----------------------------------------------------------------------------

insert into auth.users (id, aud, role, email, created_at, updated_at) values
  ('fb000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'attach-owner@example.invalid', now(), now()),
  ('fb000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'attach-client-a@example.invalid', now(), now()),
  ('fb000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'attach-client-b@example.invalid', now(), now());

insert into public.companies (id, name, status) values
  ('fb100000-0000-4000-8000-000000000001', 'Attachment Co A', 'client'),
  ('fb100000-0000-4000-8000-000000000002', 'Attachment Co B', 'client');

update public.profiles set role_id = (select id from public.roles where name = 'owner'), display_name = 'Attach Owner'
where id = 'fb000000-0000-4000-8000-000000000001';
update public.profiles set role_id = (select id from public.roles where name = 'client'),
  company_id = 'fb100000-0000-4000-8000-000000000001', display_name = 'Attach Client A'
where id = 'fb000000-0000-4000-8000-000000000002';
update public.profiles set role_id = (select id from public.roles where name = 'client'),
  company_id = 'fb100000-0000-4000-8000-000000000002', display_name = 'Attach Client B'
where id = 'fb000000-0000-4000-8000-000000000003';

insert into public.orders (id, company_id, service_id, title) values (
  'fb200000-0000-4000-8000-000000000001',
  'fb100000-0000-4000-8000-000000000001',
  (select id from public.services where archived_at is null and tenant_id = private.wolf_forge_tenant_id() order by id limit 1),
  'Attachment Project A'
);

create or replace function pg_temp.become(p_user uuid)
returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

-- -----------------------------------------------------------------------------
-- Structure and security surface
-- -----------------------------------------------------------------------------

select ok(
  to_regprocedure('public.app_prepare_ticket_attachment(uuid,uuid,uuid,uuid)') is not null
  and to_regprocedure('public.app_send_ticket_message_with_attachment(uuid,uuid,uuid,text,uuid,text,text,bigint,text)') is not null
  and to_regprocedure('public.app_get_ticket_attachment_download(uuid)') is not null,
  'Project conversation attachment RPCs exist'
);
select ok(
  not has_function_privilege('anon', 'public.app_prepare_ticket_attachment(uuid,uuid,uuid,uuid)', 'execute')
  and not has_function_privilege('anon', 'public.app_send_ticket_message_with_attachment(uuid,uuid,uuid,text,uuid,text,text,bigint,text)', 'execute')
  and not has_function_privilege('anon', 'public.app_get_ticket_attachment_download(uuid)', 'execute'),
  'anonymous callers cannot reach attachment RPCs'
);

set local role authenticated;
select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner)
    values ('ticket-attachments', 'fb000000-0000-4000-8000-000000000001/hostile-path', 'fb000000-0000-4000-8000-000000000001')$$,
  null, null,
  'an authenticated client cannot pick an arbitrary storage path directly; only the trusted server path may write'
);
reset role;

-- -----------------------------------------------------------------------------
-- Authorized upload: order target with no Ticket yet, attachment-only draft
-- -----------------------------------------------------------------------------

set local role authenticated;
select pg_temp.become('fb000000-0000-4000-8000-000000000001');

select is(
  (select (public.app_prepare_ticket_attachment(
     'fc000000-0000-4000-8000-000000000001', null, 'fb200000-0000-4000-8000-000000000001', null
   ) ->> 'storage_key')),
  'fb000000-0000-4000-8000-000000000001/fc000000-0000-4000-8000-000000000001',
  'prepare derives a server-side path from the actor and request id, not a client-chosen value'
);
reset role;

-- Trusted server write: the app layer uploads with the service role key.
set local role service_role;
insert into storage.objects (bucket_id, name, owner) values (
  'ticket-attachments',
  'fb000000-0000-4000-8000-000000000001/fc000000-0000-4000-8000-000000000001',
  'fb000000-0000-4000-8000-000000000001'
);
reset role;

set local role authenticated;
select pg_temp.become('fb000000-0000-4000-8000-000000000001');
-- Raw ticket_messages/tickets rows stay behind safe read models (revoked from
-- every browser-reachable role), so linkage is verified against the RPC's own
-- return payload and the ticket_attachments row it wrote, never a raw join.
create temp table attach_result as
select public.app_send_ticket_message_with_attachment(
  'fc000000-0000-4000-8000-000000000001', null, 'fb200000-0000-4000-8000-000000000001',
  'See attached.', null, 'brief.pdf', 'application/pdf', 1024, repeat('a1', 32)
) as payload;
reset role;

select ok(
  (select payload ->> 'ticket_id' from attach_result) is not null
  and (select payload ->> 'message_id' from attach_result) is not null
  and (select payload ->> 'attachment_id' from attach_result) is not null,
  'authorized attachment send succeeds in the native Project conversation'
);
select is(
  (select count(*) from public.project_attachments where storage_object_key = 'fb000000-0000-4000-8000-000000000001/fc000000-0000-4000-8000-000000000001'),
  1::bigint,
  'exactly one canonical attachment row is written, no duplicate'
);
select is(
  (select att.project_message_id::text from public.project_attachments att
   where att.storage_object_key = 'fb000000-0000-4000-8000-000000000001/fc000000-0000-4000-8000-000000000001'),
  (select payload ->> 'message_id' from attach_result),
  'attachment links to the exact message it was sent with'
);
select is(
  (select att.order_id::text from public.project_attachments att where att.storage_object_key = 'fb000000-0000-4000-8000-000000000001/fc000000-0000-4000-8000-000000000001'),
  (select payload ->> 'ticket_id' from attach_result),
  'attachment links directly to the canonical Project conversation'
);
select is(
  (select original_name from public.project_attachments where storage_object_key = 'fb000000-0000-4000-8000-000000000001/fc000000-0000-4000-8000-000000000001'),
  'brief.pdf',
  'original filename is preserved'
);
select is(
  (select uploaded_by_profile_id from public.project_attachments where storage_object_key = 'fb000000-0000-4000-8000-000000000001/fc000000-0000-4000-8000-000000000001'),
  'fb000000-0000-4000-8000-000000000001'::uuid,
  'uploader is the real authenticated actor, never client-supplied'
);

-- -----------------------------------------------------------------------------
-- Server-side validation rejects what the client-side policy should never send
-- -----------------------------------------------------------------------------

set local role authenticated;
select pg_temp.become('fb000000-0000-4000-8000-000000000001');
select throws_ok(
  $$select public.app_send_ticket_message_with_attachment(
    'fc000000-0000-4000-8000-000000000002', null, 'fb200000-0000-4000-8000-000000000001',
    '', null, 'malware.zip', 'application/zip', 1024, repeat('a1', 32)
  )$$,
  '22023', null,
  'an unsupported MIME type is rejected server-side regardless of client accept= hints'
);
select throws_ok(
  $$select public.app_send_ticket_message_with_attachment(
    'fc000000-0000-4000-8000-000000000003', null, 'fb200000-0000-4000-8000-000000000001',
    '', null, 'huge.pdf', 'application/pdf', 10485760, repeat('a1', 32)
  )$$,
  '22023', null,
  'a file over the canonical 5 MB policy is rejected server-side'
);
select throws_ok(
  $$select public.app_send_ticket_message_with_attachment(
    'fc000000-0000-4000-8000-000000000004', null, 'fb200000-0000-4000-8000-000000000001',
    '', null, 'no-upload.pdf', 'application/pdf', 1024, repeat('a1', 32)
  )$$,
  '22023', null,
  'a message referencing a request id whose bytes were never stored is rejected, not silently linked'
);
reset role;
select is(
  (select count(*) from public.project_attachments where original_name in ('malware.zip', 'huge.pdf', 'no-upload.pdf')),
  0::bigint,
  'none of the rejected drafts leaked an attachment or orphan message row'
);

-- -----------------------------------------------------------------------------
-- Unauthorized upload: a client from a different company cannot even reach the
-- Order this attachment belongs to.
-- -----------------------------------------------------------------------------

set local role authenticated;
select pg_temp.become('fb000000-0000-4000-8000-000000000003');
select throws_ok(
  $$select public.app_prepare_ticket_attachment(
    'fc000000-0000-4000-8000-000000000005', null, 'fb200000-0000-4000-8000-000000000001', null
  )$$,
  'P0002', null,
  'a client from a different company cannot prepare an attachment against this Order'
);
reset role;

-- -----------------------------------------------------------------------------
-- Cross-Ticket access rejected: the same outside client cannot resolve a
-- download for an attachment that belongs to another company Ticket.
-- -----------------------------------------------------------------------------

set local role authenticated;
select pg_temp.become('fb000000-0000-4000-8000-000000000003');
select throws_ok(
  format(
    $fmt$select public.app_get_ticket_attachment_download('%s'::uuid)$fmt$,
    (select payload ->> 'attachment_id' from attach_result)
  ),
  'P0002', null,
  'a client outside the owning company cannot download the Project attachment'
);
reset role;

-- -----------------------------------------------------------------------------
-- Authorized download: the owning company client and internal staff both
-- resolve the same canonical attachment.
-- -----------------------------------------------------------------------------

set local role authenticated;
select pg_temp.become('fb000000-0000-4000-8000-000000000002');
select is(
  (select public.app_get_ticket_attachment_download(
     (select (payload ->> 'attachment_id')::uuid from attach_result)
   ) ->> 'storage_object_key'),
  'fb000000-0000-4000-8000-000000000001/fc000000-0000-4000-8000-000000000001',
  'the owning company client resolves the same canonical attachment sent by staff'
);
reset role;

set local role authenticated;
select pg_temp.become('fb000000-0000-4000-8000-000000000001');
select is(
  (select public.app_get_ticket_attachment_download(
     (select (payload ->> 'attachment_id')::uuid from attach_result)
   ) ->> 'storage_object_key'),
  'fb000000-0000-4000-8000-000000000001/fc000000-0000-4000-8000-000000000001',
  'internal staff resolve the same canonical attachment'
);
reset role;

-- -----------------------------------------------------------------------------
-- Files tab reads the same canonical row: no second attachment model exists.
-- -----------------------------------------------------------------------------

select is(
  (select count(*) from public.project_attachments
   where order_id = 'fb200000-0000-4000-8000-000000000001'),
  1::bigint,
  'no duplicate attachment rows were created anywhere in this flow'
);
select is(
  (
    select count(*)
    from jsonb_array_elements(
      public.app_get_order_conversation('fb200000-0000-4000-8000-000000000001') -> 'messages'
    ) message
    cross join jsonb_array_elements(message -> 'attachments') attachment
    where attachment ->> 'original_name' = 'brief.pdf'
  ),
  1::bigint,
  'the Order conversation read model (the same source the Files tab flat-maps) surfaces the attachment exactly once'
);

select * from finish();
rollback;
