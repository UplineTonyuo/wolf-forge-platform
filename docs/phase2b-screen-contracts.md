# Phase 2B — Screen Contracts

Implementation-ready contracts for the first clickable Wolf Forge Platform UI.

Read [phase2b-product-shell.md](phase2b-product-shell.md) first — it defines the shell,
the overlay rules, and the global loading / empty / error / success patterns that these
contracts reference by name instead of repeating.

---

## 0. Binding facts

### 0.1 Fields that exist

Taken from `supabase/migrations/20260812024130_initial_core_schema.sql`. **No screen may
reference a field outside this table.**

| Entity | Fields |
| --- | --- |
| `companies` | `id`, `name`, `created_at`, `updated_at`, `archived_at` |
| `client_contacts` | `id`, `company_id`, `profile_id`, `name`, `email`, `phone`, `job_title`, `is_primary`, `created_at`, `updated_at`, `archived_at` |
| `services` | `id`, `name`, `description`, `is_active`, `created_at`, `updated_at`, `archived_at` |
| `orders` | `id`, `order_number`, `company_id`, `service_id`, `assigned_to_profile_id`, `title`, `status`, `priority`, `due_at`, `started_at`, `completed_at`, `notes`, `created_at`, `updated_at`, `archived_at` |
| `order_tasks` | `id`, `order_id`, `assigned_to_profile_id`, `title`, `description`, `status`, `due_at`, `sort_position`, `completed_at`, `created_at`, `updated_at`, `archived_at` |
| `activity_events` | `id`, `actor_profile_id`, `entity_type`, `entity_id`, `action`, `summary`, `metadata`, `created_at` |
| `profiles` | `id`, `role_id`, `company_id`, `display_name`, `created_at`, `updated_at`, `archived_at` |
| `roles` | `id`, `name` ∈ `owner`, `admin`, `manager`, `staff`, `client` |

Notable absences that screens must not paper over: **companies have no address, phone,
website, industry, or owner. Services have no price. Tasks have no priority. Profiles have
no email.**

**Vocabulary.** This table is the *backend*. Two entities carry a different product label,
per the vocabulary lock in the shell document:

| Backend | UI label |
| --- | --- |
| `companies` | **Client** |
| `orders` | **Project** |

Every identifier below — `orders`, `order_tasks`, `order_id`, `order_number`,
`OrderService`, `OrderRepository`, `createOrderSchema`, `updateOrderSchema`,
`ListOrdersFilter`, `orderCompletionPatch`, the order-status enum, and every `/orders`
route — is **backend vocabulary and is never renamed**. Only the words a user reads say
"Project". Where both appear together, the contract writes *UI: Project · Backend: order*.

### 0.2 Enumerations

- **Order status** (7) — *UI label: **Project status***: `pending`, `submitted`, `working`,
  `waiting_reply`, `pending_update`, `complete`, `canceled`
- **Order priority** (4) — *UI label: **Priority***: `low`, `normal` (default), `high`,
  `urgent`
- **Task status** (5): `todo`, `in_progress`, `blocked`, `complete`, `canceled`

The enum *names* are backend. The enum *values* are never shown raw either — only the
display labels below.

Display labels — the only labels any screen may use:

| Value | Label | Treatment |
| --- | --- | --- |
| `pending` | Pending | neutral outline badge |
| `submitted` | Submitted | neutral outline badge |
| `working` | Working | navy filled badge |
| `waiting_reply` | Waiting on client | gold outline badge |
| `pending_update` | Needs update | gold outline badge |
| `complete` | Complete | muted filled badge |
| `canceled` | Canceled | muted outline badge, row text at 60% |
| `todo` | To do | neutral |
| `in_progress` | In progress | navy |
| `blocked` | Blocked | gold |
| `low` / `normal` / `high` / `urgent` | Low / Normal / High / Urgent | text only; `normal` is never displayed |

### 0.3 Schema behaviors every screen must honor

1. `orders_completion_consistent`: `status = 'complete'` **iff** `completed_at is not null`.
   `orderCompletionPatch` sets `completed_at` on completion and **clears it on any move out
   of `complete`**. The prior completion time survives only in `activity_events`.
   `order_tasks` behaves identically via `taskCompletionPatch`.
2. `client_contacts_one_active_primary_per_company_key`: at most one active primary contact
   per client. Making a second contact primary raises `23505` → `CONFLICT`.
3. `require_internal_assignee`: assignees must be **active internal profiles**
   (`owner`/`admin`/`manager`/`staff`). Client profiles are never assignable.
4. `orders.order_number` is a database identity and the sequence is revoked from API roles.
   **The number does not exist until after insert** and can never be shown in a create form.
   In the UI it renders as the **project number** (`#1042`) — the column keeps its name.
5. `activity_events` is append-only, and authenticated inserts have their actor and
   timestamp normalized by the database. Nothing in the UI edits or deletes an event.
6. Every entity is **archived, never deleted** — and no un-archive method exists in the
   repository layer, so archiving is one-way in V1.
7. `handle_new_auth_user` gives every newly created auth user the **`client`** role.
   Self-signup can therefore never produce a staff account. The internal app has no signup.

### 0.4 Service-layer calls available

`CompanyService` get / listActive / create / update / archive ·
`ContactService` get / listForCompany / create / update / archive ·
`CatalogService` get / listActive / create / update / archive ·
`OrderService` get / list(filter) / listForCompany / create / update / changeStatus /
assign / archive ·
`TaskService` get / listForOrder / create / update / changeStatus / assign / reorder ·
`ActivityService` listTimeline(entityType, entityId) / recordUserAction /
recordSystemAction.

Every mutation takes `{ actorProfileId }` and writes its own activity event. **The UI never
writes an activity event directly.**

### 0.5 Read capabilities that do not exist yet

Marked **[NEW READ]** wherever used below. Each is additive and read-only; none requires a
schema change, and each is supported by existing indexes and RLS.

| Id | Method | Needed by | Backing |
| --- | --- | --- | --- |
| `R1` | `ProfileRepository.listInternal()` — active profiles whose role ∈ owner/admin/manager/staff | every assignee picker | `profiles_internal_select`; `profiles` granted `select` to `authenticated` |
| `R2` | `ActivityRepository.listRecent(limit)` | Home recent activity | `activity_events_created_at_idx` |
| `R3` | `ListOrdersFilter.assignedToProfileId` + `unassignedOnly` | Home "My work" / "Unassigned" | `orders_active_assignee_status_idx` |
| `R4` | `TaskRepository.listOpenDueBefore(timestamp)` | Home overdue tasks | `order_tasks` status + `due_at` |
| `R5` | `ServiceRepository.listAll()` — includes `is_active = false` | Services list | `services` internal select policy |
| `R6` | `CompanyRepository.listActive()` returning order counts, **or** a single batched order fetch | Clients list project counts | see §3 |
| `R7` | Server-side pagination + text search on all list methods | production data volume | not required for synthetic data |

