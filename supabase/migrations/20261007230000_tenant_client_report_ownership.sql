-- Wolf Forge Platform
-- White Label WL-1C.8: Tenant ownership of Client reports.
--
-- public.client_reports gains a NOT NULL tenant_id, and its Client, Service
-- and Subscription references become Tenant-relative composite foreign keys,
-- so a report in one Tenant cannot be addressed to a Client, or tied to a
-- Service or Subscription, of another Tenant, even through a trusted write.
--
-- Sections, entries and read receipts carry no tenant_id and inherit through
-- report_id. Read receipts are written only by a client of the report's
-- Client (app_mark_client_report_read), and no other Tenant-owned root hangs
-- off a report, so no UNIQUE (tenant_id, id) is added yet. Later re-homing of a
-- report's tenant_id does not revalidate children (root-ownership policy,
-- KI-107).
--
-- RLS, policies, grants, RPCs and notifications are unchanged. Cross-Tenant
-- read/write isolation is WL-2.
--
-- Same backfill as WL-1C.1: the IMMUTABLE private.wolf_forge_tenant_id()
-- default fills existing rows without an UPDATE. Existing references stay
-- valid: every Client, Service and Subscription is Wolf Forge's. New rows then
-- default to private.identity_tenant_id().
--
-- Deliberately global: sent_by_profile_id (actor),
-- client_report_reads.profile_id (reader receipt), and the Client / Service /
-- Subscription columns of private.reported_one_time_deliverables. That
-- owner-only table has no API grants; its single writer (the report send RPC)
-- copies those columns from the sent report it cites (completed_report_id), so
-- its rows inherit the report's Tenant.

alter table public.client_reports
  add column tenant_id uuid not null default private.wolf_forge_tenant_id()
    constraint client_reports_tenant_id_fkey references public.tenants (id) on delete restrict,
  drop constraint client_reports_company_id_fkey,
  add constraint client_reports_company_id_fkey
    foreign key (tenant_id, company_id)
    references public.companies (tenant_id, id)
    on delete restrict,
  drop constraint client_reports_service_id_fkey,
  add constraint client_reports_service_id_fkey
    foreign key (tenant_id, service_id)
    references public.services (tenant_id, id)
    on delete restrict,
  drop constraint client_reports_subscription_id_fkey,
  add constraint client_reports_subscription_id_fkey
    foreign key (tenant_id, subscription_id)
    references public.subscriptions (tenant_id, id)
    on delete restrict;

alter table public.client_reports
  alter column tenant_id set default private.identity_tenant_id();
