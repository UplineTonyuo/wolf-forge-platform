-- Structured Reporting Phase 2 — the internal reporting builder.
--
-- Phase 1 gave reports a durable native shape (report -> ordered sections ->
-- ordered entries) but only one way in: a Quick Action that sent one external
-- link immediately. Phase 2 turns that into an operational workspace, which
-- needs two things the schema did not have.
--
--   1. A report that exists before the client is told about it. That is the
--      `status` column: a report is a private internal DRAFT until it is
--      deliberately SENT. Drafts are invisible to the client at every layer —
--      RLS policy, read RPC, unread count and mark-read all refuse them — so a
--      half-written report can never leak merely by being a row that exists.
--
--   2. Write RPCs for the builder. No session holds INSERT, UPDATE or DELETE on
--      any reporting table and that does not change here; every builder
--      mutation is a SECURITY DEFINER RPC that re-derives the actor from
--      auth.uid(), re-checks reports.send through the internal reporting
--      module, and re-resolves the report it was handed rather than trusting
--      the id it arrived with.
--
-- Ordering is positional. The builder sends sections and entries as ordered
-- JSON arrays and the database stores `ordinality - 1` as sort_order, so array
-- position is the single ordering authority and a client-supplied sort_order
-- can never disagree with the array it arrived in.
--
-- Phase 1's app_send_client_report() is deliberately left intact. It still
-- works, still notifies and is still covered by 030; it is the transitional
-- quick-send contract, not a second reporting system.

-- -----------------------------------------------------------------------------
-- Draft state
-- -----------------------------------------------------------------------------

alter table public.client_reports
  add column status text not null default 'sent';

alter table public.client_reports
  add constraint client_reports_status_valid
  check (status in ('draft', 'sent'));

/*
 * A draft has not been sent, so it has no send time. Existing rows are all sent
 * and keep the timestamp they already had; only the NOT NULL goes.
 */
alter table public.client_reports
  alter column sent_at drop not null;

alter table public.client_reports
  add constraint client_reports_sent_at_matches_status
  check (
    (status = 'sent' and sent_at is not null)
    or (status = 'draft' and sent_at is null)
  );

-- Drafts are worked on by date touched, not by date sent.
create index client_reports_draft_idx
  on public.client_reports (updated_at desc)
  where status = 'draft' and archived_at is null;

comment on column public.client_reports.status is
  'draft while the report is internal-only; sent once it has been delivered. Every client-facing read refuses drafts at both the policy and the RPC.';

-- -----------------------------------------------------------------------------
-- Client-facing reads exclude drafts
--
-- Restated at every layer rather than once. A draft must not be readable
-- because of a policy, and also must not be listable, countable or markable.
-- -----------------------------------------------------------------------------

drop policy client_reports_authorized_select on public.client_reports;

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
    and status = 'sent'
  )
);

drop policy client_report_sections_authorized_select on public.client_report_sections;

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
        and report.status = 'sent'
    )
  )
);

drop policy client_report_entries_authorized_select on public.client_report_entries;

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
        and report.status = 'sent'
    )
  )
);

-- -----------------------------------------------------------------------------
-- Internal module
--
-- module_key 'reporting' is what the internal rail reads and what
-- app_require_module_access() enforces. It is a separate key from the client's
-- 'portal_reporting' and is backed by the internal-only reports.send
-- capability, so a client account can never resolve it: app_require_module_access
-- refuses a module whose account_class is not the caller's own.
--
-- sort_order 36 sits just after Tickets (30) in the internal ordering, which is
-- where delivery work belongs.
-- -----------------------------------------------------------------------------

insert into public.permission_modules (
  module_key, label, account_class, required_permission_key, sort_order
)
values ('reporting', 'Reporting', 'internal', 'reports.send', 36)
on conflict (module_key) do update
set label = excluded.label,
    account_class = excluded.account_class,
    required_permission_key = excluded.required_permission_key,
    sort_order = excluded.sort_order,
    updated_at = now();

