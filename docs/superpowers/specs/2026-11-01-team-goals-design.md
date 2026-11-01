# Team Goals — approved first version

User approved this scope and the navy/gold photo-card and detail screenshots in chat on 2026-11-01. Implementation is local; deployment remains separate.

- One internal Goals area under Team: photo cards, detail view, title/description, one responsible person, due date, milestone checklist, print.
- Owner/Admin see and manage all goals in their current Tenant. Manager/Staff see shared goals and complete milestones on goals assigned to them. Clients/anonymous/foreign Tenants cannot read goals or photos.
- Visibility is shared or leadership-only. A private goal must have an Owner/Admin responsible person. Membership and role are rechecked in the database on every operation.
- Progress is completed milestones divided by total milestones, equally weighted; zero milestones means 0%. Milestones inherit the goal's responsible person. No separate task system, metric types or manual percentages.
- Photo is optional, one cover per goal, JPEG/PNG/WebP, at most 2 MiB, signature-validated using the existing validator. Private bucket; authenticated same-origin read route rechecks goal access. No public or reusable signed photo links.
- Existing Team member/role permissions stay intact. Navigation gets a Team group with the existing Members permission and Goals available to internal roles.
- Reuse existing controls, server Auth context, RPC/repository/service conventions, Storage adapter and native print. No new packages, comments, reminders, chat, charts, automations, photo crop editor or generated production photos.

Approaches considered: extend the existing chat/task system (unnecessary coupling and different privacy); standalone Goals module using existing boundaries (selected by the approved scope); visual-only preview (already delivered, now superseded by implementation approval).

Builder rulings: inherited milestone ownership keeps assignment simple; optimistic revision checks prevent lost edits; list reads use bounded pagination. Created/updated/completed actor attribution is stored on these rows; no activity-feed feature or changes to the existing activity-event taxonomy.

Verification: synthetic domain/component/action tests; native isolated PostgreSQL checks without Docker; typecheck/build only within RAM limits. Full hosted Storage/PostgREST and manual browser acceptance must be reported honestly if unavailable. Do not mutate hosted databases or real accounts.
