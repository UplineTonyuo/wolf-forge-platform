-- Client portal Store module.
--
-- Store is the client-facing presentation of the existing Services catalog. It
-- is not a second catalog: public.services and public.service_folders remain the
-- single source of truth, and the client-visible slice is already decided by
-- services_authenticated_select_active (is_active and is_public and not
-- archived) plus service_folders_authenticated_select_active.
--
-- Store therefore needs no new table, view or RPC. It needs one capability so a
-- client portal module can be derived from a real permission the same way every
-- other module is.
--
-- store.view is deliberately a new capability rather than a reuse of the
-- internal services.view. private.is_client_eligible_permission() derives client
-- eligibility from client-class permission_modules rows, so pointing
-- portal_store at services.view would make an internal capability grantable to
-- a client account through the override path. The two stay disjoint.

insert into public.permissions (
  permission_key,
  category,
  label,
  description
)
values (
  'store.view',
  'store',
  'Browse the Store',
  'Browse the client-facing Store presentation of the public service catalog.'
)
on conflict (permission_key) do update
set category = excluded.category,
    label = excluded.label,
    description = excluded.description,
    updated_at = now();

-- The client preset holds store.view. Internal presets do not: internal staff
-- reach the catalog through the Services module, and the owner preset is
-- allow-all by resolution order rather than by grant.
insert into public.role_permissions (role_id, permission_key, allowed)
select role_row.id, 'store.view', true
from public.roles as role_row
where role_row.name = 'client'
on conflict (role_id, permission_key) do update
set allowed = excluded.allowed,
    updated_at = now();

-- sort_order 25 places Store between Projects (20) and Tickets (30) in module
-- order; the portal groups them into its own STORE section.
insert into public.permission_modules (
  module_key,
  label,
  account_class,
  required_permission_key,
  sort_order
)
values ('portal_store', 'Store', 'client', 'store.view', 25)
on conflict (module_key) do update
set label = excluded.label,
    account_class = excluded.account_class,
    required_permission_key = excluded.required_permission_key,
    sort_order = excluded.sort_order,
    updated_at = now();

comment on table public.permission_modules
is 'Navigation modules derived from real capabilities, per account class. Client portal modules are prefixed portal_ and never reference an internal capability.';
