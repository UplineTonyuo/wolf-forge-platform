-- WL-2.1: Client report authorization is Tenant-bound.
--
-- Concrete attack closed: these SECURITY DEFINER functions run as postgres, so
-- RLS never applied inside them. They checked the caller's internal role and
-- reporting permission in the CURRENT Tenant, then looked the target report or
-- Client up by id alone. A Tenant B admin/owner who knew a Wolf Forge report id
-- could read it, edit it, send it to the Wolf Forge Client or delete it (and the
-- reverse). Knowing an id must not matter.
--
-- Pattern (no new helper): the existing membership/capability checks stay as
-- they are, and every lookup of a caller-supplied report / Client / Service id
-- also requires `tenant_id = private.current_tenant_id()`. Secondary lookups
-- by an id read from an already Tenant-checked report stay as they were; the
-- WL-1C.8 composite keys pin those rows to the report's Tenant.
--
-- No resolved Tenant (no membership, archived membership, foreign or malformed
-- selector) is NULL, which matches nothing, so the call fails closed with the
-- same error as a missing row.
--
-- Subscriptions are reached only through a Tenant-checked Client and the
-- WL-1C.8 composite keys pin them to it. The one-time deliverables ledger has no
-- tenant_id; it is read only by a Tenant-checked Client id and written only from
-- a Tenant-checked report.
--
-- The direct-read RLS policies on reports, sections and entries had the same
-- gap (internal branch = role + permission, any Tenant), so a Tenant B admin
-- could read Wolf Forge reports straight from the tables. Their internal branch
-- now requires the report's Tenant too; the client branch was already bound
-- through private.current_user_company_id().
-- Client portal report functions are already Tenant-bound through
-- private.current_user_company_id() and are unchanged.

create or replace function private.require_editable_report(p_report_id uuid)
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
    and candidate.tenant_id = (select private.current_tenant_id())
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