`R1` and `R5` are **blocking for V1**: without `R1` no assignment is possible (build goal
14), and without `R5` deactivating a service makes it permanently invisible.

### 0.6 Route map

| Route | Screen |
| --- | --- |
| `/login` | Login |
| `/` | Home |
| `/clients` | Clients list |
| `/clients/new` | Create client |
| `/clients/:companyId` | Client detail → Overview |
| `/clients/:companyId/contacts` | Client detail → Contacts |
| `/clients/:companyId/orders` | Client detail → Projects |
| `/clients/:companyId/activity` | Client detail → Activity |
| `/clients/:companyId/edit` | Edit client |
| `/clients/:companyId/contacts/new` | Create contact (drawer over Contacts tab) |
| `/clients/:companyId/contacts/:contactId/edit` | Edit contact (drawer over Contacts tab) |
| `/services` | Services list |
| `/services/new` | Create service (drawer over the list) |
| `/services/:serviceId/edit` | Edit service (drawer over the list) |
| `/orders` | Projects list |
| `/orders/new` | Create project |
| `/orders/:orderId` | Project detail → Tasks |
| `/orders/:orderId/activity` | Project detail → Activity |
| `/orders/:orderId/edit` | Edit project |
| `/orders/:orderId/tasks/new` | Create task (drawer over Project detail) |
| `/orders/:orderId/tasks/:taskId` | Task drawer over Project detail |

Drawer routes render their parent screen behind the overlay and are refresh-safe.

**Paths are backend vocabulary in V1.** Every `/orders*` path above maps directly onto
`OrderService` / `orders.id`, and is deliberately left unrenamed while the screen labels say
**Projects**. This is the one place the split is visible to a user, in the address bar and in
shared links. **Recommendation: move the visible routes to `/projects`, `/projects/new`,
`/projects/:orderId`, `/clients/:companyId/projects` before external users arrive, with
`/orders*` kept as permanent redirects and the `:orderId` param name unchanged** (see the
route-naming note in the shell document, §4). **[REQUIRES APPROVAL]**

---

## 1. LOGIN

**Purpose.** Authenticate a Wolf Forge team member and route them into the internal shell.

**User goal.** Get to work in one step, from a bookmark or a deep link.

**Data required.** None on load. On submit: Supabase `signInWithPassword({ email,
password })`. After a session exists: the caller's `profiles` row joined to `roles` to
resolve the role. **[NEW READ — `R1` shares this join]**

**Primary action.** **Sign in**.

**Secondary actions.** None. No signup link, no social sign-in, no "remember me".
Password reset is **out of scope for V1** — an account is provisioned by an operator.

**Controls.** Email (`type=email`, `autocomplete=username`, autofocus), Password
(`type=password`, `autocomplete=current-password`, reveal toggle), Sign in button. Enter
submits.

**Sorting/filtering.** n/a.

**Empty state.** n/a.

**Loading state.** Button pending state; both fields disabled. On first paint, while an
existing session is being restored, render a neutral full-screen brand mark — never a
flash of the login form for an already-signed-in user.

**Error state.** One form-level banner above the fields. Copy is identical for wrong email
and wrong password: *"That email and password don't match an account."* Rate-limit
response: *"Too many attempts. Try again in a few minutes."* Never name which field failed
and never reveal whether an account exists.

**Role gate.** After a successful sign-in, resolve the role before mounting any internal
component:

- role ∈ `owner`/`admin`/`manager`/`staff` → continue to `next` or `/`.
- role = `client` → **do not enter the internal shell.** Sign the session out and show:
  *"This sign-in is for Wolf Forge staff. The client portal isn't available yet."* (When the
  portal ships, this branch redirects to `/portal` instead — the branch exists now so that
  change is one line.)
- `profiles.archived_at is not null` → sign out, show *"This account is no longer active."*

**Success behavior.** Redirect to `?next=` when present and internal, otherwise `/`. No
toast.

**Desktop.** Centered card, 400px, on `--wf-warm-50`. Wordmark above the card. No imagery,
no marketing copy, no split-screen hero.

**Mobile.** Full-width form, 24px padding, wordmark at the top, submit button full width
directly under the fields.

**Navigation destination.** `/` or `next`.

**Confirmation requirements.** None.

**Intentionally unavailable.** Signup (the auth trigger would create a `client` profile),
password reset, magic links, SSO, MFA, "stay signed in", any client-portal entry point.

---

## 2. HOME

**Purpose.** Answer *"What needs attention?"* from real rows, and nothing else.

**User goal.** See what is late, unowned, or waiting; jump straight into it.

**Data required.**

| Block | Query | Status |
| --- | --- | --- |
| Overdue projects | `OrderService.list()` filtered client-side: `due_at < now` and `status ∉ {complete, canceled}` | works today |
| Unassigned projects | `assigned_to_profile_id is null` and `status ∉ {complete, canceled}` | works today; server filter is **[NEW READ `R3`]** |
| Waiting on someone | `status ∈ {waiting_reply, pending_update}` | works today (`list({ status })`, two calls, or client-side) |
| My open projects | `assigned_to_profile_id = session profile` and `status ∉ {complete, canceled}` | **[NEW READ `R3`]** |
| Overdue tasks | tasks with `due_at < now` and `status ∈ {todo, in_progress, blocked}` | **[NEW READ `R4`]** — no task query spanning projects exists |
| Recent activity | last 25 `activity_events` by `created_at desc` | **[NEW READ `R2`]** |

Companies and services are also fetched (both already cached by the app for pickers) to
resolve `company_id` and `service_id` to names.

**Primary action.** None. Home is a triage surface, not a create surface — creation is
always one click away in the Create control.

**Secondary actions.** Each row navigates to its record. Section headers carry a **View all**
link to the corresponding pre-filtered list (`/orders?status=waiting_reply`).

**Controls.** Row-level status and assignee popovers are available directly in the attention
queues so triage does not require opening each project.

**Sorting/filtering.** Within each block: `due_at` ascending (nulls last), then `priority`
descending, then `created_at` descending. Blocks show a maximum of **8 rows** with the
count and a **View all** link.

**Layout (desktop ≥1024px).**

```
Good morning, Anthony                                        12 August 2026

┃ NEEDS ATTENTION                                            ← gold 2px marker
  Overdue                    3      ▸ project rows
  Unassigned                 2      ▸ project rows
  Waiting on client          4      ▸ project rows
  Overdue tasks              5      ▸ task rows

  MY OPEN PROJECTS           6      ▸ project rows

  RECENT ACTIVITY                   ▸ 25 activity lines
```

Single column, max 1280px. **No charts, no KPI tiles, no trend arrows, no percentages.**
Counts are the length of the fetched, capped collection and nothing more.

