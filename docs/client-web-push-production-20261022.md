# Client Web Push for WOAD and Studio

22 October 2026. Production push support is source-ready; live activation is a separate release step.

## Supported targets

| Application environment | Backend | Notification origin |
| --- | --- | --- |
| Vercel Production | `jwynqsyirgenqlmkooah` | `https://wolf-forge-platform-woad.vercel.app` |
| Vercel Preview | `rsnmlcyopnxucwgfttyf` | Its independently verified Studio deployment origin |

Production cannot enroll devices on a Studio origin; a Preview cannot expose production push. Unknown backends and lookalike origins fail closed. Production provisioning requires the existing Wolf Forge Tenant's verified, active host mapping. A configured backend cannot silently switch projects, and public VAPID key rotation still requires a separately reviewed change.

The application, server-side profile/status/actions, logout cleanup and delivery worker now support the production pair. The existing `studio-web-push` deployment name and `app_*studio_push*` RPC names remain for compatibility with the installed Studio worker and named wake job. Those implementation names no longer impose a Studio-only feature restriction.

Migration `20261022151319_production_web_push.sql` replaces only the trusted provisioning function and preserves its service-role-only grant and empty search path. Earlier applied migrations are unchanged. Applying the new migration does **not** enable notifications, create credentials, enroll devices or start a wake job.

## Privacy and delivery controls retained

Clients explicitly enable each device and accept browser permission. No automatic enrollment or permission prompt runs on page load. Devices, sessions, keys and configuration remain separate between production and Studio. Existing Studio opt-ins do not transfer to WOAD.

Current client membership, company, Tenant, session and notification visibility are checked before delivery. Logout disables the current session's devices; session expiry/revocation independently blocks stale work. Endpoints are restricted to supported browser push providers, redirects are forbidden and requests contain no content payload. The service worker checks the current session before showing fixed generic text, caches no private content, and opens same-origin role-aware launch when the workspace is closed. Uncertain transport is recorded without an automatic resend. Push remains best effort; the in-app feed remains authoritative.

## Production activation — part of the reviewed rollout

1. Resolve the recorded release-check blockers and close the production backup, compatibility and writer-control gates. Production currently has 98 migrations; this candidate has **163**, so the reviewed sequence now contains **65 pending migrations**. The earlier 64-migration replay remains historical evidence; this new forward migration has separate rollback-only verification.
2. Stage the exact reviewed production-configured application and apply the reviewed schema sequence to the named production project. Verify the canonical WOAD mapping and existing records/permissions before promotion.
3. Deploy this source's `studio-web-push` worker to the production project with the existing `withSupabase({ auth: "secret" })` boundary. Do not copy Studio credentials, subscriptions or private configuration. Retain the existing service-to-service authentication; do not make the worker publicly callable.
4. Generate a separate production VAPID key pair privately. Provision the trusted function with the production backend URL, canonical WOAD origin, public/private VAPID keys and that backend's default secret API key. Keep private material server-side and out of Git, terminal output, chat and reports. Verify one production configuration and at most one named wake job.
5. Promote the verified production artifact to canonical WOAD under the agreed release controls. Push enrollment must be tested on that exact origin; the protected staged hostname cannot substitute for it. Before reopening general client access, use an approved synthetic production client to opt in, verify one authorized notification with the installed app closed, verify click-to-launch and disable/logout suppression, and check no private content appears. Production device delivery is unverified until this happens. Physical Android/iOS/Safari acceptance remains outstanding.
6. Reopen general client access only after those checks pass, then monitor the original message, notification and purchase workflows.

The old Rank Fortress/Wayfront SPP and its live writes are outside this release. No CSV import, customer cutover, password reset or production notification was performed while preparing this change.

## Verification of this source change

- Native serial application/worker checks: **71 assertions passed**, no external push request.
- Rollback-only SQL on synthetic Studio: existing suite161 **48/48**; production configuration/enrollment/isolation/logout suite163 **33/33**.
- Production-mode server context and logout cases, origin/backend mismatches, dormant configuration, provider refusal and existing client permission/worker behavior are included in the normal application test suite.
- Studio users, profiles, orders, forms, migration history, configuration, subscriptions, Vault metadata, job definitions and provisioning function fingerprint matched before/after. The new migration and test changes were rolled back, so Studio stays at162 until an approved persistent test release.
- These checks do not certify live production delivery or resolve the earlier full-release application/lint/history-scan failures. GitHub validation of the pushed commit is recorded in the task handoff.

References: [Supabase service authentication](https://supabase.com/docs/guides/functions/auth), [Vault](https://supabase.com/docs/guides/database/vault), [pg_net](https://supabase.com/docs/guides/database/extensions/pg_net).