create or replace function public.app_get_internal_report(p_report_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  report_row public.client_reports;
  company_row public.companies;
  service_name_value text;
begin
  if p_report_id is null then
    raise exception 'invalid report reference' using errcode = '22023';
  end if;

  perform private.require_internal_actor();
  perform public.app_require_module_access('reporting');

  select * into report_row
  from public.client_reports as candidate
  where candidate.id = p_report_id and candidate.archived_at is null
    and candidate.tenant_id = (select private.current_tenant_id());

  if report_row.id is null then
    raise exception 'report access is denied' using errcode = '42501';
  end if;

  select * into company_row from public.companies where id = report_row.company_id;
  select service.name into service_name_value
  from public.services as service where service.id = report_row.service_id;

  return jsonb_build_object(
    'report_id', report_row.id,
    'company_id', report_row.company_id,
    'company_name', company_row.name,
    'service_id', report_row.service_id,
    'service_name', service_name_value,
    'subscription_id', report_row.subscription_id,
    'wizard_step_key', report_row.wizard_step_key,
    'completed_one_time_item_keys', coalesce(
      (
        select jsonb_agg(completion.item_key order by completion.item_key)
        from private.reported_one_time_deliverables as completion
        where report_row.service_id is not null
          and completion.company_id = report_row.company_id
          and completion.service_id = report_row.service_id
          and (
            (report_row.subscription_id is null and completion.subscription_id is null)
            or completion.subscription_id = report_row.subscription_id
          )
      ),
      '[]'::jsonb
    ),
    'report_lane', report_row.report_lane,
    'package_label', report_row.package_label,
    'title', report_row.title,
    'status', report_row.status,
    'sent_at', report_row.sent_at,
    'updated_at', report_row.updated_at,
    'reporting_period_month', report_row.reporting_period_month,
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
                    jsonb_strip_nulls(jsonb_build_object(
                      'label', entry.label,
                      'url', entry.url,
                      'value', entry.value,
                      'one_time_item_key', entry.one_time_item_key,
                      'one_time_completed', case
                        when entry.one_time_item_key is null then null
                        else entry.one_time_completed
                      end
                    ))
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

create or replace function public.app_list_internal_reports(p_status text default null, p_limit integer default 100)
returns table(report_id uuid, company_id uuid, company_name text, report_lane text, package_label text, title text, status text, section_count integer, entry_count integer, sent_at timestamp with time zone, updated_at timestamp with time zone, sent_by_name text)
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
    and report.tenant_id = (select private.current_tenant_id())
    and (status_filter is null or report.status = status_filter)
  -- A draft has no sent_at, so the working timestamp is what orders the list.
  order by coalesce(report.sent_at, report.updated_at) desc, report.id
  limit row_limit;
end;
$$;

create or replace function public.app_get_report_send_status(p_report_id uuid)
returns table(can_send boolean, send_anytime boolean, reporting_period_month date, window_start date, window_end date)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  report_row public.client_reports;
  bounds record;
begin
  perform private.require_internal_actor();
  perform public.app_require_module_access('reporting');
  perform private.require_permission('reports.send');

  select * into report_row
  from public.client_reports as candidate
  where candidate.id = p_report_id and candidate.archived_at is null
    and candidate.tenant_id = (select private.current_tenant_id());

  if report_row.id is null then
    raise exception 'report access is denied' using errcode = '42501';
  end if;

  select * into bounds from private.reporting_window_bounds(report_row.reporting_period_month);

  return query
  select
    private.report_send_authorized_for_period(report_row.reporting_period_month),
    private.current_user_has_permission('reports.send_anytime'),
    report_row.reporting_period_month,
    bounds.window_start,
    bounds.window_end;
end;
$$;

create or replace function private.validate_report_service_selection(p_company_id uuid, p_service_id uuid, p_subscription_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_company_id is null or p_service_id is null then
    raise exception 'report company and Service are required' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.companies as company
    where company.id = p_company_id and company.archived_at is null
      and company.tenant_id = (select private.current_tenant_id())
  ) then
    raise exception 'active client company is required' using errcode = '23503';
  end if;

  if not exists (
    select 1
    from public.services as service
    where service.id = p_service_id
      and service.tenant_id = (select private.current_tenant_id())
      and service.is_active
      and service.archived_at is null
  ) then
    raise exception 'active Reporting Service is required' using errcode = '23503';
  end if;

  if p_subscription_id is not null and not exists (
    select 1
    from public.subscriptions as subscription
    where subscription.id = p_subscription_id
      and subscription.company_id = p_company_id
      and subscription.service_id = p_service_id
      and subscription.archived_at is null
      and subscription.status <> 'canceled'
  ) then
    raise exception 'report subscription does not match the client and Service'
      using errcode = '23514';
  end if;
end;
$$;

create or replace function public.app_list_reporting_service_options(p_company_id uuid, p_supported_service_ids uuid[])
returns table(service_id uuid, service_name text, subscription_id uuid, subscription_status text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_internal_actor();
  perform public.app_require_module_access('reporting');
  perform private.require_permission('reports.send');

  if p_company_id is null or not exists (
    select 1 from public.companies as company
    where company.id = p_company_id and company.archived_at is null
      and company.tenant_id = (select private.current_tenant_id())
  ) then
    raise exception 'active client company is required' using errcode = '23503';
  end if;

  if p_supported_service_ids is null then
    raise exception 'supported Reporting Services are required' using errcode = '22023';
  end if;

  return query
  select
    service.id,
    service.name,
    subscription.id,
    subscription.status
  from public.services as service
  left join public.subscriptions as subscription
    on subscription.service_id = service.id
   and subscription.company_id = p_company_id
   and subscription.archived_at is null
   and subscription.status <> 'canceled'
  where service.id = any (p_supported_service_ids)
    and service.tenant_id = (select private.current_tenant_id())
    and service.is_active
    and service.archived_at is null
  order by service.name, subscription.created_at, subscription.id;
end;
$$;

create or replace function public.app_create_report_draft(p_request_id uuid, p_payload jsonb)
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
  service_id_value uuid;
  subscription_id_value uuid;
  report_lane_value text := btrim(coalesce(p_payload ->> 'report_lane', ''));
  package_label_value text := btrim(coalesce(p_payload ->> 'package_label', ''));
  title_value text := btrim(coalesce(p_payload ->> 'title', ''));
  wizard_step_key_value text := nullif(
    btrim(coalesce(p_payload ->> 'wizard_step_key', '')), ''
  );
  sections_value jsonb;
  period_value date := coalesce(
    nullif(p_payload ->> 'reporting_period_month', '')::date,
    (date_trunc('month', now() at time zone 'Asia/Manila'))::date
  );
begin
  if p_request_id is null
    or p_payload is null
    or jsonb_typeof(p_payload) <> 'object'
    or p_payload - array[
      'company_id', 'service_id', 'subscription_id', 'report_lane',
      'package_label', 'title', 'wizard_step_key', 'sections',
      'reporting_period_month'
    ] <> '{}'::jsonb
    or report_lane_value not in ('seo_package', 'gmb_management')
    or package_label_value = ''
    or char_length(package_label_value) > 200
    or title_value = ''
    or char_length(title_value) > 200
    or (
      wizard_step_key_value is not null
      and (
        wizard_step_key_value !~ '^[a-z0-9]+(_[a-z0-9]+)*$'
        or char_length(wizard_step_key_value) > 100
      )
    )
  then
    raise exception 'invalid client report input' using errcode = '22023';
  end if;

  actor_id := private.require_internal_actor();
  perform public.app_require_module_access('reporting');
  perform private.require_permission('reports.send');

  sections_value := coalesce(p_payload -> 'sections', '[]'::jsonb);
  perform private.validate_report_sections(sections_value);

  begin
    company_id_value := nullif(p_payload ->> 'company_id', '')::uuid;
    service_id_value := nullif(p_payload ->> 'service_id', '')::uuid;
    subscription_id_value := nullif(p_payload ->> 'subscription_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception 'invalid report identity' using errcode = '22023';
  end;

  select * into company_row
  from public.companies as candidate
  where candidate.id = company_id_value and candidate.archived_at is null
    and candidate.tenant_id = (select private.current_tenant_id());

  if company_row.id is null then
    raise exception 'active client company is required' using errcode = '23503';
  end if;

  if service_id_value is null and subscription_id_value is not null then
    raise exception 'a report subscription requires a Service' using errcode = '22023';
  end if;

  if service_id_value is not null then
    perform private.validate_report_service_selection(
      company_id_value, service_id_value, subscription_id_value
    );
  end if;

  existing_id := private.find_create_request(
    actor_id, 'client_report.draft', p_request_id, p_payload
  );
  if existing_id is not null then
    select * into report_row from public.client_reports where id = existing_id;
    return report_row;
  end if;

  insert into public.client_reports (
    company_id, service_id, subscription_id, report_lane, package_label, title,
    sent_by_profile_id, status, sent_at, wizard_step_key, reporting_period_month
  ) values (
    company_id_value, service_id_value, subscription_id_value,
    report_lane_value, package_label_value, title_value,
    actor_id, 'draft', null, wizard_step_key_value, period_value
  )
  returning * into report_row;

  perform private.replace_report_structure(report_row.id, sections_value);

  perform private.remember_create_request(
    actor_id, 'client_report.draft', p_request_id, p_payload, report_row.id
  );

  return report_row;
end;
$$;

create or replace function public.app_send_client_report(p_request_id uuid, p_payload jsonb)
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
  period_value date := (date_trunc('month', now() at time zone 'Asia/Manila'))::date;
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
  perform private.assert_report_send_window(period_value);

  company_id_value := nullif(p_payload ->> 'company_id', '')::uuid;

  select * into company_row
  from public.companies as candidate
  where candidate.id = company_id_value
    and candidate.tenant_id = (select private.current_tenant_id())
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
    company_id, report_lane, package_label, title, sent_by_profile_id, reporting_period_month
  )
  values (
    company_id_value, report_lane_value, package_label_value, title_value, actor_id, period_value
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
    title_value,
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

alter policy client_reports_authorized_select on public.client_reports
using (
  (
    (select private.is_internal_user())
    and public.app_has_permission('reports.send')
    and tenant_id = (select private.current_tenant_id())
  )
  or (
    (select private.is_client_user())
    and public.app_has_permission('reporting.view')
    and company_id = (select private.current_user_company_id())
    and archived_at is null
    and status = 'sent'
  )
);

alter policy client_report_sections_authorized_select on public.client_report_sections
using (
  (
    (select private.is_internal_user())
    and public.app_has_permission('reports.send')
    and exists (
      select 1
      from public.client_reports as report
      where report.id = client_report_sections.report_id
        and report.tenant_id = (select private.current_tenant_id())
    )
  )
  or (
    (select private.is_client_user())
    and public.app_has_permission('reporting.view')
    and exists (
      select 1
      from public.client_reports as report
      where report.id = client_report_sections.report_id
        and report.company_id = (select private.current_user_company_id())
        and report.archived_at is null
        and report.status = 'sent'
    )
  )
);

alter policy client_report_entries_authorized_select on public.client_report_entries
using (
  (
    (select private.is_internal_user())
    and public.app_has_permission('reports.send')
    and exists (
      select 1
      from public.client_report_sections as section
      join public.client_reports as report on report.id = section.report_id
      where section.id = client_report_entries.section_id
        and report.tenant_id = (select private.current_tenant_id())
    )
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
