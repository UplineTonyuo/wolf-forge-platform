begin;
select no_plan();

insert into public.tenants(id,slug,display_name,status)
values('f0f0f0f0-0000-4000-8000-000000001964','ticket-voice-guard-fixture','Ticket voice fixture','active');
insert into public.companies(id,tenant_id,name,status) values
('e0000000-0000-4000-8000-000000001964','f0f0f0f0-0000-4000-8000-000000001964','Ticket voice client A','client'),
('e0000000-0000-4000-8000-000000001965','f0f0f0f0-0000-4000-8000-000000001964','Ticket voice client B','client');
insert into auth.users(id,aud,role,email,created_at,updated_at)
select ('20000000-0000-4000-8000-00000000'||n)::uuid,'authenticated','authenticated','ticket-voice-'||n||'@example.invalid',now(),now()
from unnest(array['1964','1965']) n;
insert into public.tenant_memberships(tenant_id,profile_id,account_class,role_id,company_id)
select 'f0f0f0f0-0000-4000-8000-000000001964',('20000000-0000-4000-8000-00000000'||n)::uuid,'client',r.id,('e0000000-0000-4000-8000-00000000'||n)::uuid
from unnest(array['1964','1965']) n cross join public.roles r where r.name='client';
insert into auth.sessions(id,user_id,aal,not_after)
select ('33000000-0000-4000-8000-00000000'||n)::uuid,('20000000-0000-4000-8000-00000000'||n)::uuid,'aal1',now()+interval '1 day'
from unnest(array['1964','1965']) n;
insert into public.tickets(id,tenant_id,company_id,subject,status)
values('e1640000-0000-4000-8000-000000001964','f0f0f0f0-0000-4000-8000-000000001964','e0000000-0000-4000-8000-000000001964','Isolated audio guard fixture','open');

create function pg_temp.voice_actor(p_suffix text default '1964') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claim.role','',true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub','20000000-0000-4000-8000-00000000'||p_suffix,'role','authenticated','session_id','33000000-0000-4000-8000-00000000'||p_suffix)::text,true);
  perform set_config('request.headers',jsonb_build_object('x-wf-tenant','f0f0f0f0-0000-4000-8000-000000001964')::text,true);
end $$;
create function pg_temp.send_voice(p_suffix text,p_mime text default 'audio/webm',p_size bigint default 5) returns jsonb language sql as $$
select public.app_send_ticket_message_with_attachment(
  ('f1640000-0000-4000-8000-00000000'||p_suffix)::uuid,'e1640000-0000-4000-8000-000000001964',null,'',null,'voice.webm',p_mime,p_size,repeat('a1',32)
);
$$;

select ok(not has_function_privilege('anon','public.app_send_ticket_message_with_attachment(uuid,uuid,uuid,text,uuid,text,text,bigint,text)','execute'),'audio support preserves anonymous RPC denial');

-- Isolated database fixtures represent trusted Storage API metadata; all roll back.
insert into storage.objects(bucket_id,name,metadata)
select 'ticket-attachments','20000000-0000-4000-8000-000000001964/f1640000-0000-4000-8000-00000000'||suffix,metadata
from (values
('1961','{}'::jsonb),
('1962','{"mimetype":"video/webm","size":5}'::jsonb),
('1963','{"mimetype":"audio/webm","size":6}'::jsonb),
('1964','{"mimetype":"audio/webm","size":5}'::jsonb),
('1965','{"mimetype":"audio/ogg","size":5}'::jsonb),
('1966','{"mimetype":"audio/webm","size":5}'::jsonb),
('1967','{}'::jsonb)
) f(suffix,metadata);

select pg_temp.voice_actor();
set local role authenticated;
select throws_ok($q$insert into storage.objects(bucket_id,name,metadata) values('ticket-attachments','untrusted-audio','{"mimetype":"audio/webm","size":5}')$q$,null,null,'authenticated callers cannot invent trusted upload metadata');
with changed as (
  update storage.objects set metadata='{"mimetype":"audio/webm","size":5}'
  where bucket_id='ticket-attachments' and name='20000000-0000-4000-8000-000000001964/f1640000-0000-4000-8000-000000001962'
  returning id
)
select is((select count(*) from changed),0::bigint,'authenticated callers cannot relabel generic uploads as audio');
select throws_ok($q$select pg_temp.send_voice('1961')$q$,'22023','Ticket recording upload could not be verified','missing trusted audio metadata cannot finalize');
select throws_ok($q$select pg_temp.send_voice('1962')$q$,'22023','Ticket recording upload could not be verified','generic WebM uploads cannot bypass strict voice validation through the raw RPC');
select throws_ok($q$select pg_temp.send_voice('1963')$q$,'22023','Ticket recording upload could not be verified','submitted size must exactly match trusted upload metadata');
select throws_ok($q$select pg_temp.send_voice('1968')$q$,'22023','Ticket attachment upload is missing','audio does not finalize without an upload');
select lives_ok($q$select pg_temp.send_voice('1964')$q$,'validated WebM metadata finalizes through existing Ticket authority');
select lives_ok($q$select pg_temp.send_voice('1964')$q$,'exact audio replay remains idempotent');
select lives_ok($q$select pg_temp.send_voice('1965','audio/ogg')$q$,'validated Ogg metadata finalizes through existing Ticket authority');
select lives_ok($q$select pg_temp.send_voice('1967','application/pdf')$q$,'existing generic attachments do not gain a new metadata requirement');
reset role;

select pg_temp.voice_actor('1965');
set local role authenticated;
select throws_ok($q$select pg_temp.send_voice('1966')$q$,'42501',null,'another Company cannot finalize an upload into this Ticket');
reset role;
select is((select count(*) from public.ticket_attachments where ticket_id='e1640000-0000-4000-8000-000000001964'),3::bigint,'only two authorized audio records and the preserved generic attachment exist');

select * from finish();
rollback;
