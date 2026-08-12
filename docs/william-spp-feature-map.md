# William SPP Feature Coverage Map

This document maps William's official SPP requirements to the verified Wolf Forge Platform foundation. It is a product coverage and sequencing guide, not an implementation specification. Statuses describe usable feature coverage, not merely the presence of a related table or helper.

Locked user-facing terminology is **Client = company/business** and **Project = order**. Existing backend names such as `companies`, `client_contacts`, `orders`, `order_tasks`, and `activity_events` remain appropriate and should not be renamed solely to match UI labels.

## 1. Executive scope

Wolf Forge Platform is intended to become the owned operating system for the agency-client relationship now spread across SPP, Wayfront, and adjacent manual or third-party workflows. The target is a branded experience covering sales, onboarding, delivery, communication, billing, automation, and integrations while giving Wolf Forge staff a coherent internal workspace.

The objective is capability replacement, not a screen-for-screen copy. William's requirements define outcomes. Wolf Forge can consolidate fragmented workflows and improve their sequence, permissions, and visibility without copying proprietary Wayfront templates or reproducing every SPP behavior exactly.

The verified platform currently supplies a useful data and application foundation for Clients, Contacts, Services, Projects, Project Tasks, and Activity. It does **not** yet constitute a client portal, sales system, billing ledger, form system, messaging system, automation engine, or public integration platform. Phase 2B security and transactional work is in progress in another worktree and must remain treated as pending until audited, integrated, and verified.

## 2. Feature coverage matrix

Status meanings:

- **FOUNDATION EXISTS** — the core backend/domain foundation exists, although usable UI may still be absent.
- **PARTIAL** — some supporting capability exists, but the requirement is not usable end to end.
- **NOT STARTED** — no verified feature-specific implementation exists.
- **BLOCKED BY DEPENDENCY** — work should wait for a prerequisite needed for a safe or coherent implementation.
- **FUTURE** — deliberately deferred beyond nearer operational slices.

### 2.1 Client Portal

| Feature | Required capability | Current status | Existing foundation | Missing backend/domain entities | Missing UI | Dependencies | Suggested phase |
|---|---|---|---|---|---|---|---|
| Client login | Each client receives secure, appropriately scoped portal access | PARTIAL | `profiles`, `roles`, `companies`, `client_contacts`, Supabase client factories | Client membership/access model may be needed if contacts can belong to or access more than one Client; invite/session recovery flows | Login, invitation acceptance, password recovery, access-denied and account settings screens | Completed Phase 2B authorization audit; explicit contact-to-profile and Client access rules | Phase 4 — Portal Core |
| Branded client dashboard | A Wolf Forge dashboard summarizes the Client's work and actions | BLOCKED BY DEPENDENCY | Client, Project, Task, Service, and Activity data foundations | Portal-safe dashboard projections/read models; preference or branding configuration where needed | Dashboard shell, summaries, outstanding actions, status cards and responsive navigation | Secure portal boundary; Project visibility rules; portal-safe activity policy | Phase 4 — Portal Core |
| Central workspace | One place for projects, invoices, files, messages, and services | PARTIAL | Clients, Services, Projects, Tasks, Activity | Invoices, files, messages, and portal content/access concepts | Unified navigation plus each module's list/detail views | Each underlying module; portal authorization; safe aggregation | Phase 4 onward, expanded by later slices |
| Custom domain and branding | Serve the portal through approved Wolf Forge/agency branding and domain configuration | FUTURE | No verified custom-domain or tenant-branding capability; application domain validation is unrelated | Branding settings, domain verification/configuration, certificate/routing metadata if required | Branding administration, domain setup/status and branded portal theme | Hosting strategy, DNS/certificate operations, secure tenant resolution | Phase 9 — White-label and Cutover |

### 2.2 Proposals & Sales

