# Studio Web Push — October 20, 2026

Historical Studio-only checkpoint. The original SPP now has source support described in [Client Web Push for WOAD and Studio](client-web-push-production-20261022.md); production activation still requires the reviewed rollout.

User-authorized addition to the isolated PWA candidate. Production deployment and backend are excluded. Device delivery acceptance is pending; this document is implementation evidence, not a closed-app delivery pass.

## Boundary

Only Vercel Preview code using Supabase `rsnmlcyopnxucwgfttyf` can expose the enrollment UI. Database configuration starts absent/off. Its service-only provisioning RPC accepts that test project and one verified Studio Preview hostname. The worker independently refuses any other backend. No production migration, alias change or Git push is authorized.

Clients explicitly enable each device from Profile. Browser permission comes from the click; no permission prompt, service-worker registration or enrollment runs on initial page load. Unsupported browsers get guidance, including Home Screen installation for iPhone/iPad. Turning off disables server delivery before unsubscribing the browser.

## Data and delivery

Private, RLS-protected tables hold endpoint/session/tenant ownership, configuration and a bounded delivery ledger. No direct anon/authenticated table access. VAPID private material and the existing test dispatch API key are encrypted in Supabase Vault; public configuration returns only origin and public VAPID key. Local QA secrets remain Windows-user encrypted outside Git.

Notification inserts and coalesced message updates queue work only for enrolled recipient devices. Before claiming work, the service-only worker validates the actual session and current client membership, then reuses the canonical notification reader under that validated recipient context. It restores request claims/headers afterward. Current module, ownership and permission decisions therefore remain authoritative. Enrollment cannot claim or disable another profile's endpoint.

The database wakes one API-key-authenticated Edge Function through asynchronous pg_net. One named minute job wakes still-pending work and expires stale entries. Each event/device has a unique row and one durable attempt before a provider request. Transport uncertainty and provider 5xx stay unknown, never automatically resent. HTTP 404/410 retire endpoints. Queued work and provider TTL are five minutes; push is best effort and the in-app feed remains the source of truth. Provider acceptance is not device display proof.

Only HTTPS endpoints owned by Google, Mozilla, Apple or Microsoft are accepted; the worker checks again immediately before fetch and forbids redirects. Push requests have no content payload. The push-only service worker constructs a fixed generic alert after a same-origin, no-store check of the current session/device. No message title/text, email, company detail, amount, transcript or arbitrary link is sent to the provider or lock screen. No fetch handler, offline cache or session storage is added. Notification clicks focus an open client workspace without navigation; a closed workspace opens same-origin `/launch`.

Logout disables the current session's enrollments before ordinary Supabase logout. Cleanup failure cannot prevent logout; deleted/expired sessions are independently refused at dispatch and display. Enrollment expires after 90 days; inactive/expired endpoint records and delivery metadata are purged after the documented 30-day grace/history window by the named wake job. Profile deletion cascades these records. No other task or schedule is created.

## Dependencies and validation

The independent Edge worker pins `@supabase/server` 1.9.2, `@supabase/supabase-js` 2.112.3 and `web-push` 3.6.7. It uses payload-free VAPID requests and native fetch. The audited npm boundary has a lockfile and scripts disabled; root application dependencies are unchanged. The managed Deno build resolves exact direct imports with automatic node modules. This is not a claim that Deno consumes the npm lock as its own frozen lock.

Before Preview deployment: 103 focused application tests across nine files, TypeScript, affected lint and local production Webpack build passed; 48 database assertions passed with test fixtures and temporary pgTAP rolled back. Secret scan: zero findings across 1786 tracked files; diff checks passed. Runtime worker probes: anonymous/public publishable key requests get 401; the existing test secret key is accepted with zero work while configuration is absent. The new dependency boundary has zero known advisories, 30 verified registry signatures and 11 verified attestations. The root's previously deferred moderate music-metadata advisory remains.

Security advisor review: three private-table RLS/no-policy INFO findings are deliberate deny-all access. Four authenticated SECURITY DEFINER RPC WARN findings match the platform's guarded RPC pattern: explicit execute grants, validated own session/tenant/company, scoped ownership, input limits and a shared rate limit. No table grants or arbitrary actor parameter. Tests exercise real role denial for the service-only functions. See the [Supabase linter](https://supabase.com/docs/guides/database/database-linter) for advisory semantics.

## Activation, acceptance and rollback

Apply migration `20261020110724_studio_web_push_notifications` only to the test project. Deploy `studio-web-push` with its own `withSupabase(auth: secret)` authentication. Keep Vercel deployment protection intact. Verify the exact new hostname mapping before provisioning encrypted VAPID material and dispatch credentials through the service-only RPC. User opt-in and device display/click/disable/logout tests are mandatory, including a physically closed app on Windows, Android and iPhone/iPad. Existing immutable Preview installs do not automatically switch hostnames.

To stop this Studio feature, a trusted test administrator disables `private.studio_push_configuration`, disables its subscriptions, and unschedules only `studio-web-push-wake`. This stops new delivery while preserving the normal notification feed and audit evidence. Do not drop shared extensions or alter production. Code rollback is the pre-push local commit, preserving unrelated work. Canonical Obsidian/Security notes remain read-only under the restoration instruction; task receipts carry current QA evidence.

References: [Web Push protocol/library](https://github.com/web-push-libs/web-push), [Supabase service authentication](https://supabase.com/docs/guides/functions/auth), [pg_net](https://supabase.com/docs/guides/database/extensions/pg_net), [Microsoft push behavior](https://learn.microsoft.com/en-us/microsoft-edge/progressive-web-apps/how-to/push).
