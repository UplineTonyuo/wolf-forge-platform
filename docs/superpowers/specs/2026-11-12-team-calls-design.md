# Team direct and group calls — design for review

Date: 2026-11-12. Status: **proposed; design only; no implementation or release approval**.

Source baseline: `origin/main` at `ad763e8a3c2669c923d89f025839e5cea7bf0901`, fetched before creating branch `codex/woad-team-calls-design-20261112`. This document is the only repository change. D-306 governs the branch; D-319 leaves canonical Decisions/Security changes to the steward. Recommendations below are not settled owner decisions.

## 1. What the owner is deciding

Add private audio/video calling to existing Team Messages. An Owner or Admin may call the other member of a direct conversation or start a call in a group. Managers and Staff may answer and join; they may never initiate, restart, redial, or call back, even through a direct RPC request. Group calls ring every other member, and unanswered members may join from the chat while the call remains available.

The owner already decided to ring everyone and to treat Staff like Managers. This design recommends:

- Extend the existing call ledger and provider/accounting pipeline; add team targets and participant rows.
- Ship direct calls first in **one PR and one release**. Group calls are a separate second phase.
- Limit group calls to **eight people including the initiator**. A larger chat cannot start a call; do not secretly choose a subset.
- Charge team and client calls to the **same existing allowance**, with separate reporting.
- Let any current Owner/Admin who is a member of the group end it for everyone. Everyone can leave personally. An active group continues after the initiator leaves.
- Preserve the current duration-policy choice, fail-closed admission gate, conservative usage holds, and manual-call overrun policy. A new group participant needs fresh admission authority; a continuing authorized participant is not disconnected merely because accounting becomes stale.

No recording, transcription, screen sharing, outside guests, telephone dialing, client participation, scheduled meetings, call transfers, or new provider is proposed. No product code, migration, test, workflow, prototype, backend, hosted database, provider dashboard, or paid resource is created by this task.

## 2. Verified foundation and limits of this investigation

| Source at the baseline | What it establishes |
| --- | --- |
| [src/domain/tickets/calls.ts](../../../src/domain/tickets/calls.ts) | Ticket/order DTOs contain one caller, one callee, and only `client_to_team` / `team_to_client` directions. Evidence accepts up to 128 intervals. |
| [src/lib/daily/calls.ts](../../../src/lib/daily/calls.ts), [provider.ts](../../../src/lib/daily/provider.ts) | Private deterministic Daily rooms, exact room verification, disabled recording/sharing/admin powers; room capacity and presence/ejection reads are hardcoded to two. |
| [src/services/ticket-call-service.ts](../../../src/services/ticket-call-service.ts), [ticket-call-provider.ts](../../../src/services/ticket-call-provider.ts) | User-scoped RPC authority, durable room claims, winning session/device binding, token issuance, cleanup and evidence ingestion. Presence assumes two people. |
| [src/app/calls/[callId]/page.tsx](../../../src/app/calls/[callId]/page.tsx), [call-entry.ts](../../../src/domain/tickets/call-entry.ts) | Authenticated entry rejects a call without a ticket/order. Team entry needs a separate authorized target projection. |
| `src/app/api/ticket-calls/route.ts`, `ticket-call-media/route.ts`, `ticket-call-events/route.ts`, `ticket-call-push/route.ts` | Same-origin checks, bounded input, no-store responses, support-mode refusal, provider boundary, leased realtime wakeups and verified push status. These are the actual API route names. |
| Migrations `20261028195113`, `20261028195141`, `20261028200140` | Call root, frozen two-party constraints, shared claims/reservations/events/evidence/intervals/cleanup, UTC month accounting and retained history. |
| Call migrations `20261103114405` through `20261104131000` | Interface/push, account scans, pilot, request/history/device/stream limits, and native Order targets. |
| `20261106152256_ticket_call_manual_end.sql`, `20261106220033_ticket_call_maintenance_singleton_guard.sql` | Manual policy, 120-second join grants, independent presence/cleanup, growing conservative holds, singleton-safe maintenance writes. |
| `20261110223618_ticket_call_provider_evidence_bounds.sql` and test `211_ticket_call_provider_evidence.test.sql` | PR #123 repair: evidence end envelope includes the latest interval end; expected mapped-ingest failures roll back only that meeting and fall back to conservative accounting, allowing cursor progress. |
| `src/app/actions/team-messages.ts`, `src/services/team-service.ts`, `src/repositories/team-repository.ts` | Internal context and user-scoped Team RPC boundary. Conversation membership, not supervision, is the normal participation boundary. |
| `20260826170000_team_communication_tasks.sql`, `20260828120000_team_communication_v26_governance.sql`, `20260901151505_team_voice_messages_and_pins.sql` | Team membership and conversation governance. Conversation creator/delegated admin authority differs from tenant Owner/Admin roles. |
| `20261008140000_tenant_team_supervision_isolation.sql`, `20261008160000_tenant_team_conversation_ownership.sql`, `20261008170000_tenant_team_notification_isolation.sql` | A conversation has one authoritative tenant. Supervision and notifications have their own scope; neither grants media participation. |
| `src/components/team/team-conversation-view.tsx`, `team-messages-drawer.tsx`, `src/components/calls/*` | Existing chat header, Inbox call provider, preparation screen, dialog, ringtone, device controls, history and single-peer media state. |

These are source facts, not a fresh production audit. Hosted access was prohibited. Existing repository documentation contains historical live/pilot readbacks, but they cannot establish today's settings. PR #123 is merged and its repair is present in this baseline; this investigation does not independently certify the hosted function or recovery.

Graphify was unavailable under its provenance safeguards: build metadata named `ad763e8`, while the published checkpoint named `eddede8`. No query, rebuild, refresh, installation, or scheduler change was performed; current source search supplied the evidence.

### Settings inspected read-only

