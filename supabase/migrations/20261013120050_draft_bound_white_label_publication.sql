-- v1.0 adds a draft-bound companion; accepted module policy/writers stay unchanged.
alter table private.tenant_module_publications add column publication_transaction_id xid8;

create function private.stamp_white_label_publication_transaction()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  new.publication_transaction_id := pg_current_xact_id();
  return new;
end;
$$;
create trigger tenant_module_publications_xact_stamp before insert on private.tenant_module_publications
for each row execute function private.stamp_white_label_publication_transaction();
revoke all on function private.stamp_white_label_publication_transaction() from public,anon,authenticated,service_role;

create table private.tenant_white_label_publications (
  tenant_id uuid not null,
  publication_revision integer not null check(publication_revision>0),
  display_name text not null check(display_name=btrim(display_name) and char_length(display_name) between 1 and 60 and display_name !~ '[[:cntrl:]]'),
  primary_color text not null check(primary_color ~ '^#[0-9a-f]{6}$'),
  accent_color text not null check(accent_color ~ '^#[0-9a-f]{6}$'),
  source_draft_revision integer not null check(source_draft_revision>0),
  source_draft_updated_at timestamptz not null,
  source_draft_updated_by uuid not null references public.profiles(id) on delete restrict,
  expected_publication_revision integer not null check(expected_publication_revision>=0 and expected_publication_revision=publication_revision-1),
  request_id uuid not null,
  published_by uuid not null references public.profiles(id) on delete restrict,
  published_at timestamptz not null,
  reason text not null check(reason=btrim(reason) and char_length(reason) between 1 and 500),
  primary key(tenant_id,publication_revision),
  unique(published_by,request_id),
  foreign key(tenant_id,publication_revision) references private.tenant_module_publications(tenant_id,revision) on delete restrict
);
alter table private.tenant_white_label_publications enable row level security;
revoke all on private.tenant_white_label_publications from public,anon,authenticated,service_role;

create function private.require_white_label_publication_target(p_tenant_id uuid)
returns void language plpgsql stable security definer set search_path='' as $$
declare tenant_row public.tenants;
begin
  perform private.require_platform_admin();
  select * into tenant_row from public.tenants where id=p_tenant_id;
  if not found then raise exception 'Tenant not found' using errcode='P0002'; end if;
  if tenant_row.status<>'active' or tenant_row.archived_at is not null then
    raise exception 'Tenant is not active' using errcode='55000';
  end if;
end;
$$;
revoke all on function private.require_white_label_publication_target(uuid) from public,anon,authenticated,service_role;

create function private.check_white_label_publication_revisions(p_tenant_id uuid,p_source integer,p_expected integer)
returns void language plpgsql immutable set search_path='' as $$
begin
  if p_tenant_id is null or p_source is null or p_source<1 or p_expected is null or p_expected<0 or p_expected=2147483647 then
    raise exception 'A saved draft and available publication revision are required' using errcode='22023';
  end if;
end;
$$;
revoke all on function private.check_white_label_publication_revisions(uuid,integer,integer) from public,anon,authenticated,service_role;

create function private.check_white_label_publication_request(p_request_id uuid,p_reason text)
returns void language plpgsql immutable set search_path='' as $$
begin
  if p_request_id is null or p_reason is null or char_length(btrim(p_reason)) not between 1 and 500 then
    raise exception 'A request UUID and bounded reason are required' using errcode='22023';
  end if;
end;
$$;
revoke all on function private.check_white_label_publication_request(uuid,text) from public,anon,authenticated,service_role;

create function private.valid_white_label_publication_parent(p private.tenant_module_publications)
returns boolean language sql stable security definer set search_path='' as $$
select coalesce(p.tenant_id is not null and p.revision>0 and p.published_by is not null and p.published_at is not null
  and char_length(btrim(p.reason)) between 1 and 500 and private.published_module_set_valid(p.module_keys),false);
$$;
revoke all on function private.valid_white_label_publication_parent(private.tenant_module_publications) from public,anon,authenticated,service_role;

