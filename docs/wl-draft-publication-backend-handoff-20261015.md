# Draft-bound publication backend handoff — 2026-10-15

Publication backend source and focused disposable-database validation are complete. Producer commit: `dc82d1cda4ba301a8926242325593c4fc65dd7ed`; prerequisite parent: `3991b6821cc8f89c4591886d654b617874ab3cc4`. Branch: `feat/wl-publication-20261013`. This delivers the producer, not combined application/runtime acceptance.

The original `wl-draft-publication-contract.md` and allocation receipt describe the historical proposal stage. The authoritative frozen contract is Integration's `docs/wl-draft-publication-contract-v1.0.md`, SHA256 `a7de039abf9b22d821de59be3f4ffcad71ad4030e85996a033cbc2096883d4e2`; version remains **1.0**, unchanged. Its exact type artifact SHA256 is `68e2333102a9c1cd4210e10b655859c338241a36a51a1a07dcb964fd2452e02d`. This includes `SERVICES_REQUIRED` and `PublicationPreflight.publishable`.

## Composition and ownership

From proposal `375610dd1bc662ca4ed4d15ddb11cc0b4c456648`, the five coordinator-authorized `cherry-pick -x` steps were performed individually in this order: `24ed9c8b89a2753c34364c1605834cd12512ac2e`, `f2e7ae2dc0f0c0aa585023fb0e66d91502b7c0cd`, `ed6acdaa8e9ff6d3624e1fc626ba1829025bea5b`, `bde6ae40038049b00399dca6e26f838ad2948efe`, `517f0ca4fd055cd4a5d89e2a1dc74dbfc579bc98`. All 156 prerequisite migration blobs match that accepted endpoint, including `20261011172232` through `20261011172237`. Accepted Studio preview/test hunks were preserved. No merge, reset, rebase or whole-tree replacement occurred.

Policy is eight optional modules with Services required; Projects requires Tickets and Subscriptions requires Invoices. Services/Extensions work was not imported. Services OFF can remain draft-valid but is never publishable or silently repaired. Existing private module writer, validation, financial-history exceptions and enforcement remain authoritative and unchanged.

Publication retains schema/domain/repository/service, migration and publication backend tests. **`src/components/white-label/white-label-draft-review.tsx` and `src/tests/white-label-publication-review.test.tsx` are explicitly released to Builder. The sole focused/SQL execution slot is released.** No further Publication execution or source changes are planned. Coordinator confirmed the release receipt in its continuation packet. Auth's queued focused seam slot precedes Branding and Builder execution. Database, build and browser leases remain separate.

## Consumer contract and source transfer

Branding must use the exact producer domain, repository and service at the producer commit, preserving its existing dirty consumer work. Compose only the four new RPC declarations into `database.types.ts`, retaining unrelated source/type drift; do not replace that shared file wholesale. Transfer these paths/hunks through coordinator-approved owner composition, not a whole producer-branch import. Publication types and decoder remain the single contract implementation.

```ts
const service = new WhiteLabelPublicationService({
  repository: new WhiteLabelPublicationRepository(context.client),
});

getRuntimeConfiguration(): Promise<RuntimeWhiteLabelConfiguration>;
preflight(input: Pick<PublishWhiteLabelInput,
  "tenantId" | "sourceDraftRevision" | "expectedPublicationRevision">): Promise<PublicationPreflight>;
publish(input: PublishWhiteLabelInput): Promise<PublishWhiteLabelResult>;
reconcile(input: PublishWhiteLabelInput): Promise<PublicationReconciliation>;

decodeRuntimeWhiteLabelConfiguration(value: unknown): RuntimeWhiteLabelConfiguration;
```

The constructor client is the existing authorized user-scoped `context.client`; no service-role client or caller actor identity. The domain decoder is browser-safe and rejects malformed/unknown shapes, invalid policy and inconsistent results with `DatabaseError`. The domain also exports the frozen types, strict input schemas and the three result decoders. It does not resolve authentication. Branding's GET identity seam remains Auth-owned.

Runtime data is exactly `published` (tenant/revision/source revision/name/colors/module keys/time), `legacy_modules` (tenant/current revision/keys), or `unpublished` (tenant/revision zero). No draft or publisher identity is returned. Selected-Tenant membership, active profile/Tenant, account class and client Company scope are enforced by the RPC; PA entitlement alone is insufficient. A later module-only publication yields `legacy_modules`, never older branding. Invalid/denied/transport results remain unavailable errors, never default/unpublished success. Branding scope remains Tenant workspace and client portal; Platform Admin and login branding remain unchanged.