| Committed setting/policy | Verified source value |
| --- | --- |
| Account environment allocation | 600 participant-minutes in test; 5,400 in live. Existing documented combined allocation: 6,000. No increase proposed. |
| Verified free allowance field | Defaults to 10,000; enabling requires at least 6,000. This field is an operator attestation, not proof of the provider's current commercial allowance. |
| Tenant monthly allowance | Default 600; database configuration accepts 1 through the environment allocation. UI schema maximum is 5,400. |
| Master/media/manual switches | Database defaults OFF. App configuration requires `DAILY_CALLS_ENABLED=1` and the existing pinned Daily domain/key. Manual policy additionally requires its verified maintenance heartbeat. |
| Admission freshness | Environment/exclusivity verification newer than 30 days; current UTC-month usage verification newer than one hour; manual heartbeat newer than ten minutes when manual policy is enabled. |
| Existing operational bounds | 40-second ringing; 45-second connection window; fixed calls expire after 15 minutes; manual join grants last 120 seconds. |
| Existing admission/storage protection | Six admitted calls per actor/day, four concurrent/unresolved calls, 200 counted monthly calls; record caps 30/actor/day, 300/actor/30 days, 120/global/day, 1,200/global/30 days. Preserve all across call kinds. |
| Device/stream protection | Ten enabled and twenty retained push endpoints per profile; shared stream leases and RPC throttles already exist. Team routes must not create an additional independent allowance. |
| Maintenance | `vercel.json` already schedules `/api/internal/ticket-call-maintenance` every five minutes. Current worker handles bounded presence/cleanup batches and one account-history page per invocation. |

**Unknown without separately authorized hosted readback:** enabled/media/manual/pilot values, tenant allowances, current usage/holds, provider billing/spending controls, push configuration, actual scheduler health and deployed schema. Read them before activation; do not infer or change them during this design task.

## 3. Data-model options

| Option | Cost | Risk and benefit |
| --- | --- | --- |
| **A. Extend existing call tables; add participant rows** | Medium for direct calls; substantial for groups. Amend target/direction constraints, dispatch authorization by kind, add participant state, and generalize all two-person assumptions. Existing room, reservation, scan and cleanup IDs stay intact. | Shared accounting and busy claims remain atomic. Greatest risk is accidentally passing a team call through a client-oriented helper or relaxing the two-person checks for client calls. Requires explicit kind branches and regression tests. |
| **B. New team call/participant tables** | Medium initial schema cost, high integration cost. Requires a cross-ledger busy lock, cross-ledger reservations/month totals, room-to-call registry, union scans/history/maintenance and two lifecycle implementations. A shared generic call root would itself be a larger extraction. | Better isolation of the old schema, but omission of either ledger can undercount cost, miss cleanup, or let a person enter two calls. Duplicating the usage gate is especially risky after PR #123. Separate tables do not make accounting independent. |

**Recommend A.** The root already supports a second conversation target for Orders, and intervals already identify individual participant sessions. It can be extended without replacing the ledger or rewriting historical rows. **Its current constraints and lifecycle cannot support groups unchanged.** Group support requires deliberate changes throughout authorization, presence, budgets, cleanup, reconciliation and the browser media model. Merely widening `max_participants` is unsafe. If implementation cannot keep client-call branches compatible, stop and return a revised design rather than hiding a ledger rewrite in Phase 1.

### Proposed schema, not executable migration

| Object | Proposed change and invariant |
| --- | --- |
| `private.ticket_calls` | Add `call_kind`: `client` (default for existing rows), `team_direct`, `team_group`; `team_conversation_id`; frozen `participant_capacity`; group absence timestamp. Keep existing IDs, tenant, initiator, mode, lifecycle, claims, provider state and accounting. |
| Target binding | Client calls retain exactly one ticket/order and no team target. Team calls have exactly one team target and no ticket/order. Add a unique referenced pair `team_conversations(tenant_id,id)` and a composite FK from the call. Never fabricate a Ticket or Order. |
| Parties/direction | Existing client directions and frozen-party/two-person constraints remain on the client branch. Team direction is `team_to_team`. Direct teams have exactly two distinct internal people and a callee. Groups have 3–8 distinct people including the initiator and no single callee. |
| `private.ticket_call_participants` (new; team calls only) | PK `(call_id,profile_id)`; tenant-bound call FK; invitation state, attendance state, timestamps, last authorized session/device, lease generation, join-not-after, token-attempt count and version. All tables use forced RLS, no direct API-role table grants, controlled RPCs only. |
| Participant state | Invitation: `waiting` (initiator), `ringing`, `accepted`, `declined`, `missed`, `busy`, `canceled`, `revoked`. Attendance: `not_joined`, `connecting`, `joined`, `left`. The UI derives “Ringing / Joined / Declined / Left” from both; durable events preserve earlier transitions and repeat joins. |
| Frozen roster | Snapshot the complete conversation roster under the mutation lock. Existing `participants uuid[]` is a compatibility snapshot of those same IDs, not an authorization grant. A deferred constraint trigger verifies distinct IDs, capacity, caller/callee and exact agreement with participant rows at commit. Do not delete historical roster/evidence on membership removal. |
| Busy claims | Reuse `private.ticket_call_claims` with its profile PK for **all call kinds and tenants**. Busy group invitees get a participant row but no competing claim. Ringing free invitees hold a claim until answer/decline/timeout. Joining atomically claims that person's slot. |
| Reservations/intervals/evidence/cleanup | Continue using existing call-keyed tables. Add no second account budget or scan. Team token attempts live per participant: maximum eight each, plus existing actor/global rate limits; at most 64 per eight-person call. Client token limits stay unchanged. |
| Uniqueness/indexes | One unfinished team call per conversation; idempotency remains tenant + initiating actor + request UUID with exact mode/conversation/session/device replay checks. Add team history keyset index `(team_conversation_id,created_at desc,id desc)`. |

New team participant eligibility is the intersection of the frozen roster and current internal membership/permission. Members added after the call starts wait for the next call; they are not silently invited. A removed member becomes revoked for this call even if later re-added. An Owner/Admin can start the next call after the current one ends.

### History in Team Messages

Reuse the existing Ticket call-history approach: read call records separately and merge typed call entries into the Team conversation timeline. Do not write fake text messages or add a new editable message type.

A new `app_team_call_history` returns up to 50 membership-authorized call entries per page with `(created_at,id)` keyset pagination. Include mode, initiator, start/end, answered/missed/declined/canceled summary, connected duration, and the viewer's participation result. Group “missed” is per invitee; one person's decline never makes the whole call declined.

Merge messages and calls by timestamp and stable kind/ID tie-breaker. Keep independent message/call cursors; load call pages down to the oldest visible message boundary, with an explicit older-calls affordance when needed. Realtime invalidation refetches visible history and current call; reconnect performs an authoritative catch-up. Update the conversation watermark for call lifecycle changes without marking a message read or fabricating unread text. A history-load failure shows a retry state, not “no calls.”

History entries cannot be edited, forwarded, reacted to, pinned, or used to bypass participant checks. Owner/Admin may start a **new** call from history after current checks; Manager/Staff get no callback action. Normal current chat membership grants retained history, including to a later-added member, consistently with the chat transcript. Supervision remains transcript-only and gains no team-call media or call-detail access.