create function private.white_label_publication_configuration(p private.tenant_module_publications,s private.tenant_white_label_publications)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not private.valid_white_label_publication_parent(p) or p.publication_transaction_id is null or s.tenant_id is distinct from p.tenant_id
    or s.publication_revision is distinct from p.revision or s.published_by is distinct from p.published_by
    or s.published_at is distinct from p.published_at or s.reason is distinct from p.reason
    or s.source_draft_revision is null or s.source_draft_revision<1 or s.source_draft_updated_at is null or s.source_draft_updated_by is null
    or s.expected_publication_revision is distinct from p.revision-1
    or s.display_name is null or s.display_name<>btrim(s.display_name) or char_length(s.display_name) not between 1 and 60
    or s.display_name ~ '[[:cntrl:]]' or s.primary_color is null or s.primary_color !~ '^#[0-9a-f]{6}$'
    or s.accent_color is null or s.accent_color !~ '^#[0-9a-f]{6}$' or s.request_id is null then
    raise exception 'Invalid published configuration' using errcode='55000';
  end if;
  return jsonb_build_object('tenantId',p.tenant_id,'publicationRevision',p.revision,'sourceDraftRevision',s.source_draft_revision,
    'displayName',s.display_name,'primaryColor',s.primary_color,'accentColor',s.accent_color,
    'moduleKeys',(select jsonb_agg(k order by k collate "C") from unnest(p.module_keys) k),'publishedAt',p.published_at);
end;
$$;
revoke all on function private.white_label_publication_configuration(private.tenant_module_publications,private.tenant_white_label_publications) from public,anon,authenticated,service_role;

create function private.white_label_publication_receipt(s private.tenant_white_label_publications)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare p private.tenant_module_publications;
begin
  select * into p from private.tenant_module_publications where tenant_id=s.tenant_id and revision=s.publication_revision;
  return jsonb_build_object('configuration',private.white_label_publication_configuration(p,s),'requestId',s.request_id,
    'expectedPublicationRevision',s.expected_publication_revision,'publishedBy',s.published_by,'reason',s.reason);
end;
$$;
revoke all on function private.white_label_publication_receipt(private.tenant_white_label_publications) from public,anon,authenticated,service_role;

create function private.validate_white_label_publication()
returns trigger language plpgsql security definer set search_path='' as $$
declare d private.tenant_white_label_drafts; p private.tenant_module_publications;
begin
  if tg_op<>'INSERT' then raise exception 'Published configuration history is immutable' using errcode='55000'; end if;
  perform private.require_white_label_publication_target(new.tenant_id);
  perform private.check_white_label_publication_request(new.request_id,new.reason);
  perform 1 from public.tenants where id=new.tenant_id for update;
  perform private.require_white_label_publication_target(new.tenant_id);
  perform pg_advisory_xact_lock(hashtextextended('white-label.publish:'||auth.uid()::text||':'||new.request_id::text,0));
  perform private.require_white_label_publication_target(new.tenant_id);
  select * into d from private.tenant_white_label_drafts where tenant_id=new.tenant_id for update;
  perform private.require_white_label_publication_target(new.tenant_id);
  select * into p from private.tenant_module_publications where tenant_id=new.tenant_id and revision=new.publication_revision;
  -- A full transaction ID also works inside subtransactions; legacy rows remain NULL.
  if p.publication_transaction_id is distinct from pg_current_xact_id() then
    raise exception 'A companion requires a parent created in this transaction' using errcode='55000';
  end if;
  if d.tenant_id is null or new.source_draft_revision is distinct from d.revision
    or new.display_name is distinct from d.display_name or new.primary_color is distinct from d.primary_color
    or new.accent_color is distinct from d.accent_color or new.source_draft_updated_at is distinct from d.updated_at
    or new.source_draft_updated_by is distinct from d.updated_by or p.module_keys is distinct from d.module_keys
    or new.published_by is distinct from auth.uid() then
    raise exception 'The companion must match the exact saved draft and actor' using errcode='WF409';
  end if;
  perform private.white_label_publication_configuration(p,new);
  return new;
end;
$$;
create trigger tenant_white_label_publications_validate before insert or update or delete on private.tenant_white_label_publications
for each row execute function private.validate_white_label_publication();
revoke all on function private.validate_white_label_publication() from public,anon,authenticated,service_role;

insert into private.security_audit_event_codes(event_code,category,severity)
values('authorization.white_label.published','authorization','info') on conflict(event_code) do nothing;

create function public.app_publish_white_label_draft(p_tenant_id uuid,p_source_draft_revision integer,p_expected_publication_revision integer,p_request_id uuid,p_reason text)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
  d private.tenant_white_label_drafts; s private.tenant_white_label_publications; p private.tenant_module_publications;
  current_revision integer; next_revision integer; canonical_reason text:=btrim(p_reason);