**Empty state.** Per block, one compact muted line: *"Nothing overdue."* / *"Everything is
assigned."* When **every** attention block is empty, collapse them into a single statement:
*"Nothing needs attention right now."* followed by the My open projects and Recent activity
sections. When there are no projects in the system at all, show the true-empty state:
*"No projects yet. Projects are how work enters the platform."* + **New project**.

**Loading state.** Section skeletons, each with 3 placeholder rows, resolving independently
so a slow block never blocks a fast one.

**Error state.** Per block. A failed block renders an inline banner with **Retry** inside
its own section; the rest of Home still renders. A whole-page error state is used only when
the session itself fails.

**Success behavior.** Status or assignee changed from a Home row updates optimistically; if
the change removes the row from its block, the row animates out over 180ms. Toast copy names
the project (*"Project #1042 assigned to Anthony P."*).

**Desktop.** As above.

**Mobile.** Same order, full-bleed stacked rows, each block collapsed to **3 rows** with
"View all (12)". Recent activity is collapsed behind a **Show activity** disclosure so the
attention queues own the first screen.

**Navigation destination.** `/orders/:id` from a project row; `/orders/:orderId` (Tasks tab,
task highlighted) from a task row; the referenced record from an activity line.

**Confirmation requirements.** Marking a project complete from a Home row uses the same
confirmation modal as Project Detail (§11 of the shell doc).

**Intentionally unavailable.** Revenue, throughput, cycle time, capacity, utilization,
client health, any chart, any date-range selector, any comparison to a previous period.
None of these are computable from the current schema, and none will be faked.

---

## 3. CLIENTS LIST

**Route.** `/clients` · **Purpose.** The roster of client businesses and the entry point to
every client record.

**User goal.** Find a client and open it; add a new one.

**Data required.** `CompanyService.listActive()` → `id`, `name`, `created_at`. Project counts
per client require either a batched `OrderService.list()` grouped client-side (acceptable at
synthetic volume) or **[NEW READ `R6`]**. If neither is available, **the column is omitted
— it is never estimated.**

**Primary action.** **New client** → `/clients/new`.

**Secondary actions.** Row → Client detail. Row overflow: **Edit**, **Archive**.

**Controls.** Filter input (`?q=`) matching `name`, case-insensitive substring.

**Sorting/filtering.** Default `name` ascending, as returned by the repository. Sortable
client-side by Name and Created. Archived clients are excluded and cannot be shown —
`listActive()` has no include-archived option.

**Columns (desktop, drop order right-to-left).**

| # | Column | Align | Drops at |
| --- | --- | --- | --- |
| 1 | Name (500 weight) | left | never |
| 2 | Contacts | right | 768px |
| 3 | Open projects | right | 768px |
| 4 | Created | right | 1024px |
| 5 | Actions (overflow) | right | never |

**Empty state.** True-empty: *"No clients yet — Clients are the businesses you deliver work
for. Every project belongs to one."* + **New client**. Filtered-empty: *"No clients match
"acme"."* + **Clear filter**.

**Loading state.** Table skeleton, 6 rows.

**Error state.** Per shell §14. `PERMISSION_DENIED` renders the full-page access state
(a `client`-role session reaching this route).

**Success behavior.** Returning from create: toast *"Wolf Reef Media created."* and the new
row flashes. Archive: row leaves the list, toast, **no Undo** (no un-archive method exists).

**Desktop.** Table, sticky header, 44px rows, 200-row cap notice per shell §19.

**Mobile.** Stacked rows: name (16px/500) over `4 contacts · 2 open projects` in muted 13px.
Filter input sits under the top bar and is sticky. **New client** is a full-width button
pinned above the bottom bar.

**Navigation destination.** `/clients/:companyId`.

**Confirmation requirements.** Archive → modal naming the client and stating that its
projects remain intact and the action cannot be undone in the app.

**Intentionally unavailable.** Delete, bulk actions, import/export, tags, owner assignment,
client-level status, revenue columns, archived-client browsing.

---

## 4. CLIENT DETAIL

**Route.** `/clients/:companyId` (+ `/contacts`, `/orders`, `/activity`)

**Purpose.** The single record for a client business: who they are, who works there, what
work is open, and what has happened.

**User goal.** Understand this client's state and act on it without leaving the record.

**Architecture.** One fixed header, four contextual tabs. This screen is the *only* place
the Client concept lives — there is no separate Account or Organization screen.

```
Clients / Wolf Reef Media
Wolf Reef Media                            [ Edit ]  [ New project ]  [ … ]
Client since 4 Mar 2026 · 4 contacts · 2 open projects
──────────────────────────────────────────────────────────────────────────
 Overview │ Contacts 4 │ Projects 6 │ Activity
```

**Data required.** `CompanyService.get(id)`; `ContactService.listForCompany(id)`;
`OrderService.listForCompany(id)`; `ActivityService.listTimeline('company', id)`. Header
counts are lengths of the fetched contact and project collections. Service names resolve
from the cached service list.

**Primary action.** **New project** (pre-bound to this client).

**Secondary actions.** **Edit** → `/clients/:id/edit`. Overflow: **Archive client**.

**Controls.** Tabs; per-tab controls below.

### 4.1 Overview tab

Two blocks, no filler:

1. **Primary contact** — the contact with `is_primary = true`: name, `job_title`, `email`
   (mailto), `phone` (tel). If none is set: *"No primary contact set."* + **Set primary
   contact** linking to the Contacts tab.
2. **Open projects** — up to 5 projects with `status ∉ {complete, canceled}`, ordered by
   `due_at` ascending nulls last, showing project number, title, status badge, due date,
   assignee. **View all projects** links to the Projects tab.

Followed by a compact metadata line: created and last-updated timestamps.

There is deliberately **no** "about", "notes", "address", or "details" card — the
`companies` table has only `name`.

### 4.2 Contacts tab

Contract in §7.

### 4.3 Projects tab

The Projects list component (§13) scoped by `companyId`, with the Client column removed and
the client filter suppressed. Server-filtered via `OrderService.listForCompany`.

### 4.4 Activity tab

The Activity timeline component (§17) bound to `('company', companyId)`. Note the real
scope limit: `listForEntity` returns events whose `entity_id` is **this company**, so
project-level and task-level events do **not** appear here. The tab therefore carries the
line *"Client-level changes. Project activity appears on each project."* Do not misrepresent
this as a full client history.

**Sorting/filtering.** Per tab.

**Empty state.** Per tab.

**Loading state.** Header renders from the company fetch; each tab panel skeletons
independently. Switching tabs never re-skeletons the header.

**Error state.** `NOT_FOUND` → full-page *"This client no longer exists or was archived."*
+ back link. Others per shell §14.

**Success behavior.** Edits update the header in place with a 600ms wash flash.

**Desktop.** Header + tabs + panel, max 1200px. Overview uses a two-column block layout at
≥1024px, single column below.

