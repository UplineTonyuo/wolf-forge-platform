# WOAD Ticket calling and Inbox follow-ups

Local implementation on `codex/woad-ticket-call-followups-20261104`, based on verified main `c37dba4cd6a010a217ae717347ff4cfae801a1eb`. No push, deployment, hosted migration/configuration, Docker, real calls/messages, membership/assignment changes or vault writes. The November 3 final release report supersedes earlier pending-release text in the original design/plan. Historical production QA does not validate this follow-up.

## Explicit routing decision — November 4

The client's deliberate selection of **one** currently eligible internal person who personally saved **this** Ticket supersedes assigned-person/configured-fallback routing for client-initiated calls. Team-to-client calls still select the owning client on the server. A browser-supplied recipient is a proposed target, never authority: the database validates it before admission, protects the saved row during admission, binds replay to that recipient, and checks membership/access throughout commands, media and push delivery.

The repository had no per-user Ticket Inbox membership; its only durable fact was global `tickets.inbox_added_at`. The new private Ticket/profile membership starts empty. No historical timestamp or assignment is interpreted as a personal save. Existing authorized legacy Inbox visibility remains intact: internal reads project `inbox_added_at` from the legacy timestamp or the viewer's personal save, and expose `personal_inbox_added_at` separately. A legacy-visible Ticket retains View in Inbox and offers Save to my Inbox until that viewer deliberately saves it. Explicit saves are required only to become a call candidate; they are not required to recover existing Inbox visibility. Stored Tickets/messages/global timestamps remain unchanged by a personal save.

## Inbox compatibility correction

The initial unapplied follow-up migration filtered Inbox rows only by the new empty personal table and replaced the visible timestamp with the viewer's save. That would hide existing shared Inbox Tickets. The corrected filter admits a legacy timestamp **or** the viewer's personal membership, but only over the original authorized Ticket reader. Global visibility never populates personal membership or candidate eligibility. New personal-only saves do not create global visibility for other teammates.

SQL198 now prepares legacy/no-saver visibility, separate summary/detail facts, client privacy, explicit and duplicate saves, nonempty public-message/internal-note preservation, full Ticket-row preservation, independent savers/singular recipient, personal-only isolation, revoked access and cross-workspace rejection. These database cases remain unexecuted until an authorized isolated backend is available. UI regression tests exercise the actual management page, including legacy View plus Save, read-only legacy visibility and the personal saved state. Fresh results for this correction live in the parent project's `outputs/call-followups-20261104/compatibility/`; the earlier 4,528-test evidence is historical for the prior snapshot.

## Causes established from the released source

- `InboxCallProvider` already mounted once in each shell. Its idle controller had no event transport beyond optional push, initial/focus/online reads and an open Ticket's live events. A closed drawer therefore had no timely wakeup while the call-push worker flag was OFF/unset. Existing 60-second closed-drawer/notification polling cannot reliably cover a 40-second invitation. No new idle polling was added.
- Ringtone creation required `navigator.userActivation?.hasBeenActive`; an unsupported activation API suppressed it entirely. Autoplay could also keep a new audio context suspended without an incoming-card recovery action. Sound still requires browser cooperation and the existing sound preference.
- Call controls were standalone bars outside the internal drawer's actual subject/reference header and the client's Conversation header. The nested internal conversation header is intentionally hidden by the drawer composition.
- The ordinary PortalDialog layer was 9600, below the Inbox's 11900 and its menus. A z-index alone also cannot cover an existing native modal. The call variant now promotes the same PortalDialog treatment into a native top-layer dialog with explicit fullscreen positioning, dim/blur backdrop, focus/scroll/inert ownership and reduced-motion rules.
- Authoritative history already existed in `private.ticket_calls` / `app_ticket_call_history`, but neither conversation rendered it. Missed notifications linked internal users to `/tickets/<id>`, which is the management inspector.
- Public-response direction was not projected into Ticket Inbox rows. The client reply editor's minimum was 136px.

These are source and synthetic-test findings. No actual two-person ringtone, remote media or OS delivery pass is claimed.

## Changes by requirement