Public authenticated-only JSON RPCs:

- `app_get_runtime_white_label_configuration()` — no Tenant parameter.
- `app_preflight_white_label_publication(p_tenant_id, p_source_draft_revision, p_expected_publication_revision)`.
- `app_publish_white_label_draft(p_tenant_id, p_source_draft_revision, p_expected_publication_revision, p_request_id, p_reason)`.
- `app_reconcile_white_label_publication` — same five arguments as publish.

Preflight is read-only/advisory. Publish copies only the exact locked saved draft after current PA/active-Tenant/source/expected-publication checks and accepted dependency/obligation validation. Tenant, global actor/request and draft wait boundaries recheck authority. The transaction atomically inserts the existing module parent, immutable branding companion and content-free audit. Draft saves never modify publication, Tenant name or colors.

Request identity is `(auth.uid(), requestId)`, bound to Tenant, both revisions and normalized reason. Exact retries return the original immutable receipt, including after subsequent changes; mismatches conflict across Tenants. A historical receipt does not prove current effectiveness. Retain the complete input through an unknown result; reconcile first, then retry only that input/UUID. `not_found` is visibility at that read, not proof an in-flight publication cannot commit. Transport/authorization errors do not resolve uncertainty.

Canonical Git blobs (independent of checkout line endings):

| Path | Blob at producer commit |
| --- | --- |
| `src/domain/white-label/publication.ts` | `a2cec52e509617d217282fc64d524f9bf13b5938` |
| `src/repositories/white-label-publication-repository.ts` | `3d386049f4214d4968012b1a0be80b1d6582ed07` |
| `src/services/white-label-publication-service.ts` | `fbc3cba8f1858d81cf22d72a838e79e35f028ff5` |
| `src/lib/supabase/database.types.ts` (four additive hunks only) | `75efda565f1aa9a62a74d16d79856d1e2122885e` |
| `src/components/white-label/white-label-draft-review.tsx` (released) | `7a5acd781a26dcfb84d6f256a007fc81686adb18` |
| `src/tests/white-label-publication-review.test.tsx` (released) | `8ce20ef4885cd3179d8c3ae4139077d24be9657d` |

## Migration and disposable environment

Reserved migration `20261013120050_draft_bound_white_label_publication.sql` is installed and registry-recorded on the allocated SQL-only backend. Source SHA256 (LF): `9aa5a987fd7a431b99e1755f6603b2b9ea63060b18787f91cff724abd6d52e39`; Git blob `cb78a8c84eb585e039e93c7179c42a2bca68d1e4`. Registry now has **157** versions, latest `20261013120050`. Installed predecessors were not reapplied.

Backend: `Wolf-Forge-Publication-Test-20261013`, container `supabase_db_Wolf-Forge-Publication-Test-20261013`, exact ID `6f1db0d6b4a8c393e968f4de6af958937c69bfc6a2eed0c8ab163c37b8d40416`, system ID `7696121223199268902`, DB `postgres`, host port `61322`. Guard: `C:/Users/TrojanNiAnton/Documents/Wolf-Forge-Parallel-Setup-20261012/publication-test-environment.cjs`. Runtime reservation: `C:/Users/TrojanNiAnton/AppData/Local/Temp/wolf-forge-publication-backend-20261013/reservation`. These identify an existing lease, not permission to start/reset/reuse it. Coordinator must allocate any subsequent database work.

`private.tenant_module_publications` stays the sole module authority/revision sequence. New append-only `private.tenant_white_label_publications` references that parent through a composite FK and records exact saved source provenance, actor/time/reason/request. An additive parent `publication_transaction_id xid8` column has no default/backfill. Its insert-only trigger stamps the current full transaction ID; the companion requires this same transaction plus exact locked draft and parent equality, preventing late attachment to committed legacy rows. Existing rows/history are not rewritten. Missing/mismatched stamp or malformed latest policy fails closed. No API role can call the private writer, read/write the new table or spoof actor/stamp. All 12 new function bodies/owners/fixed search paths, grants, triggers, RLS and FK were read back; four fresh public RPC type declarations match CLI output. Ten accepted predecessor policy/writer bodies and their private API ACL stayed unchanged.