-- -----------------------------------------------------------------------------
-- Structure validation and replacement
--
-- One private helper owns the shape rules, so the create path and the save path
-- cannot drift apart. It raises 22023 for anything malformed, the same code the
-- Phase 1 send RPC uses for bad input.
-- -----------------------------------------------------------------------------

create function private.validate_report_sections(p_sections jsonb)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  section_element jsonb;
  entry_element jsonb;
  entry_total integer := 0;
  url_value text;
  value_value text;
begin
  if p_sections is null or jsonb_typeof(p_sections) <> 'array' then
    raise exception 'report sections must be an array' using errcode = '22023';
  end if;

  if jsonb_array_length(p_sections) > 100 then
    raise exception 'a report may not exceed 100 sections' using errcode = '22023';
  end if;

  for section_element in select * from jsonb_array_elements(p_sections) loop
    if jsonb_typeof(section_element) <> 'object'
      or section_element - array['section_key', 'title', 'entries'] <> '{}'::jsonb
      or coalesce(section_element ->> 'section_key', '') !~ '^[a-z0-9]+(_[a-z0-9]+)*$'
      or char_length(section_element ->> 'section_key') > 100
      or btrim(coalesce(section_element ->> 'title', '')) = ''
      or char_length(btrim(section_element ->> 'title')) > 200
    then
      raise exception 'invalid report section' using errcode = '22023';
    end if;

    if section_element -> 'entries' is null
      or jsonb_typeof(section_element -> 'entries') <> 'array'
      or jsonb_array_length(section_element -> 'entries') > 500
    then
      raise exception 'invalid report section entries' using errcode = '22023';
    end if;

    entry_total := entry_total + jsonb_array_length(section_element -> 'entries');

    for entry_element in select * from jsonb_array_elements(section_element -> 'entries') loop
      if jsonb_typeof(entry_element) <> 'object'
        or entry_element - array['label', 'url', 'value'] <> '{}'::jsonb
        or btrim(coalesce(entry_element ->> 'label', '')) = ''
        or char_length(btrim(entry_element ->> 'label')) > 200
      then
        raise exception 'invalid report entry' using errcode = '22023';
      end if;

      /*
       * URL and value are independently optional. An entry may carry text only,
       * a link only, or both — that distinction is the whole reason the entry
       * model exists, so neither field is allowed to imply the other.
       */
      url_value := nullif(btrim(coalesce(entry_element ->> 'url', '')), '');
      if url_value is not null
        and (url_value !~* '^https?://[^[:space:]]+$' or char_length(url_value) > 2000)
      then
        raise exception 'report links must start with http:// or https://'
          using errcode = '22023';
      end if;

      value_value := nullif(btrim(coalesce(entry_element ->> 'value', '')), '');
      if value_value is not null and char_length(value_value) > 4000 then
        raise exception 'invalid report entry value' using errcode = '22023';
      end if;
    end loop;
  end loop;

  if entry_total > 2000 then
    raise exception 'a report may not exceed 2000 entries' using errcode = '22023';
  end if;
end;
$$;

/*
 * Replaces a report's whole structure.
 *
 * Whole-document replacement rather than per-row patching: the builder always
 * holds the entire report, and replacing it atomically means a reorder, a
 * removal and an edit in the same save cannot land half-applied. The cascade on
 * client_report_sections removes the old entries with their sections.
 *
 * sort_order comes from ordinality, never from the payload.
 */
