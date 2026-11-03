# Custom Wolf Forge calls inside Inbox

Date: 2026-11-03. Status: owner approved the custom screen and explicitly requested BOTH in-app ringing and closed-app call notifications. Product implementation and live calling are not claimed complete. Closed-app push is included in this implementation, not deferred.

## Intent and approved direction

Finish private two-person voice/video calling using PR76's invitation/accounting foundation. Replace the default embedded Daily interface with a Wolf Forge interface inside Inbox, shared by client and internal views. It should feel like the existing product, show truthful call states, and remain usable on phones.

Approaches considered: (1) recolor Daily Prebuilt, with less UI code but the same provider layout; (2) use the existing pinned daily-js SDK in call-object mode with our own controls. The owner chose (2). Reuse React, CSS Modules, Lucide, existing dialogs/selects, avatars, verified session context and guarded RPCs. No new UI framework or redesign of the rest of Inbox.

The older full calling proposal is historical. D-308's selected-callee routing, budgets, exact deadlines and privacy rules remain authoritative; do not restore ring-all, implicit Join, device takeover or the superseded platform-pwa pilot.

## What the user sees

The conversation header has accessible Voice call and Video call buttons when the server permits calling. A phone view keeps controls at least44px with visible labels or accessible names. The custom screen uses the existing navy, gold, typography, radii and focus treatments; destructive end/decline actions use the established danger color. No decorative dashboard cards or provider branding frame.

1. **Prepare:** show the selected other participant, voice/video mode and microphone/camera choices. Request device permission only after the user acts. Voice remains audio-only for the entire call, with no camera control or mid-call upgrade; this preserves the foundation's frozen mode and audio-only token permissions. Video offers a local preview and may toggle its camera off/on. Device denial/busy/unavailable errors have a concrete recovery action; no endless spinner. Cancel stops acquired local tracks and creates no provider room.
2. **Outgoing:** show the selected person's authorized photo or circular initials, “Calling…”, the fixed invitation countdown and Cancel. No room is provisioned before acceptance. Busy, refused, declined and missed are distinct outcomes; an invalid fallback says “Please send a message instead”.
3. **Incoming:** show a compact dialog with caller identity, voice/video label, Accept and Decline. A single coordinator in each app shell receives authorized signals even if another section is open. Ring only while that document can execute and audio is permitted; always show visual feedback if sound cannot play. Another session's winning acceptance stops this dialog.
4. **Connecting / active:** voice shows the participant portrait and a truthful microphone activity indicator. Video gives the other participant the main stage and a bounded local preview. Persistent controls are microphone, camera when allowed, device choices and End call. Reflect actual SDK track/device state; do not show a successful toggle before it takes effect. Use contained video with a deliberate crop policy, never distorted images. Show participant connection state and elapsed local media time without claiming it is the billing/accounting result.
5. **Connection loss:** show Reconnecting and retain the same call/device lease and immutable expiry. Do not silently create a replacement call or extend time. End call remains available. Return neutral access/ended state and stop local media immediately on revoked access or terminal state.
6. **End:** stop media tracks, sound, listeners and pending work. Show the server outcome and a simple Close/return to conversation action. The screen may collapse to a compact ongoing-call strip while navigating; reopening uses the same call. Closing/minimizing the visual panel alone must not accidentally end or orphan a call. Explicit End is distinct from minimizing.

The screen supports keyboard operation, sensible focus entry/return, Escape semantics that do not silently hang up, reduced motion, screen-reader status updates and no reliance on color alone. Avoid per-second screen-reader announcements. Verify320/360/390/430/768/1280/1440px, long names, missing/broken photos and open device menus. Keep the existing conversation draft intact.

## Authority and real media

Continue from clean branch codex/woad-live-calls-20261026 at1aa8841, integrating current main before product changes and preserving unrelated releases. A different active writer must never share this checkout. Recheck source/migration ordering after integration; do not silently redate a migration that was already applied to any backend.

The client initiates only for its own open Ticket. The server chooses the eligible assignee or explicit configured fallback; team-to-client chooses the Ticket's owning client. Do not accept a browser-selected callee or room URL. Keep one live call per participant, exact40-second ring and45-second setup deadlines, winning session/device binding, fixed15-minute room expiry and idempotent commands.

Expose only the missing bounded private projections and commands needed by the coordinator: server-derived eligibility/current invitation and authorized peer display metadata; request/accept/decline/cancel/end; and media preparation for the winning bound participant. Reuse existing command/setup/token services. Tokens stay short-lived and in memory; no URLs, logs, analytics, storage or push payloads contain them. The Daily API key remains server-only.

Replace createFrame with the pinned SDK's createCallObject. Bind received audio/video tracks to our media elements, render the SDK's real participant state, and tear down the instance on final end/unmount. Handle delayed imports, stale async completions, double clicks, permission errors, device changes and ended calls without reopening media. No recording, transcription, screen sharing, phone dialing, group calls or observer access.

## Signalling, cleanup and usage