**Mobile.** Header collapses to name + one metadata line. Tabs become a horizontally
scrollable strip. Primary action **New project** is a full-width button under the header;
Edit and Archive move into the top-bar overflow sheet.

**Navigation destination.** Contacts → contact drawer; Projects → `/orders/:id`; breadcrumb
→ `/clients`.

**Confirmation requirements.** Archive client → modal (§11 of shell doc).

**Intentionally unavailable.** Invoices, subscriptions, files, messages, proposals, forms,
portal access management, client-level notes, custom fields, logo upload, address. Their
attachment points are reserved in shell §21.

---

## 5. CREATE CLIENT

**Route.** `/clients/new` · **Surface.** Dedicated page.

**Purpose.** Register a new client business.

**User goal.** Add a client in seconds and immediately create a project for it.

**Data required.** None on load.

**Primary action.** **Create client** → `CompanyService.create({ name }, { actorProfileId })`.

**Secondary actions.** **Cancel** → back to origin.

**Controls.** A single required field: **Client name**, autofocused, trimmed, max 200 chars
enforced client-side (`companies_name_not_blank` enforces non-blank server-side).

The form has exactly one field because `companies` has exactly one editable column. Do not
add address, phone, website, or industry inputs — there is nowhere to store them.

**Sorting/filtering.** n/a.

**Empty state.** n/a.

**Loading state.** Button pending; field disabled.

**Error state.** Blank/whitespace name → inline field error *"Enter a client name."*
`CONFLICT` → *"A client with this name may already exist."* (no unique constraint exists on
`companies.name`; duplicates are permitted, so this maps only if one is added later).
`DATABASE_ERROR` → form banner with **Try again**; the entered value is preserved.

**Success behavior.** Navigate to `/clients/:newId`, toast *"Wolf Reef Media created."*
When launched from quick create, the destination is the same.

**Desktop.** Page container capped at 640px, header **New client**, actions bottom-right
(Cancel then Create).

**Mobile.** Full-screen form, **Create client** full width at the bottom, Cancel in the top
bar.

**Navigation destination.** `/clients/:newId`.

**Confirmation requirements.** Leaving with a dirty field → unsaved-changes modal.

**Intentionally unavailable.** Creating a contact in the same form (a separate insert with
no transaction wrapper yet — Phase 2B transaction work is a prerequisite), duplicate
detection, bulk import, logo, custom fields.

---

## 6. EDIT CLIENT

**Route.** `/clients/:companyId/edit` · **Surface.** Dedicated page.

**Purpose.** Correct a client's name.

**User goal.** Fix a typo or a rebrand without touching anything else.

**Data required.** `CompanyService.get(id)`.

**Primary action.** **Save changes** → `CompanyService.update(id, { name }, ctx)`.
`updateCompanySchema` accepts `name` only and requires at least one field.

**Secondary actions.** **Cancel**. Overflow: **Archive client**.

**Controls.** Client name field, pre-filled. Save is disabled until the value differs from
the loaded value.

**Sorting/filtering.** n/a. **Empty state.** n/a.

**Loading state.** Field skeleton while loading; button pending on submit.

**Error state.** `NOT_FOUND` → full-page not-found. Validation and database errors as in §5.

**Success behavior.** Navigate to `/clients/:id`, toast *"Client updated."*, header flashes.

**Desktop / Mobile.** Identical to Create client.

**Navigation destination.** `/clients/:companyId`.

**Confirmation requirements.** Unsaved-changes modal; archive modal.

**Intentionally unavailable.** Changing `created_at`, merging clients, transferring projects
to another client (`updateOrderSchema` has no `company_id`), un-archiving.

---

## 7. CONTACTS WITHIN A CLIENT

**Route.** `/clients/:companyId/contacts` · **Surface.** Tab panel inside Client detail.

**Purpose.** Manage the people at a client business.

**User goal.** Know who to contact, and keep one clear primary.

**Data required.** `ContactService.listForCompany(companyId)` → `name`, `job_title`,
`email`, `phone`, `is_primary`, `profile_id`. Archived contacts are excluded by the
repository.

**Primary action.** **Add contact** → contact drawer (§8).

**Secondary actions.** Per row: **Edit** (drawer), **Make primary**, **Archive**. Email and
phone are `mailto:` / `tel:` links.

**Controls.** Row list with a trailing overflow menu. No filter input — contact counts per
client are small.

**Sorting/filtering.** Repository order: `is_primary` descending, then `name` ascending.
Not user-sortable. The primary contact is pinned first and carries a **Primary** badge.

**Row anatomy.**

```
Sarah Chen   Primary            sarah@wolfreef.com    +63 917 000 0000      …
Operations Lead
```

Missing `email`, `phone`, or `job_title` render as an em dash, never as invented text.

**Empty state.** Compact, left-aligned in the panel: *"No contacts yet. Add the people you
work with at this client."* + **Add contact**.

**Loading state.** Three row skeletons in the panel only.

**Error state.** Per shell §14. **Make primary** is the one action with a
`CONFLICT` path — see below.

**Make primary — exact behavior.** The unique index
`client_contacts_one_active_primary_per_company_key` allows one active primary per client,
so promotion is **two writes**: clear the current primary, then set the new one.

- If an existing primary is known from the loaded list, perform
  `update(oldPrimaryId, { is_primary: false })` then
  `update(newId, { is_primary: true })`, showing an optimistic single change.
- If the first write succeeds and the second fails, **roll the first back** and show
  *"Couldn't change the primary contact. Sarah Chen is still primary."*
- If a `CONFLICT` arrives anyway (a concurrent change), refetch the list and show the
  contextual conflict message defined in shell §14.
- This sequence is **not atomic** in V1. It is a known limitation and a direct consumer of
  the Phase 2B transaction work. **[REQUIRES Phase 2B transaction support for atomicity]**

**Success behavior.** Drawer closes, row flashes, list re-sorts if primacy changed. No
toast for drawer saves.

**Desktop.** Rows inside the tab panel, full panel width, 56px tall (two text lines).

**Mobile.** Same rows, 16px padding, trailing "…" opens an action sheet. **Add contact** is
a full-width button at the panel top.

**Navigation destination.** Stays on the tab; drawers use their own routes.

**Confirmation requirements.** Archive contact → modal: *"Archive Sarah Chen? They'll be
removed from this client's contact list. This cannot be undone in the app."* Archiving the
primary contact additionally states that the client will have no primary contact.
Making primary is not confirmed.

**Intentionally unavailable.** Moving a contact to another client (`updateContactSchema`
has no `company_id`), deleting, inviting to the portal, per-contact notes, multiple emails
or phones, contact-level activity.

---

## 8. CREATE CONTACT

**Route.** `/clients/:companyId/contacts/new` · **Surface.** Drawer (bottom sheet on
mobile).

**Purpose.** Add a person to a client.

**User goal.** Capture a new contact without losing the client record behind it.

**Data required.** `companyId` from the route. Nothing else is fetched.

