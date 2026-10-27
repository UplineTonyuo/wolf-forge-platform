# Form receipts and Gmail recovery — review candidate

Clients can choose Start order, complete the required service intake with a drawn signature, and receive an automatically downloaded PDF with a manual retry/download path. Orders enter In progress only after required completion. Frozen form versions and own-account authorization remain enforced.

Gmail Connect/Reconnect prepares the authorization URL over a bounded same-origin JSON request; stalled headers/body recover after 30 seconds with a reload gate. Native 303 remains available with the exact Google form destination allowed. Preparation stage logs contain no OAuth URL/state/verifier/token/mailbox, and Connected is still set only by the verified callback.

## Review status

Local form/source/UI/PDF and Gmail focused tests have passed. The combined candidate passed 196 focused tests in 14 files, including the portable 37-template package validation. Previous local fixture QA covered the 12 new service drafts, all seven repository widths for forms and independent 12-PDF verification. Auth/actions/Storage were mocked in fixture QA; no full authenticated Next purchase flow is implied.

Complete-app TypeScript, full repository tests, database checks and clean compilation/font trace are CI gates. They were not completed locally because available RAM was below the established 5.5 GiB threshold. Do not mark the release ready based only on focused checks.

## Deployment and data boundary

The review branch codex/forms-gmail-release-20261028 disables Vercel automatic deployment in vercel.json. No merge to main, Vercel deployment, hosted migration, rollout flag, source-platform save, form publication, client email or provider consent is authorized by this GitHub backup.

Four additive migrations add drawn signature receipts, gated client order start/retry and authorized PDF receipts. Client-start rollout remains off unless separately enabled for an authorized tenant/service. Draft package files in data/intake-forms/20261028 are inert; no import/publish job is added.

CI builds use only inert loopback Supabase/Sentry settings and no hosted database/provider credentials. The PDF trace check verifies all seven trusted font files actually appear in the built route trace. Existing CI security scanning and full suites remain enabled.

## Remaining before a future rollout

1. Finish CI and resolve actual failures without suppressing security gates.
2. Resolve the two catalog business decisions and review the new questions.
3. Verify the compiled authenticated flow against an explicitly authorized isolated backend, including purchase/intake/start and private PDF download.
4. Refresh production backup/rehearsal/recovery evidence and review the exact deployment/rollout plan under new authorization.

The local existing QA server and original form/Gmail worktrees are preserved. This branch combines the tested latest Gmail fix rather than the older recovery attempt still present in the form worktree.
