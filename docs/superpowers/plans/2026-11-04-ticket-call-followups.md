# Ticket call follow-ups implementation plan

> Execute inline with superpowers:executing-plans. The user's nine-requirement implementation request is the binding specification and supersedes automatic client routing and conversation-toolbar notification opt-in in the November 3 design.

**Goal:** Make Ticket calls discoverable across the open application, select one personally saved eligible teammate, and make conversation follow-up truthful.

**Architecture:** Retain one shell CallController, existing media leases/budgets and PortalDialog. Add per-user Inbox bookmarks (the repository has only a legacy global timestamp), selected-recipient validation and lifecycle revocation in one additive migration. Deliver payload-free authenticated Realtime broadcasts through a same-origin server event stream; no browser bearer token or app-wide idle database polling. Keep OS push separate and unchanged by default.

**Constraints:** Local only; same worktree; branch from verified main c37dba4. No hosted mutations, Docker, customer activity, pilot widening or vault writes. No global timestamp backfill into inferred personal membership. Preserve 40-second ring, 45-second setup, fixed 15-minute expiry, existing conservative reservations and provider cleanup. User performs browser and real-media acceptance.

## Review focus

- Recipient disappears between preparation/request/accept/media: fail closed, preserve cleanup.
- New selected recipient with an old request key: conflict, never redirect a retry.
- Drawer and call dialog focus traps: only the foreground dialog handles keys; restore focus without scrolling drafts.
- SSE reconnect and duplicate hints: one source/controller and coalesced reads; stop disabled/hidden/offline/unmounted streams.
- Public client message vs internal note/system/call event: only a public team reply clears Unanswered.

### Task 1: Recipient authority and personal Inbox membership

- [x] Add failing service/controller/recipient-picker regressions and prepare SQL acceptance for zero/one/multiple candidates, forged/removed/revoked recipients and idempotency.
- [x] Add migration with personal bookmarks, current candidate roles/photos, request selection, lifecycle guard and current-authority history. Extend strict domain/service/controller interfaces using `recipient_id` / `p_recipient_id`.
- [x] Verify focused unit tests. Database acceptance remains unrun: no already-authorized isolated local target was verified; no backend was started.

### Task 2: Shared incoming delivery and header controls

- [x] Characterize absent closed-drawer discovery, dialog stacking and ringtone lifecycle in source and focused synthetic tests; actual browser ringing remains manual.
- [x] Add authenticated event stream and private payload-free broadcasts; reuse controller and default visual alerts. Keep browser/session tokens server-only.
- [x] Move icon controls into internal subject header and client Conversation header. Reuse PortalDialog with a native top layer above Inbox and matching blur, keyboard, focus return and reduced motion.
- [x] Move browser-notification recovery to existing Profile/settings with gesture-only permission requests and subscription reuse.

### Task 3: Truthful follow-up and verification

- [x] Add authoritative call-history rendering with pagination/deduplication, caller/callee names, mode/time/outcomes; preserve participant visibility.
- [x] Fix existing and future missed-notification destinations; preserve authorization and existing Inbox deep links.
- [x] Add server-derived Unanswered projection and established badge to authorized Inbox rows; modestly shorten only the client Ticket editor.
- [x] Prior snapshot: focused/full tests, lint and typecheck with one worker/bounded heap. Frozen run: 4,528 tests / 382 files passed; 63 implementation/test/SQL files unchanged through that historical run. Lint/typecheck exit 0. Build not run: free RAM below the existing 5.5 GiB guard. This does not validate the subsequent compatibility correction.
- [x] Fresh whole-diff review; prepare report/manual checklist and proposed memory/Security replacement content outside the vault. Leave local changes reviewable; no push/deploy. Review findings corrected and covered by focused regressions; backend and browser acceptance remain outstanding.

## Evidence / execution ledger

- Startup: clean c4ba410; fetched and independently checked origin/main c37dba4, identical released tree. Created codex/woad-ticket-call-followups-20261104 in requested worktree. No competing checkout mutation observed.
- Root causes: shared provider mounts correctly once per shell; idle refresh has no live transport except optional OFF/unset push; standalone call controls sit outside the actual drawer header while its nested conversation header is hidden; PortalDialog z9600 below drawer z11900 and native dialogs occupy the top layer; only global inbox_added_at exists; call-history RPC has no conversation renderer; missed bell points to inspector route.
- Memory is stale at October 30 checkpoint. November 3 final release report supersedes older pending-release statements. Vault remains untouched.
- Prior-snapshot evidence: `outputs/call-followups-20261104/full-tests-frozen.log`, `frozen-verification.json`, `static-verification.json`, `git-verification.json` and `report.md` beneath the parent project folder. Test/lint/typecheck/whitespace exit 0 are historical for that snapshot. SQL/RLS/races/Realtime, build, rendered browser widths and real media/OS delivery were not passed.

### Task 4: Preserve legacy Inbox compatibility

