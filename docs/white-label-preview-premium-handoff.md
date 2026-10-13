# Premium simulated agency SPP

Result: READY FOR MANUAL QA. Date: 2026-10-13, Asia/Singapore. Agent: Codex.

Worktree: `C:/Users/TrojanNiAnton/Documents/Wolf-Forge-White-Label-Builder-UX`. Branch: `feat/white-label-builder-studio-20261012`. HEAD remains `bcb1864545f94af5beecf153d0d27a727b691f50`; these changes are local and uncommitted. Existing V3 and prior Studio polish edits were preserved. No competing implementation writer was found at startup.

## Correction scope

The correction applies inside the interactive Live Preview to the simulated agency application. The outer Studio, All Drafts, real global sidebar, draft editor/business logic and publication system were not redesigned or changed by this correction. SHA-256 comparisons against the fresh before capture verify preservation of every tracked file outside the three preview/style/test targets, excluding the generated `next-env.d.ts`.

The simulated shell uses the current draft primary color, with Wolf Forge navy as the default. A simulated identity header and the preserved sidebar surround a cream content canvas with 24px corners, a quiet border and soft shadow. The same canvas surrounds Dashboard and every supported simulated screen/detail. Module cards use 12px corners and comfortable spacing. Forms fills the final row when an odd number of cards occupies a two-column canvas.

Desktop simulation is a 780px app viewport. Its keyboard-focusable content region scrolls while navigation and simulated identity remain visible. This keeps a fully enabled dashboard from expanding the whole Studio page at 1280px. At narrow real-screen widths Desktop mode reflows; Mobile mode remains a dedicated phone viewport with branded gutters, rounded cream content, a clean header, single-column cards and the existing accessible simulated navigation disclosure.

Dashboard now includes a clearly labeled illustrative weekly activity chart and interactive sample recent work. Sample work obeys module eligibility/dependencies and opens only the simulated destination. It loads no live records and performs no business transaction. Primary, accent, name, module eligibility, adaptive foreground contrast, reduced motion and existing preview focus behavior remain responsive to the controlled draft state.

## Exact files changed in this correction

- `src/components/white-label/white-label-preview.tsx`
- Preview-specific rules in `src/components/white-label/white-label-builder.module.css`
- `src/tests/white-label-studio-interactive.test.tsx`
- `scripts/qa-white-label-preview-premium.mjs`
- This handoff.

New runtime screenshots and structured evidence are under `docs/qa/white-label-preview-premium/`. Older untracked screenshots and prior handoffs were preserved. Generated `next-env.d.ts` is not an implementation change.

## Fresh verification

- Seven focused and affected regression suites: 100 tests passed. Coverage includes builder, interactive preview, drafts, draft manager, actions, page and shell authorization boundaries. The affected interactive suite passed again after the final canvas/viewport adjustment: 14 tests; this overlaps the 100.
- `npm.cmd run typecheck`: PASS. Scoped ESLint with zero warnings: PASS. `npm.cmd run build -- --webpack`: PASS, including TypeScript and page generation. Whitespace check: PASS. Tracked secret scan: zero findings across 1,680 files. No package, dependency or tool installation.
- Authenticated Chrome/Playwright: 320, 360, 390, 430, 768, 1280 and 1440px passed. Each width exercised Desktop/Mobile, 24px canvas geometry, page/frame/content horizontal-overflow checks, six principal module destinations and details, opened phone navigation, Escape focus return, template dropdown and Review/back behavior.
- All 14 eligible destinations were then exercised in both devices: shared rounded canvas and unchanged real Studio URL. Preview chart/work interactions remain simulated. No navigation to production pages.
- Forest Premium produced a green shell (`rgb(23, 60, 50)`) and gold accents. Light primary colors used the existing readable foreground fallback. Long phone names, invalid hex Save/Review blocking, dependency eligibility and reduced-motion transitions passed.
- All Drafts, Keep editing/Discard protection, Continue Editing B, B refresh and switching back to A passed. Normal UI Save Draft was freshly read through the authorized RPC and then refreshed. URL traces stayed on A before Save, after Save and after refresh. Original A names/colors/module keys were restored. Across the task A advanced from revision 15 to 19; B stayed byte-identical at revision 5. Publications, Invoices and wallet transactions remained zero.
- The served app JS bundle included the new `preview-workspace` marker. Its URL and SHA-256 are recorded in `after-results.json`. Browser-computed navy/green shell colors and 24px geometry verify the changed rendering. This app ran directly from the feature worktree, not the frozen QA snapshot.
- After the build, the own dev app restarted and passed another read-only authenticated check. `final-results.json` confirms the accepted production-source hashes, default navy, rounded canvas and reachable/interactive lower desktop content at 1280px. Final screenshots were captured from that restarted app.

Browser page errors: zero. The development console retained the existing report-only CSP notice and a resource 404; a completely clean development console is not claimed. An early scripted refresh returned B while checking A; the later fresh run with explicit URL/readiness tracing passed and did not reproduce the mismatch. An initial color assertion sampled an in-progress transition; the settled computed-color assertion passed. These attempts are not reported as passes.

The Browser plugin/skill was absent, so installed Playwright was used. The existing isolated stack's container project, DB port/system identifier, read-only identity probe and synthetic Tenant slugs were verified before authenticated operations. No fixture provisioning, grants, migration, database reset or backend configuration change was performed.

## Local manual QA and screenshots

Served URL: `http://127.0.0.1:3015/white-label?tenant=c70b73ea-99d9-4c1f-9b0c-f7087a724859`. Use the existing normal Platform Admin login. The own dev app is left running on 3015; the frozen 3013 app was not changed or stopped. Backend remains the dedicated builder QA API 57321 / DB 57322.

Actual browser evidence:

- Desktop before: `before-desktop-1440.png`; after restart: `final-desktop-1440.png`.
- Phone before: `before-mobile-1440.png`; after restart: `final-mobile-1440.png`.
- Lower desktop content: `final-desktop-scroll-1280.png`.
- Custom branding: `after-green-gold-desktop.png`, `after-green-gold-mobile.png`.
- Seven-width captures: `after-desktop-*`, `after-mobile-*`, including details and opened phone navigation.

All images are actual browser captures. No AI-generated image or mockup was used as QA evidence. Desktop/phone content intentionally scrolls within the simulated viewport; the narrower real Studio configuration can still scroll naturally. Full repository/database suites, independent screen-reader execution and actual browser zoom were not rerun for this scoped UI correction. No verified unresolved implementation defect remains in the tested scope.

Canonical memory remained read-only. No unrelated worktree source change, global application/sidebar redesign, publication change, deployment, push, merge or production operation. STOP after this verified local acceptance; manual review and integration remain separate tasks.
