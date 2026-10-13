# Draft-bound publication contract v1 — proposed, awaiting baseline confirmation

Owner: Publication. Consumers: Branding and a subsequent Studio Publish assignment. Schema/API names below are concrete proposals, not installed APIs. Dependent implementation must wait for contract freeze after Integration Owner confirms the policy baseline and file allocations.

## Source and policy prerequisites

Builder source: `b94afedb56e3e89f39efc8745e2a58b6015480ba`, six optional published modules. Completed functional acceptance is `Wolf-Forge-Builder-QA-20261012/functional-acceptance-20261013.json`: historical 43/43 PASS, no publication, drafts restored at revisions A25/B5. The shared identity transient-error anomaly is Auth-owned; its fix is outside this contract.

Latest inspected accepted policy candidate: `517f0ca4fd055cd4a5d89e2a1dc74dbfc579bc98`, feature parent `bde6ae40038049b00399dca6e26f838ad2948efe`, documented in `Wolf-Forge-White-Label-Integration/docs/forms-coupons-integration-acceptance-20261012.md`. Integration Owner must confirm it as the publication baseline. Eight modules are optional; Services remains required. Nine selectable Studio draft modules do not prove nine optional published modules. Services OFF must be refused, never repaired or auto-enabled.

The six files missing from this Builder branch are, in exact replay order:

1. `20261011172232_forms_module_enforcement.sql`
2. `20261011172233_coupons_module_enforcement.sql`
3. `20261011172234_forms_integration_authorization.sql`
4. `20261011172235_forms_collection_policy.sql`
5. `20261011172236_forms_coupons_integration.sql`
6. `20261011172237_combined_authority_after_wait.sql`

No file has been imported or applied. Publication will not cherry-pick, merge or silently copy another owner's work. The coordinator must establish the accepted source/runtime combination before module acceptance. Services and Custom Extensions are separate assignments; their unintegrated policies/migrations cannot be treated as accepted publication prerequisites automatically.

## Immutable storage and compatibility

Retain `private.tenant_module_publications` as the sole effective module-policy history and revision sequence. Add private append-only `tenant_white_label_publications`, with a composite foreign key `(tenant_id, publication_revision)` to that existing history. One companion row records the exact saved draft name/colors and source provenance. Both rows commit atomically. Existing rows are never backfilled from current drafts or rewritten.

Companion fields: `tenant_id uuid`, `publication_revision integer`, `display_name text`, `primary_color text`, `accent_color text`, `source_draft_revision integer`, `source_draft_updated_at timestamptz`, `source_draft_updated_by uuid`, `expected_publication_revision integer`, `request_id uuid`, `published_by uuid`, `published_at timestamptz`, `reason text`. Primary key `(tenant_id, publication_revision)`; unique `(published_by, request_id)`. Name/color constraints match the stored draft (trimmed 1–60 characters, no controls, lowercase six-digit hex); revisions and timestamps are required. Module keys are read from the referenced parent, not maintained as a competing policy array. The insertion guard verifies exact source draft and parent module equality; update/delete refuse. All API-role table privileges and private helper execution are revoked; RLS is enabled.

There is no second branding revision. `publicationRevision` always means the current module-publication revision, including legacy module-only rows. A later module-only publication makes runtime reads explicitly legacy; it must never combine its modules with an earlier branding snapshot.

## Exact TypeScript consumer types

