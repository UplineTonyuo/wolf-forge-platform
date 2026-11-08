# Monthly report completion implementation plan

**Goal:** Implement the owner's approved monthly-report completion workflow locally in the existing lane.

**Spec:** The approved requirements in the task: client-owned supported services only; same-client/service/reporting-month sent report or an authorized, bounded, audited exception; detail/direct/bulk enforcement; preserve task progress and all historical/billing records.

**Architecture:** Reuse Reporting's stable profile UUIDs and `reporting_period_month` (`YYYY-MM-01`, Asia/Manila). A database ownership predicate serves choices and draft validation. An order completion trigger protects every mutation; an atomic exception RPC retains existing Project authority and restricts exceptions to Owner/Admin/Manager. All three status UIs reuse one resolution sheet and the existing report builder.

**Tech stack:** Existing Next.js/React, Zod, Supabase/PostgreSQL, Vitest and pgTAP; no new dependency.

## Constraints and decisions

- Worktree/session ownership verified: branch `codex/woad-monthly-report-gate-20261108`, clean baseline `0b8cba2`; session `01a1ba25-5cf9-7c51-9915-74671ac60140` is the only matching session metadata.
- No push, deployment, hosted migration, Docker, real-account mutation or vault write. A local commit is the handoff.
- Graphify unavailable: build/HEAD `0b8cba2`, publication `eddede8`; use current source.
- Ruling: absent further steering, derive the order's reporting month from `started_at`, falling back to `created_at`, in Asia/Manila. The optional clarification was sent before independent eligibility work. This stable scope avoids clock rollover changing the required report; changing an order's start month invalidates its old exception. There is no recurring progress reset or new billing cycle.
- Keep completion permissions, module gates and Tenant boundaries. Names never establish ownership. Preserve task-based percentages and historical completed records.
- Reuse SheetFrame, existing form/button styles and keyboard/focus behavior. Do not modify the All statuses filter.
- Production build only with at least 5.5 GiB free physical RAM.

## Review focus

Wrong client/service/month and drafts must fail; order-only ownership must work without a subscription. Retry must not duplicate audit or change completion time. Revoked/denied/cross-Tenant callers must fail even on retries. Exceptions must remain scoped when service or month changes. Builder opening/saving must never change order state.

## Tasks

- [x] 1. Write and observe failing service-choice/empty-state and ownership contract tests; implement a shared SQL eligibility predicate, remove catalogue fallback, preserve order-only choices. Add database acceptance cases.
- [x] 2. Resolve reporting-month policy; write failing completion/error/schema tests and pgTAP cases, then implement trigger, exact-scope immutable exception evidence and atomic RPC. Retain existing status RPC and bulk sequencing; make exact retries safe.
- [x] 3. Write failing UI tests; connect all three completion surfaces to one SheetFrame resolution UI and prefill the existing reporting flow with server-derived client/service/month. Recheck identities server-side.
- [x] 4. Run focused tests, full suite with bounded workers, typecheck, lint, secret scan and dependency audit. Run build only if RAM guard permits. Clearly distinguish pending database/browser acceptance from executed checks.
- [x] 5. Review connected code and diff, fix findings with tests, prepare a concise steward proposal outside the vault, and prepare only this task's changes for the authorized local commit. Provide exact results, unapplied migration and manual QA checklist.

## Source trace

Detail header (`order-header-controls`), detail Actions (`project-detail-actions`) and list bulk (`projects-workspace`) -> status actions -> OrderService/Repository -> `app_change_order_status`. The latest full definition is `20261010130000_projects_module_enforcement.sql`; row authorization is the order permission trigger, subsequently changed by client-start, Manager-scope and paid-invoice migrations. `app_update_order` cannot patch status, but direct table updates still need a completion trigger.

Reporting choices and service selection validation are last defined in `20261007233000_tenant_report_authorization.sql`. Draft creation invokes selection validation before replay. Existing published/client-visible state is `status='sent'`; the month is `reporting_period_month`, not `sent_at`.

## Validation ledger

Dependency bootstrap used `npm.cmd ci --ignore-scripts`; no dependency/lockfile changes or execution-policy change. Reporting red/green: 4 failures reproduced, then 115 passed. Completion boundary: 6 failures reproduced, then 9 passed. Exit regression: restoring immediate unmount fails; fixed UI passes. Final full suite: 4,734 tests/401 files passed, exit 0, 406.67s. Header/detail/bulk-event integration: 33 passed. Typegen, typecheck, full lint and staged secret scan passed (0 findings/2,363 files). Production audit: 0 high/critical, 5 moderate. Final independent source review: no remaining confirmed code findings. Seven-width synthetic actual-component Chrome QA: 21 cases, zero console errors. Production build skipped at 2.44 GiB free RAM under the 5.5 GiB guard. SQL208/full DB/advisors and authenticated browser acceptance remain pending; see `docs/monthly-report-completion-20261108.md` for exact limits and manual acceptance.

Ruling: the baseline's bulk-event listener has no production dispatcher. Preserve that existing seam and enforce its server action/SQL; do not expand this task into a new bulk toolbar. Report injected-event UI tests separately from a user-clicked production bulk flow.