| Requirement | Implementation |
| --- | --- |
| 1. Internal controls/ringing | Icon-only Voice/Video beside the drawer's subject/reference; existing shell controller receives authenticated event-driven wakeups on every internal route. |
| 2. Client controls | Voice/Video moved into Conversation header; standalone bar removed. Accessible names, titles, focus and 44px targets retained. |
| 3. Incoming card | One centered PortalDialog call variant, caller photo/initials, current role/name and mode; explicit Answer/Decline. Escape declines; cancellation/deadline/terminal state release ringtone/media. Native top layer covers open drawers and native confirmations. |
| 4. Selected teammate | Private personal saves separate from compatible legacy Inbox visibility; bounded authorized candidates with roles/photos; one-person preselection, explicit multi-person choice and clear empty state. Strict single recipient ID and independent database/lifecycle checks. |
| 5. History | Named call records merged chronologically with public messages, separate from chat messages/reactions. Bounded keyset pages, deduplication and stale/revoked-read eviction. Missed/declined/canceled/ended remain distinct. |
| 6. Notification destination | Existing and future missed bells use `/tickets/<id>?inbox=tickets&ticket=<id>` or `/account/messages/<id>`. Opaque call entry also follows the internal Inbox deep link. Existing authorization and draft-preserving selection remain. |
| 7. Default alerts | In-app visual alerts need no notification opt-in. Browser setup lives in existing Profile/notification settings; prompts require a gesture. Both settings share one enrollment and preserve the endpoint when either delivery class is disabled. Only authoritative foreign ownership permits a gesture-driven reset; uncertain failures never rotate it. |
| 8. Unanswered | Latest public human client message, ordered like Orders. Reads, notes, reactions, guest/system authors and call events do not reply. Existing gold Unanswered treatment/icon is separate from unread/missed calls. |
| 9. Reply box | Ticket-client-only minimum reduced from 136px to 96px (approximately 3–4 lines); existing growth/max-height, drafts, files, voice and send rules retained. |

## Delivery and authority

One visible shell event stream bridges private Supabase Realtime broadcasts to a same-origin SSE route. The server authenticates using the existing HttpOnly session; its bearer token stays server-side. The broadcast and SSE wakeup carry no Ticket, participant, message or media data. The one controller freshly reads authorized call state. Connections stop on hidden/offline/unmount, expire before token expiry and reconnect with bounded failure backoff; explicit disabled events stop retries. Ordinary conversation/Team polling schedules are unchanged.

Migration `20261103161636_ticket_call_inbox_followups.sql` preserves call budgets, reservations, fixed deadlines, participant limits, session/device binding, cleanup and reconciliation. It adds per-user saves/read projections, selection/replay/lifecycle checks, private broadcast policies, named history and corrected links. It also makes a ring-deadline-triggered end/cancel authoritative `missed/ring_timeout`, rather than a fabricated user cancellation. Push status and delivery claim eligibility check removed saves immediately, before the deadline sweep. No already-applied migration was edited.

Message and call push retain separate server opt-ins over one browser endpoint. Registration ownership is checked against both stores. Setup can classify a foreign endpoint without returning its old owner; it does not rotate on a generic failure. Disabling one class does not unsubscribe the shared endpoint or close the other class's notifications.

## Separate call-push limitation

The November 3 final release report last verified production `TICKET_CALL_PUSH_ENABLED` **OFF/unset**. `supabase/functions/studio-web-push/index.ts` still dispatches calls only when it equals `1`. No hosted flag was read back or changed in this local task. Removing the conversation toggle does not enable closed-app delivery. Browser/OS consent, platform support and a separately configured worker remain necessary; actual OS delivery/click acceptance is still pending.

## Acceptance and rollout gates

