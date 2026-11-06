# Calls that continue until a participant ends them

Date: 2026-11-06
Status: proposed design; no application, database or provider changes made.
Source reviewed: clean integrated candidate a8f837776a14d51639de27d72491c8b67aa2ba60, branch codex/woad-integrated-validation-20261105. This is not a fresh production readback.

## Owner's request and settled choice

Remove the fixed 15-minute cutoff from voice and video calls. Either participant can end the call. Apply the shared behavior to eligible client and internal Ticket and Order conversations, including linked Orders, without expanding the existing pilot or permissions.

The owner explicitly chose: keep an active call open with usage warnings when the monthly allocation is reached; block new calls at that point. An active call can therefore exceed the allocation and incur provider charges. No hard spending cap or uninterrupted network/device availability is promised. No provider plan, payment method or allocation increase is part of this change.

Normal cancellation, unanswered/setup deadlines, verified loss of access/session, and recovery from abandoned or disconnected calls remain. These are different from imposing a maximum duration on a healthy, authorized call.

## Approaches

1. Retain budget-based termination while allowing a longer per-call duration. Offered to the owner and declined: an active call could still be interrupted when its allocation runs out.
2. Keep active calls running; use the budget to decide whether new calls may start. Selected by the owner. Requires usage estimates for running calls and warnings; cannot guarantee zero overage.

Implementation recommendation for option 2: separate admission/join credential lifetime from active-call lifetime in the existing lifecycle. A larger fixed timer fails the request. Repeatedly extending Daily room expiry and replacing live credentials adds provider mutations and failure points that the selected behavior does not need.

## Verified reason for the current cutoff

- The original call ledger constrains expires_at to created_at plus approximately 15 minutes. Current Ticket and native Order request functions reserve two participants through that expiry.
- The latest lifecycle functions in 20261104131000_order_call_targets.sql end calls at expires_at and reject setup/join/presence after it.
- src/lib/daily/calls.ts creates and verifies a fixed-expiry private room with automatic ejection configured. src/services/ticket-call-provider.ts also bounds grant lifetime to 901 seconds and issues eject-at-expiry tokens.
- src/components/calls/call-provider.tsx invokes controller.expire() at that timestamp. call-screen.tsx displays a countdown and a separate local elapsed timer.
- Provider evidence/reconciliation clips intervals and settlement to expires_at. Removing only the countdown or provider ejection would leave this accounting incorrect.
- ticket_call_enabled also requires recent account-usage verification. That admission-readiness requirement must not be mistaken for actual loss of participant authorization during an established call.

## Shared lifecycle and provider boundary

Use an explicit lifetime-policy distinction so historical/fixed-duration calls and their original evidence retain their meaning. Implement forward-only schema changes; do not edit already-reviewed historical migrations or rewrite old outcomes. New manual-end calls have no elapsed-time termination condition once active. Preserve 40-second ringing, 45-second connection setup, session/device winner binding, one active call per participant, tenant/company/resource checks and personal-recipient eligibility.

Daily rooms remain private and limited to two verified participants. For new manual-end calls, create the room without a fixed meeting-end expiry or elapsed-ejection property. Issue short-lived room- and participant-bound join tokens with eject_at_token_exp=false. Token expiration still prevents later reuse; reconnect requires fresh authorization and a fresh bounded token. Keep existing rate limits and token-attempt limits. Never issue permanent join tokens, accept a browser-selected room, or recreate an ended room.

Continue using the durable setup and cleanup claims, bounded API calls and authoritative readback. Validation must enforce the new policy's exact provider properties and still reject public, wrong-room, extra-participant, recording or privilege changes. Manual hang-up and revocation must request provider ejection/closure through the existing reconciliation boundary. A browser release, HTTP success or missing room alone does not prove media termination or settle usage.

Separate new-call readiness (including fresh account usage and available budget) from continued-call authority. Exhausted or stale usage can block new invitations and produce an internal warning; it cannot alone end an existing manual-end call. Actual tenant/calling disablement, session revocation, participant access loss and provider/media failure retain their security behavior. Counter and busy checks must use live states/claims, rather than treating an old expires_at as proof that a long call stopped.

## Abandoned-call recovery

Removing the fixed expiry must not leave an orphan room or busy claim permanently live. Reuse existing call-status and maintenance paths; do not add site-wide polling or an always-on server. Device-bound liveness updates apply only to the winning participant/session/device and never let one participant renew the other's presence. Keep the existing active-call cadence as an upper frequency bound (currently one refresh per 10 seconds), and do not add a provider request to every refresh.

The builder check confirmed that /api/internal/ticket-call-maintenance exists but is not scheduled in vercel.json; the two current cron entries clean Team voice and intake once daily. Those daily jobs cannot provide timely abandoned-call or revocation checks. Proposed implementation choice: add one authenticated five-minute trigger for the existing call-maintenance endpoint, with a cheap early exit when there is no due call work, bounded database/provider batches, single-flight claims and existing request deadlines. This is about 8,640 endpoint invocations in a 30-day month, before platform retries, and is not a zero-cost claim. Provider reads occur only for due live/uncertain work or bounded usage reconciliation, not per user or per page visit. No new hosted schedule is activated during local implementation; verified deployment/configuration of this trigger is an explicit release prerequisite for manual-end calls. Do not enable this lifetime policy without the independent trigger. The trigger uses the existing cron secret and call-maintenance authorization; do not store or expose its value in source or evidence.