| Feature | Required capability | Current status | Existing foundation | Missing backend/domain entities | Missing UI | Dependencies | Suggested phase |
|---|---|---|---|---|---|---|---|
| Proposals | Draft, present, revise, accept, reject and retain commercial offers | NOT STARTED | Clients, Contacts, Services | `proposals`, `proposal_items`; lifecycle/version or acceptance evidence as required | Proposal builder, preview, client review/acceptance and status views | Client access; package/pricing rules; audit policy | Phase 6 — Sales and Checkout |
| Product/service packages | Bundle priced services and options into reusable offers | PARTIAL | `services` provides a service catalog foundation | `packages` and package contents/pricing only if a service alone cannot represent a bundle | Package catalog, editor, pricing/options and availability controls | Pricing/currency/tax decisions; service lifecycle rules | Phase 6 — Sales and Checkout |
| Online checkout | Let a client select an offer, provide required details and pay safely | BLOCKED BY DEPENDENCY | Clients, Contacts, Services; Projects can become the delivery result | Checkout session/order-sale record or external references; payment records | Hosted or embedded checkout journey, confirmation, failure and retry states | Processor decision; pricing; payment webhooks; idempotency; security | Phase 6 — Sales and Checkout |
| Recurring subscriptions | Sell recurring services with clear renewal and lifecycle behavior | BLOCKED BY DEPENDENCY | Services and Projects can identify what will be delivered | `subscriptions` plus processor references and lifecycle state | Plan selection, confirmation and subscription status/management | Payment processor; recurring pricing; webhook reconciliation; cancellation policy | Phase 7 — Billing and Subscriptions |
| Upsells and add-ons | Offer relevant optional additions during or after purchase | NOT STARTED | Services could supply add-on items | Package/add-on relationships or proposal/checkout line items | Add-on selection, totals and eligibility presentation | Packages, checkout, pricing and fulfillment mapping | Phase 6 or 7, after base checkout |
| Contracts/agreements | Present terms, capture acceptance/signature and retain evidence | NOT STARTED | Clients, Contacts, Activity can support context/audit history | `contracts`; agreement version and acceptance/signature evidence as legally required | Template selection, review, sign/accept, download and status | Legal/e-signature decision; identity and retention policy; proposal lifecycle | Phase 6 — Sales and Checkout |

### 2.3 Billing & Payments

| Feature | Required capability | Current status | Existing foundation | Missing backend/domain entities | Missing UI | Dependencies | Suggested phase |
|---|---|---|---|---|---|---|---|
| Recurring billing | Generate and collect recurring charges accurately | BLOCKED BY DEPENDENCY | Clients and Services provide customer/service context | `subscriptions`, invoices, invoice items, payments; processor event references | Billing setup, schedules, status, exceptions and history | Processor and tax/currency decisions; webhook/idempotency design; reconciliation | Phase 7 — Billing and Subscriptions |
| One-time payments | Accept and reconcile a single charge | BLOCKED BY DEPENDENCY | Clients, Services and Projects can provide business context | `payments` and checkout/processor references; invoice linkage where applicable | Pay/confirmation/failure/refund status views | Processor integration; immutable money representation; webhook verification | Phase 6 — Sales and Checkout |
| Invoices | Issue numbered line-item invoices and track their lifecycle | NOT STARTED | Clients, Contacts, Services, Projects | `invoices`, `invoice_items`; numbering, currency, tax and balance rules | Invoice creation, client invoice view, download and status/history | Accounting ownership decision; payment linkage; legal invoice requirements | Phase 7 — Billing and Subscriptions |
| Payment collection | Collect against checkout or invoice and reconcile final status | BLOCKED BY DEPENDENCY | No verified payment-specific module | Payments, payment attempts/events, refunds/disputes only if in scope | Payment method/hosted payment flow, retry and receipt states | Payment processor; webhook security; reconciliation and failure handling | Phase 6 then hardened in Phase 7 |
| Automatic payment reminders | Notify clients before/after due dates without duplicate or inappropriate sends | BLOCKED BY DEPENDENCY | Activity handling may record outcomes | Notification jobs/events; reminder policy/configuration; automation run linkage | Reminder policy controls, previews, history and opt-out/exception handling | Invoices, due dates, notifications, scheduler/automation, delivery provider | Phase 8 — Automation and Integrations |
| Subscription management | View, change, pause or cancel recurring services within policy | BLOCKED BY DEPENDENCY | No verified subscription module | `subscriptions`; plan changes and processor lifecycle references | Internal and client subscription controls, proration/cancellation messaging | Recurring billing, processor capabilities, permissions and commercial policy | Phase 7 — Billing and Subscriptions |

### 2.4 Project & Service Delivery

