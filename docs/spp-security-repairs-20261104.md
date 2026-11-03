# SPP security repairs — 2026-11-04

Base: `7aa06cf7e784a7a792d87d07661f9d7df3b7e14a`.
Branch: `codex/spp-security-fixes-20261104`. Local repairs; no push, deployment, production access, Docker, external email or provider call.

## Verified findings and smallest repairs

1. **P2: create-request replay bypassed current Order/task read access.** An original staff creator retained their own exact request ID/payload, lost assignment to both the Order and its tasks, then replayed create. Normal SELECT denied access, but replay returned newly changed notes/description. The replay was actor/payload/Tenant bound; arbitrary cross-account guessing was not demonstrated. Migration `20261103231409_project_task_create_replay_authorization.sql` adds current operational access and archive checks to both replay branches. It preserves read-authorized retries even after create/edit capability is removed. New writes, function signatures, ACLs and Manager scope are unchanged.
2. **P2: bulk mutation amplification.** Reachable server actions accepted unbounded ID arrays and attempted a mutation for every distinct ID, including repeated denials. Raw request length is now capped at 50 before deduplication; UUIDs and assignee shape are validated. Existing server-resolved edit/assign/archive capabilities are checked before labels and mutations. Database authorization remains final; per-Order partial success is preserved. This bounds one request, not aggregate spending.
3. **P3: password revocation falsely reported success.** Returned/thrown Auth sign-out errors were ignored while audit metadata claimed other sessions were revoked. The completed password update now remains successful, while UI and audit separately report confirmed revocation. An unconfirmed result clears secret inputs, retains a warning, and disables repeat submission until close. Provider current-password enforcement was not changed or verified.

## Fresh verification

- New regression RED: 15 failures / 59 cases before product repairs.
- Combined GREEN: 562 tests / 38 files passed, `security-regressions-green.log`.
- `next typegen`: exit 0.
- `node --max-old-space-size=1536 node_modules/typescript/bin/tsc --noEmit --incremental false`: exit 0.
- Scoped ESLint (changed TS/TSX plus new tests): exit 0; whitespace check: exit 0.
- Independent source review: no actionable defect found.
- Full production build was not run: 3.22 GiB available at final pre-scan check, below the existing 5.5 GiB guard.

Evidence directory:
`C:\Users\TrojanNiAnton\Documents\Codex\2026-10-20\continue-the-wolf-forge-spp-project\outputs\spp-security-assessment-20261104`.

## Exact scope of database proof

Existing isolated Studio project `rsnmlcyopnxucwgfttyf` is older than this source: ledger 178, latest `20261026123450`. Relevant original create/access/helper bodies matched this source by whitespace-normalized MD5 before testing. This enabled a narrowly scoped replay reproduction, not full release acceptance.

RED used synthetic c4b9-prefixed users/Tenant/company/service and a new Order/task. GREEN used the actual proposed function bodies renamed into pg_temp; public/private application functions were never replaced. Both executions were single atomic DO blocks with nested subtransactions that deliberately raised/caught a private sentinel to roll back all fixture writes and temporary DDL. Final readback found zero fixture users, Tenants, companies, services, Orders, tasks and overrides. Five application/helper function digests and the ledger were unchanged.

RED: normal Order/task SELECT denied; replay disclosed fresh notes/description.
GREEN: both replays denied; read-authorized retry preserved.
Raw evidence: `sql-evidence-raw.json`; executed statements: `project-replay-red-executed.sql` / `project-replay-green-executed.sql`.

The 17-case pgTAP suite `supabase/tests/database/202_project_task_create_replay_authorization.test.sql` is **unexecuted**. It must run on a fresh, fully migrated isolated Supabase stack/approved guarded CI, including current Manager policy. Do not run it against production or reset hosted Studio to achieve this.

## Remaining acceptance and integration

- Full SQL/RLS suite, concurrent execution, real Auth/REST/Storage endpoints and browser acceptance remain pending.
- Verify current-password enforcement with synthetic Auth sessions on a matching approved target; `secure_password_change` alone does not establish the separate provider current-password flag.
- Existing CI-only concurrency harness guards must remain intact.
- Call-cost branch `961b4962e18612ec20f0b993e74cbbf67a4155ea` has nine commits after this base and no changed-file or migration-timestamp overlap with this patch. Its six call SQL migrations remain separate and unaccepted. This suite uses number 202 to avoid that branch's 199–201 tests.
- Do not merge branches or push/trigger Preview without separate authorization. Review combined schema and execute acceptance on exact integrated commit before proposing rollout.

## Dependency and source-review limits

Native `npm audit --omit=dev --package-lock-only --ignore-scripts --json` reported five moderate package entries (two underlying advisories through Sentry -> glob/minimatch), zero high/critical. Build sourcemap tooling reaches these dependencies; inspected globs were trusted/static and no inspected glob call used AbortSignal. No request-controlled exploit path was found. No bundled-runtime proof was performed. Do not force the audit's proposed major Sentry downgrade; track compatible upstream repair separately.

Source tracing also covered finance/tenancy, form submission and credentials, files/PDFs/uploads, voice/push surfaces and receipts. No further new confirmed exploit was established. Latent billing guard ordering, deliberate receipt quotas and existing download/call-cost gaps are not counted as newly verified vulnerabilities or silently repaired.

Canonical vault notes stayed read-only. Exact memory edits are proposed outside the vault; no alternate memory tree was created.
