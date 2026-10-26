-- LOCAL DEMO DATA for the 60s client-story capture only. Apply to local Supabase after
-- seed-demo.sql, never to production:
--   psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f capture/seed-story.sql
-- Hero: Harbor Fitness (sample client) buys the SEO Growth Plan; the team and the client
-- talk on the project, in a ticket and in the team chat; an invoice is paid; a report lands.
begin;
set local session_replication_role = replica;

create temp table s as select
  'f0f0f0f0-0000-4000-8000-000000000001'::uuid as tenant,
  (select id from public.companies where name = 'Harbor Fitness') as company,
  (select id from public.services where name = 'SEO Growth Plan' and tenant_id = 'f0f0f0f0-0000-4000-8000-000000000001' limit 1) as service,
  (select p.id from public.profiles p join auth.users u on u.id = p.id where u.email = 'qa-local@wolf-forge.local') as alex,
  (select p.id from public.profiles p join auth.users u on u.id = p.id where u.email = 'wf-william@wolf-forge.local') as jordan,
  (select p.id from public.profiles p join auth.users u on u.id = p.id where u.email = 'phase3a-owner@wolf-forge.local') as sam,
  (select p.id from public.profiles p join auth.users u on u.id = p.id where u.email = 'qa-local-client@wolf-forge.local') as maya;

-- The local client login becomes Maya Chen, owner of Harbor Fitness.
update public.profiles set company_id = (select company from s), display_name = 'Maya Chen' where id = (select maya from s);
update public.tenant_memberships set company_id = (select company from s) where profile_id = (select maya from s) and account_class = 'client';
insert into public.client_contacts (company_id, profile_id, name, email, job_title, is_primary, tenant_id)
select company, maya, 'Maya Chen', 'maya@harborfitness.example', 'Owner', true, tenant from s;

-- The hero project, newest in the list.
insert into public.orders (company_id, service_id, assigned_to_profile_id, title, status, priority, due_at, started_at, created_at, tenant_id)
select company, service, jordan, 'SEO Growth Plan · Harbor Fitness', 'working', 'high', now() + interval '26 days', now() - interval '2 days', now() - interval '2 days', tenant from s;
create temp table h as select id as hero from public.orders where title = 'SEO Growth Plan · Harbor Fitness';

insert into public.project_messages (order_id, author_profile_id, author_type, body, created_at)
select hero, null, 'system', 'Project created from a Store purchase: SEO Growth Plan.', now() - interval '2 days' from h
union all select hero, (select alex from s), 'internal', 'Welcome aboard, Maya! Kickoff is booked for Thursday. Here is the plan for month one: technical audit, location pages, Google profile clean-up.', now() - interval '47 hours' from h
union all select hero, (select maya from s), 'client', 'Amazing, thank you! Could we prioritise the new Westside location page? We open on the 15th.', now() - interval '30 hours' from h
union all select hero, (select jordan from s), 'internal', 'Done. Westside is first in the sprint and the draft lands Friday for your review.', now() - interval '29 hours' from h
union all select hero, (select maya from s), 'client', 'Perfect. Love how easy this is.', now() - interval '3 hours' from h;

-- Delivery plan so the project shows real progress (3 of 5 done).
insert into public.order_tasks (order_id, assigned_to_profile_id, title, status, sort_position, completed_at, created_at)
select o.id, a.id, t.title, t.st, t.pos, case when t.st = 'complete' then now() - (t.pos || ' hours')::interval end, now() - interval '2 days'
from public.orders o
cross join (select p.id from public.profiles p join auth.users u on u.id = p.id where u.email = 'wf-william@wolf-forge.local') a
cross join (values ('Kickoff call', 'complete', 0), ('Technical SEO audit', 'complete', 1), ('Westside location page', 'complete', 2),
                   ('Google Business Profile clean-up', 'in_progress', 3), ('Month-one report', 'todo', 4)) t(title, st, pos)
where o.title = 'SEO Growth Plan · Harbor Fitness';

