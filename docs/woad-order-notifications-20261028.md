# Purchase and intake internal notifications — local handoff

Codex, 2026-10-28. Assigned branch: `codex/woad-order-notifications-20261028`. Starting and current HEAD: `99a4cd99cfc7ab9919f3e83322b71bfded076cec`. Changes are uncommitted because database verification is outstanding. No push, merge, deployment, hosted mutation, browser automation or delivery to real users was performed.

Global OS read from `C:/Users/TrojanNiAnton/Downloads/Anthony OS-20261009T175758Z-1-001/Anthony OS/10 Templates/Coding Agent OS/CODING AGENT OPERATING SYSTEM.md`; Skills Index and canonical memory at `C:/Users/TrojanNiAnton/Downloads/Anthony OS-20261009T175758Z-1-001/Anthony OS/02 Projects/Wolf Forge Platform/AI Memory` were read. The task handoff explicitly identifies that memory for this checkout. Shared vault notes stayed read-only. Another matching session's last turn was verified aborted before editing; this session owns these source changes. Unrelated untracked `.codex/config.toml` appeared during the session and was preserved.

Files:

- `supabase/migrations/20261028123000_purchase_intake_internal_notifications.sql`
- `supabase/tests/database/169_purchase_intake_internal_notifications.test.sql`
- `supabase/tests/isolation/purchase_intake_notification_replay.spec`
- `scripts/qa/check-purchase-intake-notifications.mjs`
- This handoff.

Root cause: the old invoice-payment and generic Order notification triggers intentionally suppress purchases, but native paid Order provisioning had no replacement internal notification. Intake submission persisted answers/completion/activity without an internal alert. A Project system message or audit row did not create a bell row.

The additive migration connects the existing `order.purchased` and `form.submitted` activity boundary to native durable notification fanout. Purchase eligibility is re-derived from the paid Store Invoice and provisioned item linked to the Order. Intake eligibility is re-derived from a submitted client response and matching required, completed, Order-linked intake assignment. It uses neither activity metadata nor answers as notification copy. Notifications are in the same transaction as the business operation and disappear on rollback. Event keys are `order-purchased:<order-id>` and `intake-submitted:<submission-id>`; the existing unique recipient/event key and ON CONFLICT policy provide durable deduplication. No historical backfill is included.

Recipient policy:

- Both events: active internal membership/profile in the active subject Tenant; no hardcoded identity or role grant. Eligible owners participate through existing capability rules.
- Purchase: `projects.view`, active Company/Order, plus `client_private.read`, assignment to that Order, or assignment to one of its active tasks. Link: `/orders/<id>`.
- Intake: enabled Forms plus `forms.view` and `forms.submissions_view`; nonarchived Form/assignment/Company. Link: `/forms/submissions/<id>`. Forms history authority is independent of Order assignment. Copy contains no Order metadata or answers, and the existing submission projection redacts inaccessible Order pointers.
- The same additional predicate runs on fanout, listing, individual mark-read and mark-all. Prior Tenant, audience, financial, coupon, Ticket, Subscription and capability checks are preserved. Existing destination RPCs remain responsible for current access on opening. Forms OFF hides these new alerts without changing retained submission-history access.

Commerce/submission RPC bodies, debit/Invoice/ledger logic, automatic intake assignment, explicit Start order, automation, client notifications and UI are unchanged. Owner device push remains unsupported by the existing client-only enrollment policy. No email, push enrollment or push configuration change was made.

Fresh verification:

```powershell
npm.cmd ci --ignore-scripts --no-audit --no-fund
# PASS: 590 packages; package.json and package-lock.json unchanged.

node node_modules/vitest/vitest.mjs run src/tests/notification-ring-milestones.test.ts src/tests/notification-request-overlap.test.tsx src/tests/notification-polling-optimization.test.tsx src/tests/workspace-notification-badge-visibility.test.ts src/tests/push-notifications.test.ts src/tests/client-push-notifications.test.tsx --maxWorkers=1
# PASS: 6 files, 64 tests.

node node_modules/eslint/bin/eslint.js src/tests/notification-ring-milestones.test.ts src/tests/notification-request-overlap.test.tsx src/tests/notification-polling-optimization.test.tsx src/tests/workspace-notification-badge-visibility.test.ts src/tests/push-notifications.test.ts src/tests/client-push-notifications.test.tsx --max-warnings=0
# PASS.

node scripts/qa/check-purchase-intake-notifications.mjs
# PASS: copied fanout/read guards match their predecessors after removing only
# the new predicate; unique timestamp, scope/file checks. Not SQL execution.

node node_modules/eslint/bin/eslint.js scripts/qa/check-purchase-intake-notifications.mjs --max-warnings=0
# PASS.

$env:NEXT_TELEMETRY_DISABLED = '1'
$env:NODE_OPTIONS = '--max-old-space-size=1024'
node node_modules/next/dist/bin/next typegen --webpack
# PASS: generated local route types; no server/build.
node node_modules/typescript/bin/tsc --noEmit
# NOT PASSED: process exhausted the 1 GiB heap cap; no TypeScript success claimed.

git diff --check
# PASS; new-file whitespace/BOM also checked by the source-check script.
```

SQL suites were prepared, not executed. No psql/postgres executable or verified Docker-free isolated backend was available through the checked local paths. No credentials, production env file, existing database/server or Docker were used. Full build, SQL lint/advisors, full application suite and live bell/device delivery are unrun. Low-memory instructions were respected by avoiding full builds/servers and bounding Vitest workers; the typecheck was not retried with a larger heap. Prior CI results in canonical notes are historical context only.

Suite 169 covers owner/eligible internal fanout, client/foreign-Tenant/archived/permission/resource exclusions, stable subject event identity, replay, distinct submissions, purchase and submission rollback, invalid/denied submissions, saved drafts, failed purchases, retained client assignment notification, permission/scope revocation across read/mark paths, Forms OFF, Projects OFF and suspended Tenant checks. The PostgreSQL isolationtester spec prepares two real concurrent same-request purchase and submission sessions with durable effect assertions. It refuses a non-loopback server or a database name without the exact `wf_notifications_isolated_` prefix, and requires a fresh disposable full-schema database. It is not wired into the pgTAP command, has no recorded runtime/expected-output pass, and leaves committed synthetic fixtures for that disposable database's cleanup. Inspect all step output and assertions before accepting a pass. Format follows the [PostgreSQL isolation test specification](https://github.com/postgres/postgres/blob/master/src/test/isolation/README).

Next integration gate: verify a Docker-free isolated database's identity without production credentials, apply all migrations, execute suites 037, 123, 161, 162 and 169 plus notification/module regressions, and run the isolation spec. Resolve any failures and obtain a full typecheck in an environment with adequate memory. Then manual owner/internal bell QA: purchase appears once, exact Order opens, draft/failed actions remain silent, required intake appears once and opens the saved submission, replays stay single, distinct submissions are separate, and permission/Tenant/module revocation hides inaccessible rows. Confirm existing client notices and owner push refusal remain intact. No visual/device QA was performed here.

Rollout proposal for later review: after isolated SQL/concurrency/type/manual gates pass, make a focused local commit and integrate only this task's files. Review the additive migration and recovery plan; obtain explicit production rollout approval before any deployment/database change. No rollback script or shared-note write is authorized by this handoff. Suggested coordinator updates after runtime verification: narrowly update Current State/Implementation Log; record event identities and recipient policy in Decisions/Architecture if accepted; put authorization/deduplication/privacy evidence in existing Security 02, 03, 04, 08, 13, 14, 16 and 17. Track unresolved verification gates without claiming live delivery.