Preserve the existing HttpOnly server session architecture; do not introduce a browser Supabase Auth client or expose a login access token for Realtime. Reuse the payload-free authenticated push wakeup and service-worker-to-window messages for immediate in-app signalling. The worker obtains an opaque current call ID/version from a fresh same-origin authenticated read; it forwards that hint to existing windows. A single call coordinator per app session refetches authorized call/peer state. Coalesce hints and resync on reconnect/focus/online. Reuse open-conversation live responses as the fallback when call notifications are denied; show that incoming alerts require permission outside that conversation. Do not add an app-wide five-second idle poll. Active invitation/media refreshes are bounded by the fixed call lifetime and stop at terminal state.

Add explicit “Enable call notifications” opt-in for eligible internal and client actors using existing VAPID configuration and worker registration. Store endpoint/session/Tenant/origin binding through guarded RPCs; no role changes or implicit enrollment. Preserve ordinary client message push behavior and its configuration. New call delivery intents are private, exact-once per call/version/device, short-lived and currently authorized at claim. Use high urgency and TTL no longer than the remaining invitation deadline. Reuse the existing Edge worker and bounded database wake/recovery pattern, adding a separate call-delivery claim/finish path rather than increasing generic message polling.

When a usable app window acknowledges an incoming hint, show the in-app incoming dialog; otherwise show fixed generic “Incoming call from Wolf Forge” / “Open Wolf Forge to answer.” No names, Ticket details, room URLs or tokens in OS notifications. Notification clicks open a bounded same-origin opaque-call destination and preserve unsent work in an existing window. Resolve actor class and Ticket destination on the server. Sign-in/expired/declined/answered-elsewhere calls must render the correct current state, never auto-accept or create a replacement room. Keep login return-path validation explicit and closed to external URLs.

Browser/OS permission, suspended processes, offline state, Focus and platform support affect notification display. iOS requires its supported installed-app path. No native ringing/continuous background sound guarantee is made. Denied permission has a useful in-app path; successful push-provider acceptance is not evidence that the OS displayed it. Tests must distinguish dispatch, display and click/open behavior.

Add the real Daily REST adapter to the existing provider boundary: deterministic private rooms, readback after uncertain creation, participant-scoped token issuance, and bounded ejection/deletion. Preserve the durable attempt/cleanup claims. A transport success or browser teardown cannot certify provider termination.

Use trusted Daily meeting-history reconciliation to ingest finalized participant intervals and reconcile the account budget. Run bounded, authenticated cleanup/reconciliation only when configured, with a documented scheduled trigger for enabled environments. Persist a cursor and replay-safe overlap; never lose evidence at a page boundary or depend on a browser to finalize usage. Fail admission closed when reconciliation is stale or unrelated account usage cannot be bounded. Do not activate a schedule or make provider mutations as part of design approval alone.

Preserve the600 test /5400 live participant-minute monthly allocations,6000 combined, conservative reservations, uncertain holds, month splits and existing throttles. Both participants consume usage. The lack of a verified provider-side hard spending stop remains a release gap, not a guarantee of zero charges. Confirm the actual account/allowance/retention and controls before enabling real calls. No paid upgrade, new card, extra service or higher allocation is authorized.

Daily webhooks currently require a card; they are not needed for this implementation. Use the existing-account REST path without enabling billing. Closed-app call push and internal/client device enrollment are included; native lock-screen calling UI and continuous background ringing are not promised. Existing ordinary message notifications remain unchanged.

## Delivery and evidence

Keep calling OFF by default. First implement and verify synthetic UI/controller/provider tests locally within the RAM guard. No local Docker. Full typecheck/build and database/RLS/concurrency execution can use the existing disposable CI workflow after the candidate is ready; do not call old QA receipts fresh passes. Do not change production/Studio schemas, Daily settings, real participants, roles or Vercel settings while preparing the code.

Acceptance must cover two-direction invitation/accept/decline/cancel, two-device winner, exact deadlines, access revocation, stale/duplicate signals, offline/reconnect, immutable expiry, media cleanup and false-success prevention. Preserve foundation budget/race tests and add actual API/provider-adapter tests. Show original failures when fixing a verified bug. UI fixtures use synthetic identities and no customer content.

Real two-person audio/video quality needs independent media endpoints and explicit test identities; two tabs alone do not prove it. Before claiming usable live calls, verify both directions, mute/camera controls, actual received media, ending either side and device release. Any unperformed device test remains plainly pending. Migration application, provider enablement and WOAD rollout are separate later steps with concrete reviewed artifacts; no deployment is authorized by the present UI choice.

Canonical memory stays read-only under D-319; supply a steward proposal after verified milestones. Save evidence outside the source checkout when practical. No RojanCRM changes or actions on William/customer records.

## References and builder review

The installed SDK is daily-js0.94.0. Daily's current [call-object documentation](https://docs.daily.co/reference/daily-js/factory-methods/create-call-object) supports custom UI and direct media tracks; confirm APIs against the installed type declarations during implementation. [Meeting history](https://docs.daily.co/reference/rest-api/meetings/list-meetings) is the intended trusted reconciliation source. [Webhooks](https://docs.daily.co/reference/rest-api/webhooks) currently require a card and are excluded here.

A fresh builder review raised one question: whether Voice can upgrade to Video. The foundation already fixes the mode and limits Voice tokens to audio, so the design now explicitly retains audio-only Voice calls. No new policy decision or broader media permission is introduced. No product code or real provider operation was performed during this review.
