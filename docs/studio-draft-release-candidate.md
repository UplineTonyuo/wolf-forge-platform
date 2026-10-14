# Studio draft release candidate, rc.1

This candidate starts from canonical `UplineTonyuo/wolf-forge-platform` main `d377e290a50e788d0faec71851aef42f373bcb9b`. The existing Vercel project is `wolf-forge-platform` (`prj_Ck85gEGOBER55bl84u03P8z4syHM`, team `team_dpPiEJrmZWnVTFiOhfLlVes2`). The active production deployment is `dpl_4y3zm6kSPVCW7Jm3bymE9teXLe2x`, with the same SHA, reached through `https://wolf-forge-platform-woad.vercel.app`. Destination is main; the local preparation branch is `release/studio-only-20261014`. No push, merge or production deployment is authorized.

## Scope and provenance

Accepted Studio source: `b94afedb56e3e89f39efc8745e2a58b6015480ba`. This is a selective port onto current production, not a merge of the recovery branch. The interactive editor, saved-draft manager, color templates, device simulations, module selection, review, optimistic revisions, conflict handling and unsaved-change protection are included. Targets are existing tenant metadata records; this release does not provision tenant workspaces.

Required source commits, applied by selecting the named feature files and SQL rather than cherry-picking their surrounding tenant rollout:

| Source commit | Included responsibility |
| --- | --- |
| `b0bfe3168a9a29e133ad7e41df99961b63c15b8b` | Additive tenant metadata and profile-to-membership compatibility mirror |
| `3db3ac6b21e69597f2a311bf4c59b730fa5e555e` | Explicit global Platform Admin authorization; no grants created by migration |
| `4215269755f79960016c594ed7cc54b806c9115c` | Private tenant drafts, authenticated RPCs, audit, revision checks |
| `8d73068b72b633d64eeeb778bb0d7050cb7f756b` | Six recommended defaults for an unsaved draft only |
| `01e9d7cdadf868b4a8ad600dae333374fef275ee`, `d4579ae1aa2297379dda8c63194511c3aaba0f4a`, `3615910d0f7e2d915cff2fe7feb5ada72b2aaddb`, accepted at `b94afed` | Studio feature files at the accepted checkpoint |
| `b11559477e9e8a9c6729081ce0ead9933b1adfa1` | Local Supabase email-provider configuration correction only; global self-registration remains off |

Release adaptations remove the development-only availability condition while retaining verified sessions, explicit Platform Admin checks, Settings access and refusal of the Quick Access identity. Every action repeats these checks. RPCs independently require Platform Admin from `auth.uid()`; a tenant ID grants nothing. The navigation flag is presentation only. Existing CRM membership resolution, host routing, business policies and branding remain the production baseline.

The editor explicitly says drafts only, publishing and live branding unavailable. A draft passing validation is valid for saving, not publication approval. The simulated preview uses sample data. Drafts may contain Services OFF or no modules; saving never silently adds Services. Neither live module authorization nor live branding reads these drafts.

Excluded: Publication proposal/implementation, the frozen publication contract and its future migration, incomplete Branding consumers, newer optional-module enforcement, Forms/Coupons integration, Custom Extensions, broad tenant authorization rollout and login branding. No publication table, writer, API, button or runtime branding provider is installed.

The shared Auth fix `406529d0940da6f04d141da209d8d6eb324804fc` / handoff `0a6534974cee8556bf058ec01a716489824a485e` is excluded. It is not a schema or functional prerequisite for draft storage. It changes shared identity-lookup failure classification and retry behavior, and still needs its own complete build/runtime authorization acceptance. This candidate retains production identity lookup behavior; its transient-failure limitation remains. The small verified-email and Quick Access protections are the accepted Platform Admin prerequisite, not that retry fix.

## Migration plan

Read-only production inspection on 2026-10-14 found project `jwynqsyirgenqlmkooah`, PostgreSQL17.6, the 98 canonical baseline migrations through `20261006120000_organizations`, no tenant/admin/draft tables and zero profiles missing a valid permission preset. The exact observed registry is in `docs/qa/studio-release/production-migrations-readonly.json`. This is an observation, not authorization to modify production; repeat before rollout.

Apply exactly these four existing migrations in order after baseline-registry/schema checks:

1. `20261007120000_tenant_foundation.sql`
2. `20261009160000_platform_admin_authorization.sql`
3. `20261010090000_white_label_drafts.sql`
4. `20261010120000_white_label_recommended_draft_defaults.sql`

These introduce metadata, a fail-closed profile mirror, private drafts and new guarded RPCs. They do not tenant-convert business records or install publication enforcement. The mirror backfills membership rows and runs on subsequent profile role/company/archive writes. It requires every existing role to have a valid internal/client preset. The draft-default update leaves saved arrays, including empty arrays, intact.

All 403 production public/private application function bodies match the baseline after newline normalization. Production has 23 additional preexisting `service_role` EXECUTE grants versus a pristine replay; this difference is recorded, not removed. These four migrations revoke/grant only their newly created objects. Preserve the existing production grants and do not apply a wholesale schema diff or grant reset.