Publication event `authorization.white_label.published` is additive in SQL/TypeScript taxonomy. Existing approved `draft_saved` codes were already present and preserved. Suite 129's exact mutable-draft reader allowlist was updated from three to six required readers, without granting runtime draft access. The release's phone-preview mount correction remains Builder-owned.

## Verification and limits

- **172 tests across nine focused Vitest files pass:** Builder, draft, Forms boundary, Coupons action, publication domain/repository/service/review, security audit.
- **604 assertions across six pgTAP files pass:** suites 129, 130, 135, 136, 137, 141; new suite 141 contains 137 assertions.
- **16 native SQL concurrency/failure scenarios pass, including ten real blocked waiters:** same/different request; cross-Tenant UUID conflict; in-flight absence and committed-result recovery; both draft/publish orders; PA revocation after Tenant/request/draft waits; Tenant suspension; late legacy companion; higher-isolation refusal; malformed policy/companion/stamp restoration. Failure-trigger pgTAP verifies full parent/companion/audit rollback. Obligation fixtures verify Project, Ticket, Subscription and Invoice refusal with business rows preserved.
- Full TypeScript check after local Next type generation, touched-file ESLint, `public,private` SQL lint (zero errors), script syntax, staged diff check and secret scan (zero findings across 1,736 tracked files) pass. Twelve installed bodies and four generated RPC declarations match source. These are focused checks, not a production build/full suite.
- SQL main fixtures roll back; committed synthetic concurrency fixtures remain in the disposable backend. No cleanup/reset or business-data repair was performed. Dependencies use an ignored junction to the coordinator checkout's matching installed lockfile; no install or package change.

Evidence directory: `C:/Users/TrojanNiAnton/AppData/Local/Temp/wolf-forge-publication-evidence-20261015`. Final receipts: `installed-registered-readback.json`, `focused-database-regressions.json`, `focused-pgtap.log`, `application-sql-lint.log`, `races-13f753bf-4521-46e8-99fc-ef1604922bb7.json`. Earlier pre-final readbacks are superseded by the registered receipt. Raw diagnostics are not project memory or committed artifacts.

**Not performed:** full application/database suites, production build, Auth/Data API transport, real lost HTTP response, browser/seven-width QA, fresh-database replay or combined Auth/Branding/Builder acceptance. SQL deliberately discards a committed result and proves same-ID recovery; it does not establish HTTP behavior. The SQL-only backend has no app/API/browser allocation. Approved hosted Studio backend `rsnmlcyopnxucwgfttyf` and Preview remain untouched.

## Feature file inventory and next owner actions

The producer commit changes exactly these 19 files:

- `src/domain/white-label/publication.ts`
- `src/repositories/white-label-publication-repository.ts`
- `src/services/white-label-publication-service.ts`
- `src/lib/supabase/database.types.ts`
- `src/domain/security/audit.ts`
- `src/domain/security/event-codes.ts`
- `src/components/white-label/white-label-draft-review.tsx`
- `src/tests/security-audit-trail.test.ts`
- `src/tests/white-label-publication-domain.test.ts`
- `src/tests/white-label-publication-repository.test.ts`
- `src/tests/white-label-publication-service.test.ts`
- `src/tests/white-label-publication-review.test.tsx`
- `supabase/migrations/20261013120050_draft_bound_white_label_publication.sql`
- `supabase/tests/database/129_white_label_drafts.test.sql`
- `supabase/tests/database/141_white_label_draft_publication.test.sql`
- `scripts/validate-white-label-publication.cjs`
- `scripts/readback-white-label-publication.cjs`
- `scripts/qa-white-label-publication-races.cjs`
- `scripts/check-white-label-publication-regressions.cjs`

Integration owns registration, source composition and subsequent sequential leases. Auth supplies its validated identity seam; Branding binds this exact runtime producer; Builder owns saved-draft Review/Publish controls and the released review files. No Publish control/server action, shell styling or shared Auth resolver was implemented here. Full-stack acceptance needs a separately allocated isolated functional backend, then serial build/browser QA. No contract decision remains open in this producer; integration/runtime acceptance remains outstanding.

Canonical vault/Security notes were kept read-only under the coordinator instruction. No synchronization, push, merge, deployment or production operation is claimed. Publication stops after this repository handoff.