**Primary action.** **Add contact** → `ContactService.create({ company_id, name, email,
phone, job_title, is_primary }, ctx)`.

**Secondary actions.** **Cancel**.

**Controls.**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| Name | text | **yes** | autofocus; trimmed |
| Job title | text | no | omit when blank — never send `""` (`*_not_blank` constraints reject empty strings) |
| Email | email | no | format-validated client-side; the schema stores any non-blank text |
| Phone | tel | no | free text; no formatting is imposed |
| Primary contact | checkbox | no | default off |

**Blank-string rule.** Optional fields must be submitted as `null` or omitted, never as an
empty string. `client_contacts_email_not_blank` and its siblings reject `''`.

**Sorting/filtering / empty state.** n/a.

**Loading state.** Submit button pending; the drawer stays open and inputs disable.

**Error state.** Field-level validation inline. `CONFLICT` from the primary checkbox → the
message renders **at the checkbox**: *"Sarah Chen is already the primary contact."* with a
**Replace as primary** action that runs the §7 promotion sequence. The drawer never closes
on error and never loses entered values.

**Success behavior.** Drawer closes, the new row flashes, list re-sorts. No toast.

**Desktop.** Right drawer, 480px, fields stacked, actions pinned to the drawer footer.

**Mobile.** Bottom sheet up to 90vh, fields stacked, **Add contact** full width in a sticky
footer above the keyboard.

**Navigation destination.** Returns to `/clients/:companyId/contacts`.

**Confirmation requirements.** Closing a dirty drawer → unsaved-changes modal (the one
permitted overlay stack).

**Intentionally unavailable.** Linking a portal `profile_id` (the schema supports it via
`require_client_contact_profile_consistency`, but no profile-provisioning flow exists), CSV
import, adding a contact to more than one client.

---

## 9. EDIT CONTACT

**Route.** `/clients/:companyId/contacts/:contactId/edit` · **Surface.** Drawer.

**Purpose.** Correct or update a contact.

**User goal.** Keep contact details accurate.

**Data required.** The row from the loaded list; `ContactService.get(id)` on direct
navigation.

**Primary action.** **Save changes** → `ContactService.update(id, patch, ctx)`. The patch
contains **only changed fields** (`updateContactSchema` requires at least one).

**Secondary actions.** **Cancel**. Drawer footer left side: **Archive contact**.

**Controls.** Same fields as §8. Clearing an optional field sends `null`, not `""`.

**Sorting/filtering / empty state.** n/a.

**Loading state.** As §8; drawer body skeletons only on direct navigation.

**Error state.** As §8, plus `NOT_FOUND` → drawer closes and the list refreshes with a toast
*"That contact no longer exists."*

**Success behavior.** Drawer closes, row flashes, re-sort if primacy or name changed.

**Desktop / Mobile.** As §8.

**Navigation destination.** `/clients/:companyId/contacts`.

**Confirmation requirements.** Archive modal; unsaved-changes modal.

**Intentionally unavailable.** Changing the owning client, unarchiving, deleting, editing
`created_at`.

---

## 10. SERVICES LIST

**Route.** `/services` · **Purpose.** The catalog of service types a project can be placed
against.

**User goal.** See what can be sold and delivered; keep the list current.

**Data required.** `CatalogService.listActive()` today. **This is a real problem for V1:**
`ServiceRepository.listActive()` filters `is_active = true`, so deactivating a service makes
it **permanently invisible and un-editable in the UI**. Ship `ServiceRepository.listAll()`
**[NEW READ `R5` — blocking]** and use it here; `listActive()` remains the picker query used
by Create project.

**Primary action.** **New service** → service drawer (§11).

**Secondary actions.** Row: **Edit** (drawer). Overflow: **Deactivate** / **Activate**
(`update({ is_active })`), **Archive**.

**Controls.** Filter input matching `name` and `description`. **Show inactive** toggle,
default off (requires `R5`).

**Sorting/filtering.** Default `name` ascending. Inactive rows, when shown, sit after active
rows and render at 60% opacity with an **Inactive** badge.

**Columns.**

| # | Column | Notes | Drops at |
| --- | --- | --- | --- |
| 1 | Name | 500 weight | never |
| 2 | Description | truncated to one line, em dash when null | 1024px |
| 3 | Status | Active / Inactive | never |
| 4 | Actions | overflow | never |

There is **no price column, no duration, no deliverables list** — `services` has `name`,
`description`, and `is_active` only.

**Empty state.** True-empty: *"No services yet. A service is the type of work a project is
placed against — every project needs one."* + **New service**. Filtered-empty per shell §13.

**Loading state.** Table skeleton, 5 rows.

**Error state.** Per shell §14.

**Success behavior.** Drawer closes, row flashes. Deactivate shows a toast with **Undo**
(the inverse `update({ is_active: true })` genuinely exists).

**Desktop.** Table, max 1280px.

**Mobile.** Reached from the avatar sheet, not the bottom bar (shell §3). Stacked rows: name
over truncated description, trailing Inactive badge when applicable.

**Navigation destination.** Stays on `/services`; drawers use their own routes.

**Confirmation requirements.** Archive → modal stating that existing projects keep their
service reference (`orders.service_id` is `on delete restrict`, so history is never broken)
and that the service disappears from new-project pickers. Deactivate is **not** confirmed —
it is reversible and undoable.

**Intentionally unavailable.** Pricing, packages, add-ons, recurring plans, deliverable
templates, task templates, checkout links, ordering/priority of the catalog. All belong to
the future Sales module.

---

## 11. CREATE SERVICE

**Route.** `/services/new` · **Surface.** Drawer.

**Purpose.** Add a service type to the catalog.

**User goal.** Make a new kind of work available to projects.

**Data required.** None.

**Primary action.** **Create service** → `CatalogService.create({ name, description,
is_active }, ctx)`.

**Secondary actions.** **Cancel**.

**Controls.** **Name** (required, autofocus); **Description** (optional, 3-row textarea,
omitted when blank); **Active** (checkbox, default **on** — `services.is_active` defaults to
`true`).

**Sorting/filtering / empty state.** n/a.

**Loading state.** Button pending; inputs disabled.

**Error state.** Blank name → inline. Others per shell §14; the drawer stays open with
values intact.

**Success behavior.** Drawer closes, new row flashes in place. No toast.

**Desktop.** 480px right drawer. **Mobile.** Bottom sheet.

**Navigation destination.** `/services`.

**Confirmation requirements.** Unsaved-changes modal on dirty close.

**Intentionally unavailable.** Price, billing period, deliverables, default task list,
intake form attachment, per-client visibility.

---

## 12. EDIT SERVICE

**Route.** `/services/:serviceId/edit` · **Surface.** Drawer.

**Purpose.** Update a catalog entry.

**User goal.** Rename, re-describe, or retire a service.

**Data required.** Row from the list; `CatalogService.get(id)` on direct navigation.

