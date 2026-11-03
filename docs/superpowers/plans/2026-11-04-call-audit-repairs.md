# Call Audit Repairs Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline, with test-driven-development. The owner approved this scope in chat on November 4, 2026.

**Goal:** Fix redial, incoming-event reconnection and the default speaker choice without changing calling permissions or database behavior.

**Architecture:** Keep the existing controller, event-driven call signals and Daily-backed device menu. Retire completed invitation IDs while preserving uncertain retries; maintain one capped-backoff signal connection; use valid enumerated speaker IDs.

**Tech Stack:** Existing TypeScript, React, Daily JS 0.94.0 and Vitest. No new dependencies.

**Spec:** The approved three-fix proposal in this chat and `outputs/call-followups-20261104/source-audit-20261104/report.md` under the task root. This plan records that approved scope; it does not broaden it.

## Global Constraints

- Reuse this worktree and branch at baseline `152c61ea1a49d7119a564d289029db1c916f9ecd`.
- No deployment, push, Docker, hosted database change, real call or protected-account activity.
- No migrations or permission changes. Preserve duplicate invitation protection and event-driven discovery.
- Build only with at least 5.5 GiB available RAM; do not close unrelated processes.
- Canonical memory remains read-only; stage any exact memory proposal outside the vault.
- Leave the tested changes available for review, uncommitted.

## Review Focus

- A new intentional call after decline, missed call or remote hang-up gets a new ID.
- A lost response, including immediately after a completed call, retains its ID on retry.
- An extended event-stream outage keeps one reconnect timer with a 60-second maximum delay.
- Disabled, hidden, offline and disposed signal clients do not keep reconnecting or poll the database.
- Speaker controls never submit an empty ID or offer selection when unsupported.

## Task 1: Repair the three audited failures

**Files:**
- Modify `src/components/calls/call-controller.ts` and `src/tests/call-controller.test.ts`.
- Modify `src/components/calls/call-signals.ts` and `src/tests/call-signals.test.ts`.
- Modify `src/components/calls/call-screen.tsx` and `src/tests/call-screen.test.tsx`.
- Preserve the existing `CallMedia.device(kind, id)` interface and SDK error handling.

**Interfaces:** `CallController.request/close`, `connectCallSignals(wake): stop`, and `CallScreen` keep their signatures. No task consumes a new interface. Pre-flight: no cross-task interface changes.

- [x] Add tests for remote terminal outcomes followed by redial, both with and without closing the ended screen. Assert different request IDs and a new ringing call; simulate idempotent server responses.
- [x] Add tests for lost invitation responses and retries after a previous ended call. Assert the retry sends the same ID and creates no extra invitation.
- [x] Add an extended-outage signal test beyond six failures, then recovery; assert one connection/timer, bounded delays and one wake. Cover hidden/offline/disabled/disposed cancellation.
- [x] Add rendered device-menu tests for returning to the enumerated default speaker, absence of an invalid default option and unsupported output selection.
- [x] Run the three test files with one worker and a 768 MiB heap; record the expected RED failures outside the worktree.
- [x] Implement the smallest changes in the existing three components; preserve uncertain retries, event coalescing and SDK validation.
- [x] Rerun the three files, then the related call component/controller tests, scoped lint and bounded typecheck. Expected: all requested regressions and related checks pass.
- [x] Measure RAM immediately before any full build. If under 5.5 GiB, record the hold; otherwise use the existing inert-backend build safeguards and a live RAM/time guard.
- [x] Review the complete repair diff and tests, address any verified review defect, and rerun affected checks.
- [x] Save a report, exact evidence and a steward proposal outside the vault. Verify final diff scope and leave changes uncommitted.

## Execution Notes

The implementation is inline in this chat, as requested. No new worktree or backend is needed. Prior CI and the source audit are historical evidence; new results must be recorded separately.

## Verified Results — 2026-11-04

- Initial RED: 8 failures / 17 passes. Initial GREEN: 25/25.
- Independent final review found an ended-snapshot -> null-refresh -> redial gap. Added the missing server-shaped scenario: 3 RED failures, then all 119 related call tests passed across 27 files.
- Scoped lint, full TypeScript check and tracked secret scan passed. No migration or dependency changes.
- Full build held at 4.18 GiB free against the existing 5.5 GiB guard. It was not started; real browser/device acceptance remains pending.
- All seven intended files remain uncommitted. No push, deployment, Docker, hosted database or canonical memory writes.

Execution ruling: the plan records the already approved chat proposal; no new feature/design decision was introduced. Use native inline checks rather than commit-oriented helper bookkeeping, because this approved scope explicitly leaves changes uncommitted. Final review defect was fixed with a RED-to-GREEN regression; no re-review was dispatched.
