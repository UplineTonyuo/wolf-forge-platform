-- LOCAL DEMO DATA for the showreel capture only. Apply to local Supabase, never production:
--   psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f capture/seed-demo.sql
-- LOCAL DEMO DATA for the showreel capture only (local Supabase, never production).
begin;
create temp table v as select
  'f0f0f0f0-0000-4000-8000-000000000001'::uuid as tenant,
  (select p.id from public.profiles p join auth.users u on u.id = p.id where u.email = 'qa-local@wolf-forge.local') as me;

insert into public.companies (name, status, created_at, tenant_id)
select n, s, now() - (d || ' days')::interval, (select tenant from v) from (values
 ('Northwind Studio','client',52),('Apex Dental Group','client',44),('Bluepeak Realty','client',38),
 ('Copper & Pine Co.','client',27),('Harbor Fitness','client',21),('Lumen Legal','client',16),
 ('Orbit Coffee Roasters','client',12),('Summit HVAC','client',9),('Velvet Bloom Florals','client',6),
 ('Kestrel Logistics','lead',4),('Meridian Wellness','lead',3),('Ironclad Roofing','contact',1)) t(n,s,d);

set local session_replication_role = replica;

insert into public.activity_events (entity_type, entity_id, action, summary, metadata, created_at, tenant_id, actor_profile_id)
select 'company', c.id, 'updated', c.name || ' became a client', jsonb_build_object('field','status','from','lead','to','client'),
  c.created_at + interval '2 days', (select tenant from v), (select me from v)
from public.companies c where c.status = 'client' and c.created_at > now() - interval '30 days';

insert into public.services (name, description, price, currency, is_active, sort_order, tenant_id, recurring, recurring_price, recurring_interval_length, recurring_interval_unit, recurring_action, subscription_eligible)
values
 ('SEO Growth Plan','Monthly search growth retainer.',1200,'USD',true,0,(select tenant from v),true,1200,1,'M','create_order',true),
 ('Website Build','Conversion-focused site design and build.',4500,'USD',true,1,(select tenant from v),false,null,null,null,null,false),
 ('Google Business Profile','Local profile setup and optimisation.',450,'USD',true,2,(select tenant from v),false,null,null,null,null,false),
 ('Content Workflow','Editorial calendar and production.',800,'USD',true,3,(select tenant from v),true,800,1,'M','create_order',true),
 ('Podcast SEO','Show notes, chapters and distribution.',650,'USD',true,4,(select tenant from v),false,null,null,null,null,false),
 ('Technical SEO Audit','Crawl, speed and schema audit.',1500,'USD',true,5,(select tenant from v),false,null,null,null,null,false);

create temp table co as select id, name, row_number() over (order by created_at) as i from public.companies where tenant_id = (select tenant from v) and created_at < now() - interval '12 hours';
create temp table sv as select id, name, price, row_number() over (order by sort_order) as i from public.services where tenant_id = (select tenant from v);

-- Projects
insert into public.orders (company_id, service_id, assigned_to_profile_id, title, status, priority, due_at, started_at, completed_at, created_at, tenant_id)
select c.id, s.id, (select me from v), s.name || ' · ' || c.name,
  st, pr, now() + ((g % 9) - 2 || ' days')::interval,
  case when st in ('working','waiting_reply','pending_update','complete') then now() - ((30 - g) || ' days')::interval end,
  case when st = 'complete' then now() - ((12 - g / 2) || ' days')::interval end,
  now() - ((30 - g) || ' days')::interval, (select tenant from v)
from generate_series(1, 14) g
join co c on c.i = ((g - 1) % 9) + 1
join sv s on s.i = ((g - 1) % 6) + 1
cross join lateral (select (array['working','complete','waiting_reply','working','pending','complete','submitted','working','complete','pending_update','working','complete','submitted','working'])[g] as st,
                           (array['high','normal','urgent','normal','low','normal','high','normal','normal','high','normal','low','normal','urgent'])[g] as pr) x;

