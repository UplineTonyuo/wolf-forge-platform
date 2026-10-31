-- Synthetic Supabase fixtures only. Everything, including counters and audit, rolls back.
begin;
select no_plan();

select ok(to_regprocedure('public.app_create_invoice_share_link(uuid,uuid,text)') is not null,'share creation RPC exists');
select ok(not has_function_privilege('anon','public.app_create_invoice_share_link(uuid,uuid,text)','EXECUTE'),'anonymous cannot mint sharing capabilities');
select ok(not has_function_privilege('anon','public.app_list_invoice_share_links(uuid)','EXECUTE'),'anonymous cannot list links');
select ok(not has_function_privilege('anon','public.app_revoke_invoice_share_link(uuid)','EXECUTE'),'anonymous cannot revoke links');
select ok(has_function_privilege('anon','public.app_get_public_invoice_share(text)','EXECUTE'),'only limited public projection is anonymous');
select ok(not has_table_privilege('authenticated','private.invoice_share_links','SELECT') and not has_table_privilege('anon','private.invoice_share_links','SELECT'),'private token hashes are not raw API rows');
select ok((select relrowsecurity from pg_class where oid='private.invoice_share_links'::regclass),'private links also enable RLS');
select ok(not private.client_support_operation_allowed('/rest/v1/rpc/app_create_invoice_share_link','POST'),'client support cannot create public invoice links');

insert into auth.users(id,aud,role,email,created_at,updated_at)
select ('20000000-0000-4000-8000-00000000185'||n)::uuid,'authenticated','authenticated','invoice-share-'||n||'@example.invalid',now(),now() from generate_series(1,6) n;
insert into public.tenants(id,slug,display_name,status) values
 ('f0f0f0f0-0000-4000-8000-000000001851','invoice-share-a','Share A','active'),
 ('f0f0f0f0-0000-4000-8000-000000001852','invoice-share-b','Share B','active');
insert into public.companies(id,tenant_id,name,status) values
 ('d0185000-0000-4000-8000-000000000001','f0f0f0f0-0000-4000-8000-000000001851','Share Company A','client'),
 ('d0185000-0000-4000-8000-000000000002','f0f0f0f0-0000-4000-8000-000000001851','Other Company A','client'),
 ('d0185000-0000-4000-8000-000000000003','f0f0f0f0-0000-4000-8000-000000001852','Share Company B','client');
insert into public.tenant_memberships(tenant_id,profile_id,account_class,role_id,company_id)
select v.tenant::uuid,v.profile::uuid,v.class,r.id,v.company::uuid from (values
 ('f0f0f0f0-0000-4000-8000-000000001851','20000000-0000-4000-8000-000000001851','internal','owner',null),
 ('f0f0f0f0-0000-4000-8000-000000001851','20000000-0000-4000-8000-000000001852','client','client','d0185000-0000-4000-8000-000000000001'),
 ('f0f0f0f0-0000-4000-8000-000000001852','20000000-0000-4000-8000-000000001853','internal','owner',null),
 ('f0f0f0f0-0000-4000-8000-000000001851','20000000-0000-4000-8000-000000001854','internal','staff',null),
 ('f0f0f0f0-0000-4000-8000-000000001851','20000000-0000-4000-8000-000000001855','client','client','d0185000-0000-4000-8000-000000000002')
)v(tenant,profile,class,role_name,company) join public.roles r on r.name=v.role_name;
insert into public.profile_permission_overrides(tenant_id,profile_id,permission_key,allowed) values
 ('f0f0f0f0-0000-4000-8000-000000001851','20000000-0000-4000-8000-000000001854','invoices.view',true),
 ('f0f0f0f0-0000-4000-8000-000000001851','20000000-0000-4000-8000-000000001854','invoices.manage',false);

create function pg_temp.act(n integer,tenant text default 'f0f0f0f0-0000-4000-8000-000000001851') returns void language sql as $$
 select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-00000000185'||n,true);
 select set_config('request.jwt.claims','',true);
 select set_config('request.headers',json_build_object('x-wf-tenant',tenant)::text,true);
$$;
create function pg_temp.clear_actor() returns void language sql as $$
 select set_config('request.jwt.claim.sub','',true); select set_config('request.jwt.claims','',true); select set_config('request.headers','{}',true);
