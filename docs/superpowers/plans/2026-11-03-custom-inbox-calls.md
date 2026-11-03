# Custom Inbox Calls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task in this chat. Steps use checkbox syntax for tracking.

**Goal:** Implement custom two-person voice/video calls, open-app ringing and closed-app push, preserving server authority and usage controls.

**Architecture:** Extend PR76's guarded invitation/provider boundary, replace Daily Prebuilt with call-object media and a shared shell coordinator, and reuse existing payload-free push wakeups for both call notifications and window signalling. Keep the HttpOnly session model and existing notification polling fix. Default OFF until isolated acceptance and provider controls are verified.

**Tech Stack:** Existing Next16/React19/TypeScript/CSS Modules/Lucide; daily-js0.94.0; server-only Supabase RPCs; existing Edge Web Push worker.

**Spec:** docs/superpowers/specs/2026-11-03-custom-inbox-calls-design.md, including the owner's “both” scope correction.

## Global Constraints

- No local Docker, production/Studio migrations or setting changes, real customer/William actions, RojanCRM changes, emails or deployment.
- Preserve one selected callee,40-second ring,45-second setup,15-minute fixed expiry,600 test/5400 live/6000 combined participant-minute allocations and conservative holds.
- Voice remains audio-only. No recording, transcription, screen sharing, dialing, groups or observer access.
- Existing HttpOnly auth, per-command permissions/RLS and server-selected actors remain authoritative. No browser login token, room token persistence or private push content.
- Calling OFF disables new provider work and idle client scheduling; trusted termination/cleanup remains possible.
- Canonical notes read-only under D-319. Existing call worktree reused; one writer.

## Review Focus

- Stale async media completion after cancel/end cannot reacquire microphone or join.
- A push click with an expired login or old call cannot auto-answer or cross account/Tenant boundaries.
- Multiple tabs and duplicate wakeups cannot duplicate calls, delivery or media instances.
- Notification denial/offline/suspended app cannot be shown as successful ringing or media connection.
- Unknown provider outcomes and account reconciliation gaps keep reservations and stop new admission.

### Task1: Integrate the existing call foundation with current main

Files: .github/workflows/security.yml (expected conflict), integration ledger at task outputs.

- [ ] Verify clean approved-design checkpoint and completed prior writer. Record BASE; merge origin/main, not rebase. Preserve all current main CI checks plus the call concurrency step.
- [ ] Run existing focused call domain/service/provider/route/UI tests with one worker and a bounded heap. Record exact fresh results; investigate baseline failures before continuing.
- [ ] Verify migration timestamps are unique and integration diff contains only intended call work. Commit the integration separately.

### Task2: Guarded call projections, push bindings and delivery intents

Files: src/domain/tickets/calls.ts; src/services/ticket-call-service.ts; src/app/api/ticket-calls/route.ts; src/lib/notifications/call-push-server.ts (new); src/app/api/ticket-call-push/route.ts (new); additive migration generated with existing Supabase CLI; supabase/tests/database new call UI/push test; src/tests/ticket-call-route.test.ts and ticket-call-push.test.ts.

Interfaces: CallAvailability={enabled:boolean,call:TicketCall|null,peer:{name:string,avatarUrl:string|null}|null}; GET action=current returns only the current actor's eligible frozen invitation. Existing command status remains authoritative. A push status response is {active:boolean,call:{id:string,version:number}|null}, with no peer or Ticket details. Endpoint mutation registers/disables only the authenticated actor's current endpoint/session/origin.

- [ ] Write failing tests for current-callee authority, privacy, disabled flags, wrong device, revoked/missing session, deduplication, expiry and endpoint isolation.
- [ ] Implement bounded current projection, authorized peer metadata and separate private call-push intents/claims/receipts using existing helpers and VAPID configuration. Never overwrite ordinary message delivery behavior.
- [ ] Run focused API tests; run SQL/RLS checks only in disposable CI. Commit coherent source/tests/migration without applying it to a hosted project.

### Task3: Real Daily adapter and bounded reconciliation

Files: src/lib/daily/calls.ts; src/services/ticket-call-provider.ts; src/lib/daily/provider.ts and reconciliation.ts (new); src/app/api/internal/ticket-call-maintenance/route.ts (new); src/tests/ticket-call-provider-boundary.test.ts and ticket-call-reconciliation.test.ts.

