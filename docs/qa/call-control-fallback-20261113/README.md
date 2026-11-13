# Call controls and reporting action protection

Follow-up to the two P2 findings in PR #128. Application source tested at a3eb5d9, based on main a16f199; this evidence commit changes documentation only.

- Before: four new regression cases failed (lost full-call controls, duplicate fallback requests, and both overlapping reporting bars). After: all four pass.
- Next typegen, TypeScript, lint and diff checks passed. Focused: 177 tests/6 files. Full single-worker suite: 4,866 tests/409 files, zero failures/skips. Secret scan: zero findings/2,387 tracked files before adding evidence.
- Existing local esbuild/Playwright preview reused with current CallScreen, VideoTrack, Portrait, TicketConversation, TicketComposer, ReportBuilder and ReportWizard; synthetic messages/media, shell framing and server-action/navigation adapters. Current global/component CSS, existing static font/portal assets. No production authentication or backend calls.
- All seven widths (320, 360, 390, 430, 768, 1280, 1440px), four corners each over ticket/composer and both real reporting surfaces: 84 placements. Mouse/touch drag, composer growth and re-minimization add four checks: 88 total. No overlap, horizontal overflow or browser errors; minimum 44px targets; reduced-motion transition 0s. Text/attribute edits: zero obstacle re-collections.
- Exhausted 390x240 viewport restores the existing full-call dialog. Mute toggles; actual Tab navigation reaches End call and scrolls it into view. Growing the viewport permits re-minimization. Unit regression separately confirms saved-corner retention and once-only fallback.
- Two preview compilation failures invoked AGENTS' stop rule. Owner then approved one additional attempt: adding useLinkStatus to the preview-only Next Link adapter allowed this entire run to pass. No application change after the full suite.
- Source and bounded screenshot reviews found no material issue. Detector on the four affected UI sources returned [].

These captures do not establish physical-phone performance, screen-reader speech, authenticated route navigation or live-provider media quality. No merge or manual deployment performed.