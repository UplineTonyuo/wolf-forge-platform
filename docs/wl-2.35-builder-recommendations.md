# WL-2.35 builder recommendations and defaults

Local milestone based on `d2bbaa314a9aaba52d001f1dde8410191d1c7fe4`.
Recommendations are draft and preview preferences. Saved selections remain
authoritative, and recommendations grant no permissions.

| Module | Recommendation | Initial selection |
| --- | --- | --- |
| Services | Recommended | Enabled |
| Projects | Recommended for service delivery | Enabled |
| Tickets | Recommended for support | Enabled |
| Reporting | Recommended | Enabled |
| Invoices | Recommended for billing | Enabled |
| Forms | Recommended for intake | Enabled |
| Subscriptions | Specialized: recurring plans only | Disabled |
| Investment Intent | Not recommended for most Tenants | Disabled |
| Coupons | Not recommended | Disabled |

## Implementation

- Existing `WHITE_LABEL_MODULES` carries recommendation labels, explanations and
  `defaultEnabled`; the synthetic preview derives its starting map from it.
  No new registry, permissions or authorization engine.
- Existing native checkboxes remain selectable. Their accessible names are the
  module names, with recommendation, explanation and dependency as descriptions.
  Specialized/non-recommended guidance stays neutral. Services dependency copy
  remains visible alongside the recommendation; dependent preview entries hide
  when Services is off without discarding selected checkboxes.
- Navy/white/Inter and existing restrained gold/transition styles preserved.
  Operate mode, Energy1/Rhythm1/Motion2: retain the familiar configuration rows,
  distinguish guidance with text hierarchy, and animate only existing preview
  state transitions. Narrow rows wrap naturally; no new icons or decoration.
- Editing and Review explain that these preferences do not certify publication.
  Published configurations still require all seven other modules; only Reporting
  and Intent are optional. Core workspace features and Operations exclusions are
  unchanged. No Publish/Activate or runtime branding implementation.
- Forward migration `20261010120000_white_label_recommended_draft_defaults.sql`
  changes only `app_get_white_label_draft(uuid)`'s no-saved-draft catalog fallback.
  Revision0 remains a non-mutating read, with the same name/colors, Platform Admin
  guard, signature, STABLE SECURITY DEFINER and empty search_path. Saved arrays,
  including empty and all-nine selections, are returned exactly. No data update,
  grants, policy, published configuration or enforcement change.
- The migration was created with the local CLI and ordered after the existing
  future-dated Phase2 migration. It was applied only to the verified local stack.
  Snapshot comparison checks unchanged grants/security attributes, all other
  function definitions/policies, registry, existing drafts and publications;
  getter comparison normalizes line endings and removes only the new predicate.

## Verification

- Focused application: **70/70**, five files; full Vitest: **2934/2934**, 220 files,
  two workers. Metadata/default matrix, SQL/frontend parity, selectable Coupons
  and other non-default modules, saved selections, dependencies, Review/Back,
  unsaved state, Platform Admin/environment gates and runtime separation covered.
- Focused pgTAP129: **118/118**. New assertions cover publication rejection of
  draft defaults, all-nine/empty save-read behavior and unchanged publications.
  Updated fallback assertion failed against the original getter before migration.
  Reporting 130 **110/110**, Intent 131 **85/85**. Full pgTAP: **5277/5277**, 120 files.
- Full database verification initially exposed eighteen older fixture failures
  caused by retained Phase2 synthetic data. Each reproduced with the original
  getter inside rollback; secure getter restored exactly. Test-only corrections:
  seven 59-Service counts scoped to Wolf Forge; seven Order fixture suites choose
  deterministic Wolf Forge Services;028 uses fixture-scoped security-invoker
  views instead of deleting append-only history, with scoped notification/audit
  probes;035 evaluates notification permission in its subject Tenant;091/093 use
  trusted company/captured-catalog ownership.130's global empty-publication
  assumption was also scoped to fixture Tenants. Expected counts and all security
  assertions remain; no business implementation was changed to make tests pass.
- Authenticated browser through real synthetic Platform Admin login on this
  checkout's loopback development server: revision0 six defaults/no persisted
  row; all nine checkboxes; keyboard Space/focus for Coupons; Services warning
  and preview dependencies; mobile preview sync; Review's three proposed module
  changes/default baseline; Back values/device/focus; explicit all-nine Save
  Draft and refresh; reduced-motion transitions disabled and focus usable.
- Seven widths 320/360/390/430/768/1280/1440, opened Tenant picker/Escape/focus and
  no page overflow verified. Desktop/mobile images inspected. Recommendation
  text is 12px; computed navy/white contrast 17.85:1 and muted/white 5.68:1 meet AA
  using unrounded ratios. Successful flow has no application page errors.
- Only new isolated `wl235-builder-qa` Tenant received a saved draft (revision1,
  all nine explicitly selected). Existing draft rows, publications, permissions
  and memberships preserved. No publication was created by its draft save.
- Two independent read-only source reviews: UI/accessibility and SQL compatibility;
  SQL reviewer also reviewed the verified fixture corrections. No BLOCKER/HIGH.
  Reviews do not independently execute runtime tests.
- TypeScript, ESLint, database lint, production build, secret scan and working/
  staged diff checks pass. Generated Next dev artifact returned to its tracked
  production form and is excluded from the source commit.

## Boundaries and skills

Requested UI/UX Pro Max, AntiSlop UI/mobile/code/copy, Humanizer, applicable
Caveman review/commit guidance read. AntiSlop applied during the authorized
implementation; comments kept factual, copy reviewed for unsupported claims.
Impeccable context/clarify/craft-floor and React review applied to the existing
surface. Python absent: UI/UX search not run; written priority/reference guidance
used. Caveman-explore unnecessary because exact target files were provided.
Browser plugin skill unavailable; installed Playwright used. Nothing installed
or activated, no new design/memory tree.

Pre-existing LOW portability limitation: 035 assumes stored historical notifications
remain appropriate under current recipient permissions. Later legitimate role or
module revocation may retain inaccessible history; this milestone preserves that
product behavior and documents the test assumption for separate work.

| Applied skill delivery gate | Evidence |
| --- | --- |
| Hard gate: PASS | Native checkbox interactions, actual selected counts, seven widths/no overflow, keyboard/focus/reduced motion, computed AA contrast, authenticated save/refresh and production build |
| Purpose: PASS | Existing brand/Inter and module rows retained for consistency; textual recommendations aid selection, neutral guidance avoids alarm, no new decoration |
| Liveliness: PASS | Declared 1/1/2 dials; configuration is focal, whitespace groups settings, existing gold accent and preview transitions preserved |
| Craft/copy/comments: PASS | Approved product guidance only, concise useful explanations, no unsupported claims; factual draft-authority comment, incumbent behavior and states preserved |

Publication UI, branding, seven remaining enforcement slices and hosted proof are
deferred. No destructive reset, hosted write, external email/payment, push, merge
or deployment. Projects implementation was not started.