Before any later authorized application: verify the project reference, obtain and validate a fresh backup/PITR recovery point, check the 98 baseline versions and four pending versions, check no conflicting objects or draft grants, repeat the invalid-preset count, compare production function/grant metadata and inspect migration hashes. Use bounded lock/statement timeouts and a maintenance window for the profile backfill; stop on a failure. Check history and installed definitions before retrying; do not repair history to conceal a partial application. No seeds, test users, database reset, broad `--include-all` or synthetic fixtures belong in production.

Each migration must execute transactionally. After each commit, record its version/hash, definitions, RLS/ACLs and row-count invariants. Verify the profile mirror matches existing profiles without changing those profiles. Migration failure rolls back its transaction; earlier committed migrations remain additive and must be recorded.

Platform Admin bootstrap is a separate future privileged operation for an explicitly reviewed active internal profile and reason. The migration grants nobody. Never infer Platform Admin from owner/admin, provision it through a public/service-role endpoint or copy a QA identity into production. Without bootstrap, ordinary production users retain their existing application and Studio is unavailable to them.

## Validation and isolated preview

Local backend allocation and protection rules are in `docs/studio-release-allocation-20261014.md`. Backend API62321/DB62322 and app3022 are reserved for this task; the production project is never a synthetic QA target. The SQL upgrade rehearsal preserved all 71 preexisting business-table row hashes and 403 old function definitions/ACLs. The current database system identifier is `7696522045668163622`; a controlled local provider restart preserved its volume, four synthetic identities and 102 migration records. The receipt pins the current container identity as well as the system ID.

Database acceptance: 77 pgTAP files / 3291 assertions passed. Tests were adapted to scope fixture counts against existing accounts, include the draft-save audit code and use this candidate's company schema. The live Auth/Data API matrix denies owner/staff/client/anonymous/service-role access and allows the separately granted synthetic Platform Admin. Direct private-table access and forged tokens are refused.

Application regression evidence, production build, exact candidate SHA and rendered QA results are recorded in the final release validation report. Historical screenshots/test claims from the accepted recovery branch do not count as a new pass. Local browser checks use installed Playwright because the Browser plugin is not available. Tests must pin the committed candidate SHA and reject tracked source drift.

Fresh local public-schema generation verified the four RPC declarations. Two explicit nullable return overrides are retained: an unsaved draft's `updated_at` and an unsaved tenant's `draft_revision` can actually be null, which function-return generation does not express. Only the two new public table declarations were added; unrelated historical type drift was not rewritten.

The local backend uses a separate Docker network with loopback host bindings, following [Supabase local-development guidance](https://supabase.com/docs/guides/local-development). Verify the effective bindings; a loopback API URL alone is not proof of isolation.

Hosted preview is BLOCKED until an approved isolated hosted backend is identified and its credentials can be scoped to a preview deployment. The connected WOLF FORGE SPP account currently lists production only. The local disposable backend is not reachable from Vercel and must not be exposed through a public tunnel. No preview has been deployed or pointed at production. Do not reuse existing production/preview project environment values without verifying their backend identity. Preview metadata must identify this exact commit, and environment overrides must affect only that isolated preview. Do not push main to trigger it.

`npm audit --omit=dev` reports zero high/critical vulnerabilities and one preexisting moderate `music-metadata` vulnerability group (two advisories). No dependency/lockfile changes or tool installations are part of this release. This inherited limitation is not a new security acceptance.

## Future production deployment and recovery

These are review instructions, not operations performed:

1. Resolve every BLOCKED gate in the final report. Obtain the separate production authorization. Recheck canonical main and active deployment; rebuild the candidate if either changed.
2. Complete isolated hosted preview QA, including hosted BotID login, entitlement refusal, draft save/reload/conflict and unaffected CRM flows. Verify no production backend credentials entered the preview. Vercel preview validation does not certify production environment values.
3. Take/verify the recovery point and migration preflight above. Apply only the four migrations with one operator; verify all existing data/grants and each new boundary. Provision only the explicitly approved Platform Admin if bootstrap is authorized.
4. With separate push/merge approval, deliver the reviewed exact candidate through the canonical repository's protected main workflow. Build with the intended production environment in an unassigned/staged deployment and verify it before any alias/promotion action. A preview may be rebuilt with different environment values; inspect the final build SHA/backend first. Do not expose QA credentials or enable Local QA in a hosted build.
5. After separately approved production promotion, smoke-test existing staff/client flows and the approved Platform Admin's draft save. Confirm there is no publication endpoint, no live branding change and no tenant business-data rewrite. Stop promotion/traffic changes on failure.
6. Application recovery target: production deployment `dpl_4y3zm6kSPVCW7Jm3bymE9teXLe2x` / canonical SHA `d377e290a50e788d0faec71851aef42f373bcb9b`. Verify its current rollback eligibility and environment compatibility at execution time. Route traffic back through Vercel's reviewed rollback mechanism. This does not reverse database migrations.
7. Retain additive tenant/admin/draft tables and saved drafts when rolling back the app; the old application does not consume them. Never drop the draft tables, remove valid history or undo real business writes as a routine rollback. A profile-mirror failure needs a reviewed forward fix; do not disable integrity controls blindly. For actual data corruption, restore the verified recovery point into a separate isolated project first, assess writes since that point and plan reconciliation before any destructive production restoration.

No production migrations, grant changes, production-branch push/merge or production deployment occurred during preparation. Canonical vault notes remain read-only; no memory tree, hook or automatic sync was created.
