begin;

select plan(80);

-- =============================================================================
-- Security Fix Batch B2 adversarial fixtures.
--
-- Internal: one owner (everything) and one staff account used as the
-- projects.view revocation subject for the notification read-time tests.
--
-- Client: two profiles at one company (so a shared conversation can prove the
-- reply buckets are per-actor) and one profile at an unrelated company.
--
-- Forms: one published PUBLIC ORDER Form with no contact field, so its
-- submissions carry no identity key and land in the per-Form bucket; one
-- published PUBLIC CONTACT Form carrying an email field, so its submissions
-- coalesce into the identity bucket and each success manufactures a Ticket;
-- and one published ASSIGNED Form that must stay unreachable anonymously.
--
-- Every burst assertion pre-seeds the exact bucket through the primitive and
-- then makes the real calls back to back, so a fixed window can never roll over
-- mid-assertion and make the suite flaky.
-- =============================================================================

insert into auth.users (id, aud, role, email, created_at, updated_at)
values
  ('c1000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'b2-owner@example.invalid', now(), now()),
  ('c1000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'b2-staff@example.invalid', now(), now()),
  ('c1000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'b2-archived@example.invalid', now(), now()),
  ('c2000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'b2-client-a@example.invalid', now(), now()),
  ('c2000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'b2-client-b@example.invalid', now(), now()),
  ('c2000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'b2-client-foreign@example.invalid', now(), now());

update public.profiles
set role_id = (select id from public.roles where name = 'owner'), display_name = 'B2 Owner'
where id = 'c1000000-0000-0000-0000-000000000001';

update public.profiles
set role_id = (select id from public.roles where name = 'staff'), display_name = 'B2 Staff'
where id = 'c1000000-0000-0000-0000-000000000002';

update public.profiles
set role_id = (select id from public.roles where name = 'owner'),
    display_name = 'B2 Archived',
    archived_at = now()
where id = 'c1000000-0000-0000-0000-000000000003';

insert into public.companies (id, name, status)
values
  ('c3000000-0000-0000-0000-00000000000a', 'B2 Client A', 'client'),
  ('c3000000-0000-0000-0000-00000000000b', 'B2 Client B', 'client');

update public.profiles
set company_id = 'c3000000-0000-0000-0000-00000000000a'
where id in ('c2000000-0000-0000-0000-000000000001', 'c2000000-0000-0000-0000-000000000002');

update public.profiles
set company_id = 'c3000000-0000-0000-0000-00000000000b'
where id = 'c2000000-0000-0000-0000-000000000003';

-- Catalogue: one public Service the Store may signal interest in, one private
-- Service it must silently skip.
insert into public.services (id, name, description, is_active, is_public)
values
  ('c4000000-0000-0000-0000-000000000001', 'B2 Public Service', 'B2 public copy', true, true),
  ('c4000000-0000-0000-0000-000000000002', 'B2 Private Service', 'B2 private copy', false, false);

-- -----------------------------------------------------------------------------
-- Forms
-- -----------------------------------------------------------------------------

insert into public.forms (
  id, form_type, canonical_key, name, status, visibility,
  created_by_profile_id, updated_by_profile_id
)
values
  ('c5000000-0000-0000-0000-000000000001', 'order', 'b2-public-order', 'B2 Public Order Form',
   'published', 'public', 'c1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001'),
  ('c5000000-0000-0000-0000-000000000002', 'contact', 'b2-public-contact', 'B2 Public Contact Form',
   'published', 'public', 'c1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001'),
  ('c5000000-0000-0000-0000-000000000003', 'onboarding', 'b2-assigned-onboarding', 'B2 Assigned Form',
   'published', 'assigned', 'c1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001');

insert into public.form_versions (
  id, form_id, version_number, lifecycle_state, title, visibility, type_config,
  created_by_profile_id
)
values
  ('c6000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', 1, 'draft',
   'B2 Public Order Form', 'public', '{}'::jsonb, 'c1000000-0000-0000-0000-000000000001'),
  ('c6000000-0000-0000-0000-000000000002', 'c5000000-0000-0000-0000-000000000002', 1, 'draft',
   'B2 Public Contact Form', 'public',
   jsonb_build_object(
     'subject_field_key', 'c8000000-0000-0000-0000-000000000011',
     'message_field_key', 'c8000000-0000-0000-0000-000000000012'
   ),
   'c1000000-0000-0000-0000-000000000001'),
  ('c6000000-0000-0000-0000-000000000003', 'c5000000-0000-0000-0000-000000000003', 1, 'draft',
   'B2 Assigned Form', 'assigned', '{}'::jsonb, 'c1000000-0000-0000-0000-000000000001');

-- Definition children can only be written while the version is a draft, which
-- is exactly how app_publish_form builds one.
insert into public.form_version_fields (
  form_version_id, stable_field_key, sort_order, field_type, label, required
)
values
  -- Order Form: a single free-text answer and deliberately no email or phone,
  -- so the identity bucket does not apply and the per-Form ceiling is what is
  -- actually under test.
  ('c6000000-0000-0000-0000-000000000001', 'c8000000-0000-0000-0000-000000000021', 0, 'textarea', 'Order note', false),
  -- Contact Form: subject, message and the email that becomes the coalescing
  -- key. Subject and message are what the Ticket orchestration reads.
  ('c6000000-0000-0000-0000-000000000002', 'c8000000-0000-0000-0000-000000000011', 0, 'text', 'Subject', true),
  ('c6000000-0000-0000-0000-000000000002', 'c8000000-0000-0000-0000-000000000012', 1, 'textarea', 'Message', true),
  ('c6000000-0000-0000-0000-000000000002', 'c8000000-0000-0000-0000-000000000013', 2, 'email', 'Email', true),
  ('c6000000-0000-0000-0000-000000000003', 'c8000000-0000-0000-0000-000000000031', 0, 'text', 'Assigned answer', false);

update public.form_versions
set lifecycle_state = 'published',
    schema_hash = 'b2-hash-' || version_number::text || '-' || left(id::text, 8),
    published_by_profile_id = 'c1000000-0000-0000-0000-000000000001',
    published_at = now()
where id in (
  'c6000000-0000-0000-0000-000000000001',
  'c6000000-0000-0000-0000-000000000002',
  'c6000000-0000-0000-0000-000000000003'
);

update public.forms
set published_version_id = 'c6000000-0000-0000-0000-000000000001'
where id = 'c5000000-0000-0000-0000-000000000001';
update public.forms
set published_version_id = 'c6000000-0000-0000-0000-000000000002'
where id = 'c5000000-0000-0000-0000-000000000002';
update public.forms
set published_version_id = 'c6000000-0000-0000-0000-000000000003'
where id = 'c5000000-0000-0000-0000-000000000003';

create temporary table b2_ids (label text primary key, id uuid not null) on commit drop;
grant select, insert, update on b2_ids to authenticated, anon;

create temporary table b2_unread (label text primary key, unread_count bigint not null) on commit drop;
grant select, insert, update on b2_unread to authenticated;

-- =============================================================================
-- 1. The rate limiting primitive itself
-- =============================================================================

select is(
  has_function_privilege('anon', 'private.consume_rate_limit(text, text, interval, integer)', 'EXECUTE'),
  false,
  'the anonymous browser role cannot call the throttle primitive directly'
);

select is(
  has_function_privilege('authenticated', 'private.consume_rate_limit(text, text, interval, integer)', 'EXECUTE'),
  false,
  'the authenticated browser role cannot call the throttle primitive directly'
);

select is(
  has_table_privilege('authenticated', 'private.rate_limit_counters', 'SELECT')
    or has_table_privilege('anon', 'private.rate_limit_counters', 'SELECT'),
  false,
  'no browser role can read or forge throttle state'
);

select lives_ok(
  $outer$do $inner$
    declare i integer;
    begin
      for i in 1..3 loop
        perform private.consume_rate_limit('b2.primitive', 'subject-a', interval '1 hour', 3);
      end loop;
    end
  $inner$$outer$,
  'the throttle admits exactly its configured allowance'
);

select throws_ok(
  $$select private.consume_rate_limit('b2.primitive', 'subject-a', interval '1 hour', 3)$$,
  'WF429', 'rate limit exceeded',
  'the throttle rejects the call after the allowance is spent'
);

select is(
  (select max(hits) from private.rate_limit_counters
    where scope = 'b2.primitive' and subject = 'subject-a'),
  3,
  'a rejected attempt rolls its own increment back, so the counter settles at the limit'
);

select lives_ok(
  $$select private.consume_rate_limit('b2.primitive', 'subject-b', interval '1 hour', 3)$$,
  'one exhausted subject does not consume another subject''s allowance'
);

-- =============================================================================
-- 2. M-03 — anonymous public Form abuse
-- =============================================================================

set local role anon;
set local "request.jwt.claim.role" = 'anon';
set local "request.jwt.claim.sub" = '';

-- 2a. Payload caps. These run before the throttle and before any lock, so an
-- oversized request is rejected without consuming an allowance.

select throws_ok(
  format(
    $$select public.app_submit_form(
        'c9000000-0000-0000-0000-0000000000f1',
        'c6000000-0000-0000-0000-000000000001',
        '{}'::jsonb,
        jsonb_build_array(jsonb_build_object(
          'field_key', 'c8000000-0000-0000-0000-000000000021',
          'value', %L
        ))
      )$$,
    repeat('x', 20000)
  ),
  '22023', 'Form answer is too large',
  'a single oversized answer is rejected outright'
);

select throws_ok(
  format(
    $$select public.app_submit_form(
        'c9000000-0000-0000-0000-0000000000f2',
        'c6000000-0000-0000-0000-000000000001',
        '{}'::jsonb,
        (select jsonb_agg(jsonb_build_object(
          'field_key', 'c8000000-0000-0000-0000-000000000021',
          'value', %L
        )) from generate_series(1, 30))
      )$$,
    repeat('y', 12000)
  ),
  '22023', 'Form submission payload is too large',
  'an oversized total payload is rejected before any field is parsed'
);

select throws_ok(
  $$select public.app_submit_form(
      'c9000000-0000-0000-0000-0000000000f3',
      'c6000000-0000-0000-0000-000000000001',
      '{}'::jsonb,
      (select jsonb_agg(jsonb_build_object(
        'field_key', 'c8000000-0000-0000-0000-000000000021',
        'value', 'short'
      )) from generate_series(1, 400))
    )$$,
  '22023', 'Form submission has too many answers',
  'a submission with too many answers is rejected'
);

reset role;

select is(
  (select count(*) from public.form_submissions
    where form_id = 'c5000000-0000-0000-0000-000000000001'),
  0::bigint,
  'no oversized attempt persisted a submission'
);

set local role anon;
set local "request.jwt.claim.role" = 'anon';
set local "request.jwt.claim.sub" = '';

-- 2b. A legitimate anonymous submission still works, and an idempotent replay
-- is answered from the request log rather than counted as new abuse.

select lives_ok(
  $$insert into b2_ids
      select 'order-submission',
             (public.app_submit_form(
               'c9000000-0000-0000-0000-000000000001',
               'c6000000-0000-0000-0000-000000000001',
               '{}'::jsonb,
               jsonb_build_array(jsonb_build_object(
                 'field_key', 'c8000000-0000-0000-0000-000000000021',
                 'value', 'B2 legitimate order note'
               ))
             )).id$$,
  'the first legitimate anonymous public Order submission succeeds'
);

select is(
  (public.app_submit_form(
    'c9000000-0000-0000-0000-000000000001',
    'c6000000-0000-0000-0000-000000000001',
    '{}'::jsonb,
    jsonb_build_array(jsonb_build_object(
      'field_key', 'c8000000-0000-0000-0000-000000000021',
      'value', 'B2 legitimate order note'
    ))
  )).id,
  (select id from b2_ids where label = 'order-submission'),
  'an idempotent replay returns the original submission instead of a new one'
);

reset role;

select is(
  (select count(*) from public.form_submissions
    where form_id = 'c5000000-0000-0000-0000-000000000001'),
  1::bigint,
  'the replay created no second submission'
);

select is(
  (select hits from private.rate_limit_counters
    where scope = 'form.submit.public.form.minute'
      and subject = 'c5000000-0000-0000-0000-000000000001'),
  1,
  'an idempotent replay is not punished as a second action'
);

-- 2c. Distinct request ids are exactly the bypass M-03 described. Seed the
-- per-Form minute bucket to one below its allowance and then make the two real
-- calls back to back.
do $$
declare i integer;
begin
  for i in 1..8 loop
    perform private.consume_rate_limit(
      'form.submit.public.form.minute',
      'c5000000-0000-0000-0000-000000000001',
      interval '1 minute',
      10
    );
  end loop;
end $$;

set local role anon;
set local "request.jwt.claim.role" = 'anon';
set local "request.jwt.claim.sub" = '';

select lives_ok(
  $$select public.app_submit_form(
      'c9000000-0000-0000-0000-000000000002',
      'c6000000-0000-0000-0000-000000000001',
      '{}'::jsonb,
      jsonb_build_array(jsonb_build_object(
        'field_key', 'c8000000-0000-0000-0000-000000000021',
        'value', 'B2 order note 10'
      ))
    )$$,
  'the last submission inside the per-Form allowance still succeeds'
);

select throws_ok(
  $$select public.app_submit_form(
      'c9000000-0000-0000-0000-000000000003',
      'c6000000-0000-0000-0000-000000000001',
      '{}'::jsonb,
      jsonb_build_array(jsonb_build_object(
        'field_key', 'c8000000-0000-0000-0000-000000000021',
        'value', 'B2 order note 11'
      ))
    )$$,
  'WF429', 'rate limit exceeded',
  'a fresh request id no longer buys another anonymous submission'
);

reset role;

select is(
  (select count(*) from public.form_submissions
    where form_id = 'c5000000-0000-0000-0000-000000000001'),
  2::bigint,
  'the throttled anonymous submission persisted no submission row'
);

select is(
  (select count(*) from public.form_submission_values as value_row
    join public.form_submissions as submission_row on submission_row.id = value_row.submission_id
    where submission_row.form_id = 'c5000000-0000-0000-0000-000000000001'),
  2::bigint,
  'the throttled anonymous submission persisted no submission values'
);

select is(
  (select hits from private.rate_limit_counters
    where scope = 'form.submit.public.form.minute'
      and subject = 'c5000000-0000-0000-0000-000000000001'),
  10,
  'the per-Form counter settles at its allowance and never past it'
);

-- 2d. The Contact Form: one submission is one Ticket, so the identity bucket is
-- what stops one source manufacturing unlimited downstream work.

set local role anon;
set local "request.jwt.claim.role" = 'anon';
set local "request.jwt.claim.sub" = '';

select lives_ok(
  $$select public.app_submit_form(
      'c9000000-0000-0000-0000-000000000011',
      'c6000000-0000-0000-0000-000000000002',
      '{}'::jsonb,
      jsonb_build_array(
        jsonb_build_object('field_key', 'c8000000-0000-0000-0000-000000000011', 'value', 'B2 contact subject'),
        jsonb_build_object('field_key', 'c8000000-0000-0000-0000-000000000012', 'value', 'B2 contact message'),
        jsonb_build_object('field_key', 'c8000000-0000-0000-0000-000000000013', 'value', 'spammer@example.invalid')
      )
    )$$,
  'a legitimate anonymous Contact submission succeeds'
);

reset role;

select is(
  (select count(*) from public.tickets
    where source_form_version_id = 'c6000000-0000-0000-0000-000000000002'),
  1::bigint,
  'the legitimate Contact submission produced exactly one Ticket'
);

-- Seed the identity bucket for this exact contact identity up to its allowance.
do $$
declare
  identity_key text;
  i integer;
  spent integer;
begin
  identity_key := private.form_submission_identity_key(
    'c6000000-0000-0000-0000-000000000002',
    jsonb_build_array(
      jsonb_build_object('field_key', 'c8000000-0000-0000-0000-000000000013', 'value', 'spammer@example.invalid')
    )
  );

  select coalesce(max(hits), 0) into spent
  from private.rate_limit_counters
  where scope = 'form.submit.public.identity.hour'
    and subject = 'c5000000-0000-0000-0000-000000000002:' || identity_key;

  for i in (spent + 1)..5 loop
    perform private.consume_rate_limit(
      'form.submit.public.identity.hour',
      'c5000000-0000-0000-0000-000000000002:' || identity_key,
      interval '1 hour',
      5
    );
  end loop;
end $$;

set local role anon;
set local "request.jwt.claim.role" = 'anon';
set local "request.jwt.claim.sub" = '';

select throws_ok(
  $$select public.app_submit_form(
      'c9000000-0000-0000-0000-000000000012',
      'c6000000-0000-0000-0000-000000000002',
      '{}'::jsonb,
      jsonb_build_array(
        jsonb_build_object('field_key', 'c8000000-0000-0000-0000-000000000011', 'value', 'B2 spam subject'),
        jsonb_build_object('field_key', 'c8000000-0000-0000-0000-000000000012', 'value', 'B2 spam message'),
        jsonb_build_object('field_key', 'c8000000-0000-0000-0000-000000000013', 'value', 'spammer@example.invalid')
      )
    )$$,
  'WF429', 'rate limit exceeded',
  'one anonymous source cannot keep manufacturing Contact Ticket workload'
);

select throws_ok(
  $$select public.app_submit_form(
      'c9000000-0000-0000-0000-000000000013',
      'c6000000-0000-0000-0000-000000000003',
      jsonb_build_object('assignment_id', 'c9000000-0000-0000-0000-0000000000aa'),
      jsonb_build_array(jsonb_build_object(
        'field_key', 'c8000000-0000-0000-0000-000000000031', 'value', 'B2 anonymous attempt'
      ))
    )$$,
  '42501', 'Form assignment is required',
  'an assigned Form is still unreachable anonymously'
);

reset role;

select is(
  (select count(*) from public.tickets
    where source_form_version_id = 'c6000000-0000-0000-0000-000000000002'),
  1::bigint,
  'the throttled Contact submission created no Ticket'
);

select is(
  (select count(*) from public.form_submissions
    where form_id = 'c5000000-0000-0000-0000-000000000002'),
  1::bigint,
  'the throttled Contact submission created no submission'
);

select is(
  (select count(*) from public.activity_events
    where action = 'form.submitted'
      and metadata ->> 'form_id' = 'c5000000-0000-0000-0000-000000000002'),
  1::bigint,
  'the throttled Contact submission created no activity'
);

select is(
  (select count(*) from public.notifications
    where category = 'ticket'
      and entity_id in (
        select id from public.tickets
        where source_form_version_id = 'c6000000-0000-0000-0000-000000000002'
      )
      and created_at > now() - interval '1 minute'
      and title like '%B2 spam%'),
  0::bigint,
  'the throttled Contact submission produced no notification'
);

-- 2e. Bot verification seam.
--
-- The bursts above deliberately left the Form buckets exhausted, and the
-- throttle runs before the challenge. Clearing the counters here isolates the
-- seam: throttle state is fixture state, not authorization state.
delete from private.rate_limit_counters where scope like 'form.submit.%';


select is(
  has_function_privilege('anon', 'private.require_bot_verification(text, text, text)', 'EXECUTE'),
  false,
  'the bot-verification boundary holds no anonymous EXECUTE grant'
);

select is(
  private.require_bot_verification('form.submit', 'c5000000-0000-0000-0000-000000000001', null),
  'not_configured',
  'with no provider registered the challenge is fail-safe and public Forms keep working'
);

insert into private.bot_verification_providers (provider_key, is_enabled, enforce_public_forms)
values ('b2_test_provider', true, true);

set local role anon;
set local "request.jwt.claim.role" = 'anon';
set local "request.jwt.claim.sub" = '';

select throws_ok(
  $$select public.app_submit_form(
      'c9000000-0000-0000-0000-000000000021',
      'c6000000-0000-0000-0000-000000000001',
      '{}'::jsonb,
      jsonb_build_array(jsonb_build_object(
        'field_key', 'c8000000-0000-0000-0000-000000000021',
        'value', 'B2 unverified'
      ))
    )$$,
  '42501', 'bot verification is required',
  'with a provider enforcing, an anonymous submission without a receipt is refused'
);

reset role;

select throws_ok(
  $$select private.require_bot_verification('form.submit', 'c5000000-0000-0000-0000-000000000001', 'forged-token')$$,
  '42501', 'bot verification is required',
  'a token the trusted server never recorded is worthless'
);

select lives_ok(
  $$select private.record_bot_verification(
      'b2_test_provider', 'form.submit', 'c5000000-0000-0000-0000-000000000001', 'b2-real-token'
    )$$,
  'a trusted server can record a verified challenge receipt'
);

select is(
  private.require_bot_verification('form.submit', 'c5000000-0000-0000-0000-000000000001', 'b2-real-token'),
  'verified',
  'a recorded receipt satisfies the challenge exactly once'
);

select throws_ok(
  $$select private.require_bot_verification('form.submit', 'c5000000-0000-0000-0000-000000000001', 'b2-real-token')$$,
  '42501', 'bot verification is required',
  'a receipt cannot be replayed'
);

delete from private.bot_verification_providers where provider_key = 'b2_test_provider';

-- =============================================================================
-- 3. M-04 — Ticket reply abuse
-- =============================================================================

insert into public.tickets (id, company_id, client_profile_id, subject, created_by_profile_id)
values
  ('c7000000-0000-0000-0000-000000000001', 'c3000000-0000-0000-0000-00000000000a',
   'c2000000-0000-0000-0000-000000000001', 'B2 Shared Conversation', 'c2000000-0000-0000-0000-000000000001'),
  ('c7000000-0000-0000-0000-000000000002', 'c3000000-0000-0000-0000-00000000000b',
   'c2000000-0000-0000-0000-000000000003', 'B2 Foreign Conversation', 'c2000000-0000-0000-0000-000000000003');

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = 'c2000000-0000-0000-0000-000000000001';

select lives_ok(
  $$insert into b2_ids
      select 'first-reply',
             (public.app_reply_to_ticket(
               'ca000000-0000-0000-0000-000000000001',
               'c7000000-0000-0000-0000-000000000001',
               'B2 first legitimate reply'
             )).id$$,
  'a normal authorized Ticket reply still succeeds'
);

select is(
  (public.app_reply_to_ticket(
    'ca000000-0000-0000-0000-000000000001',
    'c7000000-0000-0000-0000-000000000001',
    'B2 first legitimate reply'
  )).id,
  (select id from b2_ids where label = 'first-reply'),
  'an idempotent reply retry is answered as a replay, not as new abuse'
);

select throws_ok(
  format(
    $$select public.app_reply_to_ticket(
        'ca000000-0000-0000-0000-0000000000ff',
        'c7000000-0000-0000-0000-000000000001',
        %L
      )$$,
    repeat('z', 60000)
  ),
  '22023', 'invalid Ticket reply input',
  'an oversized reply body is rejected by the boundary'
);

reset role;

select is(
  (select hits from private.rate_limit_counters
    where scope = 'ticket.reply.conversation.minute'
      and subject = 'c2000000-0000-0000-0000-000000000001:c7000000-0000-0000-0000-000000000001'),
  1,
  'the reply replay consumed no second allowance'
);

do $$
declare i integer;
begin
  for i in 1..5 loop
    perform private.consume_rate_limit(
      'ticket.reply.conversation.minute',
      'c2000000-0000-0000-0000-000000000001:c7000000-0000-0000-0000-000000000001',
      interval '1 minute',
      6
    );
  end loop;
end $$;

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = 'c2000000-0000-0000-0000-000000000001';

select throws_ok(
  $$select public.app_reply_to_ticket(
      'ca000000-0000-0000-0000-000000000002',
      'c7000000-0000-0000-0000-000000000001',
      'B2 burst reply with a brand new request id'
    )$$,
  'WF429', 'rate limit exceeded',
  'a burst of unique reply request ids is throttled'
);

select throws_ok(
  $$select public.app_reply_to_ticket(
      'ca000000-0000-0000-0000-000000000003',
      'c7000000-0000-0000-0000-000000000002',
      'B2 foreign Ticket reply'
    )$$,
  '42501', 'Ticket access is denied',
  'foreign Ticket protection is unchanged by the throttle'
);

set local "request.jwt.claim.sub" = 'c2000000-0000-0000-0000-000000000002';

select lives_ok(
  $$select public.app_reply_to_ticket(
      'ca000000-0000-0000-0000-000000000004',
      'c7000000-0000-0000-0000-000000000001',
      'B2 second participant reply'
    )$$,
  'another participant in the same conversation keeps their own allowance'
);

reset role;

select is(
  (select count(*) from public.ticket_messages
    where ticket_id = 'c7000000-0000-0000-0000-000000000001' and message_kind = 'reply'),
  2::bigint,
  'the throttled reply persisted no Ticket message'
);

select is(
  (select count(*) from public.activity_events
    where entity_id = 'c7000000-0000-0000-0000-000000000001' and action = 'ticket.replied'),
  2::bigint,
  'the throttled reply persisted no Ticket activity'
);

select is(
  (select count(*) from public.notifications
    where category = 'ticket'
      and body like '%B2 burst reply%'),
  0::bigint,
  'the throttled reply produced no notification'
);

-- Ticket creation is the other way to manufacture staff work.
do $$
declare
  i integer;
  spent integer;
begin
  select coalesce(max(hits), 0) into spent
  from private.rate_limit_counters
  where scope = 'ticket.create.client.hour'
    and subject = 'c2000000-0000-0000-0000-000000000001';

  for i in (spent + 1)..10 loop
    perform private.consume_rate_limit(
      'ticket.create.client.hour', 'c2000000-0000-0000-0000-000000000001', interval '1 hour', 10
    );
  end loop;
end $$;

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = 'c2000000-0000-0000-0000-000000000001';

select throws_ok(
  $$select public.app_create_ticket(
      'ca000000-0000-0000-0000-000000000005',
      jsonb_build_object('subject', 'B2 flood', 'message', 'B2 flood message')
    )$$,
  'WF429', 'rate limit exceeded',
  'a client cannot open unlimited conversations'
);

set local "request.jwt.claim.sub" = 'c2000000-0000-0000-0000-000000000002';

select lives_ok(
  $$select public.app_create_ticket(
      'ca000000-0000-0000-0000-000000000006',
      jsonb_build_object('subject', 'B2 legitimate', 'message', 'B2 legitimate message')
    )$$,
  'one client exhausting their creation allowance does not silence a colleague'
);

-- =============================================================================
-- 4. M-04 — Store interest toggle abuse
-- =============================================================================

set local "request.jwt.claim.sub" = 'c2000000-0000-0000-0000-000000000001';

select is(
  public.app_record_store_interest(
    array['c4000000-0000-0000-0000-000000000001'::uuid, 'c4000000-0000-0000-0000-000000000002'::uuid],
    true
  ),
  1,
  'the first Add records interest for the public Service and silently skips the private one'
);

reset role;

select is(
  (select count(*) from public.notifications
    where entity_type = 'service_interest'
      and recipient_profile_id = 'c1000000-0000-0000-0000-000000000001'),
  1::bigint,
  'the first Add emits exactly one staff signal'
);

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = 'c2000000-0000-0000-0000-000000000001';

-- The remove / re-add loop M-04 described, run four times.
do $$
declare i integer;
begin
  for i in 1..4 loop
    perform public.app_record_store_interest(array['c4000000-0000-0000-0000-000000000001'::uuid], false);
    perform public.app_record_store_interest(array['c4000000-0000-0000-0000-000000000001'::uuid], true);
  end loop;
end $$;

reset role;

select is(
  (select count(*) from public.notifications
    where entity_type = 'service_interest'
      and recipient_profile_id = 'c1000000-0000-0000-0000-000000000001'),
  1::bigint,
  'four remove/re-add cycles manufacture no further staff signals'
);

select is(
  (select in_cart from public.service_interests
    where company_id = 'c3000000-0000-0000-0000-00000000000a'
      and service_id = 'c4000000-0000-0000-0000-000000000001'),
  true,
  'the real final interest state is still correct after the loop'
);

select is(
  (select add_count from public.service_interests
    where company_id = 'c3000000-0000-0000-0000-00000000000a'
      and service_id = 'c4000000-0000-0000-0000-000000000001'),
  5,
  'the genuine re-add history is preserved rather than suppressed'
);

select is(
  (select count(*) from public.service_interests
    where company_id = 'c3000000-0000-0000-0000-00000000000a'
      and service_id = 'c4000000-0000-0000-0000-000000000002'),
  0::bigint,
  'a non-public Service is never signalled, so the catalogue is not an oracle'
);

-- A client who genuinely reconsiders after the cooldown must still be heard.
update public.service_interests
set last_notified_at = now() - interval '2 hours'
where company_id = 'c3000000-0000-0000-0000-00000000000a'
  and service_id = 'c4000000-0000-0000-0000-000000000001';

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = 'c2000000-0000-0000-0000-000000000001';

select lives_ok(
  $outer$do $inner$
    begin
      perform public.app_record_store_interest(array['c4000000-0000-0000-0000-000000000001'::uuid], false);
      perform public.app_record_store_interest(array['c4000000-0000-0000-0000-000000000001'::uuid], true);
    end
  $inner$$outer$,
  'a client can still change their mind after the cooldown window'
);

reset role;

select is(
  (select count(*) from public.notifications
    where entity_type = 'service_interest'
      and recipient_profile_id = 'c1000000-0000-0000-0000-000000000001'),
  2::bigint,
  'a genuine later transition is signalled once the cooldown has elapsed'
);

do $$
declare
  i integer;
  spent integer;
begin
  select coalesce(max(hits), 0) into spent
  from private.rate_limit_counters
  where scope = 'store.interest.actor.minute'
    and subject = 'c2000000-0000-0000-0000-000000000001';

  for i in (spent + 1)..20 loop
    perform private.consume_rate_limit(
      'store.interest.actor.minute', 'c2000000-0000-0000-0000-000000000001', interval '1 minute', 20
    );
  end loop;
end $$;

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = 'c2000000-0000-0000-0000-000000000001';

select throws_ok(
  $$select public.app_record_store_interest(array['c4000000-0000-0000-0000-000000000001'::uuid], false)$$,
  'WF429', 'rate limit exceeded',
  'raw Store interest write churn is throttled per client profile'
);

set local "request.jwt.claim.sub" = 'c2000000-0000-0000-0000-000000000002';

select lives_ok(
  $$select public.app_record_store_interest(array['c4000000-0000-0000-0000-000000000001'::uuid], true)$$,
  'one client cannot consume another client''s Store interest allowance'
);

-- A client at an unrelated company signals interest in the same Service. The
-- company is derived from their own profile, so it can only ever write their
-- own row.
set local "request.jwt.claim.sub" = 'c2000000-0000-0000-0000-000000000003';

select lives_ok(
  $$select public.app_record_store_interest(array['c4000000-0000-0000-0000-000000000001'::uuid], true)$$,
  'a client at another company records interest against their own company only'
);

reset role;

select is(
  (select signalled_by_profile_id from public.service_interests
    where service_id = 'c4000000-0000-0000-0000-000000000001'
      and company_id = 'c3000000-0000-0000-0000-00000000000a'),
  'c2000000-0000-0000-0000-000000000001'::uuid,
  'company and actor authority stay server-derived: the foreign client never touched company A''s row'
);

-- =============================================================================
-- 5. Notification read-time permission revocation
-- =============================================================================

reset role;
-- The Projects trigger derives its actor from the JWT subject, so hand the
-- session back to the owner before creating the Project the revocation tests
-- read.
set local "request.jwt.claim.sub" = 'c1000000-0000-0000-0000-000000000001';

insert into public.orders (id, company_id, service_id, title, status, priority)
values (
  'cb000000-0000-0000-0000-000000000001',
  'c3000000-0000-0000-0000-00000000000a',
  'c4000000-0000-0000-0000-000000000001',
  'B2 Revocation Project', 'pending', 'normal'
);

insert into b2_ids
select 'project-notification', notification_row.id
from public.notifications as notification_row
where notification_row.event_key = 'project-created:cb000000-0000-0000-0000-000000000001'
  and notification_row.recipient_profile_id = 'c1000000-0000-0000-0000-000000000002';

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = 'c1000000-0000-0000-0000-000000000002';

select is(
  (select count(*) from public.app_list_my_notifications(100)
    where event_key = 'project-created:cb000000-0000-0000-0000-000000000001'),
  1::bigint,
  'a Projects notification is listed while the recipient still holds projects.view'
);

insert into b2_unread
select 'before-revocation', count(*)
from public.app_list_my_notifications(100)
where read_at is null;

reset role;

insert into public.profile_permission_overrides (profile_id, permission_key, allowed)
values ('c1000000-0000-0000-0000-000000000002', 'projects.view', false);

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = 'c1000000-0000-0000-0000-000000000002';

select is(
  (select count(*) from public.app_list_my_notifications(100)
    where event_key = 'project-created:cb000000-0000-0000-0000-000000000001'),
  0::bigint,
  'revoking the module hides the already-delivered notification immediately'
);

select is(
  (select count(*) from public.app_list_my_notifications(100) where read_at is null),
  (select unread_count - 1 from b2_unread where label = 'before-revocation'),
  'the unread count drops by exactly the revoked row'
);

select is(
  public.app_mark_notification_read((select id from b2_ids where label = 'project-notification')),
  false,
  'mark-one cannot mutate a notification the actor can no longer see'
);

select lives_ok(
  $$select public.app_mark_all_notifications_read()$$,
  'mark-all still runs for a recipient whose module was revoked'
);

reset role;

select is(
  (select read_at from public.notifications
    where id = (select id from b2_ids where label = 'project-notification')),
  null::timestamptz,
  'neither read marker mutated the hidden row'
);

delete from public.profile_permission_overrides
where profile_id = 'c1000000-0000-0000-0000-000000000002'
  and permission_key = 'projects.view';

set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = 'c1000000-0000-0000-0000-000000000002';

select is(
  (select count(*) from public.app_list_my_notifications(100)
    where event_key = 'project-created:cb000000-0000-0000-0000-000000000001'
      and read_at is null),
  1::bigint,
  'restoring the module returns the row, still unread, deterministically'
);

set local "request.jwt.claim.sub" = 'c1000000-0000-0000-0000-000000000003';

select throws_ok(
  $$select * from public.app_list_my_notifications()$$,
  '42501', 'active authenticated notification access required',
  'an archived profile is still rejected outright'
);

reset role;

-- =============================================================================
-- 6. Category map invariant and least privilege
-- =============================================================================

select is(
  (select count(*) from private.notification_category_decision_gaps()),
  0::bigint,
  'every permitted notification audience and category carries an explicit decision'
);

select is(
  (select count(*) from private.notification_category_catalog()),
  20::bigint,
  'the invariant covers the whole permitted audience and category domain'
);

select ok(
  (select bool_and(
     private.notification_category_permission(catalog.audience, catalog.category) is null
     or exists (
       select 1 from public.permissions as permission_row
       where permission_row.permission_key
         = private.notification_category_permission(catalog.audience, catalog.category)
     )
   )
   from private.notification_category_catalog() as catalog),
  'every mapped capability is a real permission key'
);

select is(
  private.notification_category_non_deliverable('client', 'coupon'),
  true,
  'the one intentionally undeliverable combination is declared rather than commented'
);

-- The invariant must actually fail when a category is added without a decision.
savepoint b2_invariant_probe;

alter table public.notifications drop constraint notifications_category_decision;
alter table public.notifications drop constraint notifications_category_valid;
alter table public.notifications add constraint notifications_category_valid check (
  category = any (array[
    'project', 'client', 'form', 'coupon', 'ticket',
    'payment', 'wallet', 'store', 'report', 'undecided'
  ])
);

select cmp_ok(
  (select count(*) from private.notification_category_decision_gaps()),
  '>',
  0::bigint,
  'adding a notification category without a decision is reported as a gap'
);

rollback to savepoint b2_invariant_probe;

select is(
  (select count(*) from private.notification_category_decision_gaps()),
  0::bigint,
  'the probe left the invariant intact'
);

select ok(
  not has_table_privilege('service_role', 'public.notifications', 'TRUNCATE')
  and not has_table_privilege('service_role', 'public.notifications', 'TRIGGER')
  and not has_table_privilege('service_role', 'public.notifications', 'REFERENCES'),
  'service_role holds no vestigial privilege on public.notifications'
);

select is(
  (select count(*) from pg_proc as function_row
    join pg_namespace as schema_row on schema_row.oid = function_row.pronamespace
    where schema_row.nspname = 'private' and function_row.proacl is null),
  0::bigint,
  'no private function retains a default PUBLIC EXECUTE grant'
);

select ok(
  (select bool_and(has_function_privilege('anon', function_row.oid, 'EXECUTE') = false)
     from pg_proc as function_row
     join pg_namespace as schema_row on schema_row.oid = function_row.pronamespace
    where schema_row.nspname = 'private'),
  'the anonymous role can execute nothing in the private schema'
);

-- The RLS helpers must keep their grant: a policy expression is evaluated with
-- the querying role's privileges, so revoking these would break every read.
select ok(
  (select bool_and(has_function_privilege('authenticated', helper_name, 'EXECUTE'))
     from unnest(array[
       'private.is_internal_user()',
       'private.is_client_user()',
       'private.current_user_company_id()',
       'private.can_read_invoice(uuid)',
       'private.can_read_subscription(uuid)',
       'private.can_access_operational_order(uuid)',
       'private.can_access_operational_task(uuid)',
       'private.is_client_private_admin()',
       'private.can_access_client_private_company(uuid)'
     ]) as helper_name),
  'the RLS helper functions keep the authenticated EXECUTE grant their policies need'
);

-- Public wrapper RPCs still work for a browser role after the revocations.
set local role authenticated;
set local "request.jwt.claim.role" = 'authenticated';
set local "request.jwt.claim.sub" = 'c1000000-0000-0000-0000-000000000001';

select lives_ok(
  $$select * from public.app_list_my_notifications(10)$$,
  'the public notification RPC still executes for a browser session'
);

select lives_ok(
  $$select public.app_has_permission('projects.view')$$,
  'the public permission wrapper still executes for a browser session'
);

set local role anon;
set local "request.jwt.claim.role" = 'anon';
set local "request.jwt.claim.sub" = '';

select lives_ok(
  $$select public.app_get_published_form_schema('b2-public-order')$$,
  'the anonymous published Form schema RPC still works after the private revocations'
);

reset role;

select * from finish();
rollback;
