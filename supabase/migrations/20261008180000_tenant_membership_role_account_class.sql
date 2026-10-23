-- WL-2.21 (KI-124): a Tenant membership's account_class must match its role.
--
-- permission_presets already classifies every role: role_id is unique there,
-- account_class is 'internal' or 'client', and system presets cannot change
-- either (protect_system_permission_preset). Every membership writer already
-- copies the class from the preset, but nothing stopped a direct write from
-- storing, e.g., account_class = 'client' with the owner role.
--
-- A composite foreign key makes the preset the single source of truth for every
-- INSERT and UPDATE of either column, archived rows included. No trigger, no
-- role UUIDs, no new role metadata.

alter table public.permission_presets
  add constraint permission_presets_role_account_class_key
  unique (role_id, account_class);

alter table public.tenant_memberships
  add constraint tenant_memberships_role_account_class_fkey
  foreign key (role_id, account_class)
  references public.permission_presets (role_id, account_class);