An inactive tab is not evidence that someone left: active media must survive minimization/backgrounding. When app liveness becomes stale, use a bounded trusted provider-presence check before declaring the room abandoned. Reuse the existing setup grace where relevant and propose a 90-second reconnect grace for confirmed participant absence. The independent five-minute job supplies the fallback when neither browser sends requests; cleanup timing includes its schedule latency, and is not promised at exactly 90 seconds. Preserve uncertain cleanup and usage holds when provider evidence is unavailable; do not claim closure or give allowance back. Exact liveness fields and bounded batch placement within this existing endpoint are builder decisions, with tests for background throttling, simultaneous disconnects, scheduler delay, duplicate invocations and actual revocation enforcement required.

## Usage and warnings

Retain existing monthly allocations, request quotas, environment scope and reconciliation policy. Before admitting a new call, atomically count reservations plus conservative accrued usage of active manual-end calls and unrelated account usage. For a running two-person room, reserve/count at least the larger of its existing hold and its elapsed participant-time estimate. Split across UTC months; no running call becomes free because 15 minutes or month-end passed. An active call continues when this estimate exceeds the allocation. Concurrent new requests must see the same authoritative usage/claim state.

Reuse the existing 75/90/100 percent thresholds. Surface a nonblocking warning to the internal participant using existing authority; do not expose tenant/provider totals to the client or grant Managers new billing permissions. At the limit, wording should clearly say that this call can continue and new calls are blocked. Suppress duplicate announcements for the same month/threshold.

Final settlement uses trusted provider participant intervals for the actual duration, including time beyond 15 minutes. Remove the old clipping only for the new policy, validate against server/provider observation time and call identity, retain replay protection and uncertain holds, and account across month boundaries. Audit the existing bounded meeting/participant pagination so long calls or reconnect intervals cannot silently discard usage. No new client-supplied duration is authoritative.

## Call display

Replace the active-call countdown with one elapsed clock based on the server-confirmed answeredAt timestamp, including the minimized strip. It must not reset on reconnect or display negative/invalid time. Keep the ring-to-answer countdown. Preserve the existing Wolf Forge layout, device controls, accessible status announcements and End call button. Do not announce an elapsed clock every second. No other UI redesign is included.

## Verification required before claiming completion

1. Demonstrate the existing active-call cutoff with a controlled clock test, then prove a new-policy call remains active beyond 15 minutes (including a two-hour clock advance). Verify either participant's End terminates it and an old-policy call retains its previous semantics.
2. Provider tests verify bounded join tokens, no active-call ejection deadline, strict room properties, fresh authorized reconnect, no ended-room reuse, and retained uncertain-write/readback behavior.
3. Isolated SQL/RLS tests cover Ticket/native/linked Orders, role/company/pilot denial, current session/device binding, budgets at 75/90/100 percent, long-running reservations, UTC month rollover, replay and concurrent new-call admission. Confirm no quota/busy bypass after the old expiry.
4. Exercise disconnect/abandonment and denied/expired authority independently of budget exhaustion. Healthy background media must survive; missing or uncertain evidence must not falsely settle usage.
5. Verify actual duration/history and provider accounting beyond 15 minutes; warning visibility/announcement, minimize/reconnect, and no duplicate elapsed/countdown UI.
6. Run relevant application suites, typecheck, lint, secret checks and a production build under the existing 5.5-GiB RAM guard. Record any checks that cannot run. No current-duration test, build, SQL acceptance or media pass is claimed by this design.
7. Use only authorized synthetic/pilot sessions for real two-person media QA longer than 15 minutes. No client/William calls, messages or account mutations as an agent-side test.

## Scope and rollout

This design is kept outside the validated release checkout while awaiting review, so its clean a8f8377 candidate and PR114 ownership are preserved. Application implementation will use an isolated task branch and one writer; no dependency installation is needed merely to review this document. Recheck the actual main/candidate before implementation and plan the smallest forward migration after the current ten release migrations.

Local implementation is distinct from hosted application. Approval of this design covers preparing the focused application/forward-migration changes and the one proposed five-minute schedule in source. It does not activate a hosted migration/schedule, push, CI dispatch, paid upgrade, deployment, pilot expansion, backup retry or vault write. Existing backup/release holds stay in effect. Rollback must preserve long-call history and actual usage; drain active new-policy calls before any application downgrade that cannot understand them.

Builder decisions: exact column/DTO names, small helper placement, warning presentation in the existing component, test file numbering, and commit boundaries. Preserve the owner's behavior above; do not replace it with a new fixed maximum or weaken access checks to make tests pass.

## Current primary references

- [Daily room access and expiry](https://docs.daily.co/reference/rest-api/rooms): room expiry governs admission; automatic room ejection is separate. Current docs are not proof of our production configuration or custom-SDK media termination.
- [Daily meeting tokens](https://docs.daily.co/reference/rest-api/meeting-tokens): room-scoped access, expiry and ejection behavior. Server-generated credentials remain required.
- [Daily pricing](https://www.daily.co/pricing/video-sdk/): usage is measured in participant-minutes; published free allowance is not an account-specific spending cap.
- [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security) and [Auth architecture](https://supabase.com/docs/guides/auth/architecture): preserve current server/database authorization; no new public table or privileged bypass.

Before hosted rollout, verify the current Vercel plan permits the proposed five-minute cadence and that its incremental usage is acceptable under the existing spending controls. No purchase or upgrade is authorized; if the account does not support this cadence, keep manual-end policy disabled and report that specific prerequisite rather than silently falling back to browser-only cleanup.

Prepared by Codex. A fresh read-only builder review identified the missing independent maintenance trigger; this design was corrected and the reviewer returned "nothing important left". This is design review, not code/SQL or media acceptance. Reviewed source and official documentation; no production-call behavior or timing change has been executed.
