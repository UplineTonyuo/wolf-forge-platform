-- Wolf Forge Platform - service-aware recurring Reporting wizard
--
-- The existing client_reports -> sections -> entries document remains the
-- storage model. This migration adds stable service/subscription identity,
-- durable wizard progress, and item-level one-time completion state. One-time
-- state is consumed only by app_send_report_draft, in the same transaction as
-- delivery and notification fan-out.

alter table public.client_reports
  add column service_id uuid references public.services (id) on delete restrict,
  add column subscription_id uuid references public.subscriptions (id) on delete restrict,
  add column wizard_step_key text;

alter table public.client_reports
  add constraint client_reports_subscription_requires_service
    check (subscription_id is null or service_id is not null),
  add constraint client_reports_wizard_step_key_valid
    check (
      wizard_step_key is null
      or (
        wizard_step_key ~ '^[a-z0-9]+(_[a-z0-9]+)*$'
        and char_length(wizard_step_key) <= 100
      )
    );

create index client_reports_company_service_idx
on public.client_reports (company_id, service_id, updated_at desc)
where service_id is not null and archived_at is null;

create index client_reports_subscription_idx
on public.client_reports (subscription_id, updated_at desc)
where subscription_id is not null and archived_at is null;

alter table public.client_report_entries
  add column one_time_item_key text,
  add column one_time_completed boolean not null default false;

alter table public.client_report_entries
  add constraint client_report_entries_one_time_item_key_valid
    check (
      one_time_item_key is null
      or (
        one_time_item_key ~ '^[a-z0-9]+(_[a-z0-9]+)*$'
        and char_length(one_time_item_key) <= 100
      )
    ),
  add constraint client_report_entries_one_time_completion_consistent
    check (
      not one_time_completed
      or (
        one_time_item_key is not null
        and (value is not null or url is not null)
      )
    );

create table private.reported_one_time_deliverables (
  company_id uuid not null references public.companies (id) on delete restrict,
  service_id uuid not null references public.services (id) on delete restrict,
  subscription_id uuid references public.subscriptions (id) on delete restrict,
  item_key text not null,
  completed_report_id uuid not null references public.client_reports (id) on delete restrict,
  completed_at timestamptz not null,
  constraint reported_one_time_deliverables_item_key_valid check (
    item_key ~ '^[a-z0-9]+(_[a-z0-9]+)*$'
    and char_length(item_key) <= 100
  )
);

create unique index reported_one_time_deliverables_subscription_unique
on private.reported_one_time_deliverables (subscription_id, item_key)
where subscription_id is not null;

create unique index reported_one_time_deliverables_fallback_unique
on private.reported_one_time_deliverables (company_id, service_id, item_key)
where subscription_id is null;

create index reported_one_time_deliverables_report_idx
on private.reported_one_time_deliverables (completed_report_id);

revoke all on table private.reported_one_time_deliverables
from public, anon, authenticated, service_role;

comment on table private.reported_one_time_deliverables is
  'Item-level one-time Reporting completion. Subscription rows are isolated by subscription; fallback rows are isolated by company and service.';

comment on column public.client_reports.service_id is
  'Stable catalogue identity used to select the Reporting profile. Nullable only for legacy reports.';
comment on column public.client_reports.subscription_id is
  'Actual company subscription when one was selected; null denotes the explicit catalogue-profile fallback, never fabricated ownership.';
comment on column public.client_reports.wizard_step_key is
  'Last durably saved guided Reporting step. The report sections and entries remain the draft data source of truth.';

-- -----------------------------------------------------------------------------
-- Service/subscription validation and read models
-- -----------------------------------------------------------------------------

