-- Wolf Forge Platform — monthly reporting send window + Send Reports Anytime
--
-- Product rule: an internal actor may SEND a report for reporting period
-- month M starting 3 calendar days before M's last calendar day through 3
-- calendar days after it, inclusive, evaluated on the Wolf Forge business
-- calendar (Asia/Manila, no DST, never the browser's clock). Creating and
-- editing a draft stays unrestricted; only the SEND transition is gated.
--
-- Owner sends anytime through the EXISTING resolver bypass —
-- private.profile_has_permission's `preset_row.key = 'owner' -> true` branch
-- already answers true for any permission key registered in
-- public.permissions, unconditionally, before any override or preset grant is
-- consulted. Nothing new is added for Owner. Everyone else needs the explicit,
-- revocable `reports.send_anytime` override — the same
-- public.profile_permission_overrides mechanism every other granular
-- capability in this codebase already uses
-- (20260813090000_roles_permissions_foundation.sql,
-- 20260815100000_account_access_presets_and_provisioning.sql). No new grant
-- store, no new role, no client-facing change: reporting.view and every
-- client-facing read RPC are untouched.

-- -----------------------------------------------------------------------------
-- Canonical reporting period on the report itself
--
-- Nothing on client_reports previously identified which calendar month a
-- report was ABOUT — only report_lane/package_label/title (free text) and
-- sent_at (when it was delivered, not what it covers). "August report sent
-- September 1" needs a period distinct from the send timestamp, so this adds
-- one column rather than inferring the period from sent_at/created_at at
-- authorization time, which would silently misclassify a late-sent report.
-- -----------------------------------------------------------------------------

alter table public.client_reports
  add column reporting_period_month date;

-- A column default, not just a NOT NULL, so any existing or future insert path
-- that does not know about this field (an older client, a raw fixture insert)
-- still lands on a sane value — the current Wolf Forge business month — rather
-- than failing outright. The RPCs below compute this explicitly rather than
-- relying on the default, so the two can never silently disagree; the default
-- exists only as a floor for a caller nobody has updated yet.
alter table public.client_reports
  alter column reporting_period_month
  set default (date_trunc('month', now() at time zone 'Asia/Manila'))::date;

-- Best-effort backfill for existing rows: a sent report's period is assumed to
-- be the month it was sent in (the common case — quick-send and same-month
-- reports); a draft's is the month it was created in. Both are editable
-- afterwards through the builder; nothing here is a durable claim about a
-- period predating this column's existence.
update public.client_reports
set reporting_period_month = (
  date_trunc('month', coalesce(sent_at, created_at) at time zone 'Asia/Manila')
)::date
where reporting_period_month is null;

alter table public.client_reports
  alter column reporting_period_month set not null;

alter table public.client_reports
  add constraint client_reports_reporting_period_month_is_month_start
  check (
    reporting_period_month
      = date_trunc('month', reporting_period_month::timestamp)::date
  );

comment on column public.client_reports.reporting_period_month is
  'First day of the calendar month this report covers. Independent of sent_at: a late-sent report keeps the period it was written for. Drives the send-window authorization check.';

-- -----------------------------------------------------------------------------
-- Date-window engine — one canonical calculation, reused by every send path
-- and by the read-only status RPC the UI calls to render the window.
--
-- monthEnd = last calendar day of the period month (real calendar arithmetic,
-- no hardcoded month lengths, no string slicing). window = [monthEnd-3,
-- monthEnd+3], both inclusive. Handles month, year and leap-year boundaries
-- because it is date arithmetic, not a lookup table.
-- -----------------------------------------------------------------------------

create or replace function private.reporting_window_bounds(p_period_month date)
returns table (window_start date, window_end date)
language sql
immutable
security definer
set search_path = ''
as $$
  with month_end as (
    select
      (date_trunc('month', p_period_month::timestamp) + interval '1 month' - interval '1 day')::date
      as value
  )
  select (month_end.value - 3)::date, (month_end.value + 3)::date
  from month_end;
$$;

comment on function private.reporting_window_bounds(date) is
  'monthEnd = last calendar day of the period month; window = [monthEnd-3, monthEnd+3] inclusive. No hardcoded month lengths, no string slicing.';

revoke all on function private.reporting_window_bounds(date)
from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Send Reports Anytime — a granular, per-profile, revocable override
-- -----------------------------------------------------------------------------

insert into public.permissions (permission_key, category, label, description)
values (
  'reports.send_anytime',
  'reports',
  'Send reports anytime',
  'Allows this user to send monthly reports outside the normal reporting window.'
)
on conflict (permission_key) do update
set category = excluded.category,
    label = excluded.label,
    description = excluded.description,
    updated_at = now();

-- Deliberately no role_permissions row for any preset here. Owner already
-- bypasses every permission key unconditionally, so Owner sends anytime with
-- no override on file. Admin/manager/staff/client all resolve to deny until an
-- explicit override is granted — this is what keeps Admin on the normal
-- window "by default", exactly like every other capability that is not
-- automatically inherited from a role.

-- -----------------------------------------------------------------------------
-- The authorization boundary: canSendReport(actor, report, now)
--
-- ALLOWED when any of:
--   1. actor is canonical Owner              (current_user_has_permission's
--                                              existing, unconditional bypass)
--   2. actor holds reports.send_anytime       (explicit per-profile override)
--   3. actor holds reports.send AND today (Asia/Manila) is inside the
--      reporting period's send window
-- Otherwise DENIED. reports.send itself is still re-checked independently by
-- every calling RPC, exactly as before this migration.
-- -----------------------------------------------------------------------------

create or replace function private.report_send_authorized_for_period(p_period_month date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    private.current_user_has_permission('reports.send_anytime')
    or exists (
      select 1
      from private.reporting_window_bounds(p_period_month) as bounds
      where (now() at time zone 'Asia/Manila')::date
        between bounds.window_start and bounds.window_end
    );
$$;

comment on function private.report_send_authorized_for_period(date) is
  'canSendReport minus the reports.send check (callers already re-check that independently). Allowed when the actor holds reports.send_anytime (Owner included, via the resolver''s unconditional bypass), or the Wolf Forge business date falls inside the reporting period''s send window. Trusted server time only — never a caller-supplied clock or timezone.';

revoke all on function private.report_send_authorized_for_period(date)
from public, anon, authenticated, service_role;

create or replace function private.assert_report_send_window(p_period_month date)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.report_send_authorized_for_period(p_period_month) then
    raise exception 'report cannot be sent outside its reporting window'
      using errcode = '42501';
  end if;
end;
$$;

revoke all on function private.assert_report_send_window(date)
from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Read-only status for the UI. The send RPCs below enforce; this only reports
-- the same computed truth so the editor can show the window and disable Send
-- before the operator ever attempts it, without the browser guessing at the
-- rule. Requires reports.send on the internal reporting module — the same
-- boundary every other Reporting RPC already re-checks — so this never widens
-- what the caller can do.
-- -----------------------------------------------------------------------------

create or replace function public.app_get_report_send_status(p_report_id uuid)
returns table (
  can_send boolean,
  send_anytime boolean,
  reporting_period_month date,
  window_start date,
  window_end date
)
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
  where candidate.id = p_report_id and candidate.archived_at is null;

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

comment on function public.app_get_report_send_status(uuid) is
  'Presentation-only read of the same rule app_send_report_draft/app_send_client_report enforce server-side. Never widens what the caller can do.';

-- -----------------------------------------------------------------------------
-- Quick-send (Phase 1, transitional): period is always the current Wolf
-- Forge business month. There is no draft review step on this path, so the
-- period is server-computed and not caller-suppliable — the same posture the
-- rest of this function already takes toward every other field.
-- -----------------------------------------------------------------------------

create or replace function public.app_send_client_report(
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

comment on function public.app_send_client_report(uuid, jsonb) is
  'Creates a structured report with a Phase 1 external-asset entry and notifies that company''s client users in the same transaction. Requires an internal actor holding reports.send, and requires the send window (or reports.send_anytime) for the current Wolf Forge business month.';

-- -----------------------------------------------------------------------------
-- Builder: create draft. The period defaults to the current Wolf Forge
-- business month (matching the existing title suggestion, "this month and
-- package") but may be set explicitly — an operator building next month's
-- report a few days early, or backfilling one, is not forced into a wrong
-- default. Creating a draft is never window-restricted; only sending is.
--
-- Rebuilt from the service-aware wizard's version of this function
-- (20260820191205_service_aware_reporting_wizard.sql), which is the latest
-- prior definition — not the earlier one in 20260820150000_reporting_builder.sql
-- — so service_id/subscription_id/wizard_step_key validation is preserved
-- exactly and reporting_period_month is the only new behaviour layered on.
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

comment on function public.app_create_report_draft(uuid, jsonb) is
  'Creates an internal-only report draft with its full ordered structure. Requires an internal actor holding reports.send through the reporting module. Retry-safe on request id. reporting_period_month defaults to the current Wolf Forge business month and is editable through app_save_report_draft.';

-- -----------------------------------------------------------------------------
-- Builder: save draft. reporting_period_month is optional in the payload — an
-- absent or blank value leaves the stored period untouched, so every existing
-- caller that does not know about this field keeps working unchanged. Rebuilt
-- from the same service-aware wizard source as app_create_report_draft above.
-- -----------------------------------------------------------------------------

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
  period_value date := nullif(p_payload ->> 'reporting_period_month', '')::date;
begin
  if p_payload is null
    or jsonb_typeof(p_payload) <> 'object'
    or p_payload - array[
      'report_lane', 'package_label', 'title', 'wizard_step_key', 'sections',
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
      end,
      reporting_period_month = coalesce(period_value, report_row.reporting_period_month)
  where id = report_row.id
  returning * into report_row;

  perform private.replace_report_structure(report_row.id, sections_value);

  return report_row;
end;
$$;

comment on function public.app_save_report_draft(uuid, jsonb) is
  'Replaces a draft report''s header (including its reporting period, when supplied) and entire ordered section/entry structure atomically. Refuses sent reports. Array position is the stored order.';

-- -----------------------------------------------------------------------------
-- Builder: send draft. The one place the window is actually enforced for the
-- primary Reporting path. Already-sent and retried requests short-circuit
-- before the check, matching the existing idempotent behaviour exactly — a
-- report that is already delivered is never re-evaluated against "now".
-- Rebuilt from the same service-aware wizard source (one-time deliverable
-- consumption on send is preserved unchanged).
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

  -- Already delivered: report the truth, notify nobody a second time, and do
  -- not re-run the window check against an action that already happened.
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

  perform private.assert_report_send_window(report_row.reporting_period_month);

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

comment on function public.app_send_report_draft(uuid, uuid) is
  'Delivers a draft: flips status to sent, stamps sent_at, notifies the company''s client users and records the audit event in one transaction. Sending an already-sent report notifies nobody. Requires the send window (or reports.send_anytime) for the report''s reporting_period_month.';

-- -----------------------------------------------------------------------------
-- Internal read model: expose the reporting period on the document the
-- builder edits. Rebuilt from the same service-aware wizard source, so
-- service_id/service_name/subscription_id/wizard_step_key/
-- completed_one_time_item_keys are preserved exactly.
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

-- -----------------------------------------------------------------------------
-- Client detail: the client read model extends the same document shape
-- (domain/reporting/schema.ts clientReportDocumentSchema extends
-- internalReportDocumentSchema), so reporting_period_month must appear here
-- too or every sent-report view fails to parse. Presentational only, and the
-- client detail already discloses report_lane/package_label/title, which say
-- exactly as much about "what this report covers".
-- -----------------------------------------------------------------------------

create or replace function public.app_get_my_client_report(
  p_report_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  company_id_value uuid;
  report_row public.client_reports;
  company_row public.companies;
begin
  if caller_id is null or p_report_id is null then
    raise exception 'report is unavailable' using errcode = '42501';
  end if;

  perform public.app_require_module_access('portal_reporting');

  company_id_value := private.current_user_company_id();
  if company_id_value is null then
    raise exception 'report is unavailable' using errcode = '42501';
  end if;

  select candidate.*
  into report_row
  from public.client_reports as candidate
  join public.companies as company on company.id = candidate.company_id
  where candidate.id = p_report_id
    and candidate.company_id = company_id_value
    and candidate.status = 'sent'
    and candidate.archived_at is null
    and company.archived_at is null;

  if report_row.id is null then
    raise exception 'report is unavailable' using errcode = '42501';
  end if;

  select * into company_row
  from public.companies as company
  where company.id = report_row.company_id
    and company.archived_at is null;

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
    'reporting_period_month', report_row.reporting_period_month,
    'is_read', exists (
      select 1
      from public.client_report_reads as read_row
      where read_row.report_id = report_row.id
        and read_row.profile_id = caller_id
    ),
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

revoke all on function public.app_get_my_client_report(uuid)
from public, anon, service_role;
grant execute on function public.app_get_my_client_report(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Per-user override management: grant / revoke Send Reports Anytime.
--
-- Reuses the existing generic override primitives
-- (private.apply_profile_permission_override,
-- private.require_permission_admin_for_target) rather than a parallel grant
-- path — same table, same resolver, same audit helper. The only addition is
-- an explicit Owner guard: private.require_permission_admin_for_target
-- already refuses a caller acting on themself, but does not by itself refuse
-- an Owner target (moot in effect, since Owner's resolver bypass ignores any
-- override either way — but the product rule is stated as a hard "cannot
-- modify Owner", so it is enforced as a hard denial here rather than left as
-- an inert no-op).
-- -----------------------------------------------------------------------------

create or replace function private.require_non_owner_permission_target(p_profile_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if private.profile_permission_preset_key(p_profile_id) = 'owner' then
    raise exception 'the owner account cannot be modified'
      using errcode = '42501';
  end if;
end;
$$;

revoke all on function private.require_non_owner_permission_target(uuid)
from public, anon, authenticated, service_role;

create or replace function public.app_grant_report_send_anytime(p_profile_id uuid)
returns public.profile_permission_overrides
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  override_row public.profile_permission_overrides;
begin
  actor_id := private.require_permission_admin_for_target(p_profile_id);
  perform private.require_non_owner_permission_target(p_profile_id);

  perform private.apply_profile_permission_override(
    p_profile_id, 'reports.send_anytime', true
  );

  select * into override_row
  from public.profile_permission_overrides as stored
  where stored.profile_id = p_profile_id
    and stored.permission_key = 'reports.send_anytime';

  perform private.record_authenticated_activity(
    'profile',
    p_profile_id,
    'permission.report_send_anytime_granted',
    'Granted permission to send monthly reports anytime.',
    jsonb_build_object('permission_key', 'reports.send_anytime', 'granted_by', actor_id)
  );

  return override_row;
end;
$$;

comment on function public.app_grant_report_send_anytime(uuid) is
  'Grants the reports.send_anytime override to a non-owner internal profile. Requires users.manage_permissions, refuses self-grant and refuses an Owner target. Audited.';

create or replace function public.app_revoke_report_send_anytime(p_profile_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  removed integer := 0;
begin
  actor_id := private.require_permission_admin_for_target(p_profile_id);
  perform private.require_non_owner_permission_target(p_profile_id);

  delete from public.profile_permission_overrides as override_row
  where override_row.profile_id = p_profile_id
    and override_row.permission_key = 'reports.send_anytime';

  get diagnostics removed = row_count;

  if removed > 0 then
    perform private.record_authenticated_activity(
      'profile',
      p_profile_id,
      'permission.report_send_anytime_revoked',
      'Revoked permission to send monthly reports anytime.',
      jsonb_build_object('permission_key', 'reports.send_anytime', 'revoked_by', actor_id)
    );
  end if;

  return removed > 0;
end;
$$;

comment on function public.app_revoke_report_send_anytime(uuid) is
  'Revokes the reports.send_anytime override from a non-owner internal profile. Requires users.manage_permissions, refuses self-revoke and refuses an Owner target. Audited. Returns false when there was nothing to revoke.';

-- -----------------------------------------------------------------------------
-- Team directory: show whether each member currently holds the override, so
-- the Team & Roles screen can render a real toggle instead of a guess.
-- -----------------------------------------------------------------------------

drop function if exists public.app_list_internal_members();

create function public.app_list_internal_members()
returns table (
  profile_id uuid,
  display_name text,
  email text,
  preset_key text,
  preset_name text,
  sort_order integer,
  override_count integer,
  is_self boolean,
  created_at timestamptz,
  avatar_url text,
  report_send_anytime boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_internal_actor();
begin
  perform private.require_permission('users.view');

  return query
  select
    profile_row.id,
    profile_row.display_name,
    auth_user.email::text,
    preset_row.key,
    preset_row.name,
    preset_row.sort_order,
    (
      select count(*)::integer
      from public.profile_permission_overrides as override_row
      where override_row.profile_id = profile_row.id
    ),
    profile_row.id = actor_id,
    profile_row.created_at,
    profile_row.avatar_url,
    private.profile_has_permission(profile_row.id, 'reports.send_anytime')

  from public.profiles as profile_row

  join public.permission_presets as preset_row
    on preset_row.role_id = profile_row.role_id

  left join auth.users as auth_user
    on auth_user.id = profile_row.id

  where profile_row.archived_at is null
    and preset_row.account_class = 'internal'

  order by
    preset_row.sort_order,
    coalesce(profile_row.display_name, auth_user.email::text),
    profile_row.id;
end;
$$;

comment on function public.app_list_internal_members() is
  'Wolf Forge member directory for Team & Roles. report_send_anytime reflects the resolved reports.send_anytime permission (true for Owner unconditionally, or when an explicit override grants it).';

-- -----------------------------------------------------------------------------
-- Function privileges
-- -----------------------------------------------------------------------------

revoke all on function public.app_get_report_send_status(uuid) from public, anon, service_role;
grant execute on function public.app_get_report_send_status(uuid) to authenticated;

revoke all on function public.app_send_client_report(uuid, jsonb) from public, anon, service_role;
grant execute on function public.app_send_client_report(uuid, jsonb) to authenticated;

revoke all on function public.app_create_report_draft(uuid, jsonb) from public, anon, service_role;
grant execute on function public.app_create_report_draft(uuid, jsonb) to authenticated;

revoke all on function public.app_save_report_draft(uuid, jsonb) from public, anon, service_role;
grant execute on function public.app_save_report_draft(uuid, jsonb) to authenticated;

revoke all on function public.app_send_report_draft(uuid, uuid) from public, anon, service_role;
grant execute on function public.app_send_report_draft(uuid, uuid) to authenticated;

revoke all on function public.app_get_internal_report(uuid) from public, anon, service_role;
grant execute on function public.app_get_internal_report(uuid) to authenticated;

revoke all on function public.app_grant_report_send_anytime(uuid) from public, anon, service_role;
grant execute on function public.app_grant_report_send_anytime(uuid) to authenticated;

revoke all on function public.app_revoke_report_send_anytime(uuid) from public, anon, service_role;
grant execute on function public.app_revoke_report_send_anytime(uuid) to authenticated;

revoke all on function public.app_list_internal_members() from public, anon, authenticated, service_role;
grant execute on function public.app_list_internal_members() to authenticated;