$$;
create temp table share_ids(label text primary key,value jsonb not null);
grant select,insert,update on share_ids to authenticated,anon;
create function pg_temp.id(label_value text) returns uuid language sql as $$select (value->>'id')::uuid from share_ids where label=label_value$$;
create function pg_temp.token(n integer) returns text language sql immutable as $$select repeat(n::text,64)$$;
create function pg_temp.hash(n integer) returns text language sql immutable as $$select encode(extensions.digest(pg_temp.token(n),'sha256'),'hex')$$;
create function pg_temp.make_invoice(p_company uuid,p_client uuid,p_issue boolean default true) returns jsonb language plpgsql as $$
declare i public.invoices;
begin
 i:=public.app_create_invoice(extensions.gen_random_uuid(),jsonb_build_object('company_id',p_company,'client_profile_id',p_client,'currency','USD','billing_reason','manual','due_at',now()+interval '7 days','tax_total_cents',200,'items',jsonb_build_array(jsonb_build_object('service_id',null,'name','Shareable invoice line','description','Customer-visible description','quantity',2,'unit_price_cents',1200,'unit_discount_cents',100,'is_taxable',true))));
 if p_issue then i:=public.app_issue_invoice(i.id); end if;
 return to_jsonb(i);
end;$$;
select pg_temp.act(1);
set local role authenticated;
insert into share_ids values('main',pg_temp.make_invoice('d0185000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000001852')),
 ('draft',pg_temp.make_invoice('d0185000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000001852',false)),
 ('void',pg_temp.make_invoice('d0185000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000001852'));