create function private.validate_report_service_selection(
  p_company_id uuid,
  p_service_id uuid,
  p_subscription_id uuid
)
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
  ) then
    raise exception 'active client company is required' using errcode = '23503';
  end if;

  if not exists (
    select 1
    from public.services as service
    where service.id = p_service_id
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

create function public.app_list_reporting_service_options(
  p_company_id uuid,
  p_supported_service_ids uuid[]
)
returns table (
  service_id uuid,
  service_name text,
  subscription_id uuid,
  subscription_status text
)
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
    and service.is_active
    and service.archived_at is null
  order by service.name, subscription.created_at, subscription.id;
end;
$$;

create function public.app_list_reported_one_time_deliverables(
  p_company_id uuid,
  p_service_id uuid,
  p_subscription_id uuid default null
)
returns setof text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_internal_actor();
  perform public.app_require_module_access('reporting');
  perform private.require_permission('reports.send');
  perform private.validate_report_service_selection(
    p_company_id, p_service_id, p_subscription_id
  );

  return query
  select completion.item_key
  from private.reported_one_time_deliverables as completion
  where completion.company_id = p_company_id
    and completion.service_id = p_service_id
    and (
      (p_subscription_id is null and completion.subscription_id is null)
      or completion.subscription_id = p_subscription_id
    )
  order by completion.item_key;
end;
$$;

-- -----------------------------------------------------------------------------
-- Structured entry validation and replacement, extended with one-time metadata
-- -----------------------------------------------------------------------------

create or replace function private.validate_report_sections(p_sections jsonb)
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
  one_time_key_value text;
  one_time_completed_value boolean;
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
        or entry_element - array[
          'label', 'url', 'value', 'one_time_item_key', 'one_time_completed'
        ] <> '{}'::jsonb
        or btrim(coalesce(entry_element ->> 'label', '')) = ''
        or char_length(btrim(entry_element ->> 'label')) > 200
        or (
          entry_element ? 'one_time_completed'
          and jsonb_typeof(entry_element -> 'one_time_completed') <> 'boolean'
        )
      then
        raise exception 'invalid report entry' using errcode = '22023';
      end if;

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

      one_time_key_value := nullif(
        btrim(coalesce(entry_element ->> 'one_time_item_key', '')), ''
      );
      if one_time_key_value is not null and (
        one_time_key_value !~ '^[a-z0-9]+(_[a-z0-9]+)*$'
        or char_length(one_time_key_value) > 100
      ) then
        raise exception 'invalid one-time report item key' using errcode = '22023';
      end if;

      one_time_completed_value := coalesce(
        (entry_element ->> 'one_time_completed')::boolean,
        false
      );
      if one_time_completed_value and (
        one_time_key_value is null or (value_value is null and url_value is null)
      ) then
        raise exception 'completed one-time report items need a value or link'
          using errcode = '22023';
      end if;
    end loop;
  end loop;

  if entry_total > 2000 then
    raise exception 'a report may not exceed 2000 entries' using errcode = '22023';
  end if;
end;
$$;

create or replace function private.replace_report_structure(
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
  insert into public.client_report_entries (
    section_id, label, url, value, sort_order,
    one_time_item_key, one_time_completed
  )
  select
    inserted_sections.id,
    btrim(entry_element ->> 'label'),
    nullif(btrim(coalesce(entry_element ->> 'url', '')), ''),
    nullif(btrim(coalesce(entry_element ->> 'value', '')), ''),
    (entry_ordinality - 1)::integer,
    nullif(btrim(coalesce(entry_element ->> 'one_time_item_key', '')), ''),
    coalesce((entry_element ->> 'one_time_completed')::boolean, false)
  from jsonb_array_elements(p_sections)
    with ordinality as sections(section_element, section_ordinality)
  join inserted_sections
    on inserted_sections.sort_order = (section_ordinality - 1)::integer
  cross join lateral jsonb_array_elements(section_element -> 'entries')
    with ordinality as entries(entry_element, entry_ordinality);
end;
$$;

-- -----------------------------------------------------------------------------
-- Draft create/save with stable service identity and wizard progress
-- -----------------------------------------------------------------------------

create or replace function public.app_create_report_draft(
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
  service_id_value uuid;
  subscription_id_value uuid;
  report_lane_value text := btrim(coalesce(p_payload ->> 'report_lane', ''));
  package_label_value text := btrim(coalesce(p_payload ->> 'package_label', ''));
  title_value text := btrim(coalesce(p_payload ->> 'title', ''));
  wizard_step_key_value text := nullif(
    btrim(coalesce(p_payload ->> 'wizard_step_key', '')), ''
  );
  sections_value jsonb;
begin
  if p_request_id is null
    or p_payload is null
    or jsonb_typeof(p_payload) <> 'object'
    or p_payload - array[
      'company_id', 'service_id', 'subscription_id', 'report_lane',
      'package_label', 'title', 'wizard_step_key', 'sections'
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
  where candidate.id = company_id_value and candidate.archived_at is null;

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
    sent_by_profile_id, status, sent_at, wizard_step_key
  ) values (
    company_id_value, service_id_value, subscription_id_value,
    report_lane_value, package_label_value, title_value,
    actor_id, 'draft', null, wizard_step_key_value
  )
  returning * into report_row;

  perform private.replace_report_structure(report_row.id, sections_value);

  perform private.remember_create_request(
    actor_id, 'client_report.draft', p_request_id, p_payload, report_row.id
  );

  return report_row;
end;
$$;

create or replace function public.app_save_report_draft(
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
  wizard_step_key_value text := nullif(
    btrim(coalesce(p_payload ->> 'wizard_step_key', '')), ''
  );
  sections_value jsonb;
begin
  if p_payload is null
    or jsonb_typeof(p_payload) <> 'object'
    or p_payload - array[
      'report_lane', 'package_label', 'title', 'wizard_step_key', 'sections'
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

  report_row := private.require_editable_report(p_report_id);

  if report_row.status <> 'draft' then
    raise exception 'a sent report can no longer be edited' using errcode = '42501';
  end if;

  sections_value := coalesce(p_payload -> 'sections', '[]'::jsonb);

  update public.client_reports
  set report_lane = report_lane_value,
      package_label = package_label_value,
      title = title_value,
      wizard_step_key = case
        when p_payload ? 'wizard_step_key' then wizard_step_key_value
        else wizard_step_key
      end
  where id = report_row.id
  returning * into report_row;

  perform private.replace_report_structure(report_row.id, sections_value);

  return report_row;
end;
$$;

-- -----------------------------------------------------------------------------
-- Sending consumes only completed one-time entries in this delivered report
-- -----------------------------------------------------------------------------

create or replace function public.app_send_report_draft(
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

  if report_row.service_id is not null then
    insert into private.reported_one_time_deliverables (
      company_id, service_id, subscription_id, item_key,
      completed_report_id, completed_at
    )
    select distinct
      report_row.company_id,
      report_row.service_id,
      report_row.subscription_id,
      entry.one_time_item_key,
      report_row.id,
      report_row.sent_at
    from public.client_report_sections as section
    join public.client_report_entries as entry on entry.section_id = section.id
    where section.report_id = report_row.id
      and entry.one_time_item_key is not null
      and entry.one_time_completed
      and (entry.value is not null or entry.url is not null)
    on conflict do nothing;
  end if;

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
      'service_id', report_row.service_id,
      'subscription_id', report_row.subscription_id,
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
-- Internal document includes wizard identity/progress and completion context
-- -----------------------------------------------------------------------------

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
  where candidate.id = p_report_id and candidate.archived_at is null;

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

revoke all on function private.validate_report_service_selection(uuid, uuid, uuid)
from public, anon, authenticated, service_role;
revoke all on function public.app_list_reporting_service_options(uuid, uuid[])
from public, anon, authenticated, service_role;
revoke all on function public.app_list_reported_one_time_deliverables(uuid, uuid, uuid)
from public, anon, authenticated, service_role;

grant execute on function public.app_list_reporting_service_options(uuid, uuid[])
to authenticated;
grant execute on function public.app_list_reported_one_time_deliverables(uuid, uuid, uuid)
to authenticated;

comment on function public.app_list_reporting_service_options(uuid, uuid[]) is
  'Reporting-only service choices: actual non-canceled company subscriptions when present, otherwise active catalogue records for the explicit fallback.';
comment on function public.app_list_reported_one_time_deliverables(uuid, uuid, uuid) is
  'Returns completed one-time item keys for one validated company/service/subscription scope.';
comment on function public.app_send_report_draft(uuid, uuid) is
  'Atomically delivers one saved draft, consumes only evidenced one-time items explicitly marked complete, notifies the client company and audits the delivery.';
