# Custom Inbox voice and video calls — candidate

Owner approved the custom screen, in-app ringing, closed-app push and implementation plan on2026-11-03. Existing worktree/PR76 reused. No production or Studio migrations/settings, real calls, customer messages, Docker on this PC or deployment are authorized in this slice. Calling stays OFF.

## Result and boundaries

- A preparation dialog identifies the server-selected person and checks microphone/camera only after a user click. Video has a local preview. Cancel stops preview tracks and creates no invitation or room.
- A shared shell controller preserves a call while navigating. Custom voice/video stages, participant avatars/fallback, observed microphone activity, truthful device controls, mute/camera, reconnect, minimize/reopen, End and accessible audio recovery replace Daily Prebuilt.
- One chosen recipient,40-second ring,45-second connection deadline and fixed15-minute expiry remain. Presence is confirmed from Daily by a separate session/device-bound probe, without consuming token attempts.
- In-app hints and closed-app push use existing HttpOnly authentication and payload-free Web Push. Only opaque call ID/version enter the service worker. A notification click rechecks current authority and cannot auto-answer. Existing drafts/windows are focused without navigation.
- There is no app-wide recurring call poll. Only fixed-lifetime calls poll; unavailable conversations stop their optional live-hint lane. Focus/online recovery is event-driven. Ordinary notification polling and push remain intact.
- Separate private call-device/delivery tables avoid implicitly changing ordinary message alerts. Call delivery needs a separate Edge flag; expired or uncertain pushes are not blindly retried.

## Accounting decision after review

Daily history is approximate, has timestamp granularity and can omit short joins. It must not be treated as exact billing or zero-use proof. Product calls keep their FULL worst-case reservation as conservative finalized usage. Busy claims release only after immutable expiry and verified room cleanup, including rooms with no meeting history. Display history cannot erase a stronger presence-confirmed answer. Interval IDs are scoped by meeting and participant.

Admission additionally requires a current operator verification that the Daily account is exclusive to this controlled integration. Unknown ongoing or current-month foreign rooms trip the admission/exclusivity fuse. Partial/uncertain scans do not refresh allowance. A provider-side hard spend cap remains an external activation gate (F9); application controls do not establish a provider billing guarantee. Existing600 test/5400 live/6000 combined participant-minute allocations remain.

Sources checked: [Daily meeting-history semantics](https://docs.daily.co/reference/rest-api/meetings), [meeting-list schema/pagination](https://docs.daily.co/reference/rest-api/meetings/list-meetings), [room presence](https://docs.daily.co/reference/rest-api/rooms/get-room-presence), [eject API](https://docs.daily.co/reference/rest-api/rooms/session/eject).

## New migration order — unapplied to hosted databases

After the three original PR76 migrations:

1.20261103114405_ticket_call_interface_delivery.sql — scoped current/peer projection, separate call-device bindings, durable invitation pushes and bounded recovery.
2.20261103120613_ticket_call_provider_reconciliation.sql — exclusive-account default-OFF guard, durable scan lease/page, conservative settlement, token-free presence authority and preparation projection.

New pgTAP195/196 cover privacy, grants, subscriptions, expiry, push deduplication, zero-history/multi-call conservative settlement and presence/token quota. They must pass against disposable Supabase before rollout. JavaScript tests do not substitute for RLS/PostgREST checks.

## Validation evidence

Evidence directory: outputs/inbox-calls-20261103 in the shared task workspace. Preliminary full Vitest run:4480/4480. Subsequent targeted regression runs and final exact-head checks are recorded in execution-ledger.md and JSON/log receipts; do not treat earlier foundation CI as a fresh pass.

Type generation and guarded full typecheck passed locally with a1536MiB heap after fixing three test typing errors. A prior768MiB typecheck exhausted its heap; this was not a source pass. The full Next build retains its5.5GiB free-RAM guard and is intended for disposable CI if unavailable locally.

Actual component layout was captured in an isolated synthetic fixture at320/360/390/430/768/1280/1440. No horizontal overflow; Answer, device menu, mute/unmute and minimize/reopen were exercised. Screenshots prove layout only, not real media or backend acceptance. Browser plugin unavailable; installed Chrome/Playwright used with external requests blocked. The fixture server/browser are closed after capture.

Review caught and source fixes cover: zero-history busy lock, completion receipt collisions, presence consuming token quota, cross-meeting interval keys, maintenance deadline overrun, stale acceptance/media resurrection, stale notification interruption, dropped concurrent hints, disabled idle requests, inaccessible autoplay recovery and live-region countdown announcements. Final review/tests remain authoritative.

## Isolated activation and manual acceptance

Do not merge or enable production from this document. Use a disposable/local CI database; no hosted project connection is supplied. This branch disables its own automatic Vercel deployment through git.deploymentEnabled, leaving other branches unchanged. [Vercel branch configuration](https://vercel.com/docs/project-configuration/git-configuration).

Before a real device test, verify the isolated project/verified origin, two synthetic identities, independent media endpoints, existing account/domain and6000-minute allowance, exclusive-account proof, emergency controls and provider spending gate. Do not alter William, clients, RojanCRM, roles or billing. Enable only isolated settings after separate concrete authorization; no card, paid upgrade or webhook purchase.

The app flag is DAILY_CALLS_ENABLED=1 with server-only Daily key/domain, plus guarded database environment/Tenant configuration. Call push additionally requires TICKET_CALL_PUSH_ENABLED=1 on the existing Edge worker and its verified VAPID configuration. Neither is enabled here. The maintenance route is prepared but no new hosted or Vercel provider schedule is enabled; activation must arrange bounded trusted maintenance with counts-only receipts and verified auth.

Manual two-person checklist:

1. Use only synthetic owner/team and owning-client identities on independent endpoints; privately grant media permissions. Two tabs alone do not prove quality.
2. Open a synthetic Ticket. Prepare voice: verify selected person, check microphone, Cancel; confirm device indicator stops and no call exists. Repeat video preview/device selection.
3. Voice both directions: invite, answer, real two-way speech, mute/unmute and device change. Verify camera never turns on. Decline, cancel and40-second missed call separately.
4. Video both directions: real remote/local video, voice, camera off/on, device selection and autoplay recovery. Connection must remain past45 seconds after verified two-party presence.
5. Minimize, navigate, reopen; preserve an unsent conversation draft. Repeated clicks create one invitation; another device cannot steal the winning lease.
6. Test temporary offline/reconnect, revoked Ticket/session, stale notification and late permission completion after Cancel. Devices must stop on End; late work must not restart them. End remains usable when new calling is disabled.
7. Explicitly opt in only the tester's device. Check visible/in-app and closed-app generic notification, click with current/expired login, old ended invitation and another currently active call. No auto-answer or private push text. Check the OS banner/notification center directly; provider acceptance alone is insufficient evidence.
8. Confirm immutable15-minute ejection, conservative budget reservations, separate release of busy claims after verified cleanup, revoked device suppression and the emergency admission fuse.

Native lock-screen calling and continuous background ringing are not promised. Browser/system permissions, suspension, offline state and platform support affect delivery.

## Rollback and memory

Keep admission and call-push flags OFF; preserve provider expiry/cleanup and usage ledgers. An app rollback must not delete reservations, frozen participants or uncertain receipts. Do not destructively reverse migrations holding call history.

Canonical Obsidian notes remain read-only under D-319. A separate steward proposal accompanies the evidence; no .ai-memory, sync hooks or Raw writes were created.