| Feature | Required capability | Current status | Existing foundation | Missing backend/domain entities | Missing UI | Dependencies | Suggested phase |
|---|---|---|---|---|---|---|---|
| Client projects | Create and manage delivery work associated with a Client | FOUNDATION EXISTS | `orders`, `companies`, repositories, business services and tests | Additional delivery fields or milestones only when validated by workflows | Internal Project list/detail/create/edit; later client Project view | Phase 2B correctness; defined Project lifecycle and visibility | Phase 3 — Project Delivery |
| Tasks and deliverables | Plan assignments, due work, completion and client deliverables | FOUNDATION EXISTS | `order_tasks` and application foundation | Assignees, deliverable/version concepts only if current fields cannot support confirmed workflow | Task list/detail, ownership, due dates, status changes and deliverable presentation | Secure mutations; staff identity; lifecycle rules | Phase 3 — Project Delivery |
| Client-facing status | Expose a deliberately limited, understandable view of delivery progress | BLOCKED BY DEPENDENCY | Projects, Tasks and Activity provide source data | Portal-safe status projection and visibility/publication controls | Client Project timeline/status and deliverable views | Portal shell; field-level visibility; internal/client status policy | Phase 4 — Portal Core |
| File sharing | Upload, associate, authorize, scan where needed and share files | NOT STARTED | Clients, Projects and Tasks provide ownership context | `files` metadata plus storage references, access classification and associations | Upload/download, preview, version/list and permission-aware sharing | Storage provider; signed access; retention/file-size/type policies | Phase 4 — Portal Core |
| Client requests | Let clients submit and track scoped requests connected to work | NOT STARTED | Clients, Contacts, Projects, Tasks | `client_requests` or a deliberately unified ticket/request model | Request submission, attachments, status, staff triage and client tracking | Portal access; files; notifications; request-to-task rules | Phase 5 — Intake and Communication |
| Fulfillment automation | Turn qualifying sales/onboarding events into predictable delivery setup/actions | BLOCKED BY DEPENDENCY | Business service and Activity foundations can host orchestration safely later | Automation rules/runs and action definitions; templates only where repeatable setup requires them | Rule configuration, run history, failures/retry and manual override | Stable Project/Task workflows; purchase events; notifications; idempotency | Phase 8 — Automation and Integrations |

### 2.5 Forms & Questionnaires

| Feature | Required capability | Current status | Existing foundation | Missing backend/domain entities | Missing UI | Dependencies | Suggested phase |
|---|---|---|---|---|---|---|---|
| Client intake forms | Collect structured intake data for a Client or Project | NOT STARTED | Clients, Contacts and Projects provide target context | `forms`, `form_submissions`; field definitions may be embedded/versioned within a form model | Form builder, assignment, client completion, save/submit and staff review | Portal access; form versioning; validation and visibility rules | Phase 5 — Intake and Communication |
| Onboarding questionnaires | Ask service/project-specific onboarding questions and track completion | NOT STARTED | Services and Projects can select the relevant questionnaire | Forms/submissions may satisfy this; separate questionnaire entity is unnecessary unless workflows materially differ | Questionnaire template, progress, completion and review | Forms; purchase/project trigger; notifications | Phase 5 — Intake and Communication |
| Collect information/files | Accept answers and uploads together with clear ownership | NOT STARTED | Client/Project context | Form submissions and files/storage associations | Mixed input/upload form experience and reviewer view | Forms; file storage/security; upload limits and retention | Phase 5 — Intake and Communication |
| Custom fields | Extend supported records with governed business-specific data | NOT STARTED | Existing entity identifiers can anchor future field values | `custom_fields` and values only for approved record types; avoid using them to replace core typed fields | Field administration, validation and rendering in approved contexts | Data type/validation rules; search/reporting needs; permissions | Phase 5 or later, driven by real forms/migration needs |

### 2.6 Client Communication

| Feature | Required capability | Current status | Existing foundation | Missing backend/domain entities | Missing UI | Dependencies | Suggested phase |
|---|---|---|---|---|---|---|---|
| Client messaging | Support secure two-way conversations with appropriate participants and context | NOT STARTED | Clients, Contacts and Projects establish context | `messages`; conversation/thread concept only if needed for grouping and participants | Inbox/thread, composer, attachments, read/unread and participant controls | Portal access; staff permissions; files; notification delivery | Phase 5 — Intake and Communication |
| Notifications | Deliver actionable in-app and external alerts with preferences and delivery state | NOT STARTED | Activity events may be an input, but are not notifications | `notifications`; delivery attempts/preferences where required | Notification center, unread state and preference controls | Event policy; email/provider decision; background delivery and retries | Phase 5 baseline, Phase 8 automation |
| Portal updates | Publish selected announcements or progress updates inside the portal | PARTIAL | `activity_events` can support audit/activity history | Client-visible update/publication model or explicit visibility classification | Client update feed with clear actor/time/context | Portal shell; activity redaction/visibility policy | Phase 4 — Portal Core |
| Project-centered communication | Keep requests, messages, updates and files connected to a Project | BLOCKED BY DEPENDENCY | Clients, Projects, Tasks and Activity supply the anchor | Messages, files, requests and their Project associations | Project conversation/activity workspace | Portal Project view and communication modules | Phase 5 — Intake and Communication |

### 2.7 Automation

