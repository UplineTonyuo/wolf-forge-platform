# Shared Auth transient lookup handoff

2026-10-14 Singapore. Codex Shared Auth owner; existing task `01a13513-23e3-7910-83b7-5cdcd4e0e173`.

Implementation commit: `406529d0940da6f04d141da209d8d6eb324804fc`, parent/source `b94afedb56e3e89f39efc8745e2a58b6015480ba`. Branch: `fix/shared-auth-transient-lookups-20261013`; allocated worktree: `C:/Users/TrojanNiAnton/Documents/Wolf-Forge-Shared-Auth-20261013`. No branch movement, reset, lock removal, worktree replacement, merge or push. Coordinator expressly retained Auth ownership; Branding/Publication exclude identity files. The allocation receipt identifies all19 implementation files and resource limits.

## Evidence and diagnosis

At the frozen source, `resolveInternalUser` converts membership errors into absent membership and profile errors into `null`. `getInternalContext` interprets that same `null` as `not_internal_actor`, writes `authorization.context.denied` and redirects to `/login?reason=staff-only`. Therefore an infrastructure/lookup error can produce a definitive non-staff classification and durable false denial. Permission/module errors separately become empty grants. The client resolver similarly collapses account errors into absent assignment. Login uses unresolved identity to record `auth.login.unassigned` and sign out. `verifyActor(...).catch(() => null)` also loses verifier failure distinctions.

These are verified source defects, corroborated by deterministic injected result tests. They do **not** establish why the reported fresh-login gateway occasionally answered401. The prior functional-acceptance report and43/43 QA artifact are historical evidence, not a fresh runtime pass. No reproducible gateway/session race, token-refresh defect or clock-skew cause is claimed.

## Resulting behavior

| Evidence | Protected access and response | Audit classification |
| --- | --- | --- |
| Verified staff plus successful current-Tenant membership/profile/permissions/modules | Existing staff context and capabilities | No denial |
| Successful non-staff/no-membership/archived-profile result | Existing staff-only refusal; full internal background context returns403 | Genuine page denial remains durable |
| Explicit client-account RPC42501, all required reads available | Existing client-only/unassigned refusal | Genuine assignment denial remains |
| Missing session or recognized invalid/expired/revoked-session verification | Login required; background401 | Authentication refusal, no non-staff/unassigned audit |
| Persistent lookup error, unexplained lookup401, null/non-array required row sets or mismatched profile identity | No context/grants; generic retry copy, background503 with `retryable: true` and private/no-store | System failure only, no durable permission denial |
| Mixed successful/negative/failed reads | Unavailable until required results establish identity; no partially populated context | No definitive non-staff inference from the failed read |

Post-credential identity outages preserve the newly established session and return `Your account information is temporarily unavailable. Please try again.` Login pages accept `reason=identity-unavailable`; client retries retain `/account` as next surface. Existing genuine unassigned login still signs out and audits. Provider prose, headers, credentials and tokens are discarded by the typed failure, never copied into logs or responses.

Read-only membership/permission/module/client-account RPCs and explicit-token claims verification may retry once for network/5xx failure. All retries must end in successful authorization; no fallback role or grants. Profile GET retains the installed PostgREST SDK's existing bounded retry (maximum three retries), without another application retry layer. SSR `getSession` is never rerun by this recovery helper. Unknown4xx/429/lookup401 is not automatically retried by the helper. Recognized JWT/session failures refuse authentication. No manual refresh, infinite retry, blanket401 suppression or changes to cookie/SSR/proxy handling.

Role selection still comes from the database-authorized request Tenant. Actor verification still creates the existing frozen/branded actor. No Tenant parameter, profile-role shortcut, PA business privilege, trusted/service-role client, SQL/RLS/grant change or authorization-boundary bypass. Team/Ticket identity-only contexts retain their downstream RPC authorization. Team Voice and Podcast full internal contexts still require positive staff identity before protected operations. All ten route callers propagate typed context failures through the shared mapper; unrelated exceptions remain exceptions.

