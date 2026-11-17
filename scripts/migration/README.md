# SPP Accounts importer

`npx tsx scripts/migration/spp-accounts-import.ts --csv <absolute-accounts-csv-path>`

The default is an offline preflight. Output is aggregate JSON only. `would_create` counts eligible unique-email candidates; `database_state_checked: 0` means existing database state was not consulted, so zero `would_skip_already_imported` is not proof that an existing database contains no matching accounts. Nothing is written or sent, and configured credentials are not used. All input is parsed before apply can mutate anything. Only mapped fields are retained temporarily in memory; no rows are spooled to disk. `form_data` filenames/columns are refused.

Optional `--only-emails <absolute-file-path>` accepts one email per line, normalized by trimming and lowercasing. An empty or malformed pilot list is refused. Keep both source and pilot files outside the repository; never paste their contents into logs or reports.

## Owner-approved preview rehearsal only

Do not run apply without owner approval. Apply needs `--apply --target-project-ref <preview-ref>`, matching a canonical HTTPS `SUPABASE_URL`. Production `jwynqsyirgenqlmkooah`, custom hosts, conflicting URL configuration and unknown targets are refused. Supply `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` and a current owner `SPP_IMPORT_OPERATOR_TOKEN` through the server process environment; never put secrets in command arguments or output. The owner session must resolve to Wolf Forge and hold its owner preset. Gmail must not be connected in the rehearsal preview. The CLI does not load an environment file, sign in, invite, generate links or refresh operator tokens.

The additive reference migration must be reviewed and applied to the approved preview before rehearsal. This task does not apply it. It must follow every migration currently on main. The importer reuses the provisioning input schema and existing database company/profile/contact/Stripe-reference boundaries, rather than the UI action that orchestrates welcome email.

A durable source-ID/email-digest claim precedes the Auth Admin call. Auth creation omits a password; the database refuses to attach an identity with an existing password, mismatched email, earlier creation date or prior tenant membership. Database completion is atomic, then a separate read verifies the persisted account before it is counted. An uncertain outcome stops the batch with `manual_review` and `not_attempted` counts. Never delete pending references, blindly retry Auth, or attach an unrelated existing user. Reconcile the authoritative Auth and reference state in a separately approved owner task before retrying.

Within one file, contradictory emails for a source ID are rejected before any provisioning. Duplicate source IDs are counted; duplicate emails create only one account. Apply still checks each distinct source ID against durable references, including duplicate-email rows. References retain the first canonical SPP ID for each email; duplicate aliases have no separate reference row and later migration tasks must resolve them through the canonical email mapping. Reordered aliases still skip by the unique email digest.

Each created company uses `company`, or the client's full name when company is blank (owner-approved); both missing is rejected. Names/email/phone/display name and the Stripe customer reference are the only source identity fields imported. Historical timestamps, source status/roles, free text, addresses, attribution and all financial amounts are ignored. Stripe references are linked through the existing database RPC without contacting Stripe or creating billing/subscription records. No historical balance is moved. Standard company creation also creates the existing empty wallet; no wallet transaction or charge is created.

The contact INSERT is an unlinked secondary contact, so the existing notification trigger returns without emission. Its profile and primary flag are then updated within the same database transaction. Existing auth, RLS, tenant and notification definitions are unchanged. Owner-controlled activation/welcome delivery remains a later normal WOAD action.

## Proof and limits

`src/tests/spp-accounts-importer.test.ts` covers offline dry run, production/target refusal, SDK endpoint allowlist, password omission, pending attempts, idempotency, duplicates/conflicts, pilot selection, tenant refusal, full CSV preflight and fresh readback. Fixtures are synthetic.

`supabase/tests/database/213_spp_account_external_references.test.sql` covers private references/ACLs, owner/tenant checks, durable claims, deduplication, ownership and passwordlessness. It replaces the notification emitter with a failing sentinel inside its rolled-back transaction and exercises both a silent import and an ordinary positive control. Run it through the existing pgTAP CI lane. A source-reviewed SQL test is not a local database pass.

The aggregate mapping and real-file statistics belong in the PR/owner's external report, never a checked-in data derivative. No later-file importer is included.