# Monthly report completion — local handoff

Branch: `codex/woad-monthly-report-gate-20261108`. Baseline: `0b8cba2ce3350e3d611bf3a56da4ea086e71d199`.

This is a local implementation. No push, deployment, hosted migration, Docker startup or real account/customer change occurred. The migration is **unapplied**:

`supabase/migrations/20261108080017_monthly_report_completion_gate.sql`

## Behavior

- New report lists only supported profile UUIDs with a real, noncanceled subscription, current working/waiting work, or a paid/provisioned invoice item linked to the exact client/Service/order. Paid completed orders can establish ownership without a subscription; canceled or archived orders cannot. Names never establish identity. Empty ownership produces an empty state.
- A new monthly-Service completion requires a nonarchived `sent` report with a nonnull `sent_at` for the exact Tenant, client, Service and `reporting_period_month`. Publication's timestamp month is irrelevant. A table trigger covers RPC, direct and multirow completion attempts, including changes to the scope of an already-completed monthly order. Unchanged historical completed orders are preserved.
- Orders have no existing reporting-period column. Implementation choice, disclosed during work: use the order's `started_at` month, falling back to `created_at`, in Reporting's existing Asia/Manila calendar. No new cycle, progress reset, recurring order or billing automation was introduced.
- The missing-report sheet links the exact client/Service/month to the existing builder. Query identities are validated and ownership is reloaded server-side; draft creation/publication enforce eligibility again. Opening the flow or saving a draft does not complete an order.
- Owner/Admin/Manager with current Project view/edit/scope authority may record a trimmed, nonblank reason of at most 1,000 characters. The atomic RPC derives actor/client/Tenant, rejects stale service/month, stores immutable private evidence with actor/time/order/service/month, and completes under the same trigger/transaction. Exact retries preserve completion time and audit; conflicting reason retries cannot overwrite evidence. API roles cannot read/write the private exception table.
- Existing task percentages, invoices, subscriptions, reports, completed-order history and the All statuses filter retain their behavior.

## Verification

Executed locally:

- Red/green tests for mixed subscription/order choices, empty state, exact scope/error handling, bounded reasons, builder prefill and sheet exit. Restoring immediate sheet unmount reproduced the exit regression; the restored fix passed.
- Final full Vitest run: **4,734 passed / 401 files**, one worker, **406.67 seconds**, exit 0. Earlier pre-review run: 4,724 passed / 399 files. Existing jsdom scroll/navigation notices and synthetic security-event logs were emitted; no test failed.
- `next typegen`, `npm run typecheck`, full `npm run lint`: **PASS**.
- Final staged secret scan: **0 findings / 2,363 tracked files**; `git diff --cached --check`: **PASS**. All 32 staged files were explicitly selected from this task's initially clean worktree; no lockfile, other lane or vault file is staged.
- Production dependency audit: **0 critical, 0 high, 5 moderate** (Sentry/glob/minimatch tree); no dependency or lockfile changes.
- Source review by a read-only independent reviewer; exit/focus, paid completed-order ownership and SQL whitespace handling corrected. Final reread: no remaining confirmed code findings.
- Installed Playwright + installed Chrome, local synthetic actual-component fixtures, no backend calls: **21 cases passed**, gate/prefill/empty at **320, 360, 390, 430, 768, 1280, 1440px**. Checked scoped links, draft-only behavior, bounded reason, completion submission, Escape/focus, long labels, overflow, page content and console health; zero console errors. Header/detail/bulk-event wiring also passed **33 component tests**, including detail focus return.
- Production build: **SKIPPED**, free physical RAM **2.44 GiB**, below the **5.5 GiB** guard.

Pending, with no pass implied:

- Applying the migration to a disposable full Supabase database and running the complete pgTAP suite, including new `208_monthly_report_completion.test.sql` and updated 033/098. SQL was source-reviewed, not executed. Database lint/advisors, live RLS/membership behavior and separate-session races remain acceptance work.
- Authenticated browser → action → database → client portal acceptance. The rendered fixtures use synthetic actions and do not establish backend behavior.
- The baseline has no production dispatcher for `PROJECTS_BULK_ACTION_EVENT`; `projects-header-actions.tsx` exposes only New Order. Bulk server enforcement and the existing event-listener UI seam are covered; a user-clicked production bulk launcher was not verified or added.

## Manual acceptance checklist

1. In a disposable synthetic database, apply this migration and run pgTAP 033/098/208 plus the full DB suite/advisors. Confirm ownership from subscriptions, order-only work and paid completed purchases; reject unowned, canceled, archived, wrong-Tenant and name-only Services.
2. From both detail status controls, attempt monthly completion with a draft, wrong client/Service/month and archived report. Confirm the correct month appears and state remains Working. Open Create report, save a draft, then publish for that exact month and retry completion.
3. Exercise Owner/Admin/Manager exceptions, whitespace/overlong reasons, duplicate/concurrent submissions and conflicting reason retries. Read private evidence as a database administrator; verify exact reason/actor/time/scope and one audit. Deny Staff, Client, explicit deny, archived membership and cross-Tenant IDs, including on retries.
4. Confirm another order in the same month and a later month on the same order remain gated. Exercise direct/multirow and authorized bulk-action calls, and verify ordinary Services still complete normally. Verify task-based client progress and historical/billing records remain unchanged.
5. Repeat authenticated mobile keyboard/menu/focus checks at the seven widths, and run the production build once at least 5.5 GiB RAM is free. Obtain separate rollout authorization; this work is not live on WOAD.

## Steward proposal — outside the vault, not synchronized

Canonical notes stayed read-only. After database acceptance and exact-content approval, a steward may narrowly update:

- `01 Current State.md`: local monthly-report workflow checkpoint, migration status and acceptance limits above; do not describe it as deployed.
- `03 Implementation Log.md`: timestamp, Codex, task files/behavior, exact final check results, unapplied migration, RAM guard and next disposable-database acceptance step.
- `05 Architecture Map.md`: choices/draft validator → shared ownership predicate; status actions → existing status RPC → completion trigger; exact-scoped exception RPC/private evidence; builder prefill path.
- Security `02 Roles & Authorization.md`, `04 RPC & SECURITY DEFINER.md`, `08 Client Data Isolation.md`, `13 Threat Model.md`, `14 Security Testing.md`, `16 Security Control Registry.md`, `17 Security Change Log.md`: scoped waiver authority, private audit evidence, row-bound completion checks, revoked access/replay boundaries and the distinction between authored SQL cases and executed acceptance. Assign any control identifier through the existing registry.
- `04 Known Issues.md` / Security gaps only if the steward accepts the verified pre-existing missing bulk launcher as a tracked issue. Do not turn pending DB execution into a verified security defect.

Configured startup paths were resolved from process environment, then persisted User environment: Global OS under the user-selected `Anthony OS/10 Templates/Coding Agent OS/CODING AGENT OPERATING SYSTEM.md`; project memory under the same vault's `02 Projects/Wolf Forge Platform/AI Memory`. The obsolete recovery clone is a different remote. Shared Graphify was not queried because build/HEAD `0b8cba2` and published `eddede8` mismatched.
