# Monthly-report isolated CI validation plan

Status: **PROPOSAL — not approved, installed or executed.** Candidate application checkpoint: `ce54eeebfeea4f594b11ee2a5e1a61174b86a032`. Original owning session: `01a1bb87-8fa2-7e12-b9f3-46c80c4b3752`. Worktree and branch remain the owner's existing monthly-report lane.

The owner confirmed on 2026-11-09 that no disposable backend is assigned, local virtualization is disabled and Docker is unavailable. No heavy local process may be started. Database acceptance, production build and authenticated acceptance are therefore **BLOCKED**, not failed or passed. Earlier unit/component/Chrome-fixture results remain historical.

## Decision and cost limit

Reuse the existing `security.yml` manual workflow, ID **344371554**, with one opt-in monthly-report job. Do not create another repository/worktree, a PR, a new default-branch workflow or a paid runner. A new standalone workflow would need default-branch registration before manual dispatch; the existing workflow is already registered. [GitHub manual-workflow documentation](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow).

Read-only GitHub/Composio evidence on 2026-11-09 local time:

| Fact | Verified result |
| --- | --- |
| Repository | `UplineTonyuo/wolf-forge-platform`, private, default branch `main` |
| Billing owner / plan | Personal account `UplineTonyuo`, GitHub Free |
| November Actions Linux usage | 1,924 minutes; gross/discounted compute value $11.544; net billed value $0 |
| Other eligible compute in the returned account summary | None returned; the remaining item is 4.994228363 GB-hours of Actions storage, a separate allowance |
| Included Free compute value | $12/month under current GitHub documentation |
| Snapshot headroom | $0.456, equivalent to **76 Linux minutes** at $0.006/minute |
| This repository's running / queued workflows | 0 / 0 at the check |

The proposal requests **one attempt**, with one standard `ubuntu-24.04` job, `timeout-minutes: 60`, no matrix and no automatic retry. Budget **65 runner-minutes** including a five-minute cancellation/cleanup reserve: **$0.390 of included compute**, leaving an 11-minute / $0.066 snapshot margin. This is a cap-based estimate, not a measured runtime promise. The default seven jobs are excluded in this dispatch mode. No rerun is approved by approving a single attempt.

