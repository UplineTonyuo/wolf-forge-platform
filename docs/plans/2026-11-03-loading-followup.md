# Client, Settings and Reporting loading follow-up

Authorized scope: fix the three reported loading defects and release to WOAD after automated checks. No manual QA prerequisite, local Docker, database writes/migrations, permission changes, customer transactions or RojanCRM work.

Root causes: same-record Client and Settings links explicitly selected inline loading feedback. Settings reused one generic body. Reporting used generic rows/toolbar and did not reproduce the real responsive action/header structure.

Implementation: ClientDetailSections preserves the client frame and server-authorized children while optimistic navigation paints only the chosen section body. SettingsShell does the same for six distinct section templates, with matching leaf loading boundaries. Reporting reuses real list/row/toolbar CSS and reserves the actual header/description geometry. Retained Client children use display:contents when visible, preserving the page layout and drafts. No forced delays, new fetches or polling.

Verification: the initial Settings/Reporting regression suite failed six cases before implementation. Final focused tests cover all Client and Settings destinations, active selection, completion, rapid return/cancellation, modified clicks, body-only fallbacks and shared route behavior. Automated synthetic rendering found and corrected Reporting's mobile header/filter wrap offset. Final measured first-row top/left/width match the actual list at320/360/390/430/768/1280/1440. Client/Settings responsive fixtures show no overflow. These are real components/CSS with synthetic content and stubbed route transport, not authenticated Next/RSC acceptance.

Scoped lint passed. Fresh local TypeScript exceeded its1280MiB heap bound; full TypeScript/build and regression gates run in existing GitHub CI. No local build or Docker startup. Evidence: outputs/loading-followup-20261103 under the task workspace.

Code review: one Reporting compact-action wrapper/visibility issue was identified and fixed; the reviewer approved the final source. Canonical memory remains read-only under D-319; the release report supplies a steward proposal. No decision IDs reserved.