## 4. Authorization contract

### Database proof, repeated on every authoritative operation

A new private helper `require_team_call_actor(conversation_id, require_start_role)` must:

1. Derive `auth.uid()`, validated `auth.sessions` session ID and `private.current_tenant_id()`; never accept actor, role, tenant or invitees as caller-supplied authority.
2. Reject support context. Check both `app.client_support_id` and an unended/unexpired `private.client_support_sessions` row bound to the original administrator/session. Stripping a support header must not restore calling while that session is impersonating.
3. Require active/unarchived tenant, profile and tenant membership with `account_class='internal'`; call `private.require_team_actor()` for `team_messages.use`.
4. Prove conversation ownership by current tenant and actual `team_conversation_members` membership. `private.team_is_conversation_member` supplies tenant-aware conversation membership, but does not replace the active internal tenant-membership checks.
5. When starting, join the current membership's `role_id` to `public.roles` and require `r.name in ('owner','admin')`. A conversation creator, delegated group admin, Manager with broad permissions, or supervisor is not thereby a tenant Owner/Admin.
6. Lock the conversation/participation authority used by a mutation, recheck after waiting, and serialize roster changes with the same conversation lock in member-add/remove RPCs. Use the existing global call lock for reservations/claims; define a consistent global-call-then-conversation lock order for both paths.
7. Validate all invitees independently against the same tenant/internal/permission/pilot boundary before any durable invitation or push. A client or foreign member accidentally present in a conversation makes creation fail closed, never a client ring.

Every team read returns only allowlisted fields. Denials for nonmembers and foreign IDs are indistinguishable. No user RPC can create a room, mint a token directly, submit trusted usage, or select a provider URL.

### User RPC surface

All functions below are proposed public SECURITY DEFINER RPCs with empty search path, explicit grants to `authenticated` only, no PUBLIC/anon/service-role execution grant, schema validation, durable rate limits and tenant-aware helpers. Service-only completions have separate grants. Existing client RPCs explicitly reject team kinds.

| RPC / operation | Who may invoke; additional proof |
| --- | --- |
| `app_team_call_prepare(p_conversation_id)` | Any current internal conversation member; return capability flags, roster count and current call. `canStart` only for Owner/Admin and enabled phase. No ring, claim, room or token. |
| `app_request_team_call(p_conversation_id,p_request_id,p_device_id,p_mode)` | **Owner/Admin member only**, including exact retries. Derive direct/group kind from the conversation. Phase 1 refuses group kind at the DB boundary. Freeze/validate roster, gate and reserve cost, acquire claims, persist call/participants/events, then enqueue rings. No recipient list parameter. |
| `app_team_call_current(p_conversation_id default null,p_call_id default null)` | Current internal member; roster membership additionally required for personal incoming/media eligibility. Without arguments return the actor's current claims plus bounded joinable group invitations, all filtered by current tenant and membership. No cross-tenant call detail. |
| `app_team_call_history(p_conversation_id,p_before,p_before_id)` | Current internal member, including Managers/Staff; no media grant. Both cursor fields required together. |
| `app_team_call_command(p_action,p_call_id,p_device_id,p_expected_generation default null)`: status | Current internal member; returns authorized current state, never grants. The common signature permits null only for operations that do not act on a participant lease. |
| Same RPC: accept / decline | Own frozen invitation only; current membership/internal/session required. Accept atomically binds one winning session/device and checks freshness/phase. Decline updates only self (direct decline ends that call). |
| Same RPC: cancel | Initiator only while not active; must still be Owner/Admin member. Idempotent; never restarts an ended call. |
| Same RPC: leave | Own saved session/device and mandatory expected lease generation; stops own media and records departure. Minimal identity-bound cleanup remains possible after permission/membership loss; returns only a receipt. No start/join/detail authority follows from this exception. Support sessions remain refused; trusted maintenance handles their cleanup. |
| Same RPC: end_for_all | Direct: either actual participant. Group: current Owner/Admin **and current conversation member**, even if not presently in the media room. Manager/Staff and delegated conversation admins cannot end a group for everyone. This operation can only close, never place a call. |
| Same RPC: setup / join | Current internal member **and frozen nonrevoked participant**, correct winning session/device and mandatory expected lease generation, phase/media/usage checks, capacity and shared busy claim. First/late join checks the one-hour gate. An already-admitted manual participant's reconnect follows existing active-authority policy. No new membership or new slot is invented by reconnect. |
| `app_team_call_media_probe(p_call_id,p_device_id,p_expected_generation)` | Same participant/session/device and mandatory expected-generation checks; only issues a bounded server probe claim. Browser presence cannot mark joined, settle cost, or end others. |
| `app_team_call_owner_summary(p_month)` | Current tenant Owner only, matching existing summary authority and throttle. Aggregate client/team participant-minutes, holds and counts; no conversation/member details outside membership. |

Accept, including an explicit late acceptance, atomically wins and returns a participant lease generation. Setup, join, media probe and Leave carry that exact generation through their HTTP/RPC inputs. Capture it in every durable provider/token attempt and revalidate it after provider work; a stale completion must not return a grant for a superseded lease. A delayed Leave from generation 1 must never mutate a same-session/same-device rejoin at generation 2. Root notification versions are separate: another member accepting does not invalidate an existing participant's lease. Recover a lost accept response with an authorized current-state read, never by silently replacing the winning lease.

Role demotion immediately removes start/cancel/end-for-all authority. An active participant demoted to Manager/Staff may continue or leave as a participant. Group continuation must not depend on the initiator remaining Owner/Admin, connected, or logged in after activation; that would contradict “members may continue.”

### HTTP, entry, realtime and trusted surface