**Primary action.** **Save changes** → `CatalogService.update(id, patch, ctx)` with changed
fields only.

**Secondary actions.** **Cancel**; footer-left **Archive service**.

**Controls.** As §11. The **Active** checkbox is the deactivate/activate path.

**Loading / error / success.** As §11, plus `NOT_FOUND` → drawer closes, list refreshes,
toast.

**Desktop / Mobile.** As §11.

**Navigation destination.** `/services`.

**Confirmation requirements.** Archive modal (§10). Turning **Active** off inside the form
is not separately confirmed — the save is the deliberate act.

**Intentionally unavailable.** Reassigning existing projects to a different service from
here (done per-project via `updateOrderSchema.service_id`), deleting, unarchiving.

---

## 13. PROJECTS LIST

*UI: Project · Backend: order.*

**Route.** `/orders` (see the route recommendation in §0.6) · **Purpose.** Every unit of work
in the platform.

**User goal.** Find work by state, ownership, or client, and open it.

**Data required.** `OrderService.list(filter)` where `filter` is `{ companyId?, status?,
includeArchived? }`. Company names and service names resolve from the cached company and
service lists. Assignee names require **[NEW READ `R1`]**; until it exists, the Assignee
column shows **Assigned** / **Unassigned** rather than a name — it never shows a UUID.

**Primary action.** **New project** → `/orders/new`.

**Secondary actions.** Row → Project detail. Row overflow: **Change status**, **Assign**,
**Archive**.

**Controls.** Status filter (multi-select over the 7 values; a single value uses the server
filter, multiple values fall back to client-side); Client filter (select over active
companies → server filter `companyId`); Assignment filter (Anyone / Me / Unassigned —
client-side today, **[NEW READ `R3`]** server-side); **Include archived** toggle (server
filter, default off); Filter input over `title` and `order_number`.

Active filters render as removable chips with **Clear all**. All filter state lives in the
URL query string so Home's **View all** links are plain links.

**Sorting/filtering.** Default `created_at` descending, as the repository returns.
Client-side sortable by Project number, Due date, Status, Priority.

**Columns.**

| # | Column | Content | Align | Drops at |
| --- | --- | --- | --- | --- |
| 1 | Project | `#1042` (`orders.order_number`) + title on a second line | left | never |
| 2 | Client | company name | left | never (removed inside Client detail) |
| 3 | Status | badge | left | never |
| 4 | Assignee | name or Unassigned | left | 1024px |
| 5 | Due | relative/absolute; `--wf-danger` + "Overdue" when `due_at < now` and status is open | right | 768px |
| 6 | Priority | text; `normal` renders blank | right | 1280px |

One badge per row: status is the badge, priority is text.

**Empty state.** True-empty: *"No projects yet. A project is a unit of work for one client
against one service."* + **New project**. Filtered-empty names the active filters + **Clear
filters**.

**Loading state.** Table skeleton, 8 rows. Filter controls render immediately and enabled.

**Error state.** Per shell §14. A failed filter change reverts the chip to its previous
state.

**Success behavior.** Inline status/assignee changes update optimistically. If a row no
longer matches the active filter, it animates out over 180ms with a toast offering **Undo**
(status and assignment both have true inverses).

**Desktop.** Table, sticky header, 200-row cap notice.

**Mobile.** Stacked rows: `#1042` and title on line one, `Client · Status · Due` muted on
line two, overdue in `--wf-danger`. Filters open in a bottom sheet from a **Filter** button
showing the active count.

**Navigation destination.** `/orders/:orderId`.

**Confirmation requirements.** Setting `complete`, leaving `complete`, `canceled`, and
archive all confirm per shell §11.

**Intentionally unavailable.** Bulk actions, saved views, kanban board, calendar view,
export, invoicing, cross-project task view, keyword search across notes.

---

## 14. CREATE PROJECT

*UI: Project · Backend: order.*

**Route.** `/orders/new` (accepts `?companyId=`) · **Surface.** Dedicated page.

**Purpose.** Put new work into the system.

**User goal.** Create a correct, assignable project quickly.

**Data required.** `CompanyService.listActive()` for the client picker;
`CatalogService.listActive()` for the service picker; **[NEW READ `R1`]** for the assignee
picker.

**Primary action.** **Create project** → `OrderService.create(input, ctx)` where input matches
`createOrderSchema`: `company_id`, `service_id`, `assigned_to_profile_id?`, `title`,
`priority?`, `due_at?`, `started_at?`, `notes?`.

**Secondary actions.** **Cancel**.

**Controls.**

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| Client | select | **yes** | active companies by name; pre-selected and read-only when `?companyId=` is supplied, with a **Change** link |
| Service | select | **yes** | active services only |
| Title | text | **yes** | autofocus when the client is pre-bound |
| Priority | segmented (Low/Normal/High/Urgent) | no | defaults to **Normal** |
| Assignee | select | no | active internal profiles only; **Unassigned** is a valid first-class choice |
| Due date | date | no | stored as `timestamptz`; a date-only input sends end-of-day in the user's zone — state this in the field hint |
| Internal notes | textarea | no | labelled **Internal notes**, hinted *"Not visible to the client."* |

**Not on this form:** status (the database defaults to `pending`; `createOrderSchema` has no
status field), the project number (`orders.order_number` — identity, generated on insert),
`started_at` (settable by the schema but exposed via **Start work** on the detail screen
instead of as a create-time input), `completed_at` (constraint-managed).

**Sorting/filtering.** Pickers order by name.

**Empty state.** If no active clients exist: replace the form with *"Create a client
first — every project belongs to one."* + **New client**. If no active services exist:
*"Add a service first — every project is placed against one."* + **New service**. Both are
hard blocks; the form is not rendered with an empty required picker.

**Loading state.** Pickers skeleton individually; the title field is usable immediately.
Submit button pending on save.

**Error state.** Missing required fields → inline, focus to the first. A `23514`
`VALIDATION_ERROR` from `require_internal_assignee` → *"That team member can't be
assigned."* at the assignee field. `DATABASE_ERROR` → form banner, all values preserved.

**Success behavior.** Navigate to `/orders/:newId`, toast *"Project #1042 created."* — this
is the first moment the project number (`orders.order_number`) exists.

**Desktop.** Page container capped at 720px, single column, actions bottom-right.

**Mobile.** Full-screen form; pickers open as bottom sheets; **Create project** full width
in a sticky footer.

**Navigation destination.** `/orders/:newId`.

**Confirmation requirements.** Unsaved-changes modal.

**Intentionally unavailable.** Creating tasks in the same submit (separate inserts, no
transaction wrapper yet), templates, recurring projects, attachments, client notification,
price, quantity, invoice generation.

---

## 15. PROJECT DETAIL

*UI: Project · Backend: order.*

**Route.** `/orders/:orderId` (+ `/activity`) · **Purpose.** The core operating screen.