-- Tickets
insert into public.tickets (company_id, subject, status, priority, assigned_to_profile_id, created_by_profile_id, created_at, resolved_at, tenant_id)
select c.id, subj, st, pr, (select me from v), (select me from v), now() - ((g * 2) || ' hours')::interval,
  case when st = 'resolved' then now() - interval '1 hour' end, (select tenant from v)
from (values
 (1,'Homepage hero not loading on Safari','open','urgent'),(2,'Add new location to Google profile','in_progress','normal'),
 (3,'Monthly report question','waiting_on_client','low'),(4,'Update pricing page copy','open','high'),
 (5,'Podcast episode 42 show notes','in_progress','normal'),(6,'Broken contact form redirect','resolved','high'),
 (7,'Request: new landing page','waiting_on_team','normal'),(8,'Invoice address change','open','low')) t(g, subj, st, pr)
join co c on c.i = ((g - 1) % 9) + 1;

-- Invoices: paid across the last 30 days for a rising sales trend, plus a few unpaid
insert into public.invoices (company_id, status, currency, invoice_number, billing_reason, issued_at, due_at, subtotal_cents, total_cents, created_by_profile_id, updated_by_profile_id, created_at, tenant_id)
select c.id, case when g <= 18 then 'paid' else 'unpaid' end, 'USD', 5000 + g, 'manual',
  now() - ((31 - g * 1.6) || ' days')::interval, now() + interval '14 days',
  amt, amt, (select me from v), (select me from v), now() - ((32 - g * 1.6) || ' days')::interval, (select tenant from v)
from generate_series(1, 22) g
join co c on c.i = ((g - 1) % 9) + 1
cross join lateral (select ((array[45000,120000,80000,65000,150000,120000,45000,80000,450000,120000,65000,150000,80000,120000,450000,120000,80000,150000,120000,65000,45000,80000])[g])::bigint * (1 + g / 12) as amt) a;

insert into public.invoice_items (invoice_id, service_id, order_id, position, name, quantity, unit_price_cents, fulfillment_status)
select i.id, case when o.id is not null then o.service_id end, o.id, 0, coalesce(s.name, 'Monthly retainer'), 1, i.total_cents,
  case when o.id is not null then 'provisioned' else 'not_applicable' end
from (select id, total_cents, company_id, row_number() over (order by invoice_number) r from public.invoices where status = 'paid') i
left join (select id, service_id, row_number() over (order by order_number) r from public.orders) o on o.r = i.r
left join public.services s on s.id = o.service_id;

insert into public.invoice_payments (invoice_id, amount_cents, currency, status, payment_method, processor, settled_at, request_id, created_by_profile_id)
select id, total_cents, 'USD', 'succeeded', 'card', 'stripe', issued_at + interval '6 hours', gen_random_uuid(), (select me from v)
from public.invoices where status = 'paid';

-- Subscriptions
insert into public.subscriptions (company_id, service_id, status, plan_source, billing_anchor, current_period_end, started_at, created_by_profile_id, updated_by_profile_id, tenant_id)
select c.id, s.id, 'active', 'admin_invoice', (now() - ((g * 3) || ' days')::interval)::date, (now() + ((30 - g * 3) || ' days')::interval)::date,
  now() - ((g * 3) || ' days')::interval, (select me from v), (select me from v), (select tenant from v)
from generate_series(1, 7) g
join co c on c.i = g
join sv s on s.i = case when g % 2 = 0 then 4 else 1 end;
commit;

-- Demo personas shown on screen instead of the QA identities.
update public.profiles p set display_name = 'Alex Morgan' from auth.users u where u.id = p.id and u.email = 'qa-local@wolf-forge.local';
update public.profiles p set display_name = 'Jordan Reyes' from auth.users u where u.id = p.id and u.email = 'wf-william@wolf-forge.local';
update public.profiles p set display_name = 'Sam Carter' from auth.users u where u.id = p.id and u.email = 'phase3a-owner@wolf-forge.local';