select public.app_void_invoice(pg_temp.id('void'));
select throws_ok($$select public.app_create_invoice_share_link('de185000-0000-4000-8000-000000000001',pg_temp.id('draft'),pg_temp.hash(1))$$,'42501',null,'draft invoice cannot be shared');
select throws_ok($$select public.app_create_invoice_share_link('de185000-0000-4000-8000-000000000001',pg_temp.id('void'),pg_temp.hash(1))$$,'42501',null,'void invoice cannot be shared');
select throws_ok($$select public.app_create_invoice_share_link('de185000-0000-4000-8000-000000000001',pg_temp.id('main'),'weak')$$,'22023',null,'malformed hash refused');
insert into share_ids values('first',public.app_create_invoice_share_link('de185000-0000-4000-8000-000000000001',pg_temp.id('main'),pg_temp.hash(1)));
select is(public.app_create_invoice_share_link('de185000-0000-4000-8000-000000000001',pg_temp.id('main'),pg_temp.hash(1)),(select value from share_ids where label='first'),'same actor/request/payload returns original metadata');
select throws_ok($$select public.app_create_invoice_share_link('de185000-0000-4000-8000-000000000001',pg_temp.id('main'),pg_temp.hash(2))$$,'22023',null,'request cannot be rebound to another token');
select ok((select (value->>'expires_at')::timestamptz-(value->>'created_at')::timestamptz=interval '30 days' from share_ids where label='first'),'new links expire in exactly30 days');
select is((select count(*) from jsonb_object_keys((select value from share_ids where label='first'))),4::bigint,'management projection contains four metadata fields only');
select is(jsonb_array_length(public.app_list_invoice_share_links(pg_temp.id('main'))),1,'authorized manager sees only this invoice metadata');
select pg_temp.act(2);
select throws_ok($$select public.app_list_invoice_share_links(pg_temp.id('main'))$$,'42501',null,'client cannot list hashes or link metadata');
select throws_ok($$select public.app_create_invoice_share_link('de185000-0000-4000-8000-000000000002',pg_temp.id('main'),pg_temp.hash(2))$$,'42501',null,'client cannot grant anonymous invoice access');
select pg_temp.act(4);
select throws_ok($$select public.app_list_invoice_share_links(pg_temp.id('main'))$$,'42501',null,'invoice viewer without manage cannot list links');
select pg_temp.act(3,'f0f0f0f0-0000-4000-8000-000000001852');
select throws_ok($$select public.app_list_invoice_share_links(pg_temp.id('main'))$$,'42501',null,'another Tenant Owner cannot manage this invoice');
insert into share_ids values('other',pg_temp.make_invoice('d0185000-0000-4000-8000-000000000003',null));
insert into share_ids values('other-link',public.app_create_invoice_share_link('de185000-0000-4000-8000-000000000003',pg_temp.id('other'),pg_temp.hash(3)));
reset role;
select pg_temp.clear_actor();
set local role anon;
select throws_ok($$select public.app_create_invoice_share_link('de185000-0000-4000-8000-000000000009',pg_temp.id('main'),pg_temp.hash(9))$$,'42501',null,'anonymous mint is refused at EXECUTE boundary');
select throws_ok($$select public.app_get_public_invoice_share(null)$$,'P0002',null,'null token has generic not-found response');
select throws_ok($$select public.app_get_public_invoice_share('invalid')$$,'P0002',null,'malformed token has same response');
select throws_ok($$select public.app_get_public_invoice_share(repeat('9',64))$$,'P0002',null,'unknown valid token has same response');
insert into share_ids values('public',public.app_get_public_invoice_share(pg_temp.token(1)));
select is((select array_agg(k order by k) from jsonb_object_keys((select value from share_ids where label='public')) k),array['invoice','settings']::text[],'public envelope is an explicit two-field allowlist');
select is((select array_agg(k order by k) from jsonb_object_keys((select value->'invoice' from share_ids where label='public')) k),array['balance_due_cents','company_name','currency','discount_total_cents','due_at','id','issued_at','items','number','payment_reported','status','subtotal_cents','successful_paid_cents','tax_total_cents','tenant_id','total_cents']::text[],'public invoice has only the agreed invoice/financial figures');
select is((select array_agg(k order by k) from jsonb_object_keys((select value#>'{invoice,items,0}' from share_ids where label='public')) k),array['description','name','quantity','total_cents','unit_price_cents']::text[],'public item excludes all internal linkage');
select is((select value#>>'{invoice,company_name}' from share_ids where label='public'),'Share Company A','public share follows its parent company');
select is((select (value#>>'{invoice,tenant_id}')::uuid from share_ids where label='public'),'f0f0f0f0-0000-4000-8000-000000001851'::uuid,'public share follows its parent Tenant');
select is((select (value#>>'{invoice,total_cents}')::bigint from share_ids where label='public'),2400::bigint,'invoice total includes line discount and tax');
select is((select (value#>>'{invoice,balance_due_cents}')::bigint from share_ids where label='public'),2400::bigint,'public balance is authoritative, not a wallet preview');
select is((select (value#>>'{invoice,subtotal_cents}')::bigint from share_ids where label='public'),2400::bigint,'subtotal is explicit');
select is((select (value#>>'{invoice,discount_total_cents}')::bigint from share_ids where label='public'),200::bigint,'discount total is explicit');
select is((select (value#>>'{invoice,tax_total_cents}')::bigint from share_ids where label='public'),200::bigint,'tax total is explicit');
select is((select (value#>>'{invoice,items,0,total_cents}')::bigint from share_ids where label='public'),2200::bigint,'item totals use discounted stored line subtotal');
select ok((select not (value ?| array['claims','receipts','payments','wallet','contacts','history']) and not ((value->'invoice') ?| array['client_profile_id','company_id','billing_address','email','phone','created_by_profile_id']) and not ((value#>'{invoice,items,0}') ?| array['order_id','service_id','invoice_id']) from share_ids where label='public'),'public DTO excludes private account/history/linkage fields');
select is((select value->'settings' from share_ids where label='public'),'{"enabled":false,"paypal_url":null,"instructions":""}'::jsonb,'unconfigured public manual payment is disabled');
reset role;
select pg_temp.clear_actor();
select is((select token_sha256 from private.invoice_share_links where id=pg_temp.id('first')),pg_temp.hash(1),'only a SHA256 hash is stored');
select ok((select not to_jsonb(l)::text like '%'||pg_temp.token(1)||'%' from private.invoice_share_links l where id=pg_temp.id('first')),'raw public token is never persisted in link row');
select is((select count(*) from public.activity_events where entity_id=pg_temp.id('main') and action='invoice.share_link_created'),1::bigint,'idempotent creation records one attributable audit event');
select ok((select not metadata::text like '%'||pg_temp.token(1)||'%' and not metadata::text like '%'||pg_temp.hash(1)||'%' from public.activity_events where entity_id=pg_temp.id('main') and action='invoice.share_link_created'),'audit contains no token or hash');

-- A prepared pending report changes presentation only, not the ledger.
insert into private.invoice_payment_receipts(id,tenant_id,invoice_id,uploader_profile_id,request_id,original_name,mime_type,size_bytes,checksum_sha256,object_key,verified_at)
values('df185000-0000-4000-8000-000000000001','f0f0f0f0-0000-4000-8000-000000001851',pg_temp.id('main'),'20000000-0000-4000-8000-000000001852','de185000-0000-4000-8000-000000000010','receipt.png','image/png',16,repeat('a',64),'synthetic-share-receipt',now());
insert into private.invoice_manual_payment_claims(tenant_id,invoice_id,company_id,client_profile_id,request_id,receipt_id,amount_cents,currency,method)
values('f0f0f0f0-0000-4000-8000-000000001851',pg_temp.id('main'),'d0185000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000001852','de185000-0000-4000-8000-000000000011','df185000-0000-4000-8000-000000000001',2400,'USD','paypal');
set local role anon;
select is((public.app_get_public_invoice_share(pg_temp.token(1))#>>'{invoice,payment_reported}')::boolean,true,'public status can say payment under review without exposing receipt');
reset role;
select pg_temp.clear_actor();
select is((select count(*) from public.invoice_payments where invoice_id=pg_temp.id('main')),0::bigint,'public reads/report flag never record payment');
select is((select status from public.invoices where id=pg_temp.id('main')),'unpaid','a reported payment is not a financial pending or paid status');
insert into private.invoice_manual_payment_settings(tenant_id,enabled,paypal_url,instructions,updated_by_profile_id)
values('f0f0f0f0-0000-4000-8000-000000001851',false,'https://paypal.me/example','Disabled recipient instructions','20000000-0000-4000-8000-000000001851');
set local role anon;
select is(public.app_get_public_invoice_share(pg_temp.token(1))->'settings','{"enabled":false,"paypal_url":null,"instructions":""}'::jsonb,'disabled configured details do not leak into public payload');
reset role;
select pg_temp.clear_actor();
update private.invoice_manual_payment_settings set enabled=true where tenant_id='f0f0f0f0-0000-4000-8000-000000001851';
set local role anon;
select is(public.app_get_public_invoice_share(pg_temp.token(1))#>>'{settings,paypal_url}','https://paypal.me/example','enabled operator instructions are available to payer');
reset role;
select pg_temp.act(1);
set local role authenticated;
insert into share_ids values('second',public.app_create_invoice_share_link('de185000-0000-4000-8000-000000000002',pg_temp.id('main'),pg_temp.hash(2))),
 ('fourth',public.app_create_invoice_share_link('de185000-0000-4000-8000-000000000004',pg_temp.id('main'),pg_temp.hash(4)));
select throws_ok($$select public.app_create_invoice_share_link('de185000-0000-4000-8000-000000000005',pg_temp.id('main'),pg_temp.hash(5))$$,'22023',null,'one locked invoice permits at most three active links');
insert into share_ids values('revoked',public.app_revoke_invoice_share_link(pg_temp.id('first')));
select ok((select value->>'revoked_at' is not null from share_ids where label='revoked'),'revoke is explicit and recorded');
select is(public.app_revoke_invoice_share_link(pg_temp.id('first')),(select value from share_ids where label='revoked'),'repeat revoke is idempotent');
select ok(public.app_create_invoice_share_link('de185000-0000-4000-8000-000000000001',pg_temp.id('main'),pg_temp.hash(1))->>'revoked_at' is not null,'replaying old creation cannot restore a revoked link');
reset role;
select pg_temp.clear_actor();
set local role anon;
select throws_ok($$select public.app_get_public_invoice_share(pg_temp.token(1))$$,'P0002',null,'revoked token has generic not-found response');
reset role;
select pg_temp.clear_actor();
insert into private.invoice_share_links(tenant_id,invoice_id,created_by_profile_id,request_id,token_sha256,created_at,expires_at)
values('f0f0f0f0-0000-4000-8000-000000001851',pg_temp.id('main'),'20000000-0000-4000-8000-000000001851','de185000-0000-4000-8000-000000000008',pg_temp.hash(8),now()-interval '2 days',now()-interval '1 day');
set local role anon;
select throws_ok($$select public.app_get_public_invoice_share(pg_temp.token(8))$$,'P0002',null,'expired token is indistinguishable from unknown');
reset role;
select pg_temp.clear_actor();
insert into private.invoice_share_links(tenant_id,invoice_id,created_by_profile_id,request_id,token_sha256) values
 ('f0f0f0f0-0000-4000-8000-000000001851',pg_temp.id('draft'),'20000000-0000-4000-8000-000000001851','de185000-0000-4000-8000-000000000006',pg_temp.hash(6)),
 ('f0f0f0f0-0000-4000-8000-000000001851',pg_temp.id('void'),'20000000-0000-4000-8000-000000001851','de185000-0000-4000-8000-000000000007',pg_temp.hash(7));
set local role anon;
select throws_ok($$select public.app_get_public_invoice_share(pg_temp.token(6))$$,'P0002',null,'even a stored capability cannot reveal a draft invoice');
select throws_ok($$select public.app_get_public_invoice_share(pg_temp.token(7))$$,'P0002',null,'a stored capability cannot reveal a void invoice');
reset role;
select pg_temp.clear_actor();
-- Force only this valid link's rate bucket to its limit, not a global/private bypass.
select public.app_get_public_invoice_share(pg_temp.token(2));
update private.rate_limit_counters set hits=20 where scope='invoice.share.read.link' and subject=pg_temp.id('second')::text;
set local role anon;
select throws_ok($$select public.app_get_public_invoice_share(pg_temp.token(2))$$,'WF429',null,'valid-link read fanout is bounded before projection');
reset role;
select pg_temp.clear_actor();
-- Full existing payment authority settles this synthetic custom-line invoice first.
select pg_temp.act(3,'f0f0f0f0-0000-4000-8000-000000001852');
set local role authenticated;
select public.app_record_invoice_payment('de185000-0000-4000-8000-000000000013',pg_temp.id('other'),2400,'succeeded','manual','manual','share-module-fixture');
reset role;
select pg_temp.clear_actor();
update public.profiles set role_id=(select id from public.roles where name='admin') where id='20000000-0000-4000-8000-000000001856';
select private.grant_platform_admin('20000000-0000-4000-8000-000000001856','Invoice share module fixture');
select pg_temp.act(6,'f0f0f0f0-0000-4000-8000-000000001852');
select private.publish_tenant_modules('f0f0f0f0-0000-4000-8000-000000001852',0,
 (select array_agg(module_key order by module_key) from private.white_label_modules where module_key not in ('invoices','subscriptions')),'Invoice public share module-off fixture');
select pg_temp.clear_actor();
set local role anon;
select throws_ok($$select public.app_get_public_invoice_share(pg_temp.token(3))$$,'P0002',null,'public access is unavailable while Invoice module is disabled, even for a paid historic invoice');
reset role;
select pg_temp.clear_actor();
-- Deterministic authority-change injection, only inside this rollback fixture:
-- retain invoices.view but revoke invoices.manage at the lifecycle boundary.
-- This exercises the after-wait decision without a timing-sensitive sleep.
alter function private.require_invoice_write(uuid) rename to share185_original_require_invoice_write;
create function private.require_invoice_write(p_tenant_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform private.share185_original_require_invoice_write(p_tenant_id);
 update public.profile_permission_overrides set allowed=false
 where tenant_id=p_tenant_id and profile_id=auth.uid()
   and profile_id='20000000-0000-4000-8000-000000001854' and permission_key='invoices.manage';
end;$$;
revoke all on function private.require_invoice_write(uuid) from public,anon,authenticated,service_role;
update public.profile_permission_overrides set allowed=true
where tenant_id='f0f0f0f0-0000-4000-8000-000000001851' and profile_id='20000000-0000-4000-8000-000000001854' and permission_key='invoices.manage';
select pg_temp.act(4);
set local role authenticated;
select throws_ok($$select public.app_list_invoice_share_links(pg_temp.id('main'))$$,'42501',null,'link listing rechecks manage authority after lifecycle acquisition even when view remains allowed');
reset role;
select pg_temp.clear_actor();
drop function private.require_invoice_write(uuid);
alter function private.share185_original_require_invoice_write(uuid) rename to require_invoice_write;
update public.profile_permission_overrides set allowed=false
where tenant_id='f0f0f0f0-0000-4000-8000-000000001851' and profile_id='20000000-0000-4000-8000-000000001854' and permission_key='invoices.manage';
update public.tenant_memberships set archived_at=now() where tenant_id='f0f0f0f0-0000-4000-8000-000000001851' and profile_id='20000000-0000-4000-8000-000000001851';
select pg_temp.act(1);
set local role authenticated;
select throws_ok($$select public.app_list_invoice_share_links(pg_temp.id('main'))$$,'42501',null,'revoked current membership cannot manage old links');
reset role;
select pg_temp.clear_actor();
update public.companies set archived_at=now() where id='d0185000-0000-4000-8000-000000000001';
set local role anon;
select throws_ok($$select public.app_get_public_invoice_share(pg_temp.token(4))$$,'P0002',null,'archived parent company cannot remain public');
reset role;
select pg_temp.clear_actor();
update public.companies set archived_at=null where id='d0185000-0000-4000-8000-000000000001';
update public.tenants set status='archived',archived_at=now() where id='f0f0f0f0-0000-4000-8000-000000001851';
set local role anon;
select throws_ok($$select public.app_get_public_invoice_share(pg_temp.token(4))$$,'P0002',null,'archived Tenant cannot keep serving a public invoice');
reset role;
select * from finish();
rollback;