**User goal.** Know the state of this work, move it forward, and record what happened.

**Architecture.** Fixed header · summary column · contextual tabs. Actions are ranked, not
piled into the header.

```
Projects / #1042
#1042  Homepage rebuild                       [ Change status ▾ ]  [ … ]
Wolf Reef Media · Website Build · Working · High
─────────────────────────────────────────────────────────────────────────
┌ summary (320px) ─────────┐  ┌ Tasks │ Activity ─────────────────────┐
│ Status      Working      │  │  [ Add task ]                          │
│ Priority    High         │  │  ⠿ ☐ Wireframes      In progress  AP … │
│ Assignee    Anthony P.   │  │  ⠿ ☐ Copy review     To do       — …   │
│ Client      Wolf Reef    │  │  ⠿ ☑ Kickoff call    Complete    AP …  │
│ Service     Website Bld  │  │                                        │
│ Due         14 Aug 2026  │  │                                        │
│ Started     4 Aug 2026   │  │                                        │
│ Created     2 Aug 2026   │  │                                        │
│ ─────────────────────    │  │                                        │
│ Internal notes           │  │                                        │
│ Not visible to client.   │  │                                        │
│ …                  [Edit]│  │                                        │
└──────────────────────────┘  └────────────────────────────────────────┘
```

**Data required.** `OrderService.get(id)`; `TaskService.listForOrder(id)`;
`ActivityService.listTimeline('order', id)`; company name; service name; assignee name
**[NEW READ `R1`]**.

**Primary action.** **Change status** — a popover listing the 7 values with the current one
marked. The single most frequent act on this screen, so it is the header's primary control.

**Secondary actions (header).** Overflow "…": **Edit project**, **Assign**, **Start work**
(only when `started_at is null` and status is not terminal), **Archive project**. The header
carries **one** visible button plus the overflow — never a row of five.

**Summary column controls.** Status, Priority, and Assignee are inline popovers editable in
place. Client and Service are text; Service becomes editable through **Edit project**
(`updateOrderSchema.service_id`). Client is **not editable at all** — `updateOrderSchema`
has no `company_id`, by design.

**Status change — exact behavior.**

- Non-terminal → non-terminal: applies immediately and optimistically via
  `OrderService.changeStatus`. Toast with **Undo** carrying the previous value.
- → `complete`: confirmation modal *"Mark project #1042 complete? This records the
  completion time now."* On confirm, `orderCompletionPatch` writes `completed_at`. The
  summary column gains a **Completed** row.
- Out of `complete`: confirmation modal *"Reopen project #1042? The recorded completion time
  (12 Aug 2026, 14:32) will be cleared. The change stays in the activity history."* This
  reflects `orders_completion_consistent` exactly.
- → `canceled`: confirmation modal.
- Transitions are otherwise **unrestricted** — the database permits any value. Any ordering
  the UI suggests is presentation only, and no transition is blocked in V1.

**Start work.** Writes `started_at = now()` via `OrderService.update` and, when status is
`pending` or `submitted`, also sets status to `working` via `changeStatus`. **These are two
calls and are not atomic in V1** — if the second fails, the summary shows the started date
with the old status and a retry banner. **[REQUIRES Phase 2B transaction support for
atomicity]**

**Assignment.** `OrderService.assign(id, profileId | null, ctx)`. The picker lists active
internal profiles plus an explicit **Unassign**. Client profiles never appear —
`require_internal_assignee` would reject them.

**Sorting/filtering.** Tasks by `sort_position` then `created_at` (repository order).
Activity newest first.

**Empty state.** No tasks: *"No tasks yet. Break this project into the steps needed to
deliver it."* + **Add task**, left-aligned in the panel. Null `due_at`, `started_at`, or
`notes` render as an em dash with an inline **Set** affordance where the field is editable.

**Loading state.** Header and summary skeleton together from the `OrderService.get` fetch;
the Tasks panel skeletons separately with 3 rows. Tab switches skeleton only the panel.

**Error state.** `NOT_FOUND` → full-page *"This project no longer exists."* + link to the
Projects list (`/orders`). Optimistic status/assignee failures roll back visibly, then
announce. Others per shell §14.

**Success behavior.** Inline controls show the new value; status changes also prepend a new
line to the Activity tab without a refetch — the service layer has already written the
event.

**Desktop.** Two columns at ≥1024px (320px summary + fluid main), single column below with
the summary collapsed to a metadata grid above the tabs.

**Mobile.** Header shows `#1042` + title + status badge. A **Change status** button spans
full width beneath it. The summary becomes a two-column key-value grid. Tabs scroll
horizontally. Overflow actions live in the top-bar sheet.

**Navigation destination.** Client name → `/clients/:companyId`; service name →
`/services` (filtered); task row → task drawer; breadcrumb → the Projects list (`/orders`).

**Confirmation requirements.** Complete, reopen, cancel, archive (shell §11).

**Intentionally unavailable — with reserved attachment points.**

| Absent | Why | Where it will attach |
| --- | --- | --- |
| Invoices / payments | no billing tables | a billing card in the summary column, and an **Invoice** tab |
| Files / attachments | no storage bucket | a **Files** tab, and a file count in the summary |
| Messages / client comments | no message table | a **Messages** tab |
| Forms / questionnaires | no form tables | a **Forms** tab |
| Client-visible status view | portal not built | the portal's own project projection (shell §21) |
| Time tracking, subtasks, dependencies, checklists, watchers, task priority | no columns exist | new columns and tabs |

The two-column layout and the tab registry exist **now** precisely so these land without a
redesign.

---

## 16. TASK MANAGEMENT

**Surface.** Tasks tab inside Project detail + a task drawer. Tasks have no standalone list —
`TaskRepository` exposes only `listForOrder`.

**Purpose.** Break a project into steps, own them, and move them.

**User goal.** See what is left on this project and change it in one click.

**Data required.** `TaskService.listForOrder(orderId)` → `title`, `description`, `status`,
`due_at`, `sort_position`, `assigned_to_profile_id`, `completed_at`. Assignee names
**[NEW READ `R1`]**.

**Row anatomy.**

```
⠿  ☐  Wireframes                          In progress   AP   14 Aug   …
      2 subtasks worth of detail lives in the drawer
```

- Drag handle (`⠿`), completion checkbox, title, status badge, assignee avatar (initials
  or a neutral glyph when unassigned), due date, overflow.
- `complete` rows: title struck through at 60% opacity, checkbox checked.
- `canceled` rows: 60% opacity, **Canceled** badge, sorted last within their position.
- Overdue (`due_at < now`, status ∈ `todo`/`in_progress`/`blocked`): due date in
  `--wf-danger` with the word **Overdue**.

**Primary action.** **Add task** → drawer at `/orders/:orderId/tasks/new`.