create function private.replace_report_structure(
  p_report_id uuid,
  p_sections jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.validate_report_sections(p_sections);

  delete from public.client_report_sections where report_id = p_report_id;

  with inserted_sections as (
    insert into public.client_report_sections (report_id, section_key, title, sort_order)
    select
      p_report_id,
      section_element ->> 'section_key',
      btrim(section_element ->> 'title'),
      (section_ordinality - 1)::integer
    from jsonb_array_elements(p_sections)
      with ordinality as sections(section_element, section_ordinality)
    returning id, sort_order
  )
  insert into public.client_report_entries (section_id, label, url, value, sort_order)
  select
    inserted_sections.id,
    btrim(entry_element ->> 'label'),
    nullif(btrim(coalesce(entry_element ->> 'url', '')), ''),
    nullif(btrim(coalesce(entry_element ->> 'value', '')), ''),
    (entry_ordinality - 1)::integer
  from jsonb_array_elements(p_sections)
    with ordinality as sections(section_element, section_ordinality)
  join inserted_sections
    on inserted_sections.sort_order = (section_ordinality - 1)::integer
  cross join lateral jsonb_array_elements(section_element -> 'entries')
    with ordinality as entries(entry_element, entry_ordinality);
end;
$$;

/*
 * The single authorization gate for every builder mutation.
 *
 * A report id arriving from a browser is request data, so this re-resolves the
 * row: it refuses one that does not exist, one that is archived, and one whose
 * company has been archived. Callers never trust the id they were handed.
 */
create function private.require_editable_report(p_report_id uuid)
returns public.client_reports
language plpgsql
security definer
set search_path = ''
as $$
declare
  report_row public.client_reports;
begin
  if p_report_id is null then
    raise exception 'invalid report reference' using errcode = '22023';
  end if;

  perform private.require_internal_actor();
  perform public.app_require_module_access('reporting');
  perform private.require_permission('reports.send');

  select * into report_row
  from public.client_reports as candidate
  where candidate.id = p_report_id
    and candidate.archived_at is null;

  if report_row.id is null then
    raise exception 'report access is denied' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.companies as company
    where company.id = report_row.company_id and company.archived_at is null
  ) then
    raise exception 'active client company is required' using errcode = '23503';
  end if;

  return report_row;
end;
$$;

-- -----------------------------------------------------------------------------
-- Create a draft
-- -----------------------------------------------------------------------------