```ts
export type WhiteLabelModuleKey =
  | "services" | "projects" | "tickets" | "reporting" | "invoices"
  | "subscriptions" | "coupons" | "investment_intent" | "forms";

export type PublishedWhiteLabelConfiguration = {
  tenantId: string;
  publicationRevision: number;
  sourceDraftRevision: number;
  displayName: string;
  primaryColor: string;
  accentColor: string;
  moduleKeys: WhiteLabelModuleKey[];
  publishedAt: string;
};

export type RuntimeWhiteLabelConfiguration =
  | { kind: "published"; configuration: PublishedWhiteLabelConfiguration }
  | { kind: "legacy_modules"; tenantId: string;
      publicationRevision: number; moduleKeys: WhiteLabelModuleKey[] }
  | { kind: "unpublished"; tenantId: string; publicationRevision: 0 };

export type PublishWhiteLabelInput = {
  tenantId: string;
  sourceDraftRevision: number;       // >= 1, saved revision reviewed by caller
  expectedPublicationRevision: number; // >= 0, including legacy revisions
  requestId: string;                // UUID, stable through uncertain retry
  reason: string;                   // trimmed 1–500 characters
};

export type PublicationReceipt = {
  configuration: PublishedWhiteLabelConfiguration;
  requestId: string;
  expectedPublicationRevision: number;
  publishedBy: string;              // auth.uid(), never supplied by caller
  reason: string;
};

export type PublicationBlockerCode =
  | "DRAFT_NOT_SAVED" | "STALE_DRAFT" | "STALE_PUBLICATION"
  | "TENANT_INACTIVE" | "INVALID_MODULE_POLICY"
  | "OUTSTANDING_PROJECTS" | "OUTSTANDING_TICKETS"
  | "UNCANCELED_SUBSCRIPTIONS" | "OUTSTANDING_FINANCIAL_OBLIGATIONS";

export type PublicationPreflight = {
  tenantId: string;
  sourceDraftRevision: number;
  currentDraftRevision: number;
  expectedPublicationRevision: number;
  currentPublicationRevision: number;
  candidate: {
    displayName: string; primaryColor: string; accentColor: string;
    moduleKeys: WhiteLabelModuleKey[];
  } | null;
  blockers: { code: PublicationBlockerCode }[];
};

export type PublishWhiteLabelResult = {
  outcome: "published" | "already_applied";
  receipt: PublicationReceipt;
};

export type PublicationReconciliation =
  | { outcome: "applied"; receipt: PublicationReceipt }
  | { outcome: "not_found" };
```

Timestamp strings are ISO timestamps. IDs are UUIDs. Arrays are sorted, unique known keys. No configurable module array grants permission: all existing membership/capability/RPC/RLS checks remain authoritative. Invalid wire shapes throw a database error; they are never interpreted as `unpublished`.

## Read and mutation interfaces

New separate `WhiteLabelPublicationRepository` and `WhiteLabelPublicationService` expose:

```ts
getRuntimeConfiguration(): Promise<RuntimeWhiteLabelConfiguration>;
preflight(input: Pick<PublishWhiteLabelInput,
  "tenantId" | "sourceDraftRevision" | "expectedPublicationRevision">):
  Promise<PublicationPreflight>;
publish(input: PublishWhiteLabelInput): Promise<PublishWhiteLabelResult>;
reconcile(input: PublishWhiteLabelInput): Promise<PublicationReconciliation>;
```

Repository uses the existing user-scoped Supabase client with the selected Tenant header, never a service-role client. Service validates input strictly; database functions derive current authority from the authenticated session. Branding imports types from `src/domain/white-label/publication.ts` and reads only `getRuntimeConfiguration()`. Branding must not read drafts or private tables, call publish, change permissions based on colors/configuration, or invent an independent schema.

Proposed public RPCs return one JSON object with the exact camelCase types above:

- `app_get_runtime_white_label_configuration()` — no Tenant parameter, selected Tenant derived through existing membership authorization. Active profile and Tenant, correct internal/client account class, and existing client Company boundary required. Platform Admin entitlement alone confers no Tenant runtime read. No publisher/source-editor identity is included in runtime data.
- `app_preflight_white_label_publication(p_tenant_id uuid, p_source_draft_revision integer, p_expected_publication_revision integer)` — Platform Admin only, read-only advisory. Missing/foreign authorization fails with the established neutral error handling; no publication/request or audit success row is written.
- `app_publish_white_label_draft(p_tenant_id uuid, p_source_draft_revision integer, p_expected_publication_revision integer, p_request_id uuid, p_reason text)` — Platform Admin only, identity always `auth.uid()`, active Tenant required.
- `app_reconcile_white_label_publication(...)` — same five input arguments as publish; currently authorized Platform Admin, target still active, read-only exact-request lookup. Mismatched binding raises conflict rather than `not_found`.