| Route / existing RPC family | Required boundary and change |
| --- | --- |
| New `GET/POST /api/team-calls` | Internal verified session, explicit support refusal, same-origin/fetch-site rules, no-store responses, strict read/command unions and 2 KB request body. Dispatch only the RPCs above; never a trusted client for user authority. No request shape accepts tenant/actor/role/participant IDs. |
| New `POST /api/team-call-media` | Same-origin, internal/support checks, strict call/device/action/expected-generation schema, 1 KB body; user RPC authorizes before a trusted completion. Team kind only. Revalidate user authority and the captured participant generation after provider work and before returning a token; discard a token if either changed. |
| Existing `/api/ticket-calls`, `/api/ticket-call-media` | Keep client/ticket/order contract and require client call kind. They cannot become alternate team start/media routes. Shared low-level provider functions dispatch from a verified database claim, not a browser-supplied kind. |
| Existing `GET /api/ticket-call-events` | Reuse a single shared leased stream in the shell for all call wakeups. Extend `app_ticket_call_signal_context`, `app_ticket_call_signal_lease_context`, `app_ticket_call_signal_lease` and topic predicate for authorized internal Team users without Tickets access. Client sessions receive only their existing client-call wakes. Keep cross-kind stream limits shared, renewal checks and session expiry. Wake payload carries no transcript or token. |
| Existing `GET/POST /api/ticket-call-push` | Reuse device opt-in and verified origin/session; extend `app_my_call_push_status` and private delivery eligibility by kind. Team results require internal participant + current membership. `app_set_my_call_push_subscription`, `app_get_my_call_push_configuration` and `app_browser_push_endpoint_state` retain shared device caps/ownership; no automatic opt-in. |
| Existing `GET /calls/[callId]` | For internal sessions, try the user-scoped `app_team_call_current(p_call_id)` and its authorized team projection; otherwise/fallback use existing client-call current resolution. Team kind goes only to `/dashboard?team-messages=<conversationId>&call=<callId>` after internal membership checks. Client sessions never try team lookup. Client entry retains existing ticket/order navigation. UUID alone never reveals a team conversation; support mode is refused. |
| Existing `GET /api/internal/ticket-call-maintenance` | Existing constant-time CRON_SECRET check and fixed Daily host/key. No user session path. Run due team/client lifecycle checks, targeted departures, cleanup and shared account reconciliation. No new endpoint, schedule or workflow is needed. |
| `app_complete_ticket_call_room`, `app_confirm_ticket_call_presence` | Service-role only, exact durable claim/call/generation; room properties and participant IDs checked against frozen kind/capacity. Team confirmation requires at least two distinct authorized roster members, not exactly caller + callee. User cannot assert provider success. |
| `app_claim_manual_call_checks`, `app_finish_manual_call_check`, `app_claim_ticket_call_cleanup`, `app_record_manual_call_empty`, `app_finish_ticket_call_cleanup` | Service-role only; bind fresh claims to exact call, no reuse across rooms. Generalize bounded presence and maximum issued join expiry across participant rows. Unknown/partial responses retain holds and claims. |
| `app_claim_ticket_call_provider_scan`, `app_apply_ticket_call_provider_page`, `app_ingest_ticket_call_evidence`, `app_reconcile_ticket_call_account` | Service-role only; one account scan/ledger, exact cursor/lease/meeting/evidence identity. Dispatch team evidence inside the existing transaction and preserve PR #123 fallback. No authenticated evidence submission. |
| `app_claim_ticket_call_push_deliveries`, `app_finish_ticket_call_push_delivery`; existing `studio-web-push` Edge worker | Existing trusted worker authentication; per-call/device unique delivery with exact attempt receipt. Enqueue/query all eligible team invitees, suppress stale invitations at claim/status time. Worker transport success never proves a person answered. |
| Existing Team member-add/remove and supervision RPCs | Preserve their current governance permissions; add shared lock + revocation hook on membership changes. Do not let a group admin create calls through membership mutation. Supervision cannot call the team media RPC successfully. |

New private helpers have no API-role execution grants. No ordinary user can change team rollout flags, provider attestations, account allocation, pilot scope or reconciliation freshness. Keep the existing Owner-only shared tenant settings RPC; add no self-service way to increase the account cap.

### Media grant boundary

Keep private `wf-call-<UUID>` rooms, pinned Daily origin, disabled recording/transcription/sharing/dialout, unique provider user IDs and nonowner tokens. New room capacity is exactly two for direct/client and the frozen roster size (at most eight) for groups; verify that exact value in JS and SQL. Provider requests must never choose a capacity supplied by a browser.

Token `user_id` is the authorized profile UUID; grants name one room and restrict audio/video permissions. Manual-policy grants last 120 seconds without expiry ejection of an already connected participant. Fixed-policy grants retain the call's absolute expiry and expiry ejection; they do not use a shorter 120-second lifetime. Shortening a fixed grant while keeping expiry ejection would disconnect that person prematurely. Device/session binding is enforced by the application lease, not by a claim that a bearer provider token is physically bound to a device. Never log or persist raw tokens, provider secrets, endpoint URLs in analytics, or media.

On removal, archive, permission/session revocation: deny new grants immediately, invalidate the participant lease and request targeted provider ejection. Outstanding bearer grants can remain usable until their join expiry; maintain the departure claim and recheck/eject through that boundary. If targeted ejection cannot be verified, close the whole call through durable cleanup rather than certify continued privacy. Provider/network failure can delay actual media termination; an HTTP “ended” response is not proof of silence.

## 5. Lifecycle

The root remains `ringing → accepted → connecting → active → ending → ended`; per-person invitation/attendance is separate. A root can be active while some group invitations are still ringing. Do not use root `state='ringing'` as the only group push predicate.

| Event | Direct call | Group call |
| --- | --- | --- |
| Start | Owner/Admin selects audio/video in their DM; DB resolves the other member. Ring for 40 seconds. | Owner/Admin member starts in the group. Snapshot all eligible members, ring everyone else for 40 seconds; initiator sees outgoing state. |
| Answer | First atomic accept wins for that callee/session/device. Both enter preparation/media. | Each person accepts independently. A single member's answer stops only their own other devices. First accept opens setup; other invitations keep ringing until response/deadline. |
| Joined / active | Trusted provider evidence of both people makes it active. Accept alone is not an answered media call. | At least two distinct roster members present makes it active. Initial setup window is 45 seconds from first acceptance; cancel/end if two people never connect. |
| Decline | Callee decline ends it; caller sees declined. | Decline stops only that person's rings and frees an unused claim. They can later choose Join while it is active; no automatic re-ring. |
| Miss / busy | Timeout records missed. Busy recipient gives the existing busy-style refusal; never replaces their other call. No late join to an ended direct call. | Timeout records missed per unanswered member. Busy members see a quiet invitation and can join later when free. With no acceptance by 40 seconds, end as missed. If every nonbusy invitee declines before any acceptance and no invite remains ringing, end without opening a room. |
| Late join | Only reconnect to a still-running accepted call; never resurrect an ended call. | Frozen, currently eligible declined/missed/busy members can Join an **active** call. Recheck freshness, phase, claim and original reserved slot; consume no second reservation for that slot. First connection cannot occur after the call has logically ended. |
| Leave | Either participant ends the direct call. A transient network drop uses the existing reconnect grace. | Leave updates only that participant; others continue. The initiator leaving is ordinary Leave. Keep or release their busy claim according to verified media departure below. |
| End for everyone | Either participant. | Any current tenant Owner/Admin who is a conversation member; server checks current role. Show a distinct “End for everyone” action with confirmation. Managers/Staff have Leave only. |
| Auto-end after activation | Existing fixed expiry or verified peer absence; preserve manual policy. | Fixed policy keeps its expiry. Otherwise end after **fewer than two people are confirmed present for 90 seconds**. No host election or initiator-presence rule. At least two remaining members can continue. |
| Revocation / master OFF | Trusted lifecycle/cleanup terminates; no new grants. | Revoke only affected participants when termination is verifiable; otherwise close the room. Explicit global/tenant calling or media disablement ends calls; phase admission flags alone drain them. |