| Feature | Required capability | Current status | Existing foundation | Missing backend/domain entities | Missing UI | Dependencies | Suggested phase |
|---|---|---|---|---|---|---|---|
| Purchase-triggered actions | React once to a confirmed purchase and start approved downstream work | BLOCKED BY DEPENDENCY | Business service/activity patterns; Services and Projects | Automation rules/runs; durable purchase/payment event intake | Trigger/action setup, execution history, failure recovery | Checkout/payment truth; idempotency; stable onboarding actions | Phase 8 — Automation and Integrations |
| Automated onboarding | Create/assign the correct intake and delivery steps from an accepted sale | BLOCKED BY DEPENDENCY | Clients, Services, Projects, Tasks | Automation rules/runs; reusable onboarding configuration if required | Onboarding template/rule selection, run status and exceptions | Packages/sales mapping; forms; Project/Task lifecycle; notifications | Phase 8 — Automation and Integrations |
| Task assignment | Assign generated or existing work based on approved rules | BLOCKED BY DEPENDENCY | Project Tasks and profiles/roles | Assignment/routing policy and automation run evidence | Assignment rule controls, queue and override | Staff/role model; Task workflow; notification policy | Phase 8 — Automation and Integrations |
| Automated emails/notifications | Send event-driven communications with suppression, retry and auditability | BLOCKED BY DEPENDENCY | Activity handling may provide event inputs | Notifications, templates/configuration, delivery attempts and automation runs | Template/rule controls, preview, delivery history and preferences | Notification provider; consent/preferences; reliable event execution | Phase 8 — Automation and Integrations |
| Integration/API actions | Invoke approved external systems reliably and record outcomes | BLOCKED BY DEPENDENCY | Repositories and business services give an internal application boundary | Integrations, credentials/configuration references, automation runs and action results | Connection setup, action configuration, health and run history | Integration auth/secrets; retries; idempotency; rate limits; observability | Phase 8 — Automation and Integrations |

### 2.8 Integrations

| Feature | Required capability | Current status | Existing foundation | Missing backend/domain entities | Missing UI | Dependencies | Suggested phase |
|---|---|---|---|---|---|---|---|
| Payment processors | Securely connect checkout, invoices, payments and subscriptions to a processor | BLOCKED BY DEPENDENCY | No verified payment-specific integration | Integration/account references, processor customer IDs, webhook events and payment domain entities | Connection/configuration status, test/production safeguards and reconciliation views | Processor approval; secret handling; webhook verification; billing model | Phase 6 and 7 |
| CRM/automation platforms | Exchange approved Client, sales and lifecycle data with external platforms | NOT STARTED | Clients, Contacts, Services, Projects | `integrations`; external ID mappings/sync state where necessary | Connection, field mapping, sync status and error resolution | Source-of-truth decisions; API credentials; conflict/deduplication policy | Phase 8 — Automation and Integrations |
| Project/business tools | Exchange selected delivery or operational data with third-party tools | FUTURE | Projects and Tasks provide internal context | Integrations and external mappings; avoid per-tool entities unless justified | Per-integration setup, mapping and health views | Stable internal workflows; tool selection; ownership of edits | Phase 8 or later, by business value |
| API capabilities | Offer a supported, authenticated interface for approved external operations | PARTIAL | Domain validation, repositories, business services and Supabase factories are useful internals | Public API contract/versioning, API clients/keys or OAuth, webhook subscriptions, request/idempotency/audit controls | Developer/admin controls, credentials, webhook logs and documentation | Security model; rate limiting; stable domain behavior; observability | Phase 8 — Automation and Integrations |

### 2.9 White-label / Agency Branding

| Feature | Required capability | Current status | Existing foundation | Missing backend/domain entities | Missing UI | Dependencies | Suggested phase |
|---|---|---|---|---|---|---|---|
| Wolf Forge logo | Consistent approved logo treatment across portal and client artifacts | NOT STARTED | No verified branding feature is claimed | Branding configuration only if assets are administered rather than deployed statically | Branded application chrome, authentication, emails and documents | Approved brand assets and usage rules | Phase 4 baseline, refined in Phase 9 |
| Wolf Forge colors/branding | Apply approved typography, color and voice consistently | NOT STARTED | No verified theme/branding capability is claimed | Theme/branding settings if runtime configuration is required | Design tokens/theme, branded empty/error/loading states and communications | Brand system approval; accessibility contrast | Phase 4 baseline, refined in Phase 9 |
| Custom domain | Deliver the intended experience at an approved custom domain | FUTURE | No verified custom-domain capability | Domain configuration/verification and tenant routing metadata if required | Domain setup, verification and error/status controls | Hosting, DNS, certificates, tenant resolution and operational ownership | Phase 9 — White-label and Cutover |
| Proprietary client-platform experience | Provide a cohesive Wolf Forge journey rather than exposing vendor-fragmented workflows | PARTIAL | Owned Client/Service/Project/Task/Activity domain foundation | The feature-specific domains identified in this roadmap | Separate client shell, coherent navigation and cross-module workflows | Secure portal boundary; vertical slices; approved experience design | Begins Phase 4; matures through Phase 9 |

