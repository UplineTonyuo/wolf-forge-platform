# Verified session context dependency

2026-10-15, existing Auth owner/task `01a13513-23e3-7910-83b7-5cdcd4e0e173`.

Authority: Integration's `docs/wl-publication-branding-continuation-20261015.md`, Supporting existing Auth seam. Starting clean HEAD `0a6534974cee8556bf058ec01a716489824a485e`; implementation `406529d0940da6f04d141da209d8d6eb324804fc` remains in ancestry. Native inventory confirms this task is the sole active writer in the existing Auth checkout. No unexpected changes were present.

Validated supplement commit: `2ced10599484cb2ca59c53c05b2318a544f1dea3`, parent `0a6534974cee8556bf058ec01a716489824a485e`. This commit changes only the context extraction and its two focused test files. Original Auth commits are preserved.

## Validated API

Export from `src/lib/supabase/next-server.ts`:

```ts
getVerifiedSessionContext(): Promise<{
  actor: VerifiedActor;
  client: UserScopedClient;
} | null>
```

Cached with existing React `cache`. Uses the established cookie-session client, explicit-token actor verification and server-selected Tenant client. Returns `null` for no session or a recognized unauthenticated session/claims result. Propagates typed `IdentityLookupError` for unavailable identity and preserves unrelated exceptions. No redirects, logout, manual refresh, caller-controlled Tenant, business-role lookup or membership grant.

Team/Ticket/InternalActor contexts reuse this path. Full InternalActor still resolves current staff membership/profile/permissions/modules and preserves explicit authorization refusal. Team/Ticket RPCs retain their own authorization. A verified actor/client is identity, not permission to access any protected resource; Publication's runtime RPC remains the selected-Tenant/account/Company authority.

## Exact failure mapper

Unchanged export from `src/lib/supabase/identity-failure-response.ts`:

```ts
identityFailureResponse(error: unknown): Promise<Response>
```

Use `await getVerifiedSessionContext().catch(identityFailureResponse)`; return any resulting `Response` before a protected read. Handle `null` as an uncached 401 response in the consumer. The mapper returns uncached 503 with generic error copy and `retryable: true` for typed unavailable identity; typed unauthenticated/unauthorized failures map to 401/403. Only system failures are logged for unavailable identity; provider text/credentials are not included. Unrelated exceptions are rethrown. RPC authorization/decoder errors must remain explicit failures; this identity mapper does not convert them into unpublished/default success.

Mapper SHA256 on disk: `db73e9ed7c62bc585cb2ad828c38e0af850e2331f0462800b56a52f28ea5a723`.

## Exact source hunks and dependency closure

The source supplement's `next-server.ts` diff adds `getVerifiedSessionContext` immediately before the Team context and replaces only the repeated session/client/actor setup in `getTeamActorContext`, `getTicketActorContext` and `getInternalActorContext`. The full internal membership resolution/refusal remains after that shared setup. No route, login-action, profile/role resolver, cookie client factory, proxy, SQL or Publication/Branding file is changed by the supplement.

Canonical Git blob IDs below are from `2ced105` and are independent of working-copy line-ending conversion:

| Path | Blob | Role |
| --- | --- | --- |
| `src/lib/supabase/next-server.ts` | `4505cf45b3e5e9bff1273c773c0acbeb3f6040e8` | New export plus three setup replacements; compose hunks, never replace the whole file |
| `src/lib/supabase/user-client.ts` | `aa0851c48722a60b83290e50f1003bee523e3664` | Existing typed `verifyActor`, verified actor brand/freeze and user-scoped client; unchanged from406529d |
| `src/lib/supabase/identity-lookup.ts` | `e056db3e27409024a21cc36546e61d706d852606` | Existing failure type and bounded lookup policy; unchanged from406529d |
| `src/lib/supabase/identity-failure-response.ts` | `4adab3a42fb0239782d4fdf234716d4c267cab0e` | Existing response mapper; unchanged from406529d |
| `src/tests/shared-auth-transient-lookups.test.ts` | `4b5db14352f7ef6004d6458cdb41ad37fe4b063a` | Nine new seam/wrapper cases plus the existing identity regressions |
| `src/tests/tenant-host-routing.test.ts` | `7f891bb4681976ce4af839a1414df4088433e9c8` | Adds the new factory to the two existing selector checks |

The factory also reuses existing `createNextServerSupabaseClient`, `requestTenantSelector`, `readLocalFrontendEnvironment`, React `cache` and the canonical user-client helpers. The mapper reuses existing request-correlation/security logging. Keep a single canonical `IdentityLookupError` module so its runtime type guard works. Do not copy the whole `next-server.ts` or automatically import the unaccepted Auth fix into Branding. Integration Owner must explicitly authorize the exact dependency transfer/composition. The supplier commit establishes source identity and focused evidence, not that transfer authorization or full Auth acceptance.

## Validation and explicit slot release

- Publication's explicit release at producer `dc82d1cda4ba301a8926242325593c4fc65dd7ed` and Integration Owner's follow-up granted this serial focused window. Auth did not use Publication's database or rerun its reported evidence.
- Fresh focused Vitest: **11 files / 226 tests PASS**, native exit 0, 6.37 seconds. The command below used one worker, no file parallelism/cache and the on-the-fly config runner; no dependency install or bundle-loader temporary write was needed. Package and lock hashes still match the approved Integration dependency root.
- Fresh cases passed for actor/client without business reads, no session, invalid session/claims, unavailable session/claims, sanitized retryable response, wrapper reuse and selected-Tenant/missing-selector behavior. Existing genuine denials, background status classification, cookie and actor-brand regressions remain covered. This is deterministic injected/unit evidence, not live authentication or RLS acceptance.
- `node node_modules/typescript/bin/tsc --noEmit --incremental false`: PASS, native exit 0. No build/typegen was run in this supplement window.
- Touched-file ESLint on the three changed source/test files: PASS, zero warnings. Staged diff check: PASS. Source secret scan: **zero findings across 1700 tracked files**; documentation-inclusive scan: **zero findings across 1701 tracked files**.
- **Auth focused execution slot RELEASED.** Tests, typecheck and lint have finished; no Auth validation/server process remains. Branding's next focused slot is for Integration Owner to grant. No database, broad suite, build, browser, hosted or production lease was used.
- Full Auth build/runtime acceptance remains pending its separate allocation. No package install, database/hosted operation, push, merge, deployment or canonical memory/Security write. Existing commits, cookie handling and authority boundaries are preserved.

Exact focused test command:

```powershell
node node_modules/vitest/vitest.mjs run src/tests/shared-auth-transient-lookups.test.ts src/tests/internal-access-tenant-membership.test.ts src/tests/security-boundaries.test.ts src/tests/tenant-host-routing.test.ts src/tests/security-audit-trail.test.ts src/tests/auth-cookie-policy.test.ts src/tests/login-production-hardening.test.ts src/tests/login-brute-force-boundaries.test.ts src/tests/podcast-seo-realtime-routes.test.ts src/tests/podcast-operations-boundaries.test.ts src/tests/team-route-same-origin.test.ts --maxWorkers=1 --no-file-parallelism --no-cache --configLoader=runner
```