Group auto-end uses two fresh, complete provider observations at least 90 seconds apart; a complete observation with two or more clears the absence timer. Failed/partial observations reset the consecutive-observation proof and do not count as empty. The existing five-minute schedule and two-call batches mean this is **not a promised 90-second wall-clock disconnect**. At four active calls, observation/drain can take multiple invocations. Keep claims/holds while unknown and show “Connection lost / checking call.”

If a user leaves before any token attempt, release their own claim immediately. After a token attempt, release only once their provider sessions are confirmed absent after the maximum issued grant expiry plus five seconds. Recheck absence under the exact participant departure claim; accounting reservations remain until call reconciliation. In manual calls this can release that person before the group finishes. In fixed calls an issued grant lasts to the group expiry, so a leaver can remain busy until that boundary; the UI must explain that their previous call is still closing. Unknown departure keeps the user busy. Changing this fixed-policy limitation requires a separate reviewed grant/revocation policy, not a shorter token with accidental early ejection.

Use the existing fixed/manual policy frozen at creation. Manual calls keep running beyond the admission reservation horizon and may exceed the allowance, matching existing owner policy; warn at 75/90/100 percent and block new admission. A 30-minute call is possible only under verified manual policy. Activation must not silently change the operator's duration policy.

Simplest group end rule: fewer than two after grace, or an authorized explicit end. It avoids host transfer, treats participants consistently, and avoids leaving a lone participant consuming media indefinitely once absence is actually confirmed.

## 6. Ring delivery and multiple devices

1. The request transaction writes call + roster + event + reservation + free-profile claims before delivery. Use the existing private per-profile realtime topics for wakeups, followed by authorized current-state reads.
2. Enqueue existing call-push delivery rows for every other member's enabled, unexpired, current-session devices on the verified tenant origin. Eight people permit at most seven recipients × ten enabled endpoints = **70 initial push deliveries**. Keep bounded ten-item batches, idempotency and existing worker recovery. Start fanout immediately after the roster transaction, not before participant rows exist.
3. Busy users are included in delivery but not interrupted: show “Group call in progress — you are already on a call”; no second ringtone, microphone capture, automatic hangup or queued automatic join. The other call remains primary. Joining requires an explicit action once their claim is free.
4. An atomic accept/late join wins one session/device lease for that profile. Increment participant/root versions, suppress pending deliveries for that person, and broadcast their updated state. Other open devices refetch, stop the ringtone, close the incoming panel and show “Answered on another device.” Other invitees keep ringing.
5. Service worker/browser notifications use the same opaque call ID/version and generic lock-screen text. On state refresh, close matching notification tags with the service worker's notification API. A stale notification click always rechecks the server and cannot obtain media or restart a call.
6. Offline/suspended devices cannot be guaranteed to clear an OS notification instantly. Realtime/push are best effort, and browser permission/PWA/OS restrictions affect audible ringing. Keep the in-chat Join bar as the durable recovery path; do not claim native telephone delivery guarantees.
7. Caller cancel/end, own decline, deadline, revocation or winner on another device stops that person's ringing after authoritative refresh. No repetitive ring when a dismissed/missed member sees the Join bar. Retry state reads with existing bounded recovery, not a fast poll per group member.

Reuse notification opt-in and sound preference controls; starting a call does not enroll any device. The initiator's other devices show call-on-another-device status, not an incoming self-call.

## 7. Cost, reservations and reconciliation

Daily's billing basis for this design is participant time. For everyone present for the full call:

| Call length | People | Participant-minutes | Participant-seconds |
| --- | --- | --- | --- |
| 30 minutes | 2 | 60 | 3,600 |
| 30 minutes | 5 | 150 | 9,000 |
| 30 minutes | 8 | 240 | 14,400 |

A late join or early departure contributes its actual time. Muted microphones and cameras off do not establish zero usage. These are arithmetic examples, not a currency quote, free-tier promise, or change to the current maximum duration.

### One allowance, separate reporting

Reserve team calls against the same `ticket_call_reservations`, account allocation, tenant cap, unknown usage, concurrency/monthly/history controls and global call lock used by client calls. There is no team-only budget that can bypass a client-call refusal. Add report categories Client / Team direct / Team group, with participant-minutes, connected minutes, conservative holds and unmapped usage labeled distinctly. Unknown account usage stays account-wide rather than falsely assigned to Team.

Replace the two-person multiplication **for team calls only** with capacity × elapsed seconds. Add a capacity-aware month-slice helper while retaining the existing two-argument wrapper for client compatibility. Initial team reservation covers 15 minutes for the **entire frozen roster**, including unanswered/busy people who may join later. This is intentionally conservative. Extend manual holds by frozen capacity until trusted termination/settlement. UTC rollover uses the same clipped month slices.

The current reservation bound is based on two people for 31 days. Team reservations need a finite eight-person bound: 8 × 31 × 86,400 = **21,427,200 seconds per month**. Client bounds/behavior remain compatible. Do not shrink a hold on browser Leave, room deletion, or incomplete provider data.

First and late joins to reserved roster slots do not charge the same reserved capacity twice. Freshness and authority remain mandatory. Existing active manual reconnection does not create a new call or free budget.

### Provider and evidence changes required

