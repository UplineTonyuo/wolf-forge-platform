# PR #76 preparation evidence — 29 October 2026

Status: local merge preparation and owner design only; PR remains draft and remote head unchanged. No push, server, call, push notification, deployment, Vercel platform change, Docker, production database access, production Daily key, real customer/William account or RojanCRM operation. Main's already-committed source configuration was inherited through the merge.

## Source and memory

* Worktree: `C:/Users/TrojanNiAnton/Documents/Codex/2026-10-20/continue-the-wolf-forge-spp-project/work/woad-voice-release-20261026`.
* Branch: `codex/woad-live-calls-20261026`; initial clean HEAD `4d4b8909ab6e3640c9d9957b910f2d199130daf7`.
* Fresh fetched main: `205214bae3a965384e1974bcd64915911ea1eefe`.
* [PR #76](https://github.com/UplineTonyuo/wolf-forge-platform/pull/76) description read through the GitHub connector. It describes private two-person Daily calls in open Ticket conversations, historical six-job CI success, incomplete two-party media and no closed-app ringing. Its pending-build paragraph is older than the saved successful compiled-build handoff dated 27 October; neither is a fresh test pass.
* Global OS: `C:/Users/TrojanNiAnton/Downloads/Anthony OS-20261009T175758Z-1-001/Anthony OS/10 Templates/Coding Agent OS/CODING AGENT OPERATING SYSTEM.md`.
* Canonical memory: `C:/Users/TrojanNiAnton/Downloads/Anthony OS-20261009T175758Z-1-001/Anthony OS/02 Projects/Wolf Forge Platform/AI Memory`.
* Configured `WOLF_FORGE_REPOSITORY_PATH` is the older White Label recovery repository, not this explicit Studio release checkout. That mapping was preserved; WL-2.34 was not resumed.
* No Decisions entry explicitly rejecting live calls was found. The exact owner-provided statement was appended as **D-307** to existing `02 Decisions.md`, marking any historical deferral superseded. Exact disk readback confirmed the sentence and the complete prior file content remained intact as its prefix. No other vault note was written; restoration keeps further note content read-only without exact approval. No `.ai-memory`, sync or Raw write.
* Fresh read-only worktree survey found merged-HEAD/dirty lanes: form-signature (48 entries), gmail-fix (8), order-details (1), order-local-qa (8), order-notifications (6), old platform-pwa pilot (34). All preserved; no cleanup or pilot execution.

## Merge and validation

`git merge --no-ff --no-commit origin/main` produced exactly one conflicted path, `package.json`. Kept main's `@pdf-lib/fontkit`, `entities`, `pdf-lib` and all other main changes, plus existing `@daily-co/daily-js` 0.94.0. Regenerated `package-lock.json` with `npm install --package-lock-only --ignore-scripts --no-audit --no-fund`; no hand editing of the lockfile. The dependency diff against main adds only Daily; original calling application files are unchanged by conflict resolution. The security-header and test merges were automatic.

| Check | Result | Evidence |
| --- | --- | --- |
| Clean original branch/head | PASS | Initial Git status; [startup-sync.json](startup-sync.json) |
| Main merged with a merge commit, no rebase | PASS | Merge `bcc80866cb6305227214693ac1344f0eafabcc67`, parents `4d4b8909ab6e3640c9d9957b910f2d199130daf7` and `205214bae3a965384e1974bcd64915911ea1eefe`; tested/committed tree `c71cf3e7ff485f9dc29787e79c8d9a52ad3fd635` |
| npm clean install | PASS | `npm ci --ignore-scripts --no-audit --no-fund`; 603 packages; [npm-ci.log](npm-ci.log). Scripts disabled consistently with repository CI |
| Next type generation | PASS | [typegen.log](typegen.log) |
| TypeScript | PASS | [typecheck.log](typecheck.log) |
| Strict zero-warning lint | PASS | [lint.log](lint.log) |
| Full Vitest | PASS | **3,744 tests in 298 files**, 329.81 seconds; full repository discovery, one worker to bound memory; [vitest.log](vitest.log) |
| Database tests | BLOCKED / NOT RUN | `npm run test:db` invokes `supabase test db --local`, whose CI setup requires Docker-backed local Supabase. Docker is prohibited. No alternate hosted suite, database mutation or remote CI dispatch was attempted |
| QA production build | BLOCKED / NOT RUN | Existing call-build helper requires 5.5 GiB available RAM; readings about 1.0–1.3 GiB during checks, **2.75 GiB after tests**. Guard preserved; no build launch or unrelated process termination. See [blocked-checks.json](blocked-checks.json) |
| Production dependency audit | PASS | Zero known vulnerabilities in current production dependency tree; [dependency-audit.json](dependency-audit.json) |
| Diff/secret checks | PASS | Tracked-file scanner: zero findings across 1,976 files before merge commit and **1,986 files including staged design/evidence**; staged/working diff checks pass. No full-history Docker scanner was invoked |

Generated `AGENTS.md`, `next-env.d.ts` and `tsconfig.json` were restored from their exact pre-validation bytes; final Git diff confirmed no unstaged tracked changes. Merge tree readback exactly matched the tested staged tree. No source fix beyond package conflict resolution was warranted by the completed checks. A blocked check is not a passed check. See [validation.json](validation.json).

### Migration order — FAIL

Repository-only comparison against fresh main's **183 migrations** shows **zero timestamp collisions**, but `20261026123450_ticket_live_calls.sql` does **not** sort after every migration. Five later main files exist:

1. `20261027120000_drawn_form_signatures.sql`
2. `20261027123000_client_order_start.sql`
3. `20261027123100_order_start_retry_job.sql`
4. `20261027130000_form_submission_pdf_receipts.sql`
5. `20261028123000_purchase_intake_internal_notifications.sql`

The call migration was preserved. Saved evidence says it is already applied to Studio, so a casual rename could cause duplicate application there. Decide and test source/ledger alignment before a later release; this task did not inspect any production ledger or alter a database. See [migration-proof.json](migration-proof.json).

## Read-only environment proof

PASS means the requested fact was established at the stated scope. FAIL includes missing/unverified evidence; it does not mean a dangerous production configuration was observed.

| Item | Result | Evidence and scope |
| --- | --- | --- |
| a. Synthetic Studio ref, different from production | **PASS** | `rsnmlcyopnxucwgfttyf`, unequal to `jwynqsyirgenqlmkooah`; corroborated by `src/domain/notifications/push.ts`, existing `../Build-WoadCalls-20261026.ps1` and `../Start-WoadCallsQa-20261026.ps1`, saved synthetic QA handoff. Configured identity proof, not a fresh database/data audit |
| b. Build-loaded env file points at Studio | **FAIL** | No `.env.production.local`, `.env.local`, `.env.production` or `.env` exists in this worktree; inherited `SUPABASE_URL` is absent. `.env.example` is not loaded. Existing safe build helper explicitly supplies the Studio URL in process environment; it does not prove a nonexistent env file. Verified Next 16.4.2 load order from installed documentation. No env file created or secret loaded for building |
| c. Daily account/workspace and production separation | **FAIL** | Read-only authenticated `GET https://api.daily.co/v1/` with existing test-labelled `../daily-local-private/daily-key.dpapi` establishes domain/workspace **`wolfforge`** (`wolfforge.daily.co`). Billing account identity and separate production workspace/use are unverified. No production Daily key/account was opened or queried |
| d. Synthetic team/client credential storage | **PASS** | Location only: `C:/Users/TrojanNiAnton/Documents/Codex/2026-10-20/continue-the-wolf-forge-spp-project/work/pwa-preview-private/synthetic-identities.dpapi` (Windows-user DPAPI encrypted). File exists; privately decoded JSON confirms synthetic-domain team and client entries; no values were printed or saved |
| e. Daily room inventory | **PASS** | **0 rooms**, fresh authenticated read-only `GET /v1/rooms?limit=1`, `total_count=0`, at `2026-10-29T02:26:44+08:00`. No room creation, renewal, join, deletion or usage history fetch |
| f. Main's existing push infrastructure | **PASS** | Paths and capabilities below, verified in fetched main; source existence only, no claim of live configuration or device delivery |

Push source inventory in main:

* Service worker: `public/push-sw.js`, generic payload-free update, authenticated `/api/push/status` fetch, click to `/launch` or existing client window. No call accept/deep link or looping ring.
* Enrollment/session binding: `src/components/account/profile/client-push-notifications.tsx`, `src/app/actions/push.ts`, `src/lib/notifications/push-server.ts`, `src/domain/notifications/push.ts`, `src/app/api/push/status/route.ts`. Existing flow is client-only, not team call enrollment.
* Tables and VAPID: `supabase/migrations/20261020110724_studio_web_push_notifications.sql` creates private `push_subscriptions`, `push_deliveries`, `studio_push_configuration`. `public.app_configure_studio_push` stores private VAPID/dispatch material encrypted in Supabase Vault; returns public config only. `20261022151319_production_web_push.sql` adds trusted provisioning support for the production origin without automatically enabling it. Names remain `studio_*` for installed-client compatibility.
* Existing sends: notification trigger `notifications_enqueue_studio_push` -> `private.enqueue_studio_push` -> `private.wake_studio_push` using `pg_net`, with minute recovery via `pg_cron`; `supabase/functions/studio-web-push/index.ts` and `handler.ts` claim a bounded ledger, build payload-free VAPID requests (normal urgency, TTL 300), send with endpoint allowlist and store accepted/rejected/unknown receipts. No sends were invoked here.

Machine-readable, redacted evidence: [environment-proof.json](environment-proof.json), [daily-readonly-proof.json](daily-readonly-proof.json). These contain paths, booleans, public project/workspace identifiers and inventory count, without credentials.

## Design handoff

Read [design.md](design.md). New capabilities remain proposed. It covers the state machine/races, exact routing, authenticated signalling, existing push reuse, platform/permission limits, private data/RLS, provider reconciliation, cost controls, hours, tests, phases, estimates and rollback.

Open approval points: browser delivery guarantees, 40-second ring/45-second connect/15-minute maximum and redial limits, invalid assignee/missing client-owner handling, missed-bell recipients/outcome semantics, optional business hours/timezone, 6,000 participant-minute cap and workspace separation, retention/history access, phased scope and real device testers.

Only D-307 was written to canonical memory under the owner's exact content authorization. Further vault synchronization is deferred under restoration read-only instructions; the verified local evidence is in this folder. Next action: owner reviews design and blockers; no new calling feature implementation is authorized by this handoff.
