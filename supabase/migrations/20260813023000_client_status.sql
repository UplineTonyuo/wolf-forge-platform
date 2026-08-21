-- Wolf Forge Platform
-- Persistent client/company lifecycle status.

alter table public.companies
  add column if not exists status text not null default 'contact';

alter table public.companies
  drop constraint if exists companies_status_check;

alter table public.companies
  add constraint companies_status_check
  check (
    status in (
      'contact',
      'lead',
      'client',
      'client_team'
    )
  );

create index if not exists companies_active_status_idx
  on public.companies (status, name)
  where archived_at is null;


-- Extend the existing secure update RPC.
-- We preserve:
--   private.require_internal_actor()
--   SECURITY DEFINER
--   archived-record protection
--   authenticated activity logging

create or replace function public.app_update_company(
  p_company_id uuid,
  p_patch jsonb
)
returns public.companies
language plpgsql
security definer
set search_path = ''
as $$
declare
  company_row public.companies;
  previous_status text;
begin
  perform private.require_internal_actor();

  if p_patch is null
    or jsonb_typeof(p_patch) <> 'object'
    or p_patch = '{}'::jsonb
    or p_patch - array['name', 'status'] <> '{}'::jsonb
  then
    raise exception 'invalid client update patch'
      using errcode = '22023';
  end if;

  if p_patch ? 'status' then
    if jsonb_typeof(p_patch -> 'status') <> 'string'
      or (p_patch ->> 'status') not in (
        'contact',
        'lead',
        'client',
        'client_team'
      )
    then
      raise exception 'invalid client status'
        using errcode = '22023';
    end if;
  end if;

  select company.status
    into previous_status
  from public.companies as company
  where company.id = p_company_id
    and company.archived_at is null;

  if not found then
    raise no_data_found;
  end if;

  update public.companies
  set
    name = case
      when p_patch ? 'name'
        then p_patch ->> 'name'
      else name
    end,
    status = case
      when p_patch ? 'status'
        then p_patch ->> 'status'
      else status
    end
  where id = p_company_id
    and archived_at is null
  returning *
    into company_row;

  if p_patch ? 'status'
    and previous_status is distinct from company_row.status
  then
    perform private.record_authenticated_activity(
      'company',
      company_row.id,
      'company.updated',
      format(
        'Changed client status from %s to %s.',
        initcap(replace(previous_status, '_', ' ')),
        initcap(replace(company_row.status, '_', ' '))
      ),
      jsonb_build_object(
        'field', 'status',
        'from', previous_status,
        'to', company_row.status
      )
    );
  else
    perform private.record_authenticated_activity(
      'company',
      company_row.id,
      'company.updated',
      format(
        'Updated client %s.',
        company_row.name
      )
    );
  end if;

  return company_row;
end;
$$;