## 3. Current platform foundation

The current foundation maps to William's language as follows:

| Current backend/application foundation | User-facing meaning | Coverage enabled | Important limit |
|---|---|---|---|
| `roles` | Staff/client permission categories | A basis for authorization and role-aware experiences | A role record alone does not prove row-level portal isolation or feature permissions |
| `companies` | **Clients** | Client ownership/context across delivery and future sales/billing | Does not itself provide a portal, branding, billing account, or membership policy |
| `profiles` | Platform user/staff identity | Actor identity and role association | Client invitation, contact linking and portal access rules still require verified treatment |
| `client_contacts` | Contacts within a Client | Contact records for onboarding, proposals, billing and communication | Does not yet equal an authenticated portal user or messaging participant |
| `services` | Service catalog/package foundation | Reusable description of what Wolf Forge sells or delivers | Bundles, price versions, add-ons, tax and recurring plan behavior are not verified |
| `orders` | **Projects** | Core delivery work connected to a Client | Sales orders, proposals, checkout and invoices must not be inferred from the table name |
| `order_tasks` | Project tasks/deliverables foundation | Work breakdown and delivery progress | Rich deliverable, assignment and client-visibility behavior may still be needed |
| `activity_events` | Audit/activity history | Traceability and a possible source for carefully selected updates | Audit events are not messages or notifications and must not be exposed wholesale to clients |
| Domain validation | Application input and rule validation | Safer domain operations | It is not custom internet-domain validation or domain hosting |
| Repositories | Data-access boundary | Consistent persistence operations for implemented domains | Not a public API and not proof of authorization for every future feature |
| Business services | Application workflow boundary | A place for tested business operations and later orchestration | Not an automation engine by itself |
| Supabase client factories | Controlled Supabase client construction | A basis for server/client access patterns | Portal authorization and service-role isolation must be verified in Phase 2B |
| Activity handling | Consistent activity creation/handling | Audit support for application workflows | Client visibility, notifications and communication need separate policies/models |
| Application tests and local synthetic smoke workflow | Verification foundation | Repeatable checks against synthetic data | Synthetic smoke does not substitute for security audit, production monitoring or migration reconciliation |

Phase 1 database foundation and Phase 2A application foundation are verified. Phase 2B security/transaction changes are explicitly **in progress elsewhere**. They should enter this map as completed only after integration, audit, and tests demonstrate the intended authorization and transaction boundaries.

## 4. Missing domain model

The following are likely domain concepts, not prescribed SQL tables. Some concepts can be combined if their lifecycle and access rules are genuinely the same. New entities should be introduced only when a vertical slice proves the need.

| Concept | Why it is needed | Scope discipline |
|---|---|---|
| `proposals` | Holds a commercial offer's Client, state, validity, totals and acceptance lifecycle | Preserve accepted terms; do not treat a mutable Service record as the historical offer |
| `proposal_items` | Captures the services, quantities, options and prices actually offered | May also support add-ons; needs price snapshots rather than live catalog lookups |
| `packages` | Represents reusable bundles when Wolf Forge sells multiple services/options together | Skip a separate package entity if the verified catalog can express every needed offer cleanly |
| `contracts` | Retains agreement version, parties, status and acceptance/signature evidence | External e-signature references may be sufficient; legal requirements determine stored evidence |
| `invoices` | Represents amount due, due date, currency, status, numbering and Client/Project context | Must be distinct from Projects and processor charge objects |
| `invoice_items` | Explains invoice totals using durable line-level descriptions and amounts | Essential for reconciliation and history; avoid recalculating old invoices from current prices |
| `payments` | Records collection attempts/outcomes, amount, currency, processor references and invoice/checkout links | Processor data is authoritative for some events, but the platform needs reconciled business state |
| `subscriptions` | Tracks recurring commercial commitments and their processor lifecycle | Keep subscription state distinct from recurring Project delivery state |
| `files` | Stores metadata, ownership, storage reference, access classification and links to Client/Project/request/form/message | Binary storage can remain external; authorization belongs in the platform |
| `messages` | Supports two-way human communication, authorship, recipients, context and read state | A thread/conversation concept is optional until participant/grouping needs require it |
| `tickets` | Could support issue-like queues with assignment, priority and resolution | Introduce only if support cases differ materially from `client_requests`; do not create both by default |
| `forms` | Defines reusable, versioned intake/questionnaire structures and their intended context | Field definitions can be part of the form model; avoid premature generic schema machinery |
| `form_submissions` | Preserves answers, submitter, version, status and related Client/Project | Required to distinguish a template from each client's response |
| `custom_fields` | Allows approved extensibility for migration or business-specific attributes | Use only where real variation exists; core searchable/reportable fields should remain first-class |
| `client_requests` | Gives client-initiated work a lifecycle, owner, status and Project context | May absorb the `tickets` use case if one request workflow serves both |
| `notifications` | Tracks an intended recipient, channel, content/reference, read/delivery state and retries | Keep separate from Activity because audit history and delivery obligations differ |
| `automation_rules` | Defines approved trigger/condition/action behavior | Build only after trigger and action contracts are stable; version changes safely |
| `automation_runs` | Records each execution, actions, outcomes, retry state and errors | Needed for idempotency, support and trustworthy recovery |
| `integrations` | Represents an external connection, provider, scope, status and non-secret configuration references | Secrets require a secure secret store; provider-specific state should remain limited |

