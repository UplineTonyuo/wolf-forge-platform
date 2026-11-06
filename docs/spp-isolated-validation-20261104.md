# Combined isolated security/call validation — 2026-11-04

## Authorized scope

Owner approved coordinating the existing call-cost and security repairs here, one bounded isolated CI validation, and manual media QA afterward. WOAD deployment remains a separate approval. No local Docker, hosted migration, production data, real-user interaction or paid service setup.

Existing isolated worktree: C:/Users/TrojanNiAnton/.codex/worktrees/spp-security-fixes-20261104/woad-voice-release-20261026.
Branch: codex/spp-security-fixes-20261104.
Parents: security bba827fe8324c208a919344c357fcea273c7a73a and call 961b4962e18612ec20f0b993e74cbbf67a4155ea; common base 7aa06cf7e784a7a792d87d07661f9d7df3b7e14a.

## Preflight and rulings

- Both worktrees were clean; no changed-file or migration-timestamp collision. Merge applied cleanly. Call worktree remains untouched.
- SQL tests 199–201 belong to call controls; replay test is 202. Seven new migrations in the combined candidate; no hosted application.
- GitHub account UplineTonyuo is Free. November billing API readback showed Actions Linux gross/discount $7.386 for 1,231 minutes, net $0, and storage gross/discount $0.000924865. All-product summary contained only these entries. No queued/in-progress repository Actions runs at inspection.
- Current official Free included compute is $12; the configured 110 standard Linux job-minute maximum corresponds to $0.66 of included compute at the reported $0.006/minute. This is an allowance estimate, not a provider spending cap or guarantee against concurrent unrelated account usage.
- Ruling: integrate into the existing security branch; leave the separately owned call branch/worktree unchanged. Add an exact false git.deploymentEnabled rule for this validation branch in vercel.json. Preserve all other branch rules, crons, workflows and hosted settings.
- Non-main branch push has no YAML push trigger. Do not open a PR, avoiding duplicate PR validation. security.yml is manually dispatched once with database_only=false and call_acceptance=true; capture exact remote head/run head SHA.
- Existing security workflow runs seven ubuntu-latest jobs with configured maximum 110 job-minutes: typecheck10, lint10, build35, tests15, database20, dependencies10, secrets10. Intake workflow is excluded and must not be widened.
- Database/build call acceptance uses fresh disposable runner-local Supabase, synthetic identities and inert/missing external provider settings. Keep CI/Linux/local-Docker/loopback/empty-fixture guards intact. Container/npm/Actions traffic is expected; this is not a general network egress firewall.

## Validation ledger

1. Checkpoints, source overlap, billing and workflow/Preview preflight: verified.
2. Clean local merge and exact branch no-deployment rule: prepared. Run combined focused tests, TypeScript, lint, harness syntax/helper and source secret/whitespace checks before committing.
3. Push only this validation branch after the checks; verify remote SHA, dispatch one security workflow, track all jobs and inspect failures. No main merge, Vercel deployment, hosted migrations or real-user QA.
4. If a verified failure occurs, make a minimal test-backed repair and rerun only affected checks within available included allowance.
5. Record exact run URL/SHA/job results and pending manual call QA. Keep canonical memory read-only; stage a steward proposal outside the vault.

## Remaining acceptance

### First CI run correction

Run 41764225935 at 12eca51 reached all migrations and passed formal SQL199–202. The database gate failed because Supabase recursively discovered the manual pre-fix reproduction under supabase/tests/manual; its expected denial on the repaired schema is not a pgTAP test. Move that file intact to scripts/qa/reproductions/project-task-create-replay-red.sql. No assertion, migration, application body or harness guard changes. After the first run finishes, dispatch database_only=true and call_acceptance=false on the corrected commit, preserving the completed build/transport/application evidence through unchanged source blobs. Maximum additional configured job-time: database20 + secrets10 =30 minutes. Record the RED discovery failure and subsequent GREEN separately.

Prior 562 security tests and 146 call tests are historical separate-branch evidence, not a combined pass. Full database/RLS/race/transport/build acceptance remains pending until the exact combined candidate completes CI. Real two-person media and closed-device behavior remain the owner's later manual QA. Current-password Auth enforcement and Daily's provider hard-stop limitation are separate unresolved acceptance/operational matters.

Evidence: C:/Users/TrojanNiAnton/Documents/Codex/2026-10-20/continue-the-wolf-forge-spp-project/outputs/spp-isolated-validation-20261104.
Official references: https://docs.github.com/en/billing/concepts/product-billing/github-actions and https://vercel.com/docs/project-configuration/git-configuration.
