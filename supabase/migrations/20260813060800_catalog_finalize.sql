-- Re-run the complete catalog through its private deterministic seed boundary.
-- This also proves migration-time idempotency after all seven captures load.
select private.seed_wolf_forge_services_catalog();