**Secondary actions.** Row click → task drawer (view/edit). Checkbox → toggle
`complete`/`todo`. Overflow: **Edit**, **Assign**, **Change status**, **Move up**,
**Move down**.

**Controls by operation.**

| Operation | Call | Surface |
| --- | --- | --- |
| View | `TaskService.get` | drawer |
| Create | `TaskService.create({ order_id, title, description?, due_at?, assigned_to_profile_id?, sort_position? })` | drawer |
| Edit | `TaskService.update(id, { title?, description?, due_at? })` — **only these three fields** | drawer |
| Change status | `TaskService.changeStatus(id, { status })` | inline popover / checkbox |
| Assign | `TaskService.assign(id, profileId \| null)` | inline popover |
| Reorder | `TaskService.reorder(id, { sort_position })` | drag, or Move up/down |

The edit drawer must **not** contain status, assignee, or position controls that write
through `update` — `updateTaskSchema` rejects them. The drawer may host the inline
status/assignee popovers, which call their own service methods.

**Status set.** `todo`, `in_progress`, `blocked`, `complete`, `canceled`. Completion writes
`completed_at` and leaving `complete` clears it (`taskCompletionPatch`). **Tasks have no
priority field — do not add one.**

**Reordering.** `sort_position` is a plain integer with no uniqueness constraint. On drop,
renumber the **visible** tasks from 0 in their new order and issue one `reorder` call per
row whose position actually changed. Apply optimistically; on any failure, restore the
previous order wholesale and show a retry toast. Keyboard users use **Move up** / **Move
down**, which swap adjacent positions — this is required, not optional (shell §17).

**Sorting/filtering.** Repository order only: `sort_position` then `created_at`. No user
sorting and no filtering — reordering *is* the ordering, and a filtered list cannot be
safely dragged. Completed tasks stay in place rather than moving to a separate section, so
positions remain meaningful; a **Hide completed** toggle may hide them from view, and drag
is disabled while it is on.

**Empty state.** *"No tasks yet. Break this project into the steps needed to deliver it."* +
**Add task**.

**Loading state.** Three row skeletons in the panel.

**Error state.** Per shell §14. Optimistic status, assignment, and reorder failures roll
back visibly before announcing.

**Success behavior.** Inline changes show the new value. Drawer saves close the drawer and
flash the row. No toasts for task operations except reorder failure.

**Desktop.** Rows 44px, drag handle visible on row hover, full panel width.

**Mobile.** Rows 56px, no drag handle — reordering uses the overflow sheet's Move up/Move
down. The checkbox is a 44px touch target. Drawer is a bottom sheet.

**Navigation destination.** Stays on Project detail; the drawer has its own route.

**Confirmation requirements.** None. Task status changes — including completion and
cancellation — commit immediately. Moving out of `complete` shows a toast noting the
completion time was cleared.

**Intentionally unavailable.** Deleting tasks (**no archive method exists on
`TaskRepository`** — use `canceled`), moving a task between projects, subtasks, dependencies,
checklists, time tracking, task priority, task templates, per-task files or comments, task
notifications.

---

## 17. ACTIVITY TIMELINE

**Surface.** A tab inside Client detail and Project detail; a section on Home.

**Purpose.** An append-only record of what happened, to whom, when, and by whom.

**User goal.** Reconstruct history without asking anyone.

**Data required.** `ActivityService.listTimeline(entityType, entityId)` →
`actor_profile_id`, `action`, `summary`, `metadata`, `created_at`. Home uses
**[NEW READ `R2`]**. Actor names **[NEW READ `R1`]**.

**Scope — state it honestly.** `listForEntity` matches on `entity_id`, so:

- Project detail → Activity shows **project-level events only** (`entity_type = 'order'`);
  its task events carry `entity_type = 'order_task'` with the task's id. The tab therefore
  fetches project events, and — because task ids are already loaded in the Tasks tab — may
  additionally fetch each task's timeline and merge by `created_at desc`. If that fan-out is
  not implemented, the tab must be labelled *"Project-level changes only."* rather than
  implying completeness.
- Client detail → Activity shows **company events only** and is labelled accordingly
  (§4.4).

**Line anatomy.**

```
AP   Changed project #1042 status from working to complete      2 hours ago
```

- Actor: initials avatar + the rendered `summary`. `summary` is written by the service
  layer and is displayed **verbatim** — the UI never rewrites or re-derives it.

> **Open terminology issue — the one place the split leaks.** Activity `summary` strings are
> composed in `src/services` and rendered verbatim, so any summary that says "order" reaches
> the user as "order" even though every label around it says **Project**. The UI must not
> patch this by string-replacing `summary` — that would violate the verbatim rule and would
> corrupt legitimate uses of the word.
>
> **Resolution: change the summary *copy* in the service layer to say "project"**, leaving
> `OrderService`, the `entity_type = 'order'` value, and every identifier untouched. This is
> a user-facing copy change that happens to live in backend files; it is **out of scope for
> these two documents** and must be scheduled as a Phase 2B service-layer task before the
> timeline ships. Historical events already written keep their old wording — they are
> append-only and are never rewritten. **[REQUIRES APPROVAL]**
- `actor_profile_id = null` renders as **Automation** with a neutral glyph avatar. Support
  this from day one so system-authored events need no later change.
- Timestamp: relative under 7 days, absolute beyond, `title` carrying the exact time.
- `metadata` is not rendered as raw JSON. Only the known keys used by the current services
  may be surfaced, and only as supporting text: `from`/`to` on status changes,
  `company_id`, `service_id`, `order_id`, `assigned_to_profile_id`, `sort_position`.
- Events are grouped under day headers (**Today**, **Yesterday**, then the date).

**Primary action.** None. The timeline is read-only.

**Secondary actions.** A line whose entity is not the current record links to that record.

**Controls.** **Load more** in increments of 50 (client-side slice of the fetched
collection; `listForEntity` is unbounded — a real limit/offset is **[NEW READ `R7`]**).

**Sorting/filtering.** `created_at` descending, as the repository returns. No filtering by
actor or action in V1 — no query supports it and client-side filtering of a partial list
would mislead.

**Empty state.** *"No activity yet."* — one muted line, no action.

**Loading state.** Five line skeletons.

**Error state.** Inline banner with **Retry**, scoped to the timeline. A timeline failure
never blocks the record.

**Success behavior.** After a mutation elsewhere on the record, the new event is prepended
without a full refetch, using the event the service call returned.

**Desktop.** Single column, max 720px within the panel; avatar gutter 32px.

**Mobile.** Full width, timestamp moves to a second line under the summary.

**Navigation destination.** The referenced record, when it is not the current one.

**Confirmation requirements.** None.

**Intentionally unavailable.** Editing or deleting events (the database enforces
append-only through `prevent_activity_event_mutation`), comments on events, manual entries,
filtering by actor or action, export, a global cross-entity feed beyond Home's recent list,
client-visible activity (internal summaries name staff and internal state).
