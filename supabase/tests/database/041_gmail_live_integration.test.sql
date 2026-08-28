-- Gmail live provider: Vault isolation, authorization, atomic state and disconnect.
begin;

select plan(20);

insert into auth.users (id, aud, role, email, created_at, updated_at)
values
  ('a1100000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'gmail-admin@example.invalid', now(), now()),
  ('a1100000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'gmail-staff@example.invalid', now(), now());

update public.profiles set role_id = (select id from public.roles where name = 'admin'), company_id = null
where id = 'a1100000-0000-0000-0000-000000000001';
update public.profiles set role_id = (select id from public.roles where name = 'staff'), company_id = null
where id = 'a1100000-0000-0000-0000-000000000002';

select has_table('private', 'integration_credential_references', 'private credential reference table exists');
select has_function('public', 'app_server_store_gmail_connection', array['uuid', 'jsonb', 'text', 'text', 'text[]', 'timestamp with time zone'], 'atomic Gmail store RPC exists');
select ok(not has_table_privilege('authenticated', 'vault.decrypted_secrets', 'SELECT'), 'authenticated cannot read decrypted Vault values');
select ok(not has_table_privilege('authenticated', 'vault.secrets', 'SELECT'), 'authenticated cannot read encrypted Vault rows');
select ok(not has_table_privilege('anon', 'vault.decrypted_secrets', 'SELECT'), 'anonymous callers cannot read decrypted Vault values');
select ok(not has_table_privilege('authenticated', 'private.integration_credential_references', 'SELECT'), 'browser roles cannot read credential references');
select ok(not has_function_privilege('authenticated', 'public.app_server_store_gmail_connection(uuid,jsonb,text,text,text[],timestamp with time zone)', 'EXECUTE'), 'authenticated cannot call Gmail mutation RPCs');
select ok(has_function_privilege('service_role', 'public.app_server_store_gmail_connection(uuid,jsonb,text,text,text[],timestamp with time zone)', 'EXECUTE'), 'trusted service role can call the narrow Gmail store RPC');

set local role service_role;

select throws_ok(
  $$select public.app_server_store_gmail_connection(
      'a1100000-0000-0000-0000-000000000002',
      '{"provider":"gmail","version":1,"payload":{"accessToken":"unit-access","refreshToken":"unit-refresh","accessTokenExpiresAt":"2026-08-25T15:00:00.000Z","scopes":["openid","email","profile","https://www.googleapis.com/auth/gmail.send"],"account":{"id":"google-sub","email":"owner@example.invalid","displayName":"Owner"}}}'::jsonb,
      'google-sub', 'owner@example.invalid',
      array['openid','email','profile','https://www.googleapis.com/auth/gmail.send'], now() + interval '1 hour'
    )$$,
  '42501', null, 'staff cannot administer Gmail through the trusted RPC'
);

select throws_ok(
  $$select public.app_server_store_gmail_connection(
      'a1100000-0000-0000-0000-000000000001',
      '{"provider":"gmail","version":1,"payload":{"accessToken":"unit-access","refreshToken":"unit-refresh","accessTokenExpiresAt":"2026-08-25T15:00:00.000Z","scopes":["openid","email","profile","https://www.googleapis.com/auth/gmail.readonly"],"account":{"id":"google-sub","email":"owner@example.invalid","displayName":"Owner"}}}'::jsonb,
      'google-sub', 'owner@example.invalid',
      array['openid','email','profile','https://www.googleapis.com/auth/gmail.readonly'], now() + interval '1 hour'
    )$$,
  '22023', null, 'unapproved Gmail read scope is rejected'
);

reset role;
select is((select count(*) from public.integration_connections where provider = 'gmail'), 0::bigint, 'failed secret write creates no fake Connected metadata');
select is((select count(*) from private.integration_credential_references where provider = 'gmail'), 0::bigint, 'failed connection creates no credential reference');

set local role service_role;
select lives_ok(
  $$select public.app_server_store_gmail_connection(
      'a1100000-0000-0000-0000-000000000001',
      '{"provider":"gmail","version":1,"payload":{"accessToken":"unit-access","refreshToken":"unit-refresh","accessTokenExpiresAt":"2026-08-25T15:00:00.000Z","scopes":["openid","email","profile","https://www.googleapis.com/auth/gmail.send"],"account":{"id":"google-sub","email":"owner@example.invalid","displayName":"Owner"}}}'::jsonb,
      'google-sub', 'Owner (owner@example.invalid)',
      array['openid','email','profile','https://www.googleapis.com/auth/gmail.send'], now() + interval '1 hour'
    )$$,
  'authorized Gmail connection stores credential and metadata atomically'
);

reset role;
select is((select status from public.integration_connections where provider = 'gmail'), 'connected', 'safe metadata becomes Connected after Vault persistence succeeds');
select is((select granted_scopes from public.integration_connections where provider = 'gmail'), array['openid','email','profile','https://www.googleapis.com/auth/gmail.send'], 'only approved scopes reach connection metadata');
select ok((select provider_metadata::text !~* '(token|secret|credential|password|private.?key)' from public.integration_connections where provider = 'gmail'), 'provider metadata contains no credential-shaped fields');
set local role service_role;
select is((select credentials#>>'{payload,refreshToken}' from public.app_server_read_gmail_credentials('a1100000-0000-0000-0000-000000000001')), 'unit-refresh', 'trusted read RPC can recover the encrypted refresh material');

select lives_ok($$select public.app_server_disconnect_gmail('a1100000-0000-0000-0000-000000000001')$$, 'disconnect destroys the credential and updates metadata');
reset role;
select is((select count(*) from private.integration_credential_references where provider = 'gmail'), 0::bigint, 'disconnect removes the credential reference');
select is((select status from public.integration_connections where provider = 'gmail'), 'disconnected', 'disconnect renders persisted state Disconnected');

reset role;
select * from finish();
rollback;