Supporting concepts such as external ID mappings, webhook event receipts, notification delivery attempts, branding settings, or API credentials may be necessary within particular slices. They should not become generic modules before an approved integration, delivery provider, or multi-brand requirement establishes their lifecycle.

## 5. Dependency graph

These are logical sequencing guides, not claims that every arrow requires a separate table or release.

```text
Secure identity + authorization + transaction boundaries
  -> Internal operator shell
  -> Portal-safe Client access
  -> Every client-visible or money-moving feature

Clients
  -> Contacts
  -> Projects
  -> Tasks / deliverables
  -> Client-safe status, files, requests and communication

Services
  -> Packages (only when bundling is needed)
  -> Proposals
  -> Checkout
  -> Payments
  -> Project/onboarding creation

Recurring offer
  -> Checkout/customer authorization
  -> Subscription
  -> Recurring invoice/charge events
  -> Reconciliation and subscription management

Purchase confirmed
  -> Onboarding assignment
  -> Intake form/questionnaire
  -> Project
  -> Tasks
  -> Notifications

Stable domain events and workflows
  -> Automation rules
  -> Automation runs
  -> External integration actions
```

Important qualifications:

- A Project may be created manually without a proposal or checkout. Sales is therefore a common upstream path, not a mandatory dependency for all Projects.
- A proposal can exist without an on-platform payment if Wolf Forge deliberately supports offline acceptance or invoicing.
- Files and messages can attach to a Client, Project, request, or form; forcing all of them through Projects would be unnecessarily restrictive.
- Notifications can ship first for a few explicit events. A general automation engine is not required for the initial notification slice.
- Contracts may be tied to proposals, Clients, or Projects depending on approved commercial/legal workflow.
- Custom branding can begin with static Wolf Forge styling. Runtime brand configuration and custom domains can follow when operational ownership is settled.

## 6. Recommended implementation sequence

The sequence favors secure vertical slices that become usable early. Migration discovery, data mapping, and reconciliation planning should run alongside feature work, not wait until cutover.

### Phase 2B — Security and transaction correctness

- Complete and audit authorization, tenant/Client isolation, privileged-client boundaries, transactional behavior and activity correctness.
- Add adversarial tests for cross-Client reads/writes and confirm internal-only fields cannot enter portal projections.
- Treat this as the gate for client access and money-moving features.

### Phase 3 — Internal Project Delivery vertical slice

- Deliver an operator workflow for Clients -> Contacts -> Projects -> Tasks -> Activity.
- Support the minimum useful lifecycle, assignments/statuses, validation and safe mutations.
- Validate terminology in the UI while retaining existing backend names.
- Use real workflow feedback to identify only the additional delivery fields/entities actually needed.

### Phase 4 — Client Portal Core

- Create a separate authenticated client application shell sharing the same domain/backend.
- Deliver invitation/login, Client dashboard, client-safe Project status, Tasks/deliverables selected for visibility, files, and explicitly published updates.
- Apply baseline Wolf Forge branding and responsive/accessibility standards.
- Make the first portal slice useful without depending on proposals or billing.

### Phase 5 — Intake and Communication

- Add forms/submissions, onboarding questionnaires, file collection and Client requests.
- Add Project-centered messages and a focused notification baseline for important actions.
- Prefer one coherent request workflow; add a distinct ticket model only if support operations demonstrate different behavior.

### Phase 6 — Sales, Contracts and One-time Checkout

