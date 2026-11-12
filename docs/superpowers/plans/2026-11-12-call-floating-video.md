# Minimized video call implementation plan

Goal: keep the participant visible while the owner works, using the existing call media and UI.

The owner's supplied spec is the implementation authority. Extend the existing navy call surface; no design-system change or media/server change. Default corner: lower-right, explicitly selected by the owner. Inline execution in one isolated D-306 lane. D-319 proposals go in the PR; append exactly one factual Implementation Log entry.

- [x] Verify current origin/main, audit worktrees, inspect provider lifetime and existing preview harness.
- [x] Add call-screen tests first and verify missing-window failures (7 red, 9 green).
- [x] Add a body-portaled floating frame for eligible minimized video calls. Reuse VideoTrack and Portrait in CallScreen; keep audio strip unchanged.
- [x] Keep corner state in the mounted call UI, keyed by call ID. Support captured mouse/touch dragging, nearest-corner release, keyboard movement and viewport clamping.
- [x] Place around visible composers and fixed/sticky actions, including mobile navigation. Recalculate after viewport, scroll and page-content changes. Reuse layer and motion tokens; respect reduced motion.
- [x] Verify remote video binding, controls, avatar fallback, ineligible states, corner lifetime, collisions, pointer cancellation and viewport changes.
- [x] Run next typegen, typecheck, lint, touched tests, full tests serially. Adapt the existing synthetic preview for seven widths/all four corners, composer visible; capture 390px and 1440px.
- [ ] Independent source review; commit, push the same branch, open the requested non-draft PR, read back PR, append one log entry, save/copy the report. Stop before merge/deploy.

Review focus: composer growth; fixed bottom navigation/sticky actions; viewport and soft-keyboard resize; pointer cancellation and non-drag movement; dialog layering and audio-recovery prompt. Client coverage follows the shared provider under the persistent internal/account layouts. Cross-shell navigation/log-out is outside a continuing call's layout lifetime.