The balance is shared and is **not reserved**. Immediately before any approved push/dispatch, repeat the account-wide usage read and repository run check; require at least $0.390 remaining and no conflicting run. Other repositories or shared compute can reduce headroom. Do not dispatch if the refreshed balance is insufficient or unreadable. No purchase, budget change, larger runner or billing credential is part of this plan. [Included usage](https://docs.github.com/en/billing/reference/product-usage-included), [runner rates and rounding](https://docs.github.com/en/billing/reference/actions-runner-pricing), [shared compute/storage rules](https://docs.github.com/en/billing/concepts/product-billing/github-actions).

Artifacts are limited to **20 MiB total, one-day retention**, with no cache upload configured in this job. Current accrued storage usage was read, but account-wide instantaneous storage occupancy was not verified; check artifact-storage headroom before approving uploads. If storage headroom cannot be verified, hold the run rather than silently omit the requested screenshots or permit paid storage.

## Exact proposed workflow changes

The adjacent [reviewable patch](2026-11-09-monthly-report-ci.patch) contains the exact proposed changes to `.github/workflows/security.yml` and `vercel.json`. **The patch has not been applied.** It parses as YAML and `git apply --check` succeeds against this checkout. Its helper entrypoints are specified below and must be implemented and reviewed after plan approval, before a push or dispatch. It is not currently an executable acceptance route.

The patch:

1. Adds optional `monthly_report_acceptance` and `expected_sha` manual inputs. Existing modes default to their current behavior.
2. Excludes the seven ordinary jobs only for the monthly-report manual mode. Gives this mode a separate, non-canceling concurrency group so it cannot cancel another lane.
3. Adds one 60-minute, standard Linux job for the opted-in manual mode. Its first step rejects a wrong repository, branch, rerun attempt or reviewed 40-character SHA before installation/validation work. The job-level condition does not skip wrong-branch requests into an all-skipped success. Conflicting existing dispatch modes are rejected.
4. Reuses Node 24, `npm ci --ignore-scripts`, the repository build/test/lint commands, existing PDF-font verification, installed Supabase CLI and Playwright dependency, and the existing sanitized real-Auth/compiled-app QA approach. No dependency/lockfile upgrade is proposed.
5. Adds only `"codex/woad-monthly-report-gate-20261108": false` to the existing `git.deploymentEnabled` map. All existing branch exclusions and cron definitions are preserved. This is necessary because a Git push can otherwise create an automatic Vercel Preview. The rule must be in the first approved pushed candidate; no Vercel project-setting or deployment API call is proposed. [Vercel branch deployment controls](https://vercel.com/docs/project-configuration/git-configuration).

The checkout must descend from `ce54eee`; application source, migrations, Supabase config, dependencies and Next config must match that checkpoint. Only the planned QA/CI files, single Vercel branch exclusion and documentation may differ. A confirmed application defect requires a reviewed new candidate and fresh allowance/attempt approval; do not silently validate a different application tree.

## Required local preparation after approval

No application feature is added. Minimal proposed implementation files:

| File | Responsibility |
| --- | --- |
| `.github/workflows/security.yml` | Apply the supplied opt-in job and existing-job/concurrency changes |
| `vercel.json` | One branch-only automatic-deployment exclusion |
| `scripts/qa/monthly-report-acceptance.mjs` | Runner/source/target guards; bootstrap, real browser, evidence and owned cleanup phases |
| `scripts/qa/monthly-report-concurrency.mjs` | Independent physical SQL sessions, observed lock waits, persisted-state assertions |
| `scripts/qa/monthly-report-acceptance.test.mjs` | Lightweight abuse tests for wrong ref/SHA, hosted endpoint/credentials, wrong container/ledger, unsafe artifacts and cleanup refusal |

Reuse the captured-command, real `signInWithPassword`/SSR-cookie, loopback HTTPS and sanitized-evidence patterns in `scripts/qa/intake-workflow-e2e.mjs` and `scripts/qa/check-ticket-call-transport.mjs`. Do not invoke those whole unrelated suites or fake their branch/CI guards. No new package is needed. Write failing boundary tests before the new orchestration code, then run only lightweight local syntax/guard checks; do not start local Docker, Next build/server or browser.

The proposed helper interface is exactly:

```text
node scripts/qa/monthly-report-acceptance.mjs bootstrap
node scripts/qa/monthly-report-concurrency.mjs
node scripts/qa/monthly-report-acceptance.mjs browser
node scripts/qa/monthly-report-acceptance.mjs evidence
node scripts/qa/monthly-report-acceptance.mjs cleanup
```

## Execution order and isolation contract

1. **Preflight outside Actions:** after explicit approval, reread billing usage/plan, artifact headroom, pending runs, local source/ownership and the exact proposed commit. Record the approved single-attempt ceiling. Do not change billing settings. No dispatch occurs while any required preflight is unknown.
2. **Exact checkout:** use `persist-credentials: false`; no repository/environment secrets, `secrets: inherit`, hosted Supabase token, Vercel credential or provider key. Reject inherited hosted endpoints, QA bypass flags, wrong repository/ref/SHA and rerun attempts. No `pull_request_target`, deployment, release or write-token permission.
3. **Production build first:** run before starting Supabase or Chromium. Require `/proc/meminfo` `MemAvailable >= 5,767,168 KiB` (5.5 GiB), then `npm run build` and `node scripts/qa/assert-pdf-font-trace.mjs`. The current private standard Linux runner is documented as 2 CPU / 8 GB RAM; that does not guarantee available RAM, so a failed guard blocks the run. Use the existing CI's inert loopback build configuration, no Sentry credential and no auth bypass. Build the normal `.next` output, then run this same compiled app with the real disposable backend at runtime. [Runner specifications](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).
4. **Fresh backend:** only on the assigned GitHub-hosted Linux runner. Create a run-ID/attempt-specific Supabase project ID, with default loopback ports confined to this fresh VM. Preserve and journal the original config and the two exact migration files under `RUNNER_TEMP`. Hold back only the two candidate migrations while `supabase start --yes` creates the baseline. Capture startup/status output privately because it can contain keys. Verify loopback API/DB destinations, container ID/labels/port bindings/volume identity, server version, empty customer/Auth baseline and the exact baseline ledger. No linked or hosted command is permitted.
5. **Ordered candidate migrations:** restore the two byte-identical files and assert they are the **only** pending versions, in the required order. Run `./node_modules/.bin/supabase migration up --local`. Fresh-read the complete ledger; both new statements must match the candidate, and all prior version/source fingerprints must be unchanged. If a command fails or is uncertain, inspect the ledger before any retry. Never reset a shared database.
6. **Database acceptance:** run the four requested pgTAP files explicitly, then `npm run test:db`, `npm run lint:db` and `./node_modules/.bin/supabase db advisors --local --type all --level info --fail-on error`, as shown in the patch. Bind every command to the verified run-specific config/container. Record counts, exit codes, advisor findings and final function owner/ACL/search-path checks. No unrelated baseline defect is silently waived.
7. **Races:** provision task-owned synthetic Auth/membership/order/report fixtures only after tests that require an empty business baseline. Use distinct `pg_backend_pid()` values and observe actual `pg_blocking_pids()`/lock waits, not serial promises. Run both lock orders where applicable. The matrix below is required.
8. **Authenticated compiled app:** one Chromium process, legitimate synthetic Owner/Admin/Manager/Client sessions, plus an unauthorized/cross-Tenant identity. Use real local Supabase password grants and normal SSR cookies; no forged identity or bypass. Privileged setup keys stay in captured runner/server memory. Verify browser click -> server action -> fresh DB read -> refreshed internal/client UI. Browser/app traffic stays on loopback; external provider/telemetry requests are refused and reported, never mocked as successful authority.
9. **Evidence/cleanup:** emit phase statuses defaulting to pending/blocked until assertions finish. Upload only allowlisted sanitized screenshots and bounded summaries, including HTTP status/error codes, exact source/ledger fingerprints and persisted-state assertions. No JWT/cookie/password/key, raw HAR/trace/storage state, raw server/Supabase log or `.env` file. Verify size/secret scrubbing before staging the upload directory. Cleanup only recorded child processes and the exact run-owned container/config; missing ownership evidence must refuse cleanup. The VM is disposable even after cancellation. No broad Docker prune/reset/stop, global process kill or hosted cleanup.

Candidate migration SHA256 (committed Git bytes, not an inferred timestamp):

```text
20261108080017_monthly_report_completion_gate.sql
cdbe85dcbd2341d35db560ae2efe550be6c821e7115b62c6acfe8691d91adf45
20261108173532_explicit_order_reporting_month.sql
5f0d1079110bd4b9ea233cb8f485c0e728d1e3509e04c26bf922147ef914768e
```

## Separate-session acceptance matrix

| Overlap | Required persisted result |
| --- | --- |
| Explicit month or monthly Service changes before scoped completion obtains its order lock | Old scope refused; no completion or exception for the wrong scope |
| Completion holds the order lock before a scope change | Wait observed; later change is checked against completed-state/report requirements, not a stale pre-lock snapshot |
| Two identical exception requests | One scoped reason/actor/recorded time, one exception audit and one completion audit; original completion time retained |
| Two conflicting reasons | One winner; loser cannot overwrite the original evidence or duplicate completion/audit |
| Report archive/eligibility change commits before completion's report check | Missing evidence refusal; order stays incomplete |
| Completion locks qualifying report before archive | Archive waits; completion is valid at its serialized decision point; a later archive does not rewrite completed history |
| Permission or Tenant membership revoked before status/exception retry | Current denial, including an otherwise exact accepted retry; no new evidence or audit |

For each case read exact order status/month/service, exception order/client/Tenant/service/month/reason/actor/time, completion timestamp and action counts from fresh authoritative state. Use only fixtures belonging to this run. Preserve before/after fingerprints of ordinary-service/task progress and historical/billing evidence; do not add recurring automation or reset progress.

## Authenticated browser acceptance matrix

- Real owned subscription and order-only choices, mixed ownership, renamed supported Service UUIDs and empty ownership; no catalogue fallback.
- Blank missing work month; explicit November on an October-started order; selection persists while absent evidence leaves work incomplete.
- Draft, archived, October, wrong-client and wrong-Service reports fail; a matching sent November report is visible only to the correct Client and permits completion.
- Owner/Admin/Manager reason bounds, exact exception scope, duplicate/conflicting requests and current denied/revoked/cross-Tenant retries. Preserve existing send-window authority; do not grant Managers send-anytime merely to pass a case.
- Both detail completion controls; applicable direct/bulk mutations without adding the missing launcher. Ordinary services, client task progress and historical/billing fingerprints stay intact.
- Real menus/sheets, keyboard, Escape/focus return, error/retry and no-overflow checks at 320/360/390/430/768/1280/1440px; no mocked RPC/component fixture counts as this phase.

**Calendar honesty:** do not change system/browser/database clocks or rewrite publication timestamps to manufacture acceptance. The literal October/November/December data-matching examples run in SQL208/209. Real browser late-period publication uses an actually earlier allowed reporting period and records the actual wall-clock publication/completion dates. It must prove that the stored work period survives late action. Do not label that result an observed December calendar run; if literal December authenticated timing is required beyond this equivalent invariant, keep that specific case pending until it can be genuinely exercised. Approval should settle this distinction before consuming the single CI attempt.

## Approval and release gates

**Approval received 2026-11-09:** implement/review the harness, commit/push this exact task branch with its Vercel exclusion, and dispatch exactly one attempt only after fresh included compute/storage/no-conflict proof. The actual-date late-period browser invariant is accepted; December remains literal SQL evidence. The harness is now implemented in `scripts/qa/monthly-report-{acceptance,concurrency,browser}.mjs` with boundary tests. Runtime acceptance remains blocked before dispatch: the connector can enumerate Actions artifact metadata but private Packages metadata returns HTTP403 for missing `read:packages`; pooled instantaneous storage headroom cannot be proven. Do not infer current headroom from accrued GB-hours. See the handoff for exact local checks and the reviewed harness corrections.

After this plan is approved: implement the proposed harness/patch locally, run lightweight guard/syntax checks, obtain source review, and commit the reviewed candidate in this same lane. Before any push, its branch-specific Vercel exclusion must be present; do not open a PR. Immediately refresh allowance/storage/run checks. Only an explicitly approved push and **one** manual `security.yml` run on that exact branch/SHA may follow. No automatic rerun, purchase, deployment, production migration or vault write.

Planned dispatch payload, **not sent**:

```json
{
  "ref": "codex/woad-monthly-report-gate-20261108",
  "inputs": {
    "monthly_report_acceptance": "true",
    "expected_sha": "EXACT_REVIEWED_PUSHED_40_CHARACTER_SHA",
    "database_only": "false",
    "call_acceptance": "false",
    "call_acceptance_only": "false"
  }
}
```

No release-ready claim until the exact candidate has successful database suites/advisors/races, production build and genuine authenticated acceptance with no required case pending. Any defect needs the smallest reviewed fix and affected rechecks; a further runner attempt needs fresh allowance and explicit authorization. Successful isolated validation still does not authorize WOAD: production backup/migration-first rollout and deployment remain a separate owner decision.

## This preparation's executed checks

- Read-only connected GitHub queries: repository owner/privacy/default branch; authenticated owner's plan; November account usage summary; all registered workflows; complete in-progress and queued result sets for this repository (both empty). No GitHub mutation was called.
- Installed Supabase CLI **2.113.0** help verified `status`, `migration list/up`, `test db`, `db lint/advisors/query` and their local/workdir flags. No CLI command connected to or changed a backend.
- Parsed the complete proposed workflow with the already-installed `js-yaml`; verified one standard 60-minute monthly job, explicit wrong-ref failure, exclusion of all seven ordinary jobs and no secret inheritance. `git apply --check docs/superpowers/plans/2026-11-09-monthly-report-ci.patch` and `git diff --check` passed.
- Final staged secret scan: **0 findings across 2,367 tracked files**. Only the handoff, this plan and its documentary patch are included in the local preparation commit.
- Independent read-only review: no remaining actionable finding after correcting the wrong-ref/all-skipped proposal and gating artifact upload on successful evidence sanitization. These are proposal corrections, not application bug fixes.
- No heavy local test/build/browser/Docker process, CI run, push, deployment, application edit, active workflow change or vault write. Helper implementation, boundary tests and all requested runtime acceptance remain pending.