- Add packages where required, proposals/items, acceptance/contracts, add-ons and one-time checkout.
- Integrate the selected payment processor using hosted components where appropriate to reduce payment-data exposure.
- Reconcile processor webhooks idempotently and turn a confirmed purchase into an explicit, reviewable onboarding/Project handoff.

### Phase 7 — Billing and Subscriptions

- Add invoices/items, recurring subscriptions, payment history, subscription management and reconciliation tools.
- Establish invoice numbering, tax/currency, refund/dispute, cancellation/proration and accounting source-of-truth policies before broad rollout.
- Treat billing accuracy, auditability and recovery from out-of-order/duplicate processor events as release criteria.

### Phase 8 — Automation and Integrations

- Begin with a small set of high-value triggers and actions: confirmed purchase -> onboarding/form/Project/Tasks -> notifications.
- Add automation run history, retries, manual recovery and idempotency before expanding the rule builder.
- Introduce CRM, automation, project/business-tool and public API capabilities according to approved source-of-truth and integration priorities.

### Phase 9 — White-label hardening and migration/cutover

- Finalize runtime branding only if needed, custom-domain operations, branded communications/artifacts and portal polish.
- Execute staged SPP/Wayfront migration with reconciliation and rollback/cutover planning.
- Retire old workflows only after functional, financial and access verification.

This order intentionally avoids building every backend domain before the platform becomes usable. Each phase should include a working internal or client journey, authorization checks, observable failures, tests, and migration-safe changes.

## 7. Internal app vs Client Portal

Wolf Forge should have two application shells sharing the same domain services and backend controls:

| Internal Wolf Forge operator app | Client Portal |
|---|---|
| Staff workflows across Clients, Projects, Tasks, requests, sales, billing and operations | A Client-scoped experience for authorized contacts |
| May expose staff assignments, operational queues, internal notes and detailed audit/support data according to staff role | Exposes only deliberately published/client-safe status, deliverables, files, messages, forms, invoices and actions |
| Supports privileged corrections, triage and administration with strong audit controls | Never receives privileged controls or broad data-query capability |
| Can navigate across Clients when the staff role permits | Must remain within the contact's authorized Client(s) and allowed Projects/resources |

Sharing a backend does not mean sharing raw queries or serializing the same object to both shells. The Client Portal should consume explicit portal-safe use cases/projections. Deny-by-default field and row access should ensure the portal cannot accidentally expose:

- internal-only notes or staff discussion;
- raw `activity_events` payloads or sensitive audit detail;
- staff-only controls, assignments, margins, operational metadata or exception tooling;
- other Clients' records or broadly joined database rows;
- service-role credentials, processor secrets or external integration configuration.

Defense should exist at both the database/access-policy boundary and the application/domain boundary. UI hiding alone is not authorization.

## 8. Wayfront / SPP migration impact

No migration scripts are part of this roadmap. Discovery must first identify exportability, data ownership, volume, quality, attachments, identifiers, timestamps, financial history and retention obligations.

| Migration group | Likely data to map | Key verification concerns |
|---|---|---|
| Clients | Companies/businesses, status, external IDs, addresses and metadata | Duplicates, archived records, ownership and Client identity matching |
| Contacts | People, roles, emails, phone details and portal access candidates | Duplicate emails, inactive contacts, Client association and invitation safety |
| Services | Catalog items, descriptions, pricing references and availability | Historical versus current pricing, recurring flags and package relationships |
| Projects/orders | Delivery records, service links, state, dates and owners | Locked terminology mapping, lifecycle/status mapping and historical completeness |
| Tasks | Work items, assignments, due dates, state and deliverables | User mapping, orphan tasks, ordering and completion timestamps |
| Files | Attachments, filenames, types, sizes, owners and associations | Export availability, checksums/counts, permissions, malware scanning and broken links |
| Messages | Threads/comments, authors, recipients, timestamps and attachments | Participant mapping, internal-versus-client visibility and unsupported formatting |
| Forms | Templates, questions, responses and uploaded files | Form version, response ownership, field types and incomplete submissions |
| Invoices | Numbers, line items, currency, tax, totals, balance and status | Number uniqueness, immutable history, voids/credits and accounting reconciliation |
| Payments | Charges, refunds, disputes, processor references and allocation | Never re-charge during import; amount/currency totals and processor truth |
| Subscriptions | Customer, plan, price, state, renewal/cancel dates and processor IDs | Avoid duplicate subscriptions; live processor ownership and cutover timing |
| Pipeline/sales | Leads/opportunities, proposals, stages, values and outcomes | Stage mapping, lost/archive history, duplicate Client creation and accepted terms |
| Settings/branding | Agency identity, domains, templates, email settings and preferences | Secret exclusion, unsupported settings, DNS ownership and approved assets |