-- Internal team conversation about the new project.
insert into public.team_conversations (conversation_key, created_by_profile_id, last_message_at, kind, title, tenant_id)
select 'group:' || gen_random_uuid(), alex, now() - interval '20 minutes', 'group', 'Harbor Fitness · SEO Growth', tenant from s;
create temp table c as select id as conv from public.team_conversations where title = 'Harbor Fitness · SEO Growth';
insert into public.team_conversation_members (conversation_id, profile_id, last_read_at)
select conv, p, now() from c, s, unnest(array[s.alex, s.jordan, s.sam]) p;
insert into public.team_messages (request_id, conversation_id, author_profile_id, body, created_at)
select gen_random_uuid(), conv, (select alex from s), 'New SEO Growth Plan just came in from Harbor Fitness through the Store.', now() - interval '47 hours' from c
union all select gen_random_uuid(), conv, (select jordan from s), 'I will take kickoff and the Westside location page.', now() - interval '46 hours' from c
union all select gen_random_uuid(), conv, (select sam from s), 'On the technical audit. Report template is ready for month end.', now() - interval '45 hours' from c
union all select gen_random_uuid(), conv, (select alex from s), 'Maya says thank you. She loves the portal.', now() - interval '20 minutes' from c;

-- A client ticket, answered by the team.
insert into public.tickets (company_id, client_profile_id, subject, status, priority, assigned_to_profile_id, created_by_profile_id, created_at, tenant_id)
select company, maya, 'Can we reply to Google reviews from the portal?', 'in_progress', 'normal', jordan, maya, now() - interval '5 hours', tenant from s;
update public.tickets set inbox_added_at = now() - interval '5 hours' where subject = 'Can we reply to Google reviews from the portal?';
create temp table k as select id as ticket from public.tickets where subject = 'Can we reply to Google reviews from the portal?';
insert into public.ticket_messages (ticket_id, author_profile_id, author_type, message_kind, visibility, body, created_at)
select ticket, (select maya from s), 'client', 'initial_request', 'client', 'Hi team! We got 12 new Google reviews this week. Can you help us reply to them?', now() - interval '5 hours' from k
union all select ticket, (select jordan from s), 'internal', 'reply', 'client', 'Great news, Maya! Replies are drafted in your brand voice. They go live today, and we will send you a summary.', now() - interval '4 hours' from k;

-- This month's invoice (captured unpaid, then paid by capture.mjs's story mode).
insert into public.invoices (company_id, client_profile_id, status, currency, invoice_number, billing_reason, issued_at, due_at, subtotal_cents, total_cents, created_by_profile_id, updated_by_profile_id, created_at, tenant_id)
select company, maya, 'unpaid', 'USD', 5100, 'manual', now() - interval '1 hour', now() + interval '14 days', 120000, 120000, alex, alex, now() - interval '1 hour', tenant from s;
insert into public.invoice_items (invoice_id, service_id, order_id, position, name, description, quantity, unit_price_cents, fulfillment_status)
select i.id, null, null, 0, 'SEO Growth Plan · November', 'Monthly SEO retainer', 1, 120000, 'not_applicable' from public.invoices i where i.invoice_number = 5100;

-- Monthly report the client opens at the end.
insert into public.client_reports (company_id, report_lane, package_label, title, sent_by_profile_id, sent_at, status, service_id, tenant_id)
select company, 'seo_package', 'SEO Growth Plan', 'October results · Harbor Fitness', alex, now() - interval '30 minutes', 'sent', service, tenant from s;
create temp table r as select id as rep from public.client_reports where title = 'October results · Harbor Fitness';
insert into public.client_report_sections (report_id, section_key, title, sort_order)
select rep, k, t, o from r, (values ('highlights','Highlights',0),('rankings','Keyword rankings',1),('local','Google Business Profile',2)) v(k,t,o);
insert into public.client_report_entries (section_id, label, value, sort_order)
select sec.id, e.label, e.value, e.o from public.client_report_sections sec join r on r.rep = sec.report_id
join (values
  ('highlights','Organic traffic','+38% vs September',0), ('highlights','New leads from search','46',1), ('highlights','Westside location page','Live',2),
  ('rankings','"gym near me" (Harbor district)','#3 (was #11)',0), ('rankings','"personal trainer harbor"','#1',1), ('rankings','Keywords in top 10','27',2),
  ('local','Profile views','5,120',0), ('local','Direction requests','+64%',1), ('local','Review replies sent','12',2)
) e(k,label,value,o) on e.k = sec.section_key;

-- What the client's bell and phone show.
insert into public.notifications (recipient_profile_id, company_id, audience, category, title, body, href, entity_type, entity_id, actor_profile_id, event_key, created_at, tenant_id)
select maya, company, 'client', 'project', 'New message on your project', 'Jordan: Westside is first in the sprint.', '/account/projects/' || (select hero from h), 'order', (select hero from h), jordan, 'story-project-message', now() - interval '29 hours', tenant from s
union all select maya, company, 'client', 'report', 'Your October report is ready', 'Organic traffic +38%.', '/account/reporting/' || (select rep from r), null, null, alex, 'story-report', now() - interval '30 minutes', tenant from s;
commit;