Interfaces: createDailyCallProvider() implements existing CallProvider. prepareTicketCallMedia(user,trusted,provider,callId,deviceId) remains the sole media setup. reconcileDailyCalls(trusted,provider,now) returns counts only, with durable cursor/overlap and no token logging.

- [ ] Write/run failing tests for deterministic room timeout/readback, expired setup, malformed provider data, duplicate/out-of-order meeting sessions, unknown deletion, budget staleness and disabled admission with cleanup still available.
- [ ] Implement server-only bounded REST adapter and scheduled-entry handler using the existing authenticated maintenance pattern. Derive all resource/account names from trusted claims; do not enable a real schedule/provider during development.
- [ ] Run provider tests and verify token restrictions; commit.

### Task4: Custom media controller and Inbox screen

Files: src/components/calls/call-controller.ts, call-media.ts, call-screen.tsx, calls.module.css and call-provider.tsx (new); src/components/tickets/ticket-call-controls.tsx; existing InternalShell/ClientAccountShell; new src/tests/call-controller.test.ts, call-screen.test.tsx and call-media.test.ts.

Interfaces: one CallProvider React context owns request/accept/decline/cancel/end/minimize/reopen; CallScreen consumes authoritative call/peer plus observed local media state; createCallMedia uses the pinned SDK call object and exposes real tracks/device state. The server call model and browser-observed media model remain distinct.

- [ ] Write/run failing tests for double clicks, accept on another device, stale import/join after cancel, track replacement/cleanup, autoplay refusal, denied permissions, disconnected/reconnecting states, truthful toggles and expiry.
- [ ] Build navy/gold UI using existing dialogs, selectors and avatars; voice portrait/video stage; large controls; persistent active strip; accessible status/focus/reduced motion. Acquire devices only after user action. Replace obsolete Join controls and all idle5-second polling.
- [ ] Run controller/component/media tests, plus existing Ticket composer/draft regressions. Render all seven widths with synthetic media and open device menus. Commit.

### Task5: Closed-app and open-app call delivery

Files: public/push-sw.js; supabase/functions/studio-web-push/handler.ts; src/components/calls/call-notifications.tsx (new); src/app/calls/[callId]/page.tsx (new shared call entry); existing login safe-return helper only if needed; src/tests/call-push-worker.test.ts, call-entry.test.ts and existing push tests.

Interfaces: worker posts {type:'wolf-forge-call',id,version} only after authenticated endpoint status; page coordinator re-reads authorization. A shared /calls/UUID entry resolves actor/Ticket server-side and redirects to the proper Inbox with the opaque call ID; safe login return accepts only that exact bounded route shape. Never auto-accept.

- [ ] Write/run failing tests for stale/wrong-account pushes, duplicate versions, active-window acknowledgement, no notification permission, expired deadline, abandoned dispatch, redirect attacks, missed/ended notification clicks and preservation of ordinary message push.
- [ ] Extend worker/Edge dispatcher with separate call delivery claims, high urgency/remaining TTL and durable unknown receipts. Add explicit eligible internal/client opt-in using existing VAPID/endpoint controls. Preserve generic update delivery.
- [ ] Run all push/entry/auth return tests, fake-worker click tests and disabled-feature no-idle-work checks. Commit; no real push to a customer device.

### Task6: Whole-branch acceptance and handoff

Files: call concurrency CI harness as needed, docs call handoff, task output evidence and steward proposal.

- [ ] Run fresh scoped/full lint, typegen/typecheck/build within RAM guards; use existing disposable CI for heavy/full SQL/RLS/concurrency checks once the reviewed candidate is ready. Do not count earlier foundation CI as a new pass.
- [ ] Fresh reviewer checks the integrated branch, particularly revoked identity, push click routing, provider holds, controls and cleanup. Fix verified blockers and rerun affected checks.
- [ ] Prepare concrete synthetic two-person media/closed-app push checklist. Verify actual account/allowance, isolated backend/credentials, delivery origin and emergency controls before any real provider/device test; obtain any missing specific setup authorization only after the code/evidence is reviewable.
- [ ] Report precisely which tests passed, which actual-device checks remain and why, migration order and rollback. Do not merge/deploy or claim usable live media without those gates. Preserve canonical notes and provide steward proposal.

Self-review: every spec section maps to Tasks1–6. Five Review Focus conditions have explicit tests in Tasks2–5. Reuse the existing CallProvider service type; name the React provider distinctly (InboxCallProvider) to avoid collision. Native execution in this chat preserves the user's chosen working method; one fresh whole-branch review at the end.