Grant only these narrow RPCs to authenticated, with explicit revocation from PUBLIC/anon/service_role. Keep `private.publish_tenant_modules(uuid, integer, text[], text)` inaccessible to API roles. Runtime reads authenticate normal Tenant membership independently of Platform Admin reads.

## Publish and retry semantics

Validate input; require current Platform Admin; refuse higher isolation as the accepted lifecycle protocol requires. Lock Tenant first, verify existence/active status and recheck Platform Admin after the wait. Before considering a new write, find `(auth.uid(), requestId)`: exact Tenant/source revision/expected publication revision/reason returns the original immutable receipt as `already_applied`, even when the draft or effective publication subsequently advanced. A conflicting use of that same request ID refuses. Returning a historical receipt never means it is still the effective configuration.

For a new request, lock the saved draft after Tenant coordination and recheck its exact revision; revision zero/defaults cannot publish. Read current module revision and reject stale expected publication revision. Copy only the locked saved draft. Delegate modules to the accepted private writer and its INSERT trigger, preserving dependencies, obligation checks, fresh post-wait authority and financial-history rules. Insert companion snapshot and content-free publication audit in the same transaction. Any failure rolls back both histories and audit; neither Tenant identity nor draft is modified.

Concurrent distinct requests with the same expected publication revision yield one publication and one conflict. Concurrent identical requests yield one publication and one exact receipt. Draft saves synchronize through the same draft row: publish copies either the reviewed locked revision or refuses; it cannot combine fields from two revisions. No automatic module enablement, obligation repair, cancellation or archival.

Preflight does not reserve authority, a revision or an approval. Publish independently repeats all authoritative checks, including outstanding work created after preflight. It does not consume a preflight token or trust client-supplied configuration.

If transport loses the publish response, retain the entire input/request UUID and mark the client outcome unknown. Call reconcile first: `applied` proves the committed receipt; `not_found` means no committed receipt was visible at that read, not proof that an in-flight transaction cannot still commit. Retry only the same input/request ID, allowing Tenant serialization to settle the race. A reconcile transport/authorization error leaves the result unresolved; never create a fresh request identity automatically.

## Runtime compatibility and fail-closed behavior

- `published`: latest module row has a valid exact companion snapshot; return that combined immutable snapshot.
- `legacy_modules`: latest valid module row has no companion; preserve its module enforcement and existing Branding fallback. Do not invent source-draft provenance or expose a saved draft.
- `unpublished`: no module publication exists; preserve existing module authorization and current shell defaults. Do not report nine enabled modules as a grant.
- Invalid latest module policy or malformed/mismatched companion: refuse read, never fallback to an older row, defaults or draft. Existing module enforcement continues to fail closed independently.

Approved Branding surfaces are Tenant internal workspace and client portal. Platform Admin shell stays Wolf Forge; login branding is deferred. Branding decides accessible presentation from the stored colors while retaining these raw immutable values.

## Required backend acceptance and current limits

Focused tests must cover current/removed Platform Admin, ordinary owner/staff/client/anon/service-role denial, active/inactive/missing/foreign Tenant, selected-Tenant runtime reads, stale source/publication, immutable history, exact request mismatch and replay after later changes, concurrent same/different requests, draft-save/publish races, committed-but-lost response, failure rollback and draft-save isolation. Exercise accepted eight-module dependencies/obligations, invalid-policy read denial, no-publication/legacy behavior and preserved financial history/replay. Real two-session races and installed grants/functions require the coordinator-allocated disposable backend.

Current state: receipt and contract draft only. No migration, application implementation, dependency preparation, database test, runtime QA or build has occurred. Any local documentation commit is identified separately in the delivery receipt and does not freeze this proposal. Integration Owner baseline confirmation, forward version/test-slot reservation, shared generated-type ownership, Branding contract acknowledgement and a guarded disposable backend remain pending. Source handoff evidence is historical; it is not a test pass for this backend.

Implementation references: [Supabase database function security](https://supabase.com/docs/guides/database/functions) and [PostgreSQL 17 transaction isolation](https://www.postgresql.org/docs/17/transaction-iso.html). Existing explicit private-function revocations and Tenant-first READ COMMITTED coordination remain authoritative project constraints.
