# Navigation feedback fixes

> Execute inline with the existing skeleton branch and superpowers:executing-plans. Browser acceptance remains distinct from component checks.

**Goal:** Address the fourteen WOAD annotations without changing domain behavior or permissions.

**Architecture:** Reuse destination CSS and existing transition-aware links. Preserve Order identity, controls and rail while only its section body loads. Use the shared portalled SheetFrame for folder creation.

**Spec:** The user's fourteen annotated destinations and confirmed full-window New Folder backdrop. Skeletons represent layout, never fake client data.

**Constraints:** Local changes only; no Docker, deployments, provider writes, role changes or protected account mutations. Preserve current main, notification polling fixes and pre-existing lane work. Keep canonical notes read-only under D-319. No forced loading delay or new polling.

**Review focus:** interrupted/rapid navigation, canceled/modified links, cached instant routes, draft preservation, narrow-screen geometry and reduced motion.

- [x] Pin failing route-selection, Team scroll and portalled-dialog regressions.
- [x] Add matching Ticket, Report, Invoice view/editor, Subscription, Coupon editor and Service editor shapes and leaf boundaries; wire accepted navigation links.
- [x] Pin and implement body-only Order Details/Files/History feedback, including cancellation. Keep local Subscription tabs immediate; add a Back link.
- [x] Remove Team's forced scroll, isolate Goal avatar styling from metadata descendants, reuse shared folder dialog and remove redundant Actions.
- [x] Run focused interaction tests, lint, bounded typecheck and proportional rendered geometry checks. Record full-build limitations, manual acceptance and exact evidence.

Review follow-up: mobile Coupon Apply/Clear also used raw router.push. A failing test reproduced missing transition dispatch; the filter now reuses useRouteTransitionPush. Both Apply and Clear pass.

Validation: 4,403 tests in the broad run, then 175 focused checks after the final code refinements; full TypeScript passes with a 1,536 MiB heap, scoped lint and secret scan pass. Rendering: 70 destination/width combinations and 7 dialog/avatar viewport checks at 320/360/390/430/768/1280/1440px. No external requests in those isolated fixtures.

Ruling: use the shared SheetFrame's desktop-centered/mobile-sheet behavior rather than a separate modal implementation; it supplies full-window backdrop, focus trap, Escape and focus return.

Remaining: full app build withheld at 3.57 GiB available versus existing 5.5 GiB guard. No authenticated Next/RSC browser navigation, real account/avatar, browser Back/error acceptance or database tests were claimed. Canonical notes remain read-only; verified steward proposal/evidence live in outputs/navigation-fixes-20261103.

## Self-audit follow-up — 2026-11-03

Audit A1–A3 are addressed locally: Invoice New/Edit reserve the real item-entry card and totals layout; Reports reserve neutral content while their authorized read-only/guided/advanced mode is unknown; initial Orders reserve Back, three sections and the header-control region.

Four added regression cases failed before the fixes and pass afterward. Fresh validation: 143 focused tests, scoped lint, full incremental TypeScript at1280MiB and28rendered layout/width checks pass. Evidence: outputs/navigation-audit-fixes-20261103. Earlier broad-suite results above remain historical, not a new full-suite run.

Cleanup: removed the unused navigationUrlForClick helper and its tests after a complete source reference search, plus unreachable entries in the skeleton map. Actual Link handling, modified-click, cancellation and retained-draft tests remain. No untracked files or duplicate source copies were added.

Full app build remains held: fresh2.95GiB available versus5.5GiB guard. Authenticated browser acceptance is still pending. No push, deployment, Docker, database, permission or notification-polling changes.

Historical research: outputs/woad-skeleton-research-20261030. Preserved pre-existing return-navigation patch passed 29 tests and was checkpointed at 22f7e2e; current main was reconciled at 9c72641.
