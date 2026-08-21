-- Client reporting.
--
-- Wolf Forge sends performance reports to a client company; the client sees
-- their own reporting history in the portal. Reports have two primary lanes:
-- seo_package and gmb_management. Package names such as Platinum SEO are open
-- labels under a lane, never closed report types.
--
-- Report content is native structure: ordered sections containing ordered
-- entries. An entry always has a label and may also carry text/status, an
-- external http(s) asset, or both. No preset section is mandatory, and section
-- keys remain open so Phase 2 can add custom sections without a schema change.
--
-- Reports belong to a COMPANY, never to a single contact record, so every
-- legitimate portal user of that company sees them and losing one contact never
-- loses the history.
--
-- Two capabilities, deliberately disjoint:
--
--   reports.send     internal. Owner and admin. Sending is the only internal
--                    write, and Quick Action is its only V1 entry point.
--   reporting.view   client. Backs the portal_reporting module.
--
-- They are separate for the same reason store.view is separate from
-- services.view: private.is_client_eligible_permission() derives client
-- eligibility from client-class modules, so a shared key would make an internal
-- capability grantable to a client account through the override path.

-- -----------------------------------------------------------------------------
-- Reports
-- -----------------------------------------------------------------------------

create table public.client_reports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete restrict,
  report_lane text not null,
  package_label text not null,
  title text not null,
  sent_by_profile_id uuid not null references public.profiles (id) on delete restrict,
  sent_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,

  constraint client_reports_lane_valid
    check (report_lane in ('seo_package', 'gmb_management')),

  constraint client_reports_package_label_not_blank
    check (btrim(package_label) <> '' and char_length(package_label) <= 200),

  constraint client_reports_title_not_blank
    check (btrim(title) <> '' and char_length(title) <= 200)
);

create index client_reports_company_sent_idx
  on public.client_reports (company_id, sent_at desc)
  where archived_at is null;

create index client_reports_sent_idx
  on public.client_reports (sent_at desc)
  where archived_at is null;

create trigger client_reports_set_updated_at
before update on public.client_reports
for each row
execute function private.set_updated_at();

comment on table public.client_reports is
  'Performance reports delivered to a client company. report_lane is seo_package or gmb_management; package_label remains open for future services. Written only through reporting RPCs.';

-- -----------------------------------------------------------------------------
-- Native report structure
-- -----------------------------------------------------------------------------

create table public.client_report_sections (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.client_reports (id) on delete cascade,
  section_key text not null,
  title text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint client_report_sections_key_valid check (
    section_key ~ '^[a-z0-9]+(_[a-z0-9]+)*$'
    and char_length(section_key) <= 100
  ),
  constraint client_report_sections_title_not_blank
    check (btrim(title) <> '' and char_length(title) <= 200),
  constraint client_report_sections_sort_order_valid
    check (sort_order between 0 and 100000)
);

create index client_report_sections_report_order_idx
  on public.client_report_sections (report_id, sort_order, id);

create trigger client_report_sections_set_updated_at
before update on public.client_report_sections
for each row
execute function private.set_updated_at();

comment on table public.client_report_sections is
  'Ordered, editable sections of a client report. section_key is intentionally open for custom Phase 2 sections; presets are defaults, not constraints.';

create table public.client_report_entries (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.client_report_sections (id) on delete cascade,
  label text not null,
  url text,
  value text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint client_report_entries_label_not_blank
    check (btrim(label) <> '' and char_length(label) <= 200),
  constraint client_report_entries_url_scheme check (
    url is null
    or (url ~* '^https?://[^[:space:]]+$' and char_length(url) <= 2000)
  ),
  constraint client_report_entries_value_valid
    check (value is null or (btrim(value) <> '' and char_length(value) <= 4000)),
  constraint client_report_entries_sort_order_valid
    check (sort_order between 0 and 100000)
);

create index client_report_entries_section_order_idx
  on public.client_report_entries (section_id, sort_order, id);

create trigger client_report_entries_set_updated_at
before update on public.client_report_entries
for each row
execute function private.set_updated_at();

comment on table public.client_report_entries is
  'Ordered native report content. URL is optional: entries may be text/status only, an external asset, or both.';

-- -----------------------------------------------------------------------------
-- Read state
--
-- Per person, not per company: one colleague opening a report must not clear
-- the "New" mark for everyone else at the company. Absence of a row means
-- unread, so nothing has to be backfilled and a report never disappears once
-- opened — read state only changes emphasis.
-- -----------------------------------------------------------------------------

