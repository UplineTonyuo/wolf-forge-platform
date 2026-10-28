# Vercel optimization follow-up — 2026-10-29

The owner overrode Part A's attribution gate and authorized this branch's push and automatic Preview deployments. Vercel settings remain read-only. The original [audit](audit.md#findings) is a historical capture; its stop/push-hold statements are superseded by this authorization.

## Root and login investigation

**Classification: uptime monitor, high confidence for the retained sample.** No application redirect loop or timed PWA retry was found. The complete earlier 12-hour population cannot be individually attributed after Hobby's one-hour request-log retention expires.

The dashboard Request Logs view exposes records that the runtime-console-log connector did not return for its text query. The initial 50 visible requests consisted of 25 GET `/` requests with 307 responses and 25 GET `/login` requests with 200 responses, from 20:29–20:53 UTC on October 28. Each root request occurred near second 45; login followed approximately 0.4–1.4 seconds later. Root-to-root intervals were approximately 60 seconds. Sample request IDs:

| UTC | Request | Status | User agent | Referrer |
| --- | --- | --- | --- | --- |
| 20:53:45.042 | GET `/` | 307 | `SentryUptimeBot/1.0 (+http://docs.sentry.io/product/alerts/uptime-monitoring/)` | Not shown in request detail |
| 20:53:46.041 | GET `/login` | 200 | Same Sentry user agent | `https://wolf-forge-platform-woad.vercel.app/` |

Request IDs are `bg5kv-1793220825042-a70425f879b9` and `xghnw-1793220826041-78dce9d4afa0`. Root logged `authorization.context.unauthenticated`, reason `no_session`. Both were Production/main, deployment `dpl_o5YjMsuEJBYcLbvHmp3qKufhdGpX`. The sampled root had middleware 802ms and function 28ms; login had middleware 630ms and function 21ms. These are elapsed execution durations, not billed active CPU measurements.

The [Firewall Traffic overview](https://vercel.com/wolf-forge/wolf-forge-platform/firewall/traffic), Past Day at about 20:55 UTC, corroborates the monitor volume:

| Available aggregate | Observed value |
| --- | --- |
| Sentry uptime user agent | Approximately 3.0K requests |
| Google LLC autonomous-system name | Approximately 3.0K requests |
| US source `35.237.134.x` | 999 requests |
| US source `34.169.179.x` | 998 requests |
| US source `34.85.249.x` | 996 requests |
| Browser/Philippine Long Distance Telephone Company aggregate | Approximately 32.8K requests; broader ordinary application traffic |

These are separate dashboard aggregates, not a proved UA/IP join. Numeric ASN, per-request IP, complete root/login referrer distribution and a complete 12-hour UA/status distribution were not exposed by the inspected request detail. Do not assign all 1,549 earlier invocations to these three masked addresses, infer ASN numbers, or label the browser traffic abusive. A 60-second monitor following one redirect would generate approximately 1,440 root/login function calls in twelve hours, consistent with a dominant contribution to the earlier 1,549; the residual is unclassified.

Code evidence:

- `src/proxy.ts`: resolves the host, stamps trusted tenant/correlation headers, refreshes claims/cookies, then `NextResponse.next()`. It does not redirect `/` or `/login`; matcher remains untouched.
- `src/app/(internal)/page.tsx`: authenticated internal users redirect to `/dashboard` or `/todo`; context resolution redirects an unauthenticated request to `/login`.
- `src/app/login/page.tsx` and `components/forms/login-form.tsx`: render the login form; POST occurs on submission. GET login does not redirect back to root.
- `src/app/launch/route.ts`: one uncached 307 to `/`, `/account` or `/login`, depending on verified session/role. It is entered on launch, not on a timer.
- `src/app/manifest.ts`: `start_url: "/launch"`; `id` and `scope` being `/` do not schedule requests.
- `public/push-sw.js`: no fetch handler, periodic sync or retry loop. Push checks `/api/push/status`; notification click focuses an existing account window or opens `/launch`.
- `src/components/pwa/pwa-provider.tsx`: reload occurs only through the explicit “Reload now” button. No timer requests root/login.

No code-side loop/retry fix is warranted by this evidence. An owner can separately reduce or retarget the Sentry monitor; this PR changes no monitor or Vercel configuration. A UA string alone is spoofable and is not suitable as an authorization bypass.

## Authorization review before polling edits

| UX boundary | Server authority that remains on every request |
| --- | --- |
| Tenant branding | `api/white-label/runtime/route.ts` verifies the session; user-scoped runtime publication RPC resolves the current configuration. |
| Forms visibility | Internal/client contexts; user-scoped Forms RLS and restrictive parent predicates (`can_read_form_submission`, `can_read_form_assignment`); write RPC capability/module checks. |
| Coupon access | Internal context, `app_has_permission`, restrictive published coupon RLS; `require_coupon_manager` on writes. |
| Financial visibility | Internal/client context; scoped invoice/wallet RPCs and RLS; invoice capability/current-parent guards on writes. |
| Subscription history | Internal/client context; subscription summary/detail RPCs and `can_read_subscription`; guarded writes. |
| Form renderer availability | Current published/assigned schema RPCs; submission independently checks tenant, published version, payload, assignment/actor and quotas. |

Source: the named actions/repositories and migrations `20261011172232`, `20261011172233`, `20261010193103`, `20261010222032`, plus existing tenant authorization policies. Slower UX refresh does not grant data access. Previously delivered browser content can remain visible longer; unchanged server authorization applies to new requests.

## Background-call estimate

Scheduled requests per continuously visible, online, idle tab/hour, excluding initial mount, focus/visibility events, user actions, retries, network time, jitter and proxy execution. Each applicable boundary is counted once. This is a code-derived estimate, not measured savings.

| Source | Before | After |
| --- | ---: | ---: |
| Branding, internal and client shell | 120 | 6 |
| Each Forms/Coupons/Financial/Subscription boundary | 240 | 12 |
| Public/assigned form availability | 240 | 12 |
| CLOSED Team live lane | 240 | 60 |
| CLOSED Team background lane | 240 | 60 |
| Internal Team presence heartbeat, unchanged when enabled | 144 | 144 |
| Internal base with Team closed and presence enabled | 744 | 270 |
| Internal page with one listed access boundary | 984 | 282 |
| Client portal page with one listed boundary | 360 | 18 |
| Assigned client form with Forms boundary + availability | 600 | 30 |
| Standalone public form (no account shell) | 240 | 12 |

Mount adds one check per active lane; branding now also checks immediately on mount. Hidden checks remain skipped; Team also remains paused offline. Closing Team changes both scheduler lanes to 60 seconds. OPEN tiers, typing, presence, ticket-live and calls are unchanged. The original retained sample's Team aggregate is 1,394 function invocations (~9.3% of rounded 15K), with no separate measurable OPEN/CLOSED share and no observed typing row. Requests may invoke proxy work in addition to the route function; these estimates count HTTP calls, not billable function totals.

## DoW review and owner recommendations

Pre-invocation firewall policy and code-level quotas serve different purposes. RLS/authentication prevents unauthorized data access but does not itself prevent repeated authorized or anonymous requests from consuming CPU. No new database migration or blanket API throttle is included.

| Surface | Existing code control | Cost exposure / next action |
| --- | --- | --- |
| Root/login/launch GET | Fail-closed session/tenant resolution; terminating redirects | Each monitor check executes proxy and route work. Review monitor frequency/target rather than blocking its UA as an attacker. |
| Login POST | BotID Basic before Auth; durable source and source+identity limits | Edge rate limiting remains useful because code-side refusal still invokes the application. |
| Public form GET and availability | Published schema/tenant scope; payload and RPC bounds | Anonymous reads still invoke proxy/database work. No identity-based authorization can make these free. |
| Public form submission | Schema validation, server BotID verification before creating a DB client, current DB authority, idempotency, payload limits and form/global/identity quotas | This PR adds the named minimum Part C control. Bots, provider errors and missing verdicts refuse with a generic permission error; answers/provider details are not logged. The database bot-token seam and quotas remain independent. |
| Authenticated polling | Session, current actor/resource scope, bounded controllers; reduced cadences | A modified client can ignore browser timers. Use observed abuse thresholds and durable actor limits where justified. |
| PDF/file routes | Verified context, authorized receipt/file RPC; file cost limiter; PDF quota error handling | Authorized repeated rendering/download can still consume CPU/transfer. Do not cache private bytes publicly. |
| Operations sync and cron | HMAC/timestamp/bounded webhook body or cron-secret authority | Keep machine routes separate from browser challenges; do not exempt by UA alone. |

After Pro upgrade, proposed **log-first** rules for owner review (none created/staged/applied):

| Match | Initial threshold | Proposed action after observing legitimate peaks |
| --- | --- | --- |
| GET/HEAD, exact `/` or `/login` | 120 requests / 60s / source IP | Challenge sustained excess; normal monitor cadence is far below this. |
| POST, exact `/login` | 12 requests / 60s / source IP | Rate limit excess. Preserve BotID Basic and durable login limits. |
| POST, path starts `/f/` | 60 requests / 60s / source IP | Rate limit excess after shared-office/NAT and availability checks. Includes Next Server Actions; does not identify the submit action alone. |
| GET, `/api/form-submissions/*/pdf` | 60 requests / 60s / source IP | Rate limit sustained rendering bursts after normal bulk-download review. |
| POST, exact `/api/team-live` or `/api/team-sync` | 600 requests / 60s / source IP | Log first; tune with multiple tabs and shared NAT. OPEN FAST legitimately produces about 101 calls/minute per tab. |

Use verified-bot signals where supported. No broad country/ASN/JA4 ban, no blanket “bot/curl/headless” substring deny and no bypass based on the presence of a session cookie or the Sentry UA. The inspected Firewall showed Custom Rules 0, Bot Protection Inactive, system mitigation active; this is a read-only capture, not a security certification. [Vercel firewall concepts](https://vercel.com/docs/vercel-firewall/firewall-concepts).

BotID uses the already installed package and existing Next integration. Client protection adds POST `/f/*` to `instrumentation-client.ts`; only `submitPublicFormAction` gains server verification. This protects anonymous and signed-in public-form submissions. Assigned/internal submissions and GETs are unchanged. A human verdict does not bypass payload validation, database permission, rate, version, assignment or idempotency checks. No Deep Analysis option, key, Vercel setting or schema migration is added. The earlier detailed Part C text was not present in the available conversation; this implements the explicitly named DoW review and public-submit BotID control, without assuming additional requirements. Hosted provider/browser acceptance remains unverified. [BotID Server Actions setup](https://vercel.com/docs/botid/get-started).

Recommended starting **On-Demand Budget: $10/month**, with email/web alerts at 50%, 75% and 100%, plus Pause Production Deployments enabled if the owner accepts the availability tradeoff. This is beyond Pro's included monthly usage credit, not an all-in invoice ceiling: seats, integrations/add-ons and retained storage can bill separately, checks lag by minutes, and pausing Production does not stop Preview or all other billable activity. Keep an overshoot reserve below the true maximum acceptable spend. No budget or pause setting was changed. [Spend Management documentation](https://vercel.com/docs/spend-management).

## Validation and review scope

Fresh local validation: Next route type generation, `npm run typecheck`, strict zero-warning `npm run lint`, and 16 focused Vitest files / 273 tests pass. Tests cover the five-minute and ten-minute boundaries, initially hidden tabs, visibility/focus return, cleanup, stale branding results, both CLOSED Team lanes at 60 seconds, existing jitter/backoff/open tiers, BotID refusal before DB access, client path configuration, and Forms/PWA/login/privacy regressions. No local build or server was started; full application/build/database/secret/dependency checks are delegated to the PR's CI.

The three removed deployment-disable entries are all merged into current `origin/main`; remote branches still existed at readback. `vercel.json` retains the exact two cron definitions. No dependency version, lockfile, proxy matcher, ticket-live/calling implementation, Vercel setting or database schema was changed. Canonical memory receives a concise verified handoff separately; this file contains no raw IPs, credentials, request bodies or answer text.