- Run new SQL198 plus changed SQL074/170–173/195/197 and the updated concurrency fixture against an authorized isolated Supabase target. No verified isolated local backend was running here; SQL compilation, grants/RLS, actual Realtime/SSE transport and database races are not passed by Vitest or source review.
- Run the full build where the existing 5.5 GiB free-RAM guard permits it. No unrelated apps/services may be closed to force it through.
- Coordinate migration and matching application rollout after acceptance: the legacy four-argument client admission path intentionally no longer auto-routes. Keep the exact existing pilot pair; require explicit personal saves, and verify candidate permissions without changing real assignments to make fixtures.
- Verify private Realtime broadcast availability, SSE streaming/proxy lifetime and fresh session revocation in the deployment environment. No new provider keys, allocations or resources are needed by this source change.
- Browser/UI, actual two-person media/device release and OS notification delivery remain manual. Daily's existing provider-side spending-stop gap remains open; application budgets are unchanged.

## Short manual checklist

1. Client and internal, at 320/360/390/430/768px and desktop 1280/1440: header icons, long subject/name, photo/initials, role, open menus, 3–4-line reply box and long-message growth. Preserve a draft with file/voice state while switching/opening the same conversation.
2. Synthetic isolated zero/one/three saver cases: only currently permitted pilot members appear; one person is selected and only that person rings. Removed save, revoked role/workspace/Ticket access and forged ID fail without a second call or media lease.
   Confirm a legacy Ticket is visible to the same authorized teammates before any personal save, with View plus Save to my Inbox available. Save twice; it creates one personal save and leaves the Ticket/messages unchanged. A new personal-only save does not appear in a different teammate's Inbox.
3. Internal on another route with Inbox closed, then open, then an attachment lightbox/native confirmation open: one centered sharp incoming card; whole background blurred; Tab/focus/Escape work; cancel/decline/40-second timeout and navigation clean up sound. No microphone/camera or answer before deliberate action.
4. Separate pilot profiles/devices, both directions: voice stays camera-free; video/audio actually arrive; mute/camera/device choices/minimize/reopen/reconnect/end release devices. Test denial/autoplay recovery and a late permission result after cancellation. Two tabs do not establish media quality.
5. Missed/declined/canceled/ended history on both sides and missed links opening the exact conversation; opening/notes/reactions/call events retain Unanswered until a public team reply. Profile setup in default/denied/granted states; ordinary/call toggles and account switch preserve shared subscriptions. Closed-app OS testing is blocked until separately configured push is enabled and actual delivery can be observed.

Canonical memory and Security notes remain read-only. The delivery evidence includes a proposed steward update outside the vault; no IDs were allocated and no synchronization is claimed.

## Fresh local revalidation — 2026-11-04

The compatibility correction was already present on `codex/woad-ticket-call-followups-20261104` when this continuation began. Both recorded task sessions had completed, no competing writer was identified, and all 71 pending files were audited as unique task work against local `origin/main`. No additional application or SQL change was necessary; the existing nine follow-ups and their compatibility regression coverage were preserved.

Fresh verification on the unchanged 68 implementation/test/SQL files: **4,531 application tests / 382 files passed**, lint passed, typecheck passed and whitespace checks passed. Independent read-only source review found no confirmed Critical, Important or Minor defect. Graph provenance was checked: its `30cbee4` source is six tooling/documentation commits beyond task base `c37dba4`; the uncommitted follow-ups are absent from the graph. Indirect callers and dynamic RPC edges were checked against actual source.

The owner explicitly confirmed that no approved isolated local Supabase target has been provided. SQL compilation/lint, SQL074/170–173/195/197/198, grants/RLS, physical-connection races and actual private Realtime → SSE delivery/reconnect/revocation/cleanup remain **NOT RUN / pending**. No production, hosted Studio, Docker, new cloud resources or real-user substitute was used. Full build was skipped at 3.54 GiB free RAM, below the 5.5 GiB guard; no unrelated process was closed.

Evidence and exact remaining prerequisites: parent-project `outputs/call-followups-20261104/resume-verification-20261104/`. Canonical memory/Security remain read-only; the steward receives a proposal outside the vault. A local checkpoint is permitted after these application checks; SQL/transport and owner browser/two-person media gates remain open. No push, deployment, hosted migration or pilot change is included.
Precommit review additionally removed one extra blank line at EOF in `src/lib/notifications/browser-push-subscription.ts`. Content excluding terminal newlines is byte-for-byte equivalent; no application logic changed. The full-suite result above precedes this formatting-only cleanup.
