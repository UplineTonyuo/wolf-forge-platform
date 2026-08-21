-- Client report detail integration repair.
--
-- The client slideshow is a presentation of the existing sent report document,
-- not a second model. Expose only the one-time item identity and completion flag
-- already stored on each structured entry; tenant isolation and draft refusal
-- remain identical to the original client detail contract.

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

comment on function public.app_get_my_client_report(uuid) is
  'Returns one sent, unarchived structured report for the authenticated client company, including only one-time item identity/completion metadata required by presentation. Company authority is derived from auth.uid(); foreign, draft, archived and missing ids are indistinguishable.';
