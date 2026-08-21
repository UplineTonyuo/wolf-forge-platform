-- Structured Reporting Phase 3 — native client report viewer.
--
-- This remains the same client_reports -> sections -> entries model. The new
-- RPC is a caller-scoped counterpart to app_get_internal_report: it accepts a
-- report id only, derives the client company from auth.uid(), and returns a
-- sent, unarchived document for that company or one indistinguishable denial.

create function public.app_get_my_client_report(
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

  -- The browser never supplies company authority. This helper resolves only a
  -- live client profile attached to an unarchived company.
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

  -- Draft, archived, missing and foreign ids all take the same path. The
  -- caller cannot use this function to learn which of those states exists.
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

revoke all on function public.app_get_my_client_report(uuid)
  from public, anon, service_role;
grant execute on function public.app_get_my_client_report(uuid) to authenticated;

comment on function public.app_get_my_client_report(uuid) is
  'Returns one sent, unarchived structured report for the authenticated client company. Company authority is derived from auth.uid(); foreign, draft, archived and missing ids are indistinguishable.';

-- Report notifications are trusted native deep links. Centralising this tiny
-- invariant at the notification row keeps both the transitional Phase 1 sender
-- and the Phase 2 builder sender on the same detail route without duplicating
-- either delivery function.
create function private.set_client_report_notification_href()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.audience = 'client'
    and new.category = 'report'
    and new.entity_type = 'client_report'
    and new.entity_id is not null
  then
    new.href := '/account/reporting/' || new.entity_id::text;
  end if;

  return new;
end;
$$;

revoke all on function private.set_client_report_notification_href()
  from public, anon, authenticated, service_role;

create trigger notifications_set_client_report_href
before insert or update of audience, category, entity_type, entity_id, href
on public.notifications
for each row
execute function private.set_client_report_notification_href();

-- Existing local/hosted report notifications should open the same native
-- detail as newly delivered ones. Only trusted client-report rows are touched.
update public.notifications
set href = '/account/reporting/' || entity_id::text
where audience = 'client'
  and category = 'report'
  and entity_type = 'client_report'
  and entity_id is not null
  and href is distinct from '/account/reporting/' || entity_id::text;

comment on function private.set_client_report_notification_href() is
  'Forces client report notifications to the trusted native report-detail route.';
