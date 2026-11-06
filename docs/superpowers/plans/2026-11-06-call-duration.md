# Manual-end Calls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans in this session. Steps use checkbox syntax for tracking.

**Goal:** Healthy authorized calls continue beyond 15 minutes until either participant ends them; exhausted usage blocks new calls and warns existing ones.
**Architecture:** Separate new-call admission and short-lived join grants from manual active-call lifetime. Retain fixed-policy historical calls, update the existing shared ledger/provider boundary and wire bounded independent maintenance.
**Tech Stack:** Existing Next.js/React/TypeScript, Daily 0.94.0, PostgreSQL/Supabase, Vitest/pgTAP. No new dependencies.
**Spec:** ../specs/2026-11-06-call-duration-design.md (owner approved 2026-11-06).

## Global Constraints

- 40-second ringing; 45-second setup; 90-second reconnect grace after confirmed absence.
- Keep pilot, tenant/company, session/device, recipient, throttles and concurrent-claim controls.
- No arbitrary maximum duration for new-policy active calls; retain historical fixed-call semantics.
- Preserve monthly allocations; warn at 75/90/100 percent, block new calls, allow active overage.
- Five-minute authenticated maintenance through the existing endpoint; no hosted activation now.
- Existing candidate a8f8377 unchanged. Local only, no push/CI/Docker/hosted writes/real calls/vault writes. Build requires 5.5 GiB free RAM.

## Review Focus

1. Stale usage is an admission failure, not authorization revocation; active calls keep running.
2. Background/suspended browsers cannot be mistaken for absent Daily participants.
3. Long calls spanning UTC months continue accruing reservations and cannot bypass admission concurrency or release uncertain usage.
4. Manual hang-up, session revocation and replay cannot recreate an ended room or reuse another device's credentials.
5. Historical fixed calls and old server projections keep their behavior during migration/application sequencing.

### Task 1: Forward ledger and usage policy

**Files:** Create one CLI-named migration and supabase/tests/database/206_call_manual_end.test.sql; update database RPC types only if new public signatures require it.
**Interfaces:** Call projection adds durationPolicy: fixed|manual and budgetWarning: null|75|90|100; setup/join return durationPolicy plus independently computed token expiry. Existing signatures remain where possible. Maintenance adds service-only due-presence claim/result RPCs.
- [x] Prepare SQL206 examples for two-hour survival, accrual, exhausted/stale usage, actor/device/replay denial and either participant's End. The broader full-stack matrix (including historical fixed policy, 75/90 thresholds, rollover and races) remains an acceptance gate; native synthetic checks are supplementary.
- [ ] Run isolated SQL if an authorized running local target exists; otherwise explicitly record execution unavailable rather than substitute static checks for acceptance.
- [x] Add explicit manual lifetime policy defaulting old rows to fixed. New backend admission selects manual only after operator activation; separate readiness from active authority, retain 15-minute admission reservation, accrue running/uncertain usage by UTC month under the existing lock.
- [x] Preserve old function guards while replacing active expiry branches; bind fresh join tokens to current device/session; add bounded maintenance absence checks and actual-duration evidence reconciliation.
- [x] Verify whitespace, SQL syntax using existing local tools, and source/type contracts; keep migration unapplied to hosted databases.

### Task 2: Provider grants and elapsed call display

**Files:** src/lib/daily/calls.ts; src/services/ticket-call-provider.ts; src/domain/tickets/calls.ts; src/components/calls/call-provider.tsx, call-controller.ts, call-screen.tsx; focused existing tests and new call-duration.test.tsx.
**Interfaces:** Consume durationPolicy default fixed for legacy DTOs; grants expire as join credentials, not active media. Use answeredAt for elapsed clock. Expose internal-only numeric threshold without billing totals.
- [x] Add failing behavior tests for provider manual room/token properties, strict validation, active clock past 15 minutes and fixed expiry. Either participant's End has native persistence evidence; full SQL acceptance is pending.
- [x] Run focused Vitest with one worker and bounded heap; verify the expected failures before product edits.
- [x] Implement new-policy room creation without active expiry/ejection; preserve short token TTL, readback, claim and cleanup checks. Keep fixed-policy path intact.
- [x] Replace active countdown with one elapsed clock; keep ring countdown and existing auth/error behavior. Persist warning threshold announcements without per-second live announcements.
- [x] Run all affected call suites, then the full application suite within resource limits; typecheck/lint.

### Task 3: Independent maintenance and safe release configuration

**Files:** src/app/api/internal/ticket-call-maintenance/route.ts; src/services/ticket-call-provider.ts; vercel.json; maintenance/provider tests.
**Interfaces:** Due presence claims are service-only and bound to an exact call/version/claim. Provider presence validated before persistence; unknown responses retain usage/busy holds. Existing cleanup and usage scans remain bounded.
- [x] Add failing application/native tests for unauthorized/no-work maintenance, healthy present rooms, absent-peer grace, duplicate/late claims, provider failure and five-minute source schedule. Actual background devices remain untested.
- [x] Reuse deterministic provider presence, durable claims and bounded deadline/batches. Maintenance advances authoritative lifecycle even without browser requests; do not infer termination from a missing room alone.
- [x] Add only this branch's automatic-deployment exclusion and the approved five-minute cron source configuration. Policy is not production-ready without verified trigger/plan/configuration.
- [x] Run maintenance/call suites and verify no provider request for no due work.

### Task 4: Review and handoff

**Files:** This plan/spec; focused handoff and external evidence/memory proposal.
- [x] Run relevant tests, full suite, typecheck, lint and tracked-file secrets; preserve actual command outputs outside the vault. Build skipped: 2.81 GiB available, below the 5.5-GiB guard.
- [x] Fresh independent whole-change review against the five Review Focus cases; fix concrete important findings with RED/GREEN evidence.
- [x] Report executed versus pending SQL/real-media/build checks. No live duration claim until deployment and real two-person acceptance. Keep all changes local and provide exact worktree/branch/changed files.

Final local receipts (2026-11-07 SGT): 4,708 tests / 396 files; TypeScript and full ESLint passed. The exact migration compiled in native PostgreSQL 17.11 with 28 passing synthetic-prerequisite persistence checks and baseline RED evidence. SQL206/full Supabase/RLS/races, production build, responsive browser/media and deployed cron acceptance are unexecuted. Manual policy stays OFF. These limits are local-checkpoint gates, not a claim of rollout completion.

Execution: owner explicitly approved the design and local implementation in this chat. Use one writer; routine plan details do not add another authorization gate. Record implementation rulings and actual checks in the task ledger.