create table public.client_report_reads (
  report_id uuid not null references public.client_reports (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (report_id, profile_id)
);

create index client_report_reads_profile_idx
  on public.client_report_reads (profile_id);

-- -----------------------------------------------------------------------------
-- Capabilities and module
-- -----------------------------------------------------------------------------

insert into public.permissions (permission_key, category, label, description)
values
  (
    'reports.send',
    'reports',
    'Send client reports',
    'Send a structured performance report to a client company.'
  ),
  (
    'reporting.view',
    'reports',
    'View reporting',
    'View the reporting history shared with your own company.'
  )
on conflict (permission_key) do update
set category = excluded.category,
    label = excluded.label,
    description = excluded.description,
    updated_at = now();

insert into public.role_permissions (role_id, permission_key, allowed)
select role_row.id, 'reports.send', true
from public.roles as role_row
where role_row.name in ('owner', 'admin')
on conflict (role_id, permission_key) do update
set allowed = excluded.allowed, updated_at = now();

insert into public.role_permissions (role_id, permission_key, allowed)
select role_row.id, 'reporting.view', true
from public.roles as role_row
where role_row.name = 'client'
on conflict (role_id, permission_key) do update
set allowed = excluded.allowed, updated_at = now();

-- sort_order 35 places Reporting after Projects (20) and Tickets (30) and
-- before Forms (40), which is where the portal rail groups delivery work.
insert into public.permission_modules (
  module_key, label, account_class, required_permission_key, sort_order
)
values ('portal_reporting', 'Reporting', 'client', 'reporting.view', 35)
on conflict (module_key) do update
set label = excluded.label,
    account_class = excluded.account_class,
    required_permission_key = excluded.required_permission_key,
    sort_order = excluded.sort_order,
    updated_at = now();

-- -----------------------------------------------------------------------------
-- Shared constraint widenings
-- -----------------------------------------------------------------------------

alter table public.notifications drop constraint notifications_category_valid;
alter table public.notifications add constraint notifications_category_valid check (
  category in (
    'project', 'client', 'form', 'coupon', 'ticket',
    'payment', 'wallet', 'store', 'report'
  )
);

alter table public.activity_events drop constraint activity_events_entity_type_valid;
alter table public.activity_events add constraint activity_events_entity_type_valid check (
  entity_type in (
    'company', 'client_contact', 'service_folder', 'service', 'order',
    'order_task', 'profile', 'coupon', 'invoice', 'subscription',
    'form', 'form_assignment', 'form_submission', 'ticket', 'service_interest',
    'client_report'
  )
);

-- -----------------------------------------------------------------------------
-- Row level security
--
-- Reads are decided by the policies below; writes are decided by the RPCs,
-- because no session holds INSERT, UPDATE or DELETE on any reporting table.
-- -----------------------------------------------------------------------------

alter table public.client_reports enable row level security;
alter table public.client_reports force row level security;
revoke all on table public.client_reports from public, anon, authenticated, service_role;

/*
 * Reads go through RLS, writes do not exist. SELECT is granted so the policies
 * below are the operative boundary rather than dead code behind a missing
 * privilege — the same shape public.invoices uses. Every write path remains a
 * SECURITY DEFINER RPC, so no session can insert, update or delete a report.
 */
grant select on table public.client_reports to authenticated;

create policy client_reports_authorized_select
on public.client_reports for select to authenticated
using (
  (
    (select private.is_internal_user())
    and public.app_has_permission('reports.send')
  )
  or (
    (select private.is_client_user())
    and public.app_has_permission('reporting.view')
    and company_id = (select private.current_user_company_id())
    and archived_at is null
  )
);

alter table public.client_report_sections enable row level security;
alter table public.client_report_sections force row level security;
revoke all on table public.client_report_sections from public, anon, authenticated, service_role;
grant select on table public.client_report_sections to authenticated;

create policy client_report_sections_authorized_select
on public.client_report_sections for select to authenticated
using (
  (
    (select private.is_internal_user())
    and public.app_has_permission('reports.send')
  )
  or (
    (select private.is_client_user())
    and public.app_has_permission('reporting.view')
    and exists (
      select 1 from public.client_reports as report
      where report.id = client_report_sections.report_id
        and report.company_id = (select private.current_user_company_id())
        and report.archived_at is null
    )
  )
);

alter table public.client_report_entries enable row level security;
alter table public.client_report_entries force row level security;
revoke all on table public.client_report_entries from public, anon, authenticated, service_role;
grant select on table public.client_report_entries to authenticated;

create policy client_report_entries_authorized_select
on public.client_report_entries for select to authenticated
using (
  (
    (select private.is_internal_user())
    and public.app_has_permission('reports.send')
  )
  or (
    (select private.is_client_user())
    and public.app_has_permission('reporting.view')
    and exists (
      select 1
      from public.client_report_sections as section
      join public.client_reports as report on report.id = section.report_id
      where section.id = client_report_entries.section_id
        and report.company_id = (select private.current_user_company_id())
        and report.archived_at is null
    )
  )
);

alter table public.client_report_reads enable row level security;
alter table public.client_report_reads force row level security;
revoke all on table public.client_report_reads from public, anon, authenticated, service_role;

-- Own rows only, and only for reading. Marking read is the RPC's job.
grant select on table public.client_report_reads to authenticated;

create policy client_report_reads_select_own
on public.client_report_reads for select to authenticated
using (profile_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- Sending
--
-- One transaction: the report row and the client notifications either both land
-- or neither does. A report the client is never told about is worse than no
-- report, so this is deliberately not an eventual-delivery design.
-- -----------------------------------------------------------------------------

create function public.app_send_client_report(
  p_request_id uuid,
  p_payload jsonb
)
returns public.client_reports
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  report_row public.client_reports;
  existing_id uuid;
  company_row public.companies;
  company_id_value uuid;
  report_lane_value text := btrim(coalesce(p_payload ->> 'report_lane', ''));
  package_label_value text := btrim(coalesce(p_payload ->> 'package_label', ''));
  title_value text := btrim(coalesce(p_payload ->> 'title', ''));
  url_value text := btrim(coalesce(p_payload ->> 'report_url', ''));
  section_id_value uuid;
begin
  if p_request_id is null
    or p_payload is null
    or jsonb_typeof(p_payload) <> 'object'
    or p_payload - array['company_id', 'report_lane', 'package_label', 'title', 'report_url'] <> '{}'::jsonb
    or report_lane_value not in ('seo_package', 'gmb_management')
    or package_label_value = ''
    or char_length(package_label_value) > 200
    or title_value = ''
    or char_length(title_value) > 200
    or url_value !~* '^https?://[^[:space:]]+$'
    or char_length(url_value) > 2000
  then
    raise exception 'invalid client report input' using errcode = '22023';
  end if;

  actor_id := private.require_internal_actor();
  perform private.require_permission('reports.send');

  company_id_value := nullif(p_payload ->> 'company_id', '')::uuid;

  select * into company_row
  from public.companies as candidate
  where candidate.id = company_id_value
    and candidate.archived_at is null;

  if company_row.id is null then
    raise exception 'active client company is required' using errcode = '23503';
  end if;

  -- Retry-safe: the same request id returns the report it already created.
  existing_id := private.find_create_request(actor_id, 'client_report.send', p_request_id, p_payload);
  if existing_id is not null then
    select * into report_row from public.client_reports where id = existing_id;
    return report_row;
  end if;

  insert into public.client_reports (
    company_id, report_lane, package_label, title, sent_by_profile_id
  )
  values (
    company_id_value, report_lane_value, package_label_value, title_value, actor_id
  )
  returning * into report_row;

  /*
   * Phase 1's quick sender supplies one external asset. Store it in the native
   * child-entry model so the report root never becomes a URL-only dead end.
   * Phase 2 may replace this default section with any editable structure.
   */
  insert into public.client_report_sections (report_id, section_key, title, sort_order)
  values (report_row.id, 'external_report', 'Report', 0)
  returning id into section_id_value;

  insert into public.client_report_entries (section_id, label, url, sort_order)
  values (section_id_value, 'View report', url_value, 0);

  /*
   * Fan-out follows the established company-client pattern, so only live client
   * profiles of the selected company are told. No other company can be reached
   * from here, and the recipient list is never supplied by the caller.
   */
  perform private.emit_company_client_notification(
    company_id_value,
    'client-report:' || report_row.id::text,
    'report',
    'info',
    'New ' || package_label_value || ' report from Wolf Forge',
    report_row.title,
    '/account/reporting',
    'client_report',
    report_row.id,
    actor_id,
    report_row.sent_at
  );

  perform private.record_authenticated_activity(
    'client_report',
    report_row.id,
    'client_report.sent',
    format('Sent a %s report to %s.', package_label_value, company_row.name),
    jsonb_build_object(
      'company_id', company_id_value,
      'report_lane', report_lane_value,
      'package_label', package_label_value
    )
  );

  perform private.remember_create_request(
    actor_id, 'client_report.send', p_request_id, p_payload, report_row.id
  );

  return report_row;
end;
$$;

-- -----------------------------------------------------------------------------
-- Client read model
--
-- Company comes from auth.uid(); the caller supplies nothing. Read state is
-- resolved per calling profile, so "New" is personal to whoever is looking.
-- -----------------------------------------------------------------------------

create function public.app_list_my_client_reports(
  p_limit integer default 100
)
returns table (
  report_id uuid,
  report_lane text,
  package_label text,
  title text,
  report_url text,
  sent_at timestamptz,
  is_read boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  company_id_value uuid;
  row_limit integer := least(greatest(coalesce(p_limit, 100), 1), 200);
begin
  perform public.app_require_module_access('portal_reporting');

  company_id_value := private.current_user_company_id();
  if company_id_value is null then
    raise exception 'authenticated client account is required' using errcode = '42501';
  end if;

  return query
  select
    report.id,
    report.report_lane,
    report.package_label,
    report.title,
    primary_asset.url,
    report.sent_at,
    (read_row.profile_id is not null)
  from public.client_reports as report
  left join lateral (
    select entry.url
    from public.client_report_sections as section
    join public.client_report_entries as entry on entry.section_id = section.id
    where section.report_id = report.id
      and entry.url is not null
    order by section.sort_order, section.id, entry.sort_order, entry.id
    limit 1
  ) as primary_asset on true
  left join public.client_report_reads as read_row
    on read_row.report_id = report.id
   and read_row.profile_id = caller_id
  where report.company_id = company_id_value
    and report.archived_at is null
  order by report.sent_at desc, report.id
  limit row_limit;
end;
$$;

-- -----------------------------------------------------------------------------
-- Marking a report read
--
-- Called when the client deliberately opens a report. Idempotent, and scoped to
-- the caller's own company — a report id from another company simply is not
-- found.
-- -----------------------------------------------------------------------------

create function public.app_mark_client_report_read(
  p_report_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  company_id_value uuid;
begin
  if p_report_id is null then
    raise exception 'invalid report reference' using errcode = '22023';
  end if;

  perform public.app_require_module_access('portal_reporting');

  company_id_value := private.current_user_company_id();
  if company_id_value is null then
    raise exception 'authenticated client account is required' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.client_reports as report
    where report.id = p_report_id
      and report.company_id = company_id_value
      and report.archived_at is null
  ) then
    raise exception 'report access is denied' using errcode = '42501';
  end if;

  insert into public.client_report_reads (report_id, profile_id)
  values (p_report_id, caller_id)
  on conflict (report_id, profile_id) do nothing;

  return true;
end;
$$;

-- -----------------------------------------------------------------------------
-- Unread count, for the rail badge
-- -----------------------------------------------------------------------------

create function public.app_count_my_unread_reports()
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  company_id_value uuid := private.current_user_company_id();
  unread integer;
begin
  if caller_id is null or company_id_value is null then
    return 0;
  end if;

  -- Denied module reports zero rather than raising: the rail asks this on every
  -- request and a denied account simply has no badge.
  if not private.current_user_has_permission('reporting.view') then
    return 0;
  end if;

  select count(*)::integer into unread
  from public.client_reports as report
  left join public.client_report_reads as read_row
    on read_row.report_id = report.id
   and read_row.profile_id = caller_id
  where report.company_id = company_id_value
    and report.archived_at is null
    and read_row.profile_id is null;

  return coalesce(unread, 0);
end;
$$;

-- -----------------------------------------------------------------------------
-- Function boundary
-- -----------------------------------------------------------------------------

revoke all on function public.app_send_client_report(uuid, jsonb) from public, anon, service_role;
revoke all on function public.app_list_my_client_reports(integer) from public, anon, service_role;
revoke all on function public.app_mark_client_report_read(uuid) from public, anon, service_role;
revoke all on function public.app_count_my_unread_reports() from public, anon, service_role;

grant execute on function public.app_send_client_report(uuid, jsonb) to authenticated;
grant execute on function public.app_list_my_client_reports(integer) to authenticated;
grant execute on function public.app_mark_client_report_read(uuid) to authenticated;
grant execute on function public.app_count_my_unread_reports() to authenticated;

comment on function public.app_send_client_report(uuid, jsonb) is
  'Creates a structured report with a Phase 1 external-asset entry and notifies that company''s client users in the same transaction. Requires an internal actor holding reports.send.';