begin
  perform private.require_platform_admin();
  perform private.check_white_label_publication_revisions(p_tenant_id,p_source_draft_revision,p_expected_publication_revision);
  perform private.check_white_label_publication_request(p_request_id,p_reason);
  if current_setting('transaction_isolation') not in ('read committed','read uncommitted') then
    raise exception 'Publication requires READ COMMITTED' using errcode='55000';
  end if;
  perform 1 from public.tenants where id=p_tenant_id for update;
  perform private.require_white_label_publication_target(p_tenant_id);
  perform pg_advisory_xact_lock(hashtextextended('white-label.publish:'||auth.uid()::text||':'||p_request_id::text,0));
  perform private.require_white_label_publication_target(p_tenant_id);
  select * into s from private.tenant_white_label_publications where published_by=auth.uid() and request_id=p_request_id;
  if found then
    if s.tenant_id is distinct from p_tenant_id or s.source_draft_revision is distinct from p_source_draft_revision
      or s.expected_publication_revision is distinct from p_expected_publication_revision or s.reason is distinct from canonical_reason then
      raise exception 'Publication request binding conflict' using errcode='WF409';
    end if;
    return jsonb_build_object('outcome','already_applied','receipt',private.white_label_publication_receipt(s));
  end if;
  select * into d from private.tenant_white_label_drafts where tenant_id=p_tenant_id for update;
  perform private.require_white_label_publication_target(p_tenant_id);
  if d.revision is distinct from p_source_draft_revision then
    raise exception 'Saved draft revision conflict' using errcode='WF409';
  end if;
  select coalesce(max(revision),0) into current_revision from private.tenant_module_publications where tenant_id=p_tenant_id;
  if current_revision<>p_expected_publication_revision then raise exception 'Published revision conflict' using errcode='WF409'; end if;
  next_revision:=private.publish_tenant_modules(p_tenant_id,p_expected_publication_revision,d.module_keys,canonical_reason);
  select * into p from private.tenant_module_publications where tenant_id=p_tenant_id and revision=next_revision;
  insert into private.tenant_white_label_publications
    (tenant_id,publication_revision,display_name,primary_color,accent_color,source_draft_revision,source_draft_updated_at,source_draft_updated_by,
     expected_publication_revision,request_id,published_by,published_at,reason)
  values(p_tenant_id,next_revision,d.display_name,d.primary_color,d.accent_color,d.revision,d.updated_at,d.updated_by,
    p_expected_publication_revision,p_request_id,p.published_by,p.published_at,p.reason) returning * into s;
  insert into public.security_audit_events(event_code,actor_profile_id,actor_class,action_slug,resource_type,resource_id,outcome,metadata)
  values('authorization.white_label.published',auth.uid(),'internal','white-label.draft.publish','tenant',p_tenant_id,'succeeded',
    jsonb_build_object('revision',next_revision,'source_draft_revision',d.revision,'previous_revision',p_expected_publication_revision,
      'request_id',p_request_id,'module_count',cardinality(d.module_keys)));
  return jsonb_build_object('outcome','published','receipt',private.white_label_publication_receipt(s));