- Pass exact frozen capacity through room creation, SQL/JS verification, presence/probe/ejection and cleanup. Replace `presence?limit=2` for groups with a bounded capacity-aware read and require reported total to equal complete returned data; never interpret a truncated response as empty. Reject foreign IDs/rooms/duplicates. Client rooms still require two.
- Bind a trusted meeting to the deterministic room, call kind, roster and provider user IDs. A group `max_participants > 2` is mapped only within its frozen capacity. An unknown participant, malformed interval, excessive count or unexpected room stays unmapped/conservative; never silently drop the extra participant's cost.
- Preserve PR #123's end envelope: greatest of accepted time, policy-correct meeting end and **maximum leftAt over all intervals**, not the last array element. Preserve fixed-policy clipping and full manual duration.
- Preserve meeting-local exception rollback for only expected 22023/42501 ingest rejection. Keep the conservative bound, seen-not-verified record, cursor advancement and completion. Unexpected errors still abort the page. Do not catch every exception and report success.
- Sum participant-session intervals for billable time across **all** roster members and rejoin sessions. Deduplicate exact evidence/meeting/session identities; conflicting replays fail. Do not union two genuinely billed simultaneous sessions to hide cost.
- Derive group connected duration from periods with at least two **distinct profiles** present: merge each profile's ranges, sweep timestamp deltas, sum segments with count ≥ 2. Existing caller/callee intersection stays for client/direct behavior. Initiator absence cannot erase a conversation between other members.
- Preserve 128 intervals per bounded evidence unit, 32 KB provider/DB page limits, 10 meetings/page and existing per-request timeouts. Eight members can still create more than 128 sessions over repeated joins. Oversize/truncated evidence must retain holds and surface an actionable reconciliation failure; no array slicing or arbitrary limit increase. Fitting more sessions requires a separately reviewed paged-ingestion change.
- Settle only after the call has ended, all join grants are closed, cleanup has proven media empty/room absence, and a complete authoritative account scan covers the required cutoff and visibility delay. Retain conservative usage when history omits a short join or meeting. One meeting's end is not proof that a reused room cannot have another meeting.
- Keep cleanup and due reconciliation operational when **admission is OFF**. The current route skips usage when the app flag is OFF, and scan claiming requires enabled/media flags. Phase 1 must narrowly permit trusted due-work scans for existing unresolved calls/holds with verified provider configuration even when admission is disabled. It must never re-enable environment flags, create rooms, place calls or release unknown holds as a consequence.
- Preserve singleton WHERE guards, owner/ACL/SECURITY DEFINER/search-path checks and migration drift guards from the existing maintenance/evidence repairs.

