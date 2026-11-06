# Manual-end call duration: local implementation

Scope: remove the fixed 15-minute end for newly activated manual-policy voice/video calls in Tickets and Orders. At the monthly allocation, warn the internal participant and block new calls; keep an active authorized call running. The owner approved this behavior and local implementation on November 6.

Base: integrated candidate a8f837776a14d51639de27d72491c8b67aa2ba60. Branch: codex/woad-call-duration-20261106. This branch is separate from the validated release and has automatic Vercel deployment disabled in source. Nothing from this task is live.

## Behavior

- Historical rows default to fixed policy and retain their original expiry. New-policy activation uses private.ticket_call_environment.manual_end_enabled, default OFF. Fresh independent maintenance and the existing verified environment/account usage are required before new manual invitations.
- New manual rooms have no elapsed end/ejection property. Room/participant-bound join grants last 120 seconds; existing winning session/device and eight-token attempt limits remain. Reconnect obtains a new authorized grant, rather than extending an existing JWT.
- Active manual authority is checked independently of stale or exhausted accounting. Explicit tenant/calling disablement, access/session revocation, participant End, unanswered/setup deadlines and confirmed disconnection remain effective. Device/provider/network failures can interrupt media; uninterrupted service is not guaranteed.
- Active and unknown provider lifetimes accrue conservative participant-time reservations across UTC months. Unresolved ended rooms count toward admission/concurrency limits. Finalized provider intervals may exceed the former expiry and settle against actual usage when trusted closure is complete. Unknown history retains conservative holds.
- Internal participants receive 75/90/100 percent warnings without billing totals or new billing permissions. Client projections omit the threshold. Active calls display a server-based elapsed clock, including the minimized strip; ring countdown remains.
- One five-minute authenticated job is proposed for the existing maintenance endpoint. At two due presence checks per invocation, its bounded batches and scheduling affect cleanup latency. Background tabs alone do not imply absence. Missing/partial provider responses do not certify a stopped call.

## Review corrections

Fresh whole-change review identified three important failures in a simple cutoff removal. They are corrected locally with focused tests and native persistence checks:

1. Unknown cleanup previously stayed permanently read-only. Manual cleanup now inspects fresh presence, ejects current observed sessions, and waits for all issued join grants plus five seconds before recording empty presence and deleting. The empty observation is durable before deletion; a lost delete response can reconcile it with fresh room absence. Fixed-policy cleanup is unchanged.
2. Ended but unresolved rooms were omitted from global concurrency/month counts after their old expiry. They remain counted until trusted reconciliation. A disjoint caller pair demonstrates the previous predicate admits a call and the corrected predicate refuses it.
3. A delayed create could finish after cleanup certified absence. Manual creation is durably pending before provider I/O. Absence cannot close that pending work. A late observed room resolves its original setup claim and reopens cleanup, without issuing a token or using a stale cleanup claim.

Additional guard: a null presence claim cannot match a previously consumed null claim. Cleanup claims rotate by oldest attempt to avoid starving unresolved work.

## Evidence and limits

External receipts and the disposable native test harness: outputs/call-duration-20261106 under the task workspace's parent. The native harness uses the existing PostgreSQL 17.11 binary, a new loopback-only disposable cluster and synthetic authorization/rate-limit prerequisites; it is not full Supabase/Auth/PostgREST/RLS acceptance. PostgreSQL pgcrypto is absent in this binary, so the synthetic harness supplies core gen_random_uuid/SHA-256 wrappers. No production data or credentials are used. All owned clusters are stopped and PID-file absence is checked.

- Original fixed-cutoff counterexample fails before applying the candidate and passes afterward.
- Cleanup regressions fail against the old application path and pass after the correction. Null-claim and prior concurrency predicates have native RED/GREEN evidence.
- The exact forward migration compiles; 28 native persistence checks cover two-hour survival, budgeting, bounded joins, either participant's End/retry, actual-duration settlement, UTC month slicing, late-create recovery, durable empty proof and disconnection grace.
- SQL206 is prepared for a legitimate isolated Supabase stack and is unexecuted here. Full SQL/RLS acceptance, physical database races, actual Daily/media duration, mobile/background/OS behavior and actual deployed cron operation remain pending.
- Final application command: node node_modules/vitest/vitest.mjs run --maxWorkers=1, 4,708 tests / 396 files passed in 419.91 seconds after the review corrections. The earlier 4,701-test result is superseded.
- Final TypeScript command: node node_modules/typescript/bin/tsc --noEmit, exit 0. Full ESLint: node node_modules/eslint/bin/eslint.js . --max-warnings=0, exit 0. Source hashes and final tracked-file secrets/whitespace receipts are saved in the external report.
- Local production build was not started: 2.81 GiB available at 2026-11-06T16:04:41Z, below the existing 5.5-GiB free-RAM guard.

## Forward migration and activation

New migration: supabase/migrations/20261106152256_ticket_call_manual_end.sql. Existing ten Orders/calls release migrations from the base remain separate prerequisites and were not applied by this task. Do not rewrite old migrations or enable the policy on the currently serving app.

Before any release: preserve the existing private DB+Storage backup/verification hold, refresh the candidate against actual main, run isolated full SQL/RLS and transport acceptance, verify the current Vercel plan/configuration permits the five-minute trigger, deploy code/schema in reviewed order, verify authenticated maintenance and new-policy compatibility, then separately enable manual_end_enabled. No plan purchase, allocation increase, new provider credential, hosted flag/schema/cron change, CI dispatch, push, merge or deployment is performed here.

The five-minute schedule means approximately 8,640 function invocations per 30 days before retries. Provider work is bounded and due-work driven, but no zero-cost claim is made. An active call may exceed the application allocation and incur provider charges by the owner's chosen policy.

Rollback: disable new manual admissions first, let active manual calls finish and retain their accounting/history; do not downgrade to a client that assumes every active call has a fixed expiry. Never clear unresolved provider work or usage holds merely to restore admission.

Manual acceptance after authorized deployment uses only the existing pilot pair: a real call longer than 15 minutes, minimize/background/reconnect, either side End, budget warning/new-call refusal, and independent cleanup after closing both clients. No such real call was placed during this local task.

Canonical Obsidian notes remain read-only. The exact proposed milestone update is saved outside the vault for the existing steward workflow.