end;
$$;
revoke all on function public.app_publish_white_label_draft(uuid,integer,integer,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.app_publish_white_label_draft(uuid,integer,integer,uuid,text) to authenticated;

create function public.app_reconcile_white_label_publication(p_tenant_id uuid,p_source_draft_revision integer,p_expected_publication_revision integer,p_request_id uuid,p_reason text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s private.tenant_white_label_publications;
begin
  perform private.require_white_label_publication_target(p_tenant_id);
  perform private.check_white_label_publication_revisions(p_tenant_id,p_source_draft_revision,p_expected_publication_revision);
  perform private.check_white_label_publication_request(p_request_id,p_reason);
  select * into s from private.tenant_white_label_publications where published_by=auth.uid() and request_id=p_request_id;
  if not found then return jsonb_build_object('outcome','not_found'); end if;
  if s.tenant_id is distinct from p_tenant_id or s.source_draft_revision is distinct from p_source_draft_revision
    or s.expected_publication_revision is distinct from p_expected_publication_revision or s.reason is distinct from btrim(p_reason) then
    raise exception 'Publication request binding conflict' using errcode='WF409';
  end if;
  return jsonb_build_object('outcome','applied','receipt',private.white_label_publication_receipt(s));
end;
$$;
revoke all on function public.app_reconcile_white_label_publication(uuid,integer,integer,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.app_reconcile_white_label_publication(uuid,integer,integer,uuid,text) to authenticated;

create function public.app_get_runtime_white_label_configuration()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  tenant uuid:=private.current_tenant_id(); membership public.tenant_memberships;
  p private.tenant_module_publications; s private.tenant_white_label_publications;
begin
  if auth.uid() is null or tenant is null or not exists(select 1 from public.profiles where id=auth.uid() and archived_at is null) then
    raise exception 'Tenant membership required' using errcode='42501';
  end if;
  select * into membership from public.tenant_memberships where tenant_id=tenant and profile_id=auth.uid() and archived_at is null;
  if membership.account_class is null or membership.account_class not in ('internal','client')
    or (membership.account_class='client' and private.current_user_company_id() is null) then
    raise exception 'Tenant membership required' using errcode='42501';
  end if;
  select * into p from private.tenant_module_publications where tenant_id=tenant order by revision desc limit 1;
  if not found then return jsonb_build_object('kind','unpublished','tenantId',tenant,'publicationRevision',0); end if;
  if not private.valid_white_label_publication_parent(p) then raise exception 'Invalid published policy' using errcode='55000'; end if;
  select * into s from private.tenant_white_label_publications where tenant_id=tenant and publication_revision=p.revision;
  if not found then return jsonb_build_object('kind','legacy_modules','tenantId',tenant,'publicationRevision',p.revision,
    'moduleKeys',(select jsonb_agg(k order by k collate "C") from unnest(p.module_keys) k)); end if;
  return jsonb_build_object('kind','published','configuration',private.white_label_publication_configuration(p,s));
end;
$$;
revoke all on function public.app_get_runtime_white_label_configuration() from public,anon,authenticated,service_role;
grant execute on function public.app_get_runtime_white_label_configuration() to authenticated;

create function public.app_preflight_white_label_publication(p_tenant_id uuid,p_source_draft_revision integer,p_expected_publication_revision integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  t public.tenants; d private.tenant_white_label_drafts; p private.tenant_module_publications;
  blockers jsonb:='[]'::jsonb; candidate jsonb; current_revision integer;
begin
  perform private.require_platform_admin();
  perform private.check_white_label_publication_revisions(p_tenant_id,p_source_draft_revision,p_expected_publication_revision);
  select * into t from public.tenants where id=p_tenant_id;
  if not found then raise exception 'Tenant not found' using errcode='P0002'; end if;
  select * into p from private.tenant_module_publications where tenant_id=p_tenant_id order by revision desc limit 1;
  if found and not private.valid_white_label_publication_parent(p) then raise exception 'Invalid published policy' using errcode='55000'; end if;
  current_revision:=coalesce(p.revision,0);
  select * into d from private.tenant_white_label_drafts where tenant_id=p_tenant_id;
  if not found then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','DRAFT_NOT_SAVED')); end if;
  if coalesce(d.revision,0)<>p_source_draft_revision then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','STALE_DRAFT')); end if;
  if current_revision<>p_expected_publication_revision then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','STALE_PUBLICATION')); end if;
  if t.status<>'active' or t.archived_at is not null then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','TENANT_INACTIVE')); end if;
  if d.tenant_id is not null then
    candidate:=jsonb_build_object('displayName',d.display_name,'primaryColor',d.primary_color,'accentColor',d.accent_color,
      'moduleKeys',(select coalesce(jsonb_agg(k order by k collate "C"),'[]'::jsonb) from unnest(d.module_keys) k));
    if not ('services'=any(d.module_keys)) then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','SERVICES_REQUIRED'));
    elsif not private.published_module_set_valid(d.module_keys) then blockers:=blockers||jsonb_build_array(jsonb_build_object('code','INVALID_MODULE_POLICY')); end if;
    if not ('projects'=any(d.module_keys)) and exists(select 1 from public.orders where tenant_id=p_tenant_id and archived_at is null and status not in ('complete','canceled')) then
      blockers:=blockers||jsonb_build_array(jsonb_build_object('code','OUTSTANDING_PROJECTS')); end if;
    if not ('tickets'=any(d.module_keys)) and exists(select 1 from public.tickets where tenant_id=p_tenant_id and archived_at is null and status<>'closed') then
      blockers:=blockers||jsonb_build_array(jsonb_build_object('code','OUTSTANDING_TICKETS')); end if;
    if not ('subscriptions'=any(d.module_keys)) and exists(select 1 from public.subscriptions where tenant_id=p_tenant_id and status<>'canceled') then
      blockers:=blockers||jsonb_build_array(jsonb_build_object('code','UNCANCELED_SUBSCRIPTIONS')); end if;
    begin
      perform private.require_invoice_publication_clear(p_tenant_id,d.module_keys);
    exception when sqlstate '55000' then
      blockers:=blockers||jsonb_build_array(jsonb_build_object('code','OUTSTANDING_FINANCIAL_OBLIGATIONS'));
    end;
  end if;
  return jsonb_build_object('tenantId',p_tenant_id,'sourceDraftRevision',p_source_draft_revision,'currentDraftRevision',coalesce(d.revision,0),
    'expectedPublicationRevision',p_expected_publication_revision,'currentPublicationRevision',current_revision,'candidate',candidate,
    'publishable',candidate is not null and jsonb_array_length(blockers)=0,'blockers',blockers);
end;
$$;
revoke all on function public.app_preflight_white_label_publication(uuid,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.app_preflight_white_label_publication(uuid,integer,integer) to authenticated;