create function public.app_create_report_draft(
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
  existing_id uuid;
  report_row public.client_reports;
  company_row public.companies;
  company_id_value uuid;
  report_lane_value text := btrim(coalesce(p_payload ->> 'report_lane', ''));
  package_label_value text := btrim(coalesce(p_payload ->> 'package_label', ''));
  title_value text := btrim(coalesce(p_payload ->> 'title', ''));
  sections_value jsonb;
begin
  if p_request_id is null
    or p_payload is null
    or jsonb_typeof(p_payload) <> 'object'
    or p_payload - array['company_id', 'report_lane', 'package_label', 'title', 'sections']
       <> '{}'::jsonb
    or report_lane_value not in ('seo_package', 'gmb_management')
    or package_label_value = ''
    or char_length(package_label_value) > 200
    or title_value = ''
    or char_length(title_value) > 200
  then
    raise exception 'invalid client report input' using errcode = '22023';
  end if;

  actor_id := private.require_internal_actor();
  perform public.app_require_module_access('reporting');
  perform private.require_permission('reports.send');

  sections_value := coalesce(p_payload -> 'sections', '[]'::jsonb);
  perform private.validate_report_sections(sections_value);

  company_id_value := nullif(p_payload ->> 'company_id', '')::uuid;

  select * into company_row
  from public.companies as candidate
  where candidate.id = company_id_value
    and candidate.archived_at is null;

  if company_row.id is null then
    raise exception 'active client company is required' using errcode = '23503';
  end if;

  -- Retry-safe. A double-submitted "New report" returns the draft it created.
  existing_id := private.find_create_request(
    actor_id, 'client_report.draft', p_request_id, p_payload
  );
  if existing_id is not null then
    select * into report_row from public.client_reports where id = existing_id;
    return report_row;
  end if;

  insert into public.client_reports (
    company_id, report_lane, package_label, title, sent_by_profile_id, status, sent_at
  )
  values (
    company_id_value, report_lane_value, package_label_value, title_value,
    actor_id, 'draft', null
  )
  returning * into report_row;

  perform private.replace_report_structure(report_row.id, sections_value);

  perform private.remember_create_request(
    actor_id, 'client_report.draft', p_request_id, p_payload, report_row.id
  );

  return report_row;
end;
$$;

-- -----------------------------------------------------------------------------
-- Save a draft
--
-- Not idempotency-keyed: saving overwrites a known report, so repeating it
-- converges rather than duplicating. A sent report is immutable here.
-- -----------------------------------------------------------------------------

create function public.app_save_report_draft(
  p_report_id uuid,
  p_payload jsonb
)
returns public.client_reports
language plpgsql
security definer
set search_path = ''
as $$
declare
  report_row public.client_reports;
  report_lane_value text := btrim(coalesce(p_payload ->> 'report_lane', ''));
  package_label_value text := btrim(coalesce(p_payload ->> 'package_label', ''));
  title_value text := btrim(coalesce(p_payload ->> 'title', ''));
  sections_value jsonb;
begin
  if p_payload is null
    or jsonb_typeof(p_payload) <> 'object'
    or p_payload - array['report_lane', 'package_label', 'title', 'sections'] <> '{}'::jsonb
    or report_lane_value not in ('seo_package', 'gmb_management')
    or package_label_value = ''
    or char_length(package_label_value) > 200
    or title_value = ''
    or char_length(title_value) > 200
  then
    raise exception 'invalid client report input' using errcode = '22023';
  end if;

  report_row := private.require_editable_report(p_report_id);

  if report_row.status <> 'draft' then
    raise exception 'a sent report can no longer be edited' using errcode = '42501';
  end if;

  sections_value := coalesce(p_payload -> 'sections', '[]'::jsonb);

  update public.client_reports
  set report_lane = report_lane_value,
      package_label = package_label_value,
      title = title_value
  where id = report_row.id
  returning * into report_row;

  perform private.replace_report_structure(report_row.id, sections_value);

  return report_row;
end;
$$;

-- -----------------------------------------------------------------------------
-- Send a draft
--
-- The one intentional act. Flipping status, stamping sent_at, notifying the
-- company's client users and recording the audit event happen in one
-- transaction, so a report the client is never told about cannot exist.
--
-- Duplicate-send protection is layered: an already-sent report returns
-- unchanged and notifies nobody, a retried request id returns the same row, and
-- the notification event key ('client-report:<id>') is unique per recipient
-- regardless of how the call arrived.
-- -----------------------------------------------------------------------------

create function public.app_send_report_draft(
  p_request_id uuid,
  p_report_id uuid
)
returns public.client_reports
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  report_row public.client_reports;
  company_row public.companies;
  existing_id uuid;
begin
  if p_request_id is null then
    raise exception 'invalid report reference' using errcode = '22023';
  end if;

  report_row := private.require_editable_report(p_report_id);
  actor_id := private.require_internal_actor();

  -- Already delivered: report the truth, notify nobody a second time.
  if report_row.status = 'sent' then
    return report_row;
  end if;

  existing_id := private.find_create_request(
    actor_id, 'client_report.send_draft', p_request_id,
    jsonb_build_object('report_id', p_report_id)
  );
  if existing_id is not null then
    select * into report_row from public.client_reports where id = existing_id;
    return report_row;
  end if;

  if not exists (
    select 1 from public.client_report_sections where report_id = report_row.id
  ) then
    raise exception 'a report needs at least one section before it is sent'
      using errcode = '22023';
  end if;

  select * into company_row from public.companies where id = report_row.company_id;

  update public.client_reports
  set status = 'sent', sent_at = now(), sent_by_profile_id = actor_id
  where id = report_row.id
  returning * into report_row;

  perform private.emit_company_client_notification(
    report_row.company_id,
    'client-report:' || report_row.id::text,
    'report',
    'info',
    'New ' || report_row.package_label || ' report from Wolf Forge',
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
    format('Sent a %s report to %s.', report_row.package_label, company_row.name),
    jsonb_build_object(
      'company_id', report_row.company_id,
      'report_lane', report_row.report_lane,
      'package_label', report_row.package_label
    )
  );

  perform private.remember_create_request(
    actor_id, 'client_report.send_draft', p_request_id,
    jsonb_build_object('report_id', p_report_id), report_row.id
  );

  return report_row;
end;
$$;

-- -----------------------------------------------------------------------------
-- Discard a draft
--
-- Drafts only. A sent report is never removed — the client has already seen it.
-- -----------------------------------------------------------------------------

create function public.app_discard_report_draft(
  p_report_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  report_row public.client_reports;
begin
  report_row := private.require_editable_report(p_report_id);

  if report_row.status <> 'draft' then
    raise exception 'a sent report cannot be discarded' using errcode = '42501';
  end if;

  delete from public.client_reports where id = report_row.id;
  return true;
end;
$$;

-- -----------------------------------------------------------------------------
-- Internal read models
-- -----------------------------------------------------------------------------

create function public.app_list_internal_reports(
  p_status text default null,
  p_limit integer default 100
)
returns table (
  report_id uuid,
  company_id uuid,
  company_name text,
  report_lane text,
  package_label text,
  title text,
  status text,
  section_count integer,
  entry_count integer,
  sent_at timestamptz,
  updated_at timestamptz,
  sent_by_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  row_limit integer := least(greatest(coalesce(p_limit, 100), 1), 200);
  status_filter text := nullif(btrim(coalesce(p_status, '')), '');
begin
  perform private.require_internal_actor();
  perform public.app_require_module_access('reporting');

  if status_filter is not null and status_filter not in ('draft', 'sent') then
    raise exception 'unknown report status: %', status_filter using errcode = '22023';
  end if;

  return query
  select
    report.id,
    report.company_id,
    company.name,
    report.report_lane,
    report.package_label,
    report.title,
    report.status,
    (
      select count(*)::integer from public.client_report_sections as section
      where section.report_id = report.id
    ),
    (
      select count(*)::integer
      from public.client_report_sections as section
      join public.client_report_entries as entry on entry.section_id = section.id
      where section.report_id = report.id
    ),
    report.sent_at,
    report.updated_at,
    sender.display_name
  from public.client_reports as report
  join public.companies as company on company.id = report.company_id
  left join public.profiles as sender on sender.id = report.sent_by_profile_id
  where report.archived_at is null
    and (status_filter is null or report.status = status_filter)
  -- A draft has no sent_at, so the working timestamp is what orders the list.
  order by coalesce(report.sent_at, report.updated_at) desc, report.id
  limit row_limit;
end;
$$;

/*
 * One report, whole. Returned as a single JSON document because the builder
 * needs the report and its complete ordered structure together or not at all —
 * separate round trips could show a section list that no longer matches its
 * entries.
 */
create function public.app_get_internal_report(
  p_report_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  report_row public.client_reports;
  company_row public.companies;
begin
  if p_report_id is null then
    raise exception 'invalid report reference' using errcode = '22023';
  end if;

  perform private.require_internal_actor();
  perform public.app_require_module_access('reporting');

  select * into report_row
  from public.client_reports as candidate
  where candidate.id = p_report_id and candidate.archived_at is null;

  if report_row.id is null then
    raise exception 'report access is denied' using errcode = '42501';
  end if;

  select * into company_row from public.companies where id = report_row.company_id;

  return jsonb_build_object(
    'report_id', report_row.id,
    'company_id', report_row.company_id,
    'company_name', company_row.name,
    'report_lane', report_row.report_lane,
    'package_label', report_row.package_label,
    'title', report_row.title,
    'status', report_row.status,
    'sent_at', report_row.sent_at,
    'updated_at', report_row.updated_at,
    'sections', coalesce(
      (
        select jsonb_agg(
          ordered_sections.section_document
          order by ordered_sections.section_sort, ordered_sections.section_id
        )
        from (
          select
            section.sort_order as section_sort,
            section.id as section_id,
            jsonb_build_object(
              'section_key', section.section_key,
              'title', section.title,
              'entries', coalesce(
                (
                  select jsonb_agg(
                    jsonb_build_object(
                      'label', entry.label,
                      'url', entry.url,
                      'value', entry.value
                    )
                    order by entry.sort_order, entry.id
                  )
                  from public.client_report_entries as entry
                  where entry.section_id = section.id
                ),
                '[]'::jsonb
              )
            ) as section_document
          from public.client_report_sections as section
          where section.report_id = report_row.id
        ) as ordered_sections
      ),
      '[]'::jsonb
    )
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Client-facing reads refuse drafts
-- -----------------------------------------------------------------------------

create or replace function public.app_list_my_client_reports(
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
    and report.status = 'sent'
  order by report.sent_at desc, report.id
  limit row_limit;
end;
$$;

create or replace function public.app_mark_client_report_read(
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
      and report.status = 'sent'
  ) then
    raise exception 'report access is denied' using errcode = '42501';
  end if;

  insert into public.client_report_reads (report_id, profile_id)
  values (p_report_id, caller_id)
  on conflict (report_id, profile_id) do nothing;

  return true;
end;
$$;

create or replace function public.app_count_my_unread_reports()
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

  -- A denied module reports zero rather than raising: the rail asks this on
  -- every request and a denied account simply has no badge.
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
    and report.status = 'sent'
    and read_row.profile_id is null;

  return coalesce(unread, 0);
end;
$$;

-- -----------------------------------------------------------------------------
-- Function boundary
-- -----------------------------------------------------------------------------

revoke all on function private.validate_report_sections(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.replace_report_structure(uuid, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.require_editable_report(uuid)
  from public, anon, authenticated, service_role;

revoke all on function public.app_create_report_draft(uuid, jsonb) from public, anon, service_role;
revoke all on function public.app_save_report_draft(uuid, jsonb) from public, anon, service_role;
revoke all on function public.app_send_report_draft(uuid, uuid) from public, anon, service_role;
revoke all on function public.app_discard_report_draft(uuid) from public, anon, service_role;
revoke all on function public.app_list_internal_reports(text, integer) from public, anon, service_role;
revoke all on function public.app_get_internal_report(uuid) from public, anon, service_role;

grant execute on function public.app_create_report_draft(uuid, jsonb) to authenticated;
grant execute on function public.app_save_report_draft(uuid, jsonb) to authenticated;
grant execute on function public.app_send_report_draft(uuid, uuid) to authenticated;
grant execute on function public.app_discard_report_draft(uuid) to authenticated;
grant execute on function public.app_list_internal_reports(text, integer) to authenticated;
grant execute on function public.app_get_internal_report(uuid) to authenticated;

comment on function public.app_create_report_draft(uuid, jsonb) is
  'Creates an internal-only report draft with its full ordered structure. Requires an internal actor holding reports.send through the reporting module. Retry-safe on request id.';

comment on function public.app_save_report_draft(uuid, jsonb) is
  'Replaces a draft report''s header and entire ordered section/entry structure atomically. Refuses sent reports. Array position is the stored order.';

comment on function public.app_send_report_draft(uuid, uuid) is
  'Delivers a draft: flips status to sent, stamps sent_at, notifies the company''s client users and records the audit event in one transaction. Sending an already-sent report notifies nobody.';

comment on function public.app_discard_report_draft(uuid) is
  'Removes an unsent draft. A sent report is refused, because the client has already seen it.';

comment on function public.app_list_internal_reports(text, integer) is
  'Internal reporting workspace list, optionally filtered to draft or sent. Gated by the internal reporting module.';

comment on function public.app_get_internal_report(uuid) is
  'One report and its complete ordered structure as a single JSON document, for the internal builder and preview.';