References checked: installed `@supabase/auth-js` getClaims implementation and `@supabase/postgrest-js` retry implementation; installed Next redirect/error/typegen/cookie guides. [Supabase SSR guidance](https://supabase.com/docs/guides/auth/server-side/creating-a-client?queryGroups=framework&framework=nextjs) supports retaining Proxy-owned cookie refresh and verified claims. [PostgREST errors](https://docs.postgrest.org/en/v14/references/errors.html) documents JWT codes301/302/303 and singular-response116. The client's42501 assignment meaning is grounded in this repository's `app_get_client_account_context` SQL, not a generic403 assumption. Supabase changelog markdown fetch was attempted but unsupported by the browser fetcher; no dependency/API upgrade was made.

## Validation actually performed

- Final focused Vitest: **11 files / 215 tests PASS**, native exit0,14.64 seconds, one worker, no file parallelism and caching disabled. Files: shared-auth-transient-lookups, internal-access-tenant-membership, security-boundaries, tenant-host-routing, security-audit-trail, auth-cookie-policy, login-production-hardening, login-brute-force-boundaries, podcast-seo-realtime-routes, podcast-operations-boundaries and team-route-same-origin.
- Deterministic cases cover valid staff, genuine client/non-staff, absent/archived membership/profile, invalid/expired/revoked-session error codes, transient503 then success, persistent/network401/503 failures, mixed/malformed outcomes, client account/modules, self-service, login sign-out preservation, actual route503/403/401 propagation, no protected read on failure and sanitized audit/log records.
- `tsc --noEmit --incremental false` PASS after documented checkout-local `next typegen --webpack`. Initial absent generated PageProps and one test typing issue were corrected; generated route types stay local. `next-env.d.ts` and `tsconfig.json` unchanged.
- Final ESLint on all changed source/test files PASS, zero warnings. Source staged secret scan: **zero findings across 1698 files**; inclusive handoff scan: **zero findings across 1700 files**. Staged diff check PASS. One trailing EOF blank line was removed before commit.
- Only the coordinator-approved Integration dependency junction was prepared; package/lock hashes matched before reuse. No install, dependency upgrade, backend access or real-account mutation. Synthetic in-process test doubles and tenant-routing fetch injection are distinct from live runtime evidence.

## Integration limits and next action

**Focused Auth validation window RELEASED.** No process/server/build remains running for this task. Builds, broad suite, browser/responsive acceptance and a synthetic runtime app/backend were not allocated and were not run. No gateway capture or actual expired/revoked-account session exercise is claimed. The cause of the intermittent401 remains uncertain; classify/capture future requests only in an explicitly assigned synthetic QA environment. Existing claims/JWT revocation semantics are preserved, not strengthened into a new provider-session revocation guarantee.

Integration Owner should review this exact Auth commit against the composed candidate; no whole-file replacement from the frozen source and no SQL/type-contract overwrite. Further integration/build/runtime work requires the allocated sequential window. Publication/branding/favicon behavior was not changed; the login change is only failure copy.

Branding's requested current-session/client fetch seam remains **proposed, not implemented**: cached exported `getVerifiedSessionContext`, extracting the existing Team/Ticket/InternalActor session/actor-only code and returning `{ actor, client } | null`, with typed unavailable errors mapped by existing `identityFailureResponse`. `getSelfServiceContext` exposes the client but redirects and is unsuitable for that GET endpoint. Await the requested Integration Owner acknowledgment before extra seam edits; the authoritative Publication RPC must still validate account/membership/Tenant. Do not claim that proposed export exists in406529d.

Canonical Global OS, Skills Index, AI Memory, Security notes and Raw remain unchanged/read-only; no memory:sync or alternative memory tree. Their older WL-2.38 state remains a known discrepancy versus Integration's later accepted policy. Integration Owner's future exact-content-approved synchronization should narrowly update Current State/Implementation Log/Known Issues and Security Authentication & Sessions, Roles & Authorization, Testing, Registry and Change Log with this evidence and its runtime limits. No memory synchronization is claimed here.

Outgoing native coordinator messages were automatically rejected (`approval policy is never`). Incoming coordinator ownership/dependency/test allocations arrived successfully; the local allocation receipt and this handoff are persisted for coordinator readback. STOP after this narrow local fix and handoff; no deployment, production operation or further feature work.