Daily documents returned presence limits and token-defined user IDs in [room presence](https://docs.daily.co/reference/rest-api/rooms/get-room-presence), short room-bound grant controls in [meeting tokens](https://docs.daily.co/reference/rest-api/meeting-tokens/create-meeting-token), and meeting/participant timing and short-join omissions in [meeting history](https://docs.daily.co/reference/rest-api/meetings). These support the conservative design, not a proof of current provider/account behavior.

### Proving the one-hour gate stays healthy

Do **not** move the freshness timestamp, widen the one-hour window, or certify a partial scan to make calls work.

Future automated acceptance must combine call kinds in one account scan; include eight-person history, rounded endpoints from test 211, expected/unexpected ingest failures, duplicate/oversized pages, cursor replay, UTC rollover, unknown foreign rooms, missing/partial presence and cleanup with admission OFF. Assert the gate is false with old usage, remains false after an uncertain/failed/partial scan, and becomes eligible only after genuine qualifying scan completion plus all other existing checks.

During a separately authorized rollout, observe the existing scheduled worker rather than manually resetting scan state. Record counts/timestamps only: cursor progress, latest successful page/completion, ongoing flag, unmapped seconds, oldest unresolved cleanup/hold, usage age and manual-heartbeat age. Verify actual function definitions/ACLs/owners and migration ledger include the PR #123 repair before activation. A healthy HTTP response alone is insufficient.

Operational review thresholds: worker absence approaching ten minutes needs attention; usage age at 45 minutes needs investigation before the one-hour admission cutoff. Use existing operational monitoring; no new paid monitor or CI job is authorized by this design. Observe both a completed call/scan and a subsequent scan cycle before broadening a pilot.

**Known policy limit:** the current scanner does not refresh usage when any meeting in the account scan is ongoing. A long manual call or overlapping calls can therefore legitimately make usage stale and block new calls/first-time late joins even if page progress is healthy. Preserve this fail-closed rule in both phases; explain the refusal. Continuous fresh certification of known active rooms is a separate accounting-policy change requiring owner/reviewer approval, not an implicit part of group calls.

## 8. Screens and interaction

This extends the existing Operate-mode UI: navy call stage, restrained gold primary answer/start actions, current typography, CSS Modules, Lucide icons and current chat composition. No replacement design system or parallel Inbox.

| Surface | Placement and behavior |
| --- | --- |
| Direct chat header | In `TeamConversationView` header actions beside existing Settings/Search: labeled Audio call and Video call controls for Owner/Admin only, using server `canStart`. Disabled/pending state prevents double submission; a transient error leaves the chat/draft intact. |
| Group chat header | Same position in Phase 2; show group size and clear “Calls support up to 8 members” when larger. No member picker. Eligible Owner/Admin calls everyone; role alone cannot bypass group membership. |
| Manager/Staff | No start, redial or callback button in header, history, incoming panel or ended-call screen. They see Answer/Decline when invited, Join on an active eligible group, and Leave in media. No misleading disabled start button. |
| Incoming screen | Reuse `CallScreen` / `PortalDialog` call layer, `Portrait`, `startCallRingtone` and `CallPrepare`. Direct: caller identity/mode. Group: caller + group name + “Group audio/video call”. No live microphone/camera until explicit acceptance/preparation. Escape declines only the viewer's invitation. |
| Join bar | Sticky below the existing conversation header and above pins/search/timeline: “Call in progress · N joined” + Join; audio/video icon and optional elapsed time. Visible after missed/declined/busy while active and eligible. For someone already connected: “You are in this call” + Return to call. Busy/permission/freshness errors explain why joining is unavailable. |
| Active call | Reuse preparation, device selection with `AnimatedSelect`, mic/camera controls, minimized strip, budget warnings, audio playback recovery and focus/portal behavior. Extend media state from one remote track to a profile/session-keyed participant collection. A group needs an audio sink per remote stream and explicit cleanup of every track/listener; reusing only the first remote track would mute other people. |
| Video layout | Two people: current remote stage + local preview. Three/four: balanced 2-column grid. Five/eight: desktop grid up to 3 columns; narrow screens show a focused tile and explicit thumbnail/page controls rather than eight unreadably small tiles. Every person has name, camera-off avatar, mute state and reconnect state. Local video stays muted; remote audio is not duplicated by tile reordering. No automatic focus stealing when speaker changes. |
| Group controls | Everyone: Mute, Camera for video, Device settings, Leave. Current Owner/Admin members additionally get a clearly separate “End for everyone” menu action with reused confirmation dialog; Leave is always available. No host badge implying that departure ends the group. |
| Team history | Inline typed call cards beside chronological messages, as described above. Opening ended history shows outcome and duration; it never starts a new call. |

Reuse `InboxCallProvider` in `src/components/shell/internal-shell.tsx`, one call controller/device identity per shell, `call-signals.ts`, `call-notifications.tsx`, `public/push-sw.js`, shared `PortalDialog`, avatar primitives and current animation/focus conventions. Separate team DTO/service authority from the legacy client DTO; presentation reuse must not introduce an account-class toggle that grants client access.

Use one shared active-call arbiter so the Team drawer cannot open a second media object over a Ticket/Order call. Do not keep the existing provider's unconditional `pagehide → end entire call` behavior for groups: navigation/disposal releases own media/attendance only, and maintenance confirms absence. Minimize must not leave; closing an ended dialog returns focus to the initiating chat control.

Future rendered acceptance: 320, 360, 390, 430, 768, 1280 and 1440 px; open device menus and end confirmation, long names/group titles, eight people, camera-off, reconnecting, denied permissions, autoplay-blocked sound, browser zoom, keyboard and screen-reader checks. Preserve focus-visible, labels, Escape/focus return, reduced motion, minimum 44 px action targets and viewport-safe sticky controls. Fix flex/grid minimum widths and wrap content; do not clip important controls to hide overflow. No UI rendering or real device test was performed during this design.

## 9. Delivery plan for a later authorized implementation

These are proposed work packages and acceptance criteria, not permission to execute them. Do not create another plan file in this design PR. Assign migration timestamps only when implementing against then-current main; never edit historical migrations.

### Phase 1 — direct calls only; one PR, one release

**Migration set within that PR:**

1. `<timestamp>_team_call_foundation.sql`: call-kind/team-target/composite-FK constraints, team participant rows, direct-only creation guard, operator-owned per-tenant `private.team_call_rollout` with `direct_enabled=false` and `group_enabled=false`, indexes, RLS/ACLs and exact role/session/support/member authorization.
2. `<timestamp>_team_call_direct_delivery_accounting.sql`: direct lifecycle, cross-kind busy/record/rate/budget checks, team history/entry projections, shared signal/device/push eligibility, owner-only categorized usage, authority-revocation hooks and narrowly scoped due-work maintenance under admission OFF. Provider capacity remains two for every enabled kind.

The phase flags are admission flags, including first-time join, not cleanup switches. They are operator-only; no browser configuration RPC. No group start is permitted even if a caller manually changes a request payload.

**Files to create:** `src/domain/team/calls.ts`, `src/services/team-call-service.ts`, `src/app/api/team-calls/route.ts`, `src/app/api/team-call-media/route.ts`, `src/components/team/team-call-controls.tsx`, `src/components/team/use-team-call-history.ts`.

**Files to adapt:** `src/services/ticket-call-provider.ts` (claim-based shared provider dispatch); `src/lib/daily/{calls,provider,reconciliation}.ts`; `src/app/api/internal/ticket-call-maintenance/route.ts`; existing call events/push routes and push context; `src/app/calls/[callId]/page.tsx`; `src/domain/tickets/call-entry.ts`; `src/components/calls/call-controller.ts`, `call-provider.tsx`, `call-screen.tsx`, `call-notifications.tsx` and `call-signals.ts`; `src/components/team/{team-conversation-view,team-messages-drawer}.tsx`, existing call/team CSS modules and history rendering; `public/push-sw.js`; generated `src/lib/supabase/database.types.ts`. Reuse Team action/service/repository architecture where projections are carried; keep `team-messages.ts` mutation authority unchanged. No workflow or cron edit is needed.

**Tests to add in that implementation PR, before implementation:**

- pgTAP `<next>_team_direct_calls.test.sql`: Owner/Admin start; Manager/Staff direct RPC request and replay denied; delegated group admin not a start grant; client/nonmember/foreign-tenant/dual-tenant/inactive/profile/pilot failures; support-context and active-support-session denial even without header; direct roster exactly two and group refusal.
- pgTAP `<next>_team_call_shared_controls.test.sql`: interleaved client/team profile claims and budget admission in separate transactions; exact idempotency conflicts; no new room/token before valid claim; post-lock revocation; self-cleanup without disclosure; one winning device; stale account/manual heartbeat; cap/history/rate limits shared; maintenance continues under OFF and cannot enable calls.
- Vitest `team-call-service.test.ts`, `team-call-route.test.ts`, `team-call-media-route.test.ts`, `team-call-controls.test.tsx`, `team-call-history.test.tsx`: strict schema, same-origin/body/no-store/support boundaries; token authority/generation recheck after provider work; correct entry; no Manager/Staff callback anywhere; no second media object; cross-device answer and stale push.
- Extend existing `ticket-call-{service,route,provider,provider-boundary,reconciliation,push,history}.test.*`, `call-events-route.test.ts`, `call-push-worker.test.ts`, `call-controller.test.ts`, `call-screen.test.tsx` and existing SQL call suites, particularly 199/201/207/211. Pin unchanged client behavior and PR #123's repaired rounding/fallback. Reuse the existing isolated CI facilities; no new rig/job/database is authorized.

**Release order, after a separate concrete release approval:** refresh/review the one PR against main; run normal full Vitest, typecheck, lint, production build and existing isolated pgTAP/RLS/transport checks; verify backup/recovery evidence and actual schema/function/settings/pilot/provider controls read-only; apply additive migrations with both team flags OFF; deploy the matching app/maintenance; verify trusted scheduled work and unchanged client calls; then explicitly enable direct calls for the approved tenant/pilot only. Verify an answered direct call, decline/miss/busy, both devices, cleanup and two scan cycles before declaring Live. Do not silently widen an existing two-profile pilot to satisfy “any team member.”

**Kill switch:** `team_call_rollout.direct_enabled=false` stops new direct invitations and first-time admission; preserve authorized active calls while draining. Existing tenant/global/media switches remain emergency termination controls. Keep cleanup and reconciliation enabled and observable.

**Rollback:** turn direct admission OFF; drain or explicitly end team calls with compatible workers; prove issued grants closed and cleanup/holds reconciled; retain schema, events, history and accounting. Roll back application only to a version compatible with remaining durable work. Never revert the shared ledger, drop participant rows or reset freshness/claims to restore service. Phase 1 is not complete until direct-call acceptance is reviewed; Phase 2 is not bundled into its release.

### Phase 2 — group calls; separate PR and release

**Migration set:** `<timestamp>_team_group_call_participants.sql` enables the group branch and complete-roster snapshot, per-person invitation/device/leave/revocation semantics and one-live-conversation index; `<timestamp>_team_group_call_accounting.sql` generalizes capacity-aware month holds/bounds, group overlap, provider evidence mapping, presence/departure/cleanup and fanout. Group flag remains OFF throughout deployment. Phase 1 data and client rows are not backfilled into invented groups.

**Files:** extend the new team domain/service/routes/history/controls and existing shared provider/reconciliation/maintenance/push/signal paths named in Phase 1; add `src/components/calls/call-participant-grid.tsx`; extend `call-media.ts`, `call-provider.tsx`, `call-controller.ts`, `call-screen.tsx` and call CSS for collections, audio sinks, Return/Leave/End-for-everyone; add `src/components/team/team-call-join-bar.tsx`; integrate it in the existing conversation view/drawer. Regenerate DB types. Avoid renaming the entire ticket-call subsystem in this phase.

**Tests:**

- pgTAP `<next>_team_group_calls.test.sql`: 3/5/8-person snapshots; nine-member refusal; every member gets invitation rows including busy; client/foreign/pilot member makes creation fail; late joins after miss/decline/busy; added/removed/re-added membership; per-person device races, claims and lease generations; stale same-device Leave and token completion after rejoin cannot affect the new lease; another member's root-version update does not revoke it; initiator leaves/demotion, Manager/Staff cannot start/callback/end-all, Owner/Admin nonmember cannot end-all.
- pgTAP `<next>_team_group_call_reconciliation.test.sql`: exact 2/5/8-person arithmetic and month split; call continues without initiator; at-least-two connected duration; repeated joins; finite enlarged holds; unknown/duplicate/foreign/rounded/oversize evidence; PR #123 error-isolation and unexpected-error rollback; unknown presence not empty; manual departure after its short-grant boundary versus fixed departure held to call expiry, targeted-ejection fallback, cleanup under OFF; ongoing-scan freshness remains fail closed.
- Vitest `team-call-group-lifecycle.test.ts`, `team-call-join-bar.test.tsx`, `call-participant-grid.test.tsx`, plus existing media/provider/push/controller suites: independent ring states while root active, all-device stop for one answer, busy noninterruption, multiple remote audio/video streams, every-track cleanup, leave versus end, minimized/navigated group retention, no stale notification restart, accessible roster/device controls.
- Use the existing concurrency/transport acceptance path to prove two-device accept, simultaneous join versus another call, membership removal versus grant, and end versus late join at the DB boundary. Real device 5/8-party audio/video and OS push acceptance needs separately authorized participants/environment; fixtures are not proof of device performance.

**Release order:** complete and review Phase 1 first; run expanded full existing checks on a fresh main base; independently verify current hosted controls/backups and maintenance capacity; apply group migrations with group flag OFF; deploy compatible UI/provider/worker; verify client/direct compatibility and 3/5/8-person accounting/cleanup through approved acceptance; enable group calls only for the approved scope, observe complete settlement and subsequent scan, then expand by explicit approval. No new CI job, paid service, workflow or schedule is assumed.

**Kill switch/rollback:** set group admission OFF independently of direct/client calls; preserve group-capable maintenance, late-join denial, departures and end-for-all until all groups/grants/cleanup drain. After verified settlement, application rollback may retain Phase 1. Keep group schema/history/accounting. An old two-person cleanup worker is **not** a safe rollback while any group work remains. If quality/cost/scan health is unacceptable, leave group flag OFF and return the findings to the owner.

## 10. Risks and owner questions

These are recommendations for review, not reasons to begin implementation.

| Question / risk | Recommended answer |
| --- | --- |
| Eight people use the allowance four times as fast as two. | Cap at eight including initiator; one shared allowance with separate Team reporting. Do not increase allocations in this feature. |
| A group larger than eight cannot both ring everyone and admit the entire group. | Refuse the call and explain the eight-member limit. Do not pick recipients or leave an invisible waiting room. |
| Who can stop a group? | Any current tenant Owner/Admin who belongs to that chat. Everyone else can leave; initiator departure does not stop others. |
| How long can calls run? | Preserve the current fixed/manual operator policy and its existing warning/overrun behavior. Do not silently impose a new hard budget disconnect or enable manual policy. |
| A long/overlapping call can keep usage verification stale. | Retain fail-closed admission. Treat continuous active-room certification as a separate accounting proposal if this restriction is unacceptable. |
| Someone joins the chat after the call began. | Let them see permitted history, but wait until the next call to participate. Remove/revoke immediately on departure; do not regrant this call after re-add. |
| Push/OS/browser restrictions mean some devices will not audibly ring. | Offer realtime plus opted-in Web Push and a reliable in-chat Join bar. Require actual-device acceptance; promise best-effort delivery. |
| Member/session revocation can precede provider-token expiry or verified ejection. | Short grants, explicit departure tracking and fail-closed room termination on unverified ejection. Do not promise instantaneous provider silence. |
| History/evidence is coarse and can omit short joins; oversized responses can block progress. | Retain conservative holds, report the failure and refuse new admission when freshness expires. Do not discard intervals or weaken the gate. |
| Shared changes could affect client calls. | Kind-specific checks and mixed-kind regression/concurrency tests; keep Phase 1 small enough to review, then group release separately. |
| Live settings, billing guard and current schema are not verified here. | Make read-only preflight and existing provider spending-control evidence release prerequisites. This design authorizes no hosted reads or changes. |

## 11. Design acceptance and handoff

The owner/reviewer should approve or amend the recommendations in sections 1, 3, 5, 7 and 10 before any implementation. The delivery endpoint of this task is this single file in a **draft PR**; no merge, build or implementation follows.

Design verification is source review, requirement coverage, Markdown/local-link checks, a single-file diff check and a fresh builder/security review. Application tests, pgTAP, build and rendered/device acceptance are **future phase gates**, not tests claimed for this document.

Steward proposal for the PR description: record this as Planned / In PR with its actual PR number after creation; no Live status, new decision/security ID, or changed architecture/control claim. Update the already-existing task Implementation Log entry rather than appending a second entry, as the owner requested on resume.