Real-data migration should use this controlled sequence:

1. **Dry run** — run against a non-production target with no live side effects, emails, charges, invitations or automations.
2. **Mapping validation** — obtain business approval for field, status, identity, visibility and source-of-truth mappings.
3. **Counts and reconciliation** — compare totals by entity, state, time period, currency and relevant financial aggregates; record explainable exclusions.
4. **Sample migration** — migrate representative Clients including edge cases, attachments, historical records and at least one financial/subscription scenario where applicable.
5. **Full migration** — use a controlled window, repeatable/idempotent process, captured errors and an approved rollback/cutover plan.
6. **Post-migration verification** — recheck counts, samples, permissions, file access, financial balances, subscriptions, links and user-facing workflows before retiring legacy access.

Financial and subscription migrations require special care: historical records may be imported for reference while the payment processor remains the operational source of truth. No migration should create charges, renew subscriptions, send messages, trigger onboarding, or invite users unless the cutover plan explicitly enables that effect.

## 9. Definition of V1

### OPERATIONAL V1

Operational V1 is the smallest secure, coherent system that improves day-to-day delivery for Wolf Forge and its clients:

- audited Phase 2B authorization and transactional boundaries;
- an internal operator experience for Clients, Contacts, Services, Projects, Tasks and Activity;
- a separate Wolf Forge-branded Client Portal shell with secure login/invitation;
- client-safe Project status, selected Tasks/deliverables and published updates;
- secure file sharing;
- intake form/questionnaire submission with file collection;
- Client requests and Project-centered messaging;
- focused in-app/email notifications for a small approved set of events;
- synthetic and representative-data verification, with migration mappings prepared for the included domains.

Operational V1 does **not** need a generic automation builder, public API, every third-party integration, runtime multi-brand theming, custom-domain self-service, full proposal/contract tooling, or native recurring billing. Existing approved external payment/invoice workflows can remain linked or manually coordinated during V1 if William and Anthony accept that boundary and no financial state is misrepresented inside the portal.

### FULL SPP REPLACEMENT

Full SPP replacement is reached only when the approved Wolf Forge scope also covers:

- proposals, packages, add-ons, acceptance/contracts and online checkout;
- trustworthy invoices, payments, recurring billing, subscription management, reminders and reconciliation;
- purchase-driven onboarding and fulfillment automation with run history and recovery;
- approved CRM/automation/business-tool integrations and supported API capabilities;
- complete Wolf Forge branding and custom-domain operations;
- migrated and verified legacy data for all retained categories;
- operational reporting, support procedures, monitoring and failure recovery sufficient to retire the legacy workflows.

The two definitions prevent “V1” from implying that all nine feature groups ship simultaneously while keeping the complete replacement target explicit.

## 10. Open product decisions

These decisions materially change scope, data ownership, legal/financial behavior, security, or migration strategy and need William/Anthony approval:

1. **Operational V1 boundary:** Approve whether the proposed delivery/portal/intake/communication slice is sufficient and which current billing/sales workflows remain external until Phases 6–7.
2. **Client access model:** Decide which Contacts may log in, whether a person can access multiple Clients, who can invite/remove contacts, and whether Client-side admin roles are required.
3. **Client visibility policy:** Approve which Project/Task statuses, deliverables, Activity-derived updates, staff identities and timestamps are client-visible, including the publication workflow.
4. **Request versus ticket workflow:** Confirm whether one Client Request lifecycle covers both service requests and support cases or whether support requires distinct priorities, SLAs and queues.
5. **Sales-to-delivery handoff:** Define when a proposal/contract/checkout becomes authoritative and whether Project creation is automatic, reviewed, or configurable by package.
6. **Contracts and signatures:** Decide whether typed acceptance is sufficient for any agreement type or a specific e-signature provider/evidence standard is required.
7. **Billing ownership and processor:** Select the payment processor and accounting source of truth; approve currencies, taxes, invoice numbering, refunds/disputes, proration, cancellation and failed-payment policies.
8. **Notification channels and consent:** Approve which events may send email/in-app notifications, sender identity, preference/consent rules and escalation expectations.
9. **Integration priorities and source of truth:** Rank the CRM/automation/project tools and decide which system owns each shared field to prevent destructive two-way synchronization.
10. **Brand/domain operating model:** Confirm whether only Wolf Forge branding is required or per-brand configuration is needed, and who owns DNS, certificates, email sending domains and custom-domain support.
11. **Migration retention and cutover:** Approve the history window, archived-data treatment, financial record policy, attachment retention, legacy read-only period, cutover window and reconciliation sign-off owners.

