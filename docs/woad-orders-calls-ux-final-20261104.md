Implemented locally on `codex/woad-orders-calls-ux-20261104`, based on `7e011865`. Changes are uncommitted; both migrations remain **unapplied**.

| Item | Behavior and principal changed files |
|---|---|
| Order calls | Both `order-conversation.tsx` and `project-conversation.tsx` use the shared controls, preparation, controller and history. Explicit native-order RPCs reuse the call ledger; legacy orders resolve real Tickets. `calls.ts`, `ticket-call-service.ts`, `call-entry.ts`, `/calls/[callId]/page.tsx` and migration `20261104131000_order_call_targets.sql` carry authorization/deep links. Pilot restrictions, lifecycle and cost controls remain. |
| Tasks | `project-tasks.module.css` and `project-detail.module.css`: padding, wrapping, headings and responsive input/button alignment; task behavior preserved. |
| History failure | `ticket-calls/route.ts`, `use-ticket-call-history.ts`, `ticket-client-conversation.tsx`: support 403 has explanatory nonretry UI; session 401, quota 429 and service 503 remain distinct. Late responses cannot overwrite another conversation. |
| Duplicate pill | `/account/messages/[ticketId]/page.tsx`: removed only the header status pill; summary/status retained. |
| Notifications | `client-notification-bell.tsx`, `actions/notifications.ts`: explicit managed/unmanaged opening marks its existing snapshot, with acknowledged bounded mutations and recovery. Hover does not mark read; later arrivals and overlapping openings are preserved. |
| Manager assignment | Clients page/table/actions, company service/repository, database types and migration `20261104130000_client_manager_assignment.sql`: persisted account-level assignment, active same-workspace manager checks, edit/module permission, audit, per-account results and authoritative refresh. No access grants. |
| Operations | `nav-registry.ts`: hidden from shared navigation; routes, titles, workflows and permissions retained. |

The [detailed handoff and complete changed-file/test inventory](C:/Users/TrojanNiAnton/.codex/worktrees/spp-security-fixes-20261104/woad-voice-release-20261026/docs/woad-orders-calls-ux-20261104.md) includes evidence and commands.

Checks passed: **199 tests/34 files**, then **141 tests/5 files** (three overlapping tests); typecheck, full lint, final changed-file lint, whitespace and inclusive secret scan. Source review has no remaining concrete findings. New SQL 203/204 cover isolation, eligibility, persistence/replay and native-call admission, but **were not executed**.

The support 403 behavior was reproduced with synthetic sessions. No genuine-client production failure was reproduced. Local Supabase and Daily configuration are absent; live pilot/configuration, RPC compatibility and real-session transport remain unverified.

SQL/RLS/concurrency and browser/media QA remain pending. Full build was skipped at **3.91 GiB available**, below the **5.5 GiB** guard. Vault notes stayed read-only. No commit, push, deployment, hosted migration or real calls/customer mutations occurred. A verified source checkpoint was saved; automatic compaction was not configured.

Manual QA on the authorized synthetic local server (usual base `http://127.0.0.1:3000`):

- `/orders/<id>` and `/account/projects/<id>`: native/legacy orders, permitted team roles/client, cross-tenant/company denial, pilot exclusion, recipient selection, full call lifecycle/history and `/calls/<callId>` deep links.
- `/account/messages/<id>`: genuine login versus administrator support, sanitized history/current/prepare errors, preserved summary status.
- `/account`: hover versus click, initial-load/opening races, later arrivals, overlapping 50-row snapshots and failed read/retry; Unanswered unchanged.
- `/clients`: assignment/reload persistence, audit, partial failures and foreign/revoked manager/edit denial. Check task layout and menus at 320/360/390/430/768/1280/1440px; Operations hidden while direct `/todo` remains intact.

Final report copied to clipboard.

Skills used: systematic-debugging, security-and-hardening, ui-ux-pro-max, impeccable, ponytail, react-best-practices, using-superpowers, using-git-worktrees, brainstorming, writing-plans, test-driven-development, verification-before-completion, requesting-code-review.
