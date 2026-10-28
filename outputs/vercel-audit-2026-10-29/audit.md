# Vercel cost and risk audit — 2026-10-29

Owner follow-up: the attribution gate was explicitly overridden and branch pushes/automatic Preview deployments authorized. See [investigation and implementation follow-up](follow-up.md) for subsequent evidence. The capture below remains historical.

Audit only. **Part B is stopped at the consumer-attribution gate.** No application code, Vercel settings, deployments, environment variables, domains or Supabase resources were changed.

Captured on 2026-10-29 Singapore time (2026-10-28 approximately 20:23–20:40 UTC). Values are point-in-time observations and dashboard rounding is preserved. This report does not claim a seven-day route audit passed.

## Scope and checkpoint

- Project: `wolf-forge-platform`, `prj_Ck85gEGOBER55bl84u03P8z4syHM`.
- Team: WolfForge / `wolf-forge`, `team_dpPiEJrmZWnVTFiOhfLlVes2`. The unrelated ROJAN CRM connection was excluded after account discovery.
- Worktree: `woad-vercel-optimization-20261029`; branch `codex/vercel-optimization-20261029`; starting HEAD and independently read remote main: `205214bae3a965384e1974bcd64915911ea1eefe` (PR #81).
- Vercel's Production overview identifies that commit and deployment `dpl_o5YjMsuEJBYcLbvHmp3qKufhdGpX` behind WOAD.
- D-306 was read. The worktree started clean. Other worktrees were inspected read-only; seven merged-HEAD/dirty trees were found, including the active support/forms lane. A merged HEAD is not cleanup authorization. None was touched.
- The configured recovery repository differs from this platform repository's Studio-release Git common directory. Existing canonical memory records this platform release. No memory tree was created, moved, copied or synchronized.
- WL-2.33 / WL-2.34 recovery instructions are historical checkpoints, not a request to implement WL-2.34. This lane's Part B remains unstarted.

## Findings

| ID | Severity | Evidence | Recommendation |
| --- | --- | --- | --- |
| F-01 | High — gate | Seven-day route/CPU detail is unavailable on this Hobby account. Even the available all-environment 12-hour sample contains 785 `/login` and 764 `/` invocations, about 57 seconds of CPU, without attribution to the Part B polling. | Stop before code. Obtain retained seven-day route/action evidence and explain these consumers, or have the owner explicitly revise the gate. |
| F-02 | High | Billing shows active Hobby. This is the agency operations/client-commerce platform. Vercel restricts Hobby to personal, noncommercial use. | Owner decides an appropriate commercial hosting plan. Polling savings do not resolve plan eligibility. No upgrade applied. |
| F-03 | High | Team Fluid Active CPU is 79.47% of 4 hours; project alone is 79.16%. Hobby has no fixed billing reset date. | Treat CPU headroom as the immediate capacity concern; reduce verified waste after the gate and make the plan decision separately. |
| F-04 | High | One Owner; the Owner remains listed under the “2FA Disabled” member filter. Team 2FA enforcement is Disabled. | Owner enables account 2FA and reviews enforcement/recovery and CI token impact. No account or enforcement changes applied. |
| F-05 | High | `SUPABASE_SECRET_KEY` exists in default Preview; its backend ref cannot be read from the sensitive URL. A single `SENTRY_AUTH_TOKEN` definition targets Production and Preview. “Separate Production Secret Values” is unchecked. | Owner verifies default Preview isolation, chooses distinct credentials and scopes, and reviews the separate-values policy. Shared names alone do not prove identical Supabase credentials. |
| F-06 | Medium | Preview uses Standard Protection, but one active shareable link and one masked automation bypass exist; the latter was added Aug 29 and is designated as a system environment variable. | Owner reviews whether each access path is still needed and its lifetime. Neither link nor bypass value was copied, revealed, revoked or regenerated. |
| F-07 | Medium | Seven-day cron run timestamps/statuses cannot be retrieved: runtime-log API explicitly rejects the requested seven-day range on Hobby. Only aggregate metering survives. | Owner chooses an evidence/retention approach. Do not equate metered invocations with successful maintenance. |
| F-08 | Medium | Spend Management is disabled on Hobby, with “No team budget”; custom Alerts asks for Pro. General owner Email/Web notifications are on, but delivery was not tested. | Owner sets budget/alerts if moving to a plan that supports them; retain ordinary quota notification coverage. |
| F-09 | Information | Fluid enabled, iad1, 1 vCPU / 2 GB; average observed function memory about 329 MB / 2.05 GB. | Memory is an owner setting decision, not an automatic change. Average memory alone is insufficient to size a lower allocation; consider peaks and CPU/runtime effects. |
| F-10 | Low — operational | Only `wolf-forge-platform-woad.vercel.app` is registered to the project; no owned domain found. | Owner decides the stable domain and associated application/OAuth configuration. No domain change applied. |

F-02 is grounded in Vercel's current [fair-use guidelines](https://vercel.com/docs/limits/fair-use-guidelines#commercial-usage). F-03's reset interpretation follows the [Hobby billing-cycle documentation](https://vercel.com/docs/plans/hobby#hobby-billing-cycle).

## 1. Plan, included limits and current usage

**Plan: Hobby. Reset date: none.** Hobby has no billing cycles; the Usage dashboard reports a rolling Last 30 Days range, rather than a future monthly reset. The displayed range was Sep 28, 2pm – Oct 28, 2pm. Usage can lag by up to an hour. Do not promise a November 1 reset.

Team totals consume the shared allowance. Project percentages show this project's contribution against that same allowance; they are not an additional allowance. Read from [team Usage](https://vercel.com/wolf-forge/~/usage) and [project Usage](https://vercel.com/wolf-forge/wolf-forge-platform/usage).

| Meter | Included | WolfForge team usage | Team % | This project usage | Project % |
| --- | --- | --- | --- | --- | --- |
| Fluid Active CPU | 4 CPU-hours | 3h 10m | 79.47% | 3h 9m | 79.16% |
| Fluid Provisioned Memory | 360 GB-hours | 57.5 GB-hours | 15.98% | 57.3 GB-hours | 15.92% |
| Function Invocations | 1,000,000 | 392,407 | 39.24% | 392,251 | 39.23% |
| Legacy Edge Middleware Invocations | 1,000,000 | 0 | 0% | 0 | 0% |
| Fast Data Transfer | 100 GB | 2.15 GB | 2.15% | 2.15 GB | 2.15% |
| Fast Origin Transfer | 10 GB | 1.79 GB | 17.92% | 1.79 GB | 17.92% |
| CDN Requests | 1,000,000 | 202,156 | 20.22% | 201,373 | 20.14% |

Percentages use the dashboard's more precise progress values, so rounded time/GB labels may not reproduce them exactly. Remaining team CPU headroom is about 20.53%, or 49 minutes of active CPU; that is capacity, not a forecast of wall-clock days remaining.

**Proxy qualification:** zero legacy Edge Middleware usage does not mean `src/proxy.ts` is free or unused. The [Middleware dashboard](https://vercel.com/wolf-forge/wolf-forge-platform/observability/middleware) shows roughly 15K Production invocations over its available 12-hour window (the action table separately rounds “next” to 16K and shows 6 “respond” events). Its duration panel is marked **Demo Data**, so no duration statistic from that panel is used here. A separate current-30-day Node proxy count/percentage was not obtained. Node middleware is charged under [Vercel Functions pricing](https://vercel.com/docs/functions/runtimes/node-js); do not add the overlapping dashboard counters or describe the legacy 0% as total proxy usage.

## 2. Top routes/functions and the gate

**Requested last-seven-day ranking: unavailable.** The Functions time selector labels Last 7 days as Observability Plus, while Hobby exposes Last 12 hours. No plan/add-on was purchased. The connector's observability query returned HTTP 400 without usable results; it is not evidence of zero traffic. Runtime-log requests over seven days separately returned an explicit retention error.

The following is an **alternative 12-hour sample**, not a substitute seven-day pass: All environments, Oct 28 16:35 – Oct 29 04:35 Singapore time (Oct 28 08:35–20:35 UTC). Dashboard values are rounded. Source: [Functions, all environments](https://vercel.com/wolf-forge/wolf-forge-platform/observability/vercel-functions?environment=all).

### Top 10 by invocations

| Rank | Route | Invocations | Active CPU |
| --- | --- | --- | --- |
| 1 | `/forms/[formId]` | ~4K | ~2m |
| 2 | `/forms` | 932 | 39s |
| 3 | `/login` | 785 | 24s |
| 4 | `/` | 764 | 33s |
| 5 | `/api/team-live` | 699 | 23s |
| 6 | `/api/team-sync` | 695 | 26s |
| 7 | `/api/white-label/runtime` | 536 | 18s |
| 8 | `/account/projects` | 388 | 15s |
| 9 | `/dashboard` | 367 | 4.38s |
| 10 | `/account/onboarding/[assignmentId]` | 359 | 14s |

### Top 10 by active CPU

| Rank | Route | Active CPU | Invocations |
| --- | --- | --- | --- |
| 1 | `/forms/[formId]` | ~2m | ~4K |
| 2 | `/forms` | 39s | 932 |
| 3 | `/` | 33s | 764 |
| 4 | `/api/team-sync` | 26s | 695 |
| 5 | `/login` | 24s | 785 |
| 6 | `/api/team-live` | 23s | 699 |
| 7 | `/api/white-label/runtime` | 18s | 536 |
| 8 | `/account/projects` | 15s | 388 |
| 9 | `/account/onboarding/[assignmentId]` | 14s | 359 |
| 10 | `/orders/[orderId]` | 7s | 161 |

### Attribution and unchanged Team lanes

- `/api/white-label/runtime` directly matches the branding reader's 30-second poll.
- `/api/team-live` and `/api/team-sync` directly match the controller's two lanes. Together: **1,394 invocations**, approximately **9.3%** of the dashboard's rounded 15K function total, and approximately 49 seconds of active CPU. This is not an exact share and excludes separately metered proxy work.
- **OPEN vs CLOSED Team share is not measurable from these route aggregates.** Both states hit the same endpoints. No request payloads or customer message content were collected. Do not attribute the whole 1,394 to CLOSED polling or present the OPEN tiers' share as known.
- Searching this same all-environment table for `team-typing` returned no row. This means **no typing-route traffic was observed in the retained sample**, not proof of zero seven-day typing traffic.
- Forms/onboarding and dashboard routes can contain the listed visibility Server Actions, but their route totals also mix page rendering, other actions and refreshes. The internal shell also contains a separate 25-second Team presence action (`team-presence-provider.tsx`), outside Part B. Route totals cannot establish the fraction attributable to each action.
- `/login` plus `/` contributes **1,549 invocations**, roughly **10.3%** of the rounded 15K function total, and about **57 seconds of CPU**. Their volume is not explained by the listed polling. The login page renders the login form; `src/app/(internal)/page.tsx` resolves context and redirects to dashboard/todo. No bot, redirect loop, abuse or customer behavior diagnosis is asserted.

**Gate decision: STOP after Part A.** The required seven-day evidence is absent and substantial consumers in the available sample remain unexplained. No boundary changes, shared constants, Team cadence change or `vercel.json` cleanup were made. The per-boundary server-authorization proof remains a prerequisite before any later edit.

## 3. Environment variable names and Preview exposure

Retrieved 51 project environment definitions with `decrypt=false`; only names, types, targets and branch scopes are retained here. Sensitive values were not printed or written. Built-in/system-injected variables are not a complete part of this list.

| Name | Production | Preview default | Development |
| --- | --- | --- | --- |
| `CONTENT_WORKFLOW_SPREADSHEET_ID` | Yes | Yes | — |
| `CRON_SECRET` | Yes | — | — |
| `GMB_MANAGEMENT_SPREADSHEET_ID` | Yes | Yes | — |
| `GOOGLE_CLIENT_ID` | Yes | — | — |
| `GOOGLE_CLIENT_SECRET` | Yes | — | — |
| `GOOGLE_OAUTH_REDIRECT_URI` | Yes | — | — |
| `GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL` | Yes | Yes | — |
| `GOOGLE_SHEETS_SERVICE_ACCOUNT_PRIVATE_KEY` | Yes | Yes | — |
| `OFF_PAGE_SEO_SPREADSHEET_ID` | Yes | Yes | — |
| `ON_PAGE_SEO_SPREADSHEET_ID` | Yes | Yes | — |
| `OPERATIONS_SYNC_WEBHOOK_SECRET` | Yes | Yes | — |
| `PODCAST_SEO_SPREADSHEET_ID` | Yes | Yes | — |
| `SENTRY_AUTH_TOKEN` | Yes | Yes | — |
| `SUPABASE_PUBLISHABLE_KEY` | Yes | Yes | — |
| `SUPABASE_SECRET_KEY` | Yes | Yes | — |
| `SUPABASE_URL` | Yes | Yes | — |
| `TECHNICAL_SEO_SPREADSHEET_ID` | Yes | Yes | — |
| `WEBSITE_BUILDER_SPREADSHEET_ID` | Yes | Yes | — |
| `YOUTUBE_SEO_SPREADSHEET_ID` | Yes | Yes | — |

Production has 19 unique explicit names; default Preview has 15; Development has **no explicit project definitions** in the API response.

Branch-specific Preview overrides:

| Branch | Names overridden |
| --- | --- |
| `feat/pwa-functional-20261020` | `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` |
| `release/studio-only-20261014` | The three Supabase names above, `SENTRY_AUTH_TOKEN`, `GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SHEETS_SERVICE_ACCOUNT_PRIVATE_KEY`, `OPERATIONS_SYNC_WEBHOOK_SECRET`, and all eight spreadsheet-ID names in the table |

| Requested secret family | Production / Preview finding |
| --- | --- |
| Supabase secret key | Present in both, with separate sensitive definitions. Same-value equality and default Preview project isolation cannot be established from names or inaccessible values. |
| Daily | No `DAILY*` explicit project definitions returned for any target. This does not prove provider configuration elsewhere is absent. |
| Gmail OAuth | `GOOGLE_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_OAUTH_REDIRECT_URI` are Production-only. Gmail refresh credentials in database/Vault were not inspected. |
| VAPID | No `*VAPID*` explicit project definitions returned for any target. |
| Sentry | A single sensitive `SENTRY_AUTH_TOKEN` definition targets both Production and Preview: confirmed shared credential scope. The Studio branch also has its own override. A public Sentry DSN would not itself be a secret. |
| Other privileged integrations | Sheets service-account private-key and Operations webhook-secret names exist in Production and default Preview; equality was not inspected. |

**Which Supabase project does Preview use?**

- Default Preview, including this lane's branch: **not verifiable**. The API omits the sensitive `SUPABASE_URL` value even on a targeted read (`decrypted=false`). Do not assume the Production project or the Studio project.
- `feat/pwa-functional-20261020`: sensitive branch override; ref likewise unavailable.
- `release/studio-only-20261014`: targeted read of its non-sensitive URL verified project ref **`rsnmlcyopnxucwgfttyf`**. Only the ref is retained.
- Production database and credential contents were not queried for this audit.

## 4. Deployment Protection

Source: [project Deployment Protection](https://vercel.com/wolf-forge/wolf-forge-platform/settings/deployment-protection), independently cross-checked against project API metadata.

| Surface/control | Observed setting |
| --- | --- |
| Vercel Authentication | Enabled; dashboard “Standard Protection”; API uses legacy enum `all_except_custom_domains` |
| Preview deployments | Protected by Vercel Authentication, subject to configured bypass paths |
| Production | Generated deployment URLs protected under Standard Protection; the Production domain remains the public application entry point |
| Password protection | Disabled |
| Trusted IP protection | Disabled |
| Automation bypass | One masked entry, added Aug 29, designated as a system environment variable; value never revealed |
| Shareable links | One active entry for an intake-publication Preview, shown as about 10 hours old; token/link not copied |
| Deployment Protection Exceptions | No domain entries shown |
| Trusted Sources | This project; matching environment tokens, with development tokens allowed to Preview |
| Protected sourcemaps | Enabled |

Standard Protection's semantics follow [Vercel's authentication documentation](https://vercel.com/docs/deployment-protection/methods-to-protect-deployments/vercel-authentication). The old API enum is preserved as evidence, not silently renamed. This audit did not test a bypass or weaken application authorization.

## 5. Function configuration

Source: [Functions settings](https://vercel.com/wolf-forge/wolf-forge-platform/settings/functions).

| Setting | Observed |
| --- | --- |
| Fluid Compute | Enabled |
| CPU / memory | Standard, 1 vCPU / 2 GB; alternatives disabled on Hobby |
| Region | `iad1` (North America / Washington, D.C.) |
| Maximum duration | No explicit project value; settings input is empty with default placeholder 300 seconds |
| Per-function duration/region overrides | No `maxDuration` or `preferredRegion` export found in `src`, `next.config.ts` or `vercel.json` |
| Failover | Disabled |
| Node version | Project API reports 24.x |

The available Production Functions sample showed average memory around 329 MB of 2.05 GB. This is not peak-memory evidence or a lower-memory benchmark. Configuration inspection is not a new deployment/runtime load test.

## 6. Domains

The domains API returns exactly one verified project domain: **`wolf-forge-platform-woad.vercel.app`**. Its `gitBranch` and `customEnvironmentId` are null. No owned/custom domain is registered to this project. The Production overview shows the same WOAD alias; generated deployment and branch URLs also end in `.vercel.app`.

Thus **yes, WOAD is currently only on Vercel-provided domains**, within this project's domain scope. This does not inventory unrelated domains owned by the user.

## 7. Team membership and 2FA

Sources: paginated team-members API (one result, no next page), [Members](https://vercel.com/wolf-forge/~/settings/members), and [Security & Privacy](https://vercel.com/wolf-forge/~/settings/security).

| Member | Role | Account 2FA |
| --- | --- | --- |
| `paghubasanantonio7-7455` / GitHub `UplineTonyuo` | OWNER, confirmed | Disabled; remained the sole result under “2FA Disabled” |

Team 2FA enforcement is **Disabled**. “Separate Production Secret Values” is also unchecked. No member invitations, roles, account authentication or policy controls were changed.

## 8. Spend management and alerts

- [Billing](https://vercel.com/wolf-forge/~/settings/billing): active Hobby; Spend Management controls disabled, “No team budget”; no payment method listed. The disabled budget panel describes 50%/75%/100% alerts for supported plans, not active configured alerts for this account.
- [Alerts](https://vercel.com/wolf-forge/~/settings/alerts): “Upgrade to Pro”; no custom monitor configuration is available on this plan.
- [My Notifications](https://vercel.com/wolf-forge/~/settings/notifications): general Email and Web notifications checked; no muted projects. These preferences are not proof that a specific quota email was delivered.
- Billing charges API returned `404 costs_not_found`; that is not an audited zero-dollar invoice or a spend forecast.

## 9. Cron configuration and seven-day evidence

[Live cron settings](https://vercel.com/wolf-forge/wolf-forge-platform/settings/cron-jobs) are Enabled and match the two source definitions in `vercel.json`.

| Route | Schedule (UTC) | Nominal Singapore time |
| --- | --- | --- |
| `/api/internal/team-voice-cleanup` | `17 3 * * *` | 11:17 daily |
| `/api/internal/intake-maintenance` | `47 3 * * *` | 11:47 daily |

The dashboard explicitly states that Hobby cron scheduling has a flexible one-hour window. No Run button was clicked.

- **Seven-day aggregate metering: 10 Cron Job Invocations**, verified in both team and this project's [Last 7 Days usage](https://vercel.com/wolf-forge/wolf-forge-platform/usage?from=1792616400000&range=last-7-days). This query begins 2026-10-21T21:00:00Z; the displayed range is Oct 21, 2pm – Oct 28, 2pm. It is a dashboard usage bucket window, not seven days of retained runtime logs.
- Last-30-day aggregate: 33 invocations.
- **Per-run last-seven-day history, exact timestamps, status and success/failure counts: unavailable.** The read-only logs tool explicitly rejected `since=7d`: Hobby retains one hour. No cron was retriggered to manufacture a result. See [runtime-log retention](https://vercel.com/docs/logs/runtime).

## Handoff and owner decisions

Part B is unstarted. No PR exists and no new CI was triggered. No local build/server, dependency installation, application test run or Supabase operation occurred. Repository verification is limited to source inspection and `git diff --check`; prior release QA remains historical evidence.

The three `git.deploymentEnabled` branch entries remain unchanged because the code gate was not passed. Boundary authorization, fake-timer tests, typecheck, lint, touched tests, before/after visible-tab estimates and the code PR remain outstanding.

Owner decisions remain: commercial plan/observability retention, Preview backend/credentials/protection and existing bypass access, 2FA, budget/alerts, any memory adjustment, and an owned domain. None has been applied.

This audit is saved and locally committed before handoff under D-306. A remote push is held because Part A forbids Vercel changes and this Git integration automatically creates Preview deployments; the explicit code/push/PR phase was not reached. Keep this worktree and branch for review. Canonical vault notes are unchanged for this read-only, gated audit.
