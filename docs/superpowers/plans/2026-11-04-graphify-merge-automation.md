# Graphify verified-merge automation implementation plan

> **For agentic workers:** Use superpowers:executing-plans. Implement inline with one final independent review; this follows the owner's request to build the approved setup with low usage.

**Goal:** Refresh Graphify exports and append factual merge evidence without recurring AI calls.

**Architecture:** A normal-user Windows task checks GitHub every five minutes. A frozen local Python program verifies exact-main CI/Vercel evidence, builds in the existing dedicated checkout, and publishes four allowlisted files with crash reconciliation.

**Tech Stack:** Existing Python 3.12 / Graphify 0.9.90; Python standard library; Git Credential Manager; Windows ScheduledTasks.

**Spec:** Owner-approved design, `C:/Users/TrojanNiAnton/Documents/Codex/2026-11-03/can-x20/outputs/graphify-automation-design-20261104.md` (approved: “lets build it then”).

## Global constraints

- No installations, model calls, execution-policy changes, application/database changes or main-branch mutations.
- Existing canonical vault/memory bindings and dedicated detached graph checkout only.
- Automatic vault writes: three Code Graph exports plus append-only `03 Implementation Log.md`; no other automatic notes.
- Pin Graphify 0.9.90, disable upstream auto-refresh, require fresh HTML below 10,000,000 bytes.
- Freeze installed program; generated data, Python environment, machine configuration and receipts remain ignored.
- Schedule every five minutes and sign-in, current user/normal privileges, no wake; cap receipt history.

## Review focus

1. Successful but wrong-SHA or old workflow attempt must not authorize publication.
2. Concurrent user edits and interrupted writes must preserve unrelated bytes and avoid duplicate log entries.
3. Environment/path changes, symlinks/reparse points and dirty checkouts must fail closed.
4. Authentication/network failures and pending/failed CI must preserve the last published snapshot.
5. Offline catch-up must record covered PRs without claiming tests for intermediate commits.

## Task 1 — Verified merge runner and publication

Files: create `scripts/graphify/refresh-after-merge.py`, `scripts/graphify/test_automation.py`; narrowly update `stage-export.py` to replace the generic upstream rebuild instruction.

Interfaces: `verified_snapshot(api, sha)` returns validated CI/PR/status evidence or raises `Pending`; `publish(config, evidence, metadata, staged)` reconciles/writes only allowlisted targets; `run(config, check_only=False)` polls and refreshes using installed setup.

- [x] Write failing standard-library tests for exact-SHA gating, latest attempts, job completeness, direct pushes, Vercel failure, credential failure, unchanged polls, catch-up, path binding, dirty checkout, stale HTML, duplicate entries, interrupted publication and conflicting edits.
- [x] Observe failures, implement runner using existing builder/stager and explicit boundary checks, then run the full Graphify unittest suite.
- [x] Keep a bounded 20-receipt history, one pending transaction and one status file. Reconcile persisted state before retrying uncertain writes.

## Task 2 — Registration, documentation and verification

Files: create `scripts/graphify/manage-automation.ps1`; update existing `docs/agents/graphify-trial.md`, `.claude/CLAUDE.md`; retain this plan as a concise execution ledger.

Interfaces: PowerShell `-Mode Install|Remove|Status -GraphRoot <path>`; install copies/fingerprints frozen program into `graphify-out/automation/program`, seeds checkpoint from the existing approved exports, registers one current-user task and verifies the saved task definition. Remove unregisters only this exact task and preserves runtime evidence/graphs/environment by default.

- [x] Validate PowerShell AST and real scheduler object construction without changing policy or using elevated privileges; saved task readback follows installation.
- [x] Update scoped trial documentation with the owner's narrow recurring exception and disable/status instructions.
- [x] Run Python suite and tracked secret scan; dispatch one independent code/security review; fix important findings with regression checks.
- [ ] Commit setup only, back up the lane branch under D-306, install reviewed frozen program, run real read-only verification and scheduled no-change invocation; inspect persisted task/state/files.
- [ ] Append factual setup evidence to the existing implementation log, preserve unrelated content, and reread saved files. Save a concise handoff and exact Desktop/clipboard report.

## Execution ledger

- Startup: canonical OS/vault/memory paths resolved; repository-path variable still identifies the old recovery clone. This lane explicitly targets verified `UplineTonyuo/wolf-forge-platform`; old clone untouched.
- Baseline: main/dedicated checkout `30cbee4fdf994be1e96d047e50aa4a14e8b24746`, clean/detached; existing 11 Graphify tests pass. Existing exports already approved at this SHA.
- Ruling: execute inline without another plan-approval round — owner explicitly requested construction after reviewing the concrete design; additional method questions would repeat settled authorization. Cost if wrong: implementation remains isolated and reversible before registration.
- Task 1: initial 17 new tests failed because runner was absent, then passed. Later recovery-cleanup test exposed missing-payload retry after checkpoint; reproduced and fixed. Generic upstream rebuild instruction regression failed then passed. Full focused suite now 40/40.
- Final review: one fresh independent reviewer found two P1 boundaries. Both reproduced in real child Python/disposable Git: checkout module shadowing and ignored runtime overwrite. Fixed with isolated Python entrypoints, reserved-tree rejection, `--no-overwrite-ignore` and post-switch manifest validation. Both regressions RED→GREEN; suite 40/40. No deferred minor findings or reviewer rulings.
- Live verification: REST 2026-03-10 omits actual merge-SHA evidence even on full PRs; pinned supported 2022-11-28 and added full PR lookup. Missing-summary-field regression RED→GREEN; actual main30c/security41683247516 exact-SHA verification passes. Never relax the exact merge-SHA requirement.
- Ruling: Remove unregisters only this owned task and preserves all local runtime evidence, rather than deleting its program/state — smaller and reversible; no automatic destructive cleanup of runtime directories. Completed receipt history is still bounded to20. Cost if wrong: a few retained local setup files after removal.
