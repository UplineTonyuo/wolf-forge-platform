-- Wolf Forge Platform
-- White Label WL-1C.2a: Tenant ownership of Forms.
--
-- public.forms gains a NOT NULL tenant_id. A Form is the authoritative Tenant
-- source for its submissions: a public (anonymous) submission reaches the Form
-- through form_submissions.form_id, so the Ticket slice can file a Contact
-- Form Ticket in the Form's Tenant without relying on caller identity or a
-- Wolf Forge fallback.
--
-- Forms only. Versions, fields, submissions, values, assignments and files
-- inherit through form_id / form_version_id. RLS, policies, grants and
-- functions are unchanged; cross-Tenant read isolation is WL-2.
--
-- Same backfill as WL-1C.1: the IMMUTABLE private.wolf_forge_tenant_id()
-- default fills existing rows without an UPDATE, so no row trigger fires and
-- updated_at is untouched. New rows then default to
-- private.identity_tenant_id():
--   signed-in app_create_form   -> the caller's current Tenant
--   invalid or foreign selector -> NULL, the insert fails NOT NULL
--   anon                        -> NULL (anon cannot create Forms anyway)
--   service_role                -> no INSERT grant on forms

alter table public.forms
  add column tenant_id uuid not null default private.wolf_forge_tenant_id()
    constraint forms_tenant_id_fkey references public.tenants (id) on delete restrict;

alter table public.forms
  alter column tenant_id set default private.identity_tenant_id();