- [x] Confirm the new migration is untracked/absent from HEAD and recorded unapplied in the prior local delivery; no hosted ledger was accessed. Verify expected branch and no competing active writer; snapshot all 66 preexisting changed files outside the repository.
- [x] Keep legacy Inbox visibility behind the original authorized reader; add viewer-only personal_inbox_added_at, with no inferred saves or global timestamp changes. Preserve candidate/admission/lifecycle checks.
- [x] Keep legacy View in Inbox and a deliberate Save to my Inbox action distinct; read-only viewers cannot save. Add failing page regressions and implement the narrow correction. Focused final run: 162 tests / 6 files passed, including a rendered acknowledgement-preservation test during refreshed personal-save props.
- [x] Strengthen SQL198 with legacy/personal visibility separation, explicit/duplicate/separate saves, nonempty message preservation, client privacy, personal-only isolation, revoked access and cross-workspace denial. Prepared only; no isolated backend available for execution.
- [x] Fresh focused review found no Critical/Important source findings; added its three SQL-fixture coverage recommendations. Lint/typecheck passed after the code correction.
- Initial full correction run: 4,529 passed / 1 failed, 382 files. The failure was the old exact-source assertion in unified-inbox-boundaries.test.ts expecting a single-timestamp guard. Removed that brittle assertion and replaced its intended coverage with an actual management-page refresh/acknowledgement regression. No production code changed for this test correction. Fresh full/static reruns are required; prior results are not substituted.
- [x] Final application verification: 4,531 tests / 382 files passed; focused 162 / 6 passed; lint/typecheck/whitespace passed. All 68 implementation/test/SQL files remained unchanged through the full run. Afterward, only unexecuted SQL198 was corrected from source review: revoked-membership expectations and fixture savepoint isolation so four retained invitation holds do not exhaust the next scenario's cap. Application/Vitest source remains identical to the passing run; those prepared SQL changes are not claimed executed.
- [x] Final evidence/report and proposed canonical updates remain outside the vault. SQL/RLS/concurrency and actual private Realtime-to-SSE/reconnect/cleanup remain unrun because no authorized configured local stack is available; no hosted substitute or Docker is permitted. Build remains subject to the 5.5 GiB guard; browser/media/OS acceptance remains manual.

### Continuation verification — 2026-11-04

- [x] Recheck the named worktree/branch and recorded session completion; preserve the existing compatibility correction and all nine follow-ups. Audit 71 pending files against local main; no additional application/SQL fix was needed.
- [x] Run fresh full application verification: 4,531 tests / 382 files passed, lint/typecheck/whitespace passed. All 68 implementation/test/SQL files stayed unchanged. Independent read-only review found no confirmed source defect.
- [x] Owner confirms no approved isolated backend is available. Record exact prerequisites outside the vault; keep SQL/RLS/concurrency and actual Realtime/SSE acceptance pending without substitutes.
- [x] Recheck build memory guard: 3.54 GiB free, below 5.5 GiB; full build not run. No unrelated service/application was closed.
- [x] Prepare the local-only checkpoint handoff and steward proposal. Canonical notes remain read-only; no push, deployment, hosted migration, pilot expansion or real-user activity.
- [ ] Execute isolated SQL/RLS/concurrency and actual Realtime/SSE acceptance once the missing target/identity/session/runner prerequisites are explicitly available.
- [ ] Owner browser and real two-person media acceptance, followed by separately authorized rollout.

### CI continuation — 2026-11-04

- User now authorizes GitHub CI validation. Keep this existing worktree/branch; no production rollout, hosted databases, local Docker, or real-user activity.
- Billing preflight: authenticated account Free; November Actions usage 763 Linux minutes, fully discounted, net $0. One standard-Linux workflow has a maximum 110 runner-minutes ($0.66 before included credit); no paid runner or new artifact upload.
- [x] Reproduce missing Vercel exclusion and add this exact branch to `git.deploymentEnabled: false`, preserving existing rules/crons. Guard check now passes.
- [x] Add optional manual CI acceptance: real synthetic password sessions/cookies, compiled Next route, private Realtime wake, authoritative read, reconnect/lifecycle, revoked-session denial and disconnect cleanup. Runtime refuses execution outside disposable GitHub Linux; local negative guard check refuses before any backend access. No Daily media endpoint or provider credential is used.
- [ ] Fresh review, static checks, feature-only push and one manual workflow dispatch with `call_acceptance=true`; record exact run/SHA and each job result. No main merge or Vercel promotion.
- [ ] Resolve verified CI failures and rerun only the failed jobs as appropriate. SQL/RLS/concurrency/build and transport remain pending until actual runner evidence passes.
- [ ] User browser/two-device media and OS delivery acceptance remain separate. Canonical notes stay read-only; prepare a steward proposal outside the vault.
- Fresh CI-harness review: corrected a nonexistent provider-room relation before execution; provider state lives on `private.ticket_calls`. Reproduced a false-positive lifecycle assertion (401 counted as an ended call); the new regression failed, then passed after requiring HTTP 200, `ok=true`, and explicit `call=null`. Review reported no other Important/Critical or minor finding.
