# Phase 2B — Product Shell

Specification for the first visible Wolf Forge Platform UI: the shell that surrounds every
screen, and the rules an implementation agent must follow when building inside it.

Companion document: [phase2b-screen-contracts.md](phase2b-screen-contracts.md).

**Ground rule for this entire document:** every behavior described here is backed by the
Phase 1 schema (`supabase/migrations/20260812024130_initial_core_schema.sql`) and the
Phase 2A service layer (`src/domain`, `src/repositories`, `src/services`). Where a behavior
needs a capability that does not exist yet, it is marked **[REQUIRES NEW READ METHOD]** or
**[REQUIRES APPROVAL]** and is not silently assumed.

---

## 1. Product-shell philosophy

The platform is an **operating workspace**, not a reporting product. The shell exists to
answer one question on arrival and then get out of the way:

> **What needs attention?**

Five principles govern every shell decision.

1. **The shell is thin.** Global chrome is one top bar on desktop and one top bar plus one
   bottom bar on mobile. No permanent sidebar, no secondary persistent panels, no
   collapsible rails. Screen content owns the viewport.
2. **Navigation exposes only what works.** A destination appears in navigation only when
   every action inside it is implemented end to end. No placeholders, no "coming soon",
   no disabled nav items.
3. **Objects are the nouns.** Client, Contact, Service, Project, Task, Activity. The
   navigation is a map of real records, not a map of features.
4. **Depth is expensive.** Maximum two levels of navigation: a global slot, and — only when
   a slot genuinely holds more than one working screen — a contextual horizontal bar inside
   it. V1 uses contextual bars only inside record detail screens.
5. **Nothing is invented.** No metric is displayed that is not a count of rows the client
   actually fetched. No chart, no trend, no percentage, no forecast, no "health score".

### Vocabulary lock

Two locked splits between the product word and the schema entity. **The UI never shows the
schema word, and no document renames the schema.**

| Schema | Product label | Meaning |
| --- | --- | --- |
| `companies` | **Client** | The customer business. The billing/relationship root. |
| `client_contacts` | **Contact** | A person who belongs to a client. |
| `orders` | **Project** | A unit of delivery work for one client against one service. |
| `order_tasks` | **Task** | A step inside a project. |
| `profiles` (internal roles) | **Team member** | Wolf Forge staff. Assignable. |
| `profiles` (client role) | **Portal user** | A contact's future portal login. Not shown in V1. |

The hierarchy this produces:

```
Clients
→ Kraken Junk Removal
  → Contacts
  → Projects
    → SEO Campaign
      → Tasks
      → Activity
```

**UI: Project · Backend: order.** Every service, repository, table, column, constraint, and
route identifier keeps the `order` vocabulary — `OrderService`, `OrderRepository`, `orders`,
`order_tasks`, `order_id`, `order_number`, `createOrderSchema`, `ListOrdersFilter`, and the
seven order-status enum values. Only text a user reads changes. Where a passage names both
layers, it names them explicitly (*UI: Project · Backend: order*).

Never introduce "Account", "Organization", or "Customer" as separate UI concepts, and never
render the word "Order" in the interface. If a future requirement needs a parent above
Client, it is introduced as a new noun with its own screens, not by re-labelling this one.

### Visual DNA

| Token | Value | Use |
| --- | --- | --- |
| `--wf-navy` | `#000D51` | Primary actions, active nav, links, focus ring, headings on light. |
| `--wf-navy-hover` | `#001A73` **[REQUIRES APPROVAL]** | Primary button hover/press. |
| `--wf-navy-wash` | `#F2F3F8` **[REQUIRES APPROVAL]** | Selected row, active tab background. |
| `--wf-white` | `#FFFFFF` | Page and card surface. |
| `--wf-warm-50` | `#F8F7F5` **[REQUIRES APPROVAL]** | App background behind cards. |
| `--wf-warm-100` | `#EFEDE9` **[REQUIRES APPROVAL]** | Table header, subtle fills. |
| `--wf-border` | `#E2DFDA` **[REQUIRES APPROVAL]** | 1px borders and dividers. |
| `--wf-text` | `#1A1A18` **[REQUIRES APPROVAL]** | Body text. |
| `--wf-text-muted` | `#6B6660` **[REQUIRES APPROVAL]** | Labels, metadata, timestamps. |
| `--wf-gold` | `#A8832E` **[REQUIRES APPROVAL]** | Attention accents only. Never a background for large areas. |
| `--wf-danger` | `#8C2F2F` **[REQUIRES APPROVAL]** | Overdue, destructive confirm, error text. |

Rules:

- **Typeface:** Inter. Weights 400 / 500 / 600 only. No 700+ display weight in the shell.
- **Radius:** 4px on inputs, buttons, badges. 6px on cards and drawers. Never fully rounded
  pills except the avatar.
- **Elevation:** borders do the work. Exactly two shadows exist in the system: dropdown/
  popover (`0 4px 12px rgba(0,13,81,0.08)`) and drawer/modal
  (`0 8px 32px rgba(0,13,81,0.12)`). Cards and tables use borders, never shadows.
- **Icons:** single-weight line icons, 16px in dense UI, 20px in nav. Icons never appear
  without a text label in navigation.
- **Motion:** 120ms for hover/focus, 180ms for drawer and menu entry, 240ms for bottom
  sheets. Easing `cubic-bezier(0.2, 0, 0, 1)`. Nothing animates on initial page paint.
  Respect `prefers-reduced-motion: reduce` by dropping to opacity-only transitions.
- **Gold is rationed.** Gold appears on: the attention-state badge, the "needs attention"
  section marker on Home, and nowhere else in V1.

Explicitly forbidden: gradient fills, glassmorphism, oversized rounded pills, multi-color
status rainbows, decorative illustrations, sparklines, donut charts, KPI tiles with
percentage deltas, "AI" visual language.

---

## 2. Desktop global layout

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  WOLF FORGE   Home  Clients  Projects  Services          [ search ] [+] (AP) │  56px, sticky
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   ┌─ page container: max-width 1280px, centered, 32px side padding ──────┐   │
│   │  Page title                                    [ secondary ] [ Primary ] │
│   │  supporting line / breadcrumb                                        │   │
│   │  ────────────────────────────────────────────────────────────────    │   │
│   │  contextual tabs (record detail screens only)                        │   │
│   │                                                                      │   │
│   │  content                                                             │   │
│   └──────────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────────┘
```

- **Top bar:** 56px, `--wf-white`, 1px bottom border, sticky at `top: 0`, `z-index: 100`.
  Never hides on scroll.
- **Left:** wordmark, links to Home.
- **Center-left:** global navigation links. Active item is 500 weight with a 2px
  `--wf-navy` underline flush to the bar's bottom border. Inactive items are
  `--wf-text-muted`.
- **Right, in order:** search entry point (see §8), Create control (see §6), avatar menu
  (see §9). 8px gap.
- **Page container:** `max-width: 1280px` for list screens, `max-width: 1200px` for detail
  screens, centered, 32px horizontal padding, 24px top padding.
- **Page header block:** title (24px/600) on the left, actions on the right, aligned to the
  same baseline. Maximum **one** primary button and **two** visible secondary buttons; any
  further action goes into an overflow "…" menu. Breadcrumb, when present, sits above the
  title at 13px muted and shows at most two ancestors.
- **Contextual horizontal navigation** appears only inside record detail screens (Client
  Detail, Project Detail). It sits directly under the page header block, above the content,
  as underlined tabs. It never appears at the module level in V1.
- **No sidebar of any kind, at any breakpoint, ever.** This is a locked decision.

---

## 3. Mobile global layout

Mobile is purpose-built. It is not the desktop shell at a smaller width.

```
┌────────────────────────────┐
│ ‹ Back   Screen title  (AP)│  52px top bar
├────────────────────────────┤
│                            │
│  content, 16px padding     │
│  full-bleed lists          │
│                            │
│                            │
├────────────────────────────┤
│  Home  Clients  Projects  ⊕│  56px + safe area
└────────────────────────────┘
```

Differences from desktop, each deliberate:

1. **Bottom bar carries destinations, not the brand.** Three destinations plus one Create
   action. Icons with 11px labels. Active item is `--wf-navy` on both icon and label.
2. **The top bar is contextual, not global.** On a root destination it shows the screen
   title and the avatar. On a nested screen it shows a back affordance and the record name,
   truncated to one line.
3. **Services is not in the bottom bar.** Catalog editing is low-frequency configuration
   work; spending a permanent thumb-zone slot on it would starve the daily flows. Services
   lives in the account sheet (avatar → **Services**). This divergence from desktop is
   intentional.
4. **Page-level action buttons move to the bottom of the content**, full width, above the
   bottom bar, rather than into the top bar. Destructive and low-frequency actions live in
   an overflow sheet opened from the top bar "…".
5. **Tables do not exist on mobile.** Every list is a stacked row list (see §19).
6. **Drawers become bottom sheets**, dismissible by swipe-down and by an explicit Cancel.
7. **No hover states.** Every affordance is visible at rest; row actions are reached by
   tapping the row or its trailing "…" control.

---

## 4. First-version navigation

### Desktop global navigation

| Slot | Route | Contains |
| --- | --- | --- |
| **Home** | `/` | Attention queues and recent activity. |
| **Clients** | `/clients` | Client list → Client detail (contacts, projects, activity). |
| **Projects** | `/orders` | Projects list → Project Detail (tasks, activity). *UI: Project · Backend: order.* |
| **Services** | `/services` | Service catalog. |

Four flat items, zero navigation depth. Rationale for the shape:

- **Projects is top-level, not nested under a "Work" slot.** A "Work" slot would today hold
  exactly one working screen, which is depth for its own sake. Tasks have no independent
  list — `TaskRepository` exposes only `listForOrder` — so a global Tasks destination is
  not backed by the data layer and must not be shown.
- **Services is top-level *provisionally*.** It is real, working, and needed. It is also
  destined for the future **Sales** slot (SPP calls these products/packages). §5 defines
  exactly how it moves there without a shell redesign.
- **Nothing else appears.** Sales, Billing, Support, Forms, Automation, Integrations, and
  the Client Portal are absent from navigation because no screen behind them works.

### Route naming — recommendation

Routes in these two documents are treated as **implementation identifiers**: every path is
quoted next to the service, repository, or schema name it maps onto (`/orders/:orderId`
carries an `orders.id`), so V1 keeps `/orders`, `/orders/new`, `/orders/:orderId`. That is a
deliberate but temporary asymmetry, not a claim that it is correct — the path is visible in
the address bar and in every shared link, so a **Projects** screen served from `/orders`
leaks backend vocabulary to the user.

> **Recommendation: rename the visible routes to `/projects`, `/projects/new`, and
> `/projects/:orderId` before any user outside Wolf Forge sees the app, keeping `/orders*`
> as permanent redirects.** The route *parameter* stays `:orderId` because it is an
> `orders.id`. Ship this in the same change as the §5.2 promotion redirects so the URL space
> moves once rather than twice. **[REQUIRES APPROVAL]**

Until that approval lands, every route written in these documents reads `/orders`, and the
label above it reads **Projects**.

Contextual horizontal navigation in V1 exists in exactly two places:

- **Client Detail:** Overview · Contacts · Projects · Activity
- **Project Detail:** Tasks · Activity

### Mobile navigation

| Bottom bar slot | Type | Target |
| --- | --- | --- |
| Home | destination | `/` |
| Clients | destination | `/clients` |
| Projects | destination | `/orders` |
| Create | action | opens the Create sheet (§6) |

Reachable from the avatar sheet: **Services**, signed-in identity, **Sign out**.

The fourth slot is deliberately an action rather than a destination, and a fifth slot is
deliberately left unused — it is reserved for the **More** entry that appears when a fourth
destination ships.

---

## 5. Future navigation expansion strategy

The shell must absorb new modules without being redesigned. Three mechanisms do this.

### 5.1 The slot registry

Global navigation is data, not markup. One module registry drives desktop top nav, the
mobile bottom bar, and the mobile account sheet:

```ts
interface NavSlot {
  id: string;                    // 'clients'
  label: string;                 // 'Clients'
  route: string;                 // '/clients'
  icon: IconName;
  enabled: boolean;              // false = absent from the DOM, not disabled
  surfaces: Array<'desktop' | 'mobile-bar' | 'mobile-sheet'>;
  tabs?: ContextualTab[];        // populated only when > 1 working screen
  order: number;
}
```

Shipping Billing means appending one entry with `enabled: true`. No shell component
changes. `enabled: false` slots must be **omitted from the rendered output**, never
rendered disabled or greyed.

### 5.2 The promotion rule

> When a slot would hold more than one working screen, the slot becomes the parent and its
> screens become contextual horizontal tabs inside it. The slot's route becomes a redirect
> to its first tab.

Applied to the known roadmap:

| Today | After expansion | Mechanism |
| --- | --- | --- |
| `Projects` | `Work` → Projects · Tasks · Requests | Promotion; the current path keeps working as a permalink and the tab reads `/work/projects`, with a redirect from the old path. |
| `Services` | `Sales` → Proposals · Packages · Checkout · Contracts | The Services slot is retired and re-registered as the "Packages" tab of the Sales slot; `/services` redirects. |
| `Home` | `Dashboard` | Label change only. |
| — | `Billing`, `Support` | New slots appended. |

Because every list and detail screen is written to a route and never to a nav position, a
promotion is a routing table edit plus a redirect. No screen contract changes.

### 5.3 The record-tab registry

Contextual tabs inside a record detail screen are also a registry, so future capabilities
attach to existing records instead of demanding new top-level destinations:

| Record | V1 tabs | Reserved future tabs |
| --- | --- | --- |
| Client Detail | Overview · Contacts · Projects · Activity | Invoices · Subscriptions · Files · Forms · Messages · Portal Access |
| Project Detail | Tasks · Activity | Files · Messages · Invoice · Forms |

A tab is appended, never inserted before Overview, and **Activity always stays last.**

Mobile ceiling: when a record exceeds four tabs, the tab strip becomes horizontally
scrollable with the active tab scrolled into view — it does not wrap and does not become a
dropdown.

---

## 6. Quick-create behavior

### Control

Desktop: a `+` button in the top bar right cluster opens a menu, keyboard shortcut `C`.
Mobile: the bottom bar's Create slot opens a bottom sheet.

### Contents — context-aware, never dead

The menu always contains the two creates that need no parent:

- **New Client** → `/clients/new`
- **New Project** → `/orders/new`

The menu **gains** context-scoped entries when the current route supplies an unambiguous
parent:

- On any `/clients/:companyId*` route → **New Contact** (opens the contact drawer with the
  client pre-bound)
- On any `/orders/:orderId*` route → **New Task** (opens the task drawer with the project
  pre-bound)

Rationale: a global "New Task" with no project context would have to open a picker over
every project in the system, and its backing method `OrderRepository.list()` has no search
or pagination. A create entry that is disabled, or that opens a modal asking "which
project?", is worse than one that appears exactly where it can succeed. Users still create
contacts and tasks from their parent screens, which remains the primary path.

**New Service is deliberately excluded from quick create.** It edits the global catalog,
it is low-frequency configuration, and it is not part of daily operational throughput. It
is created from `/services` only. **[REQUIRES APPROVAL — see §12 of the final report]**

### Rules

- The menu lists at most six items; beyond that it gains section headers.
- Every entry navigates or opens immediately. No sub-menus.
- A create started from quick create returns the user to the **created record**, not to the
  screen they launched from (see per-screen success behavior in the contracts document).

---

## 7. Contextual navigation behavior

- Rendered as underlined tabs directly beneath the page header block: 14px, 500 weight when
  active with a 2px `--wf-navy` underline, `--wf-text-muted` when inactive.
- Each tab is a real route (`/clients/:id/contacts`), so tabs are linkable, refresh-safe,
  and back-button correct. Tab switches must not full-page reload.
- The record header block (name, key metadata, primary actions) stays fixed above the tabs
  across every tab. Switching tabs never changes the header.
- Tabs may carry a count when the count is the length of an already-fetched collection
  (`Contacts 4`). They must not carry a count that would require a separate query.
- The default tab is the leftmost: Overview for Client Detail, Tasks for Project Detail.
- Tab content owns its own loading and empty states; the header does not re-skeleton.

---

## 8. Search behavior direction

**V1 has no global search, and the shell must not pretend otherwise.**

The repository layer offers no text search: `listActive()` on companies and services returns
everything ordered by name; `OrderRepository.list()` filters only by company, status, and
archived state. Server-side search over multiple entity types does not exist.

What V1 ships:

- **Per-list filter input**, labelled **"Filter clients"** / **"Filter projects"** /
  **"Filter services"** — the word *Filter*, never *Search*, because it only narrows rows
  already loaded in the client. Case-insensitive substring match, 150ms debounce, matched
  fields stated per screen in the contracts document.
- The filter value lives in the URL query string (`?q=`) so a filtered list is shareable
  and survives refresh.
- Filtered-empty results get the filtered-empty state (§13), not the true-empty state.

What V1 reserves:

- The top bar keeps a **search slot** in its right cluster. In V1 it renders **nothing** —
  no greyed box, no non-functional icon.
- When server-side search lands, that slot becomes a `⌘K` command palette spanning clients,
  projects, and contacts. The slot's position, width, and keyboard shortcut are fixed now so
  the top bar layout does not shift later.

Prerequisite before global search is specified further: server-side search methods on the
repositories (trigram or `ilike` indexes over `companies.name`, `orders.title`,
`orders.order_number`, `client_contacts.name`/`email`). **[REQUIRES NEW READ METHOD]**

---

## 9. Profile / account placement

- **Desktop:** a 28px circular avatar at the far right of the top bar showing the initials
  derived from `profiles.display_name`. Click opens a 240px menu:

  ```
  Anthony Paghubasan
  Owner                      ← roles.name, title-cased
  ─────────────────────────
  Sign out
  ```

- **Mobile:** the same avatar in the top bar opens a bottom sheet containing identity, a
  **Services** link, and **Sign out**.
- There is **no settings screen in V1** — no user-editable preference exists in the schema.
  `profiles.display_name` is nullable and there is no profile update path in the service
  layer, so profile editing is not offered.
- **Avatar fallback:** `display_name` is nullable. When it is null, render a neutral glyph
  avatar and the label "Unnamed user"; do not fall back to a raw UUID, and do not invent an
  email — `profiles` has no email column.
- Sign out clears the Supabase session and hard-navigates to `/login`.

---

## 10. Modal vs drawer vs dedicated page

A single decision table. An implementation agent must not deviate per screen.

| Surface | Use when | Desktop form | Mobile form |
| --- | --- | --- | --- |
| **Dedicated page** | Creating or editing a **root record** (Client, Project), or any form with more than four fields, or any form the user may need to leave and return to. | Route, page container, header with Save/Cancel. | Full screen, same route. |
| **Drawer** | Creating, editing, or inspecting a **child record that only exists inside an open parent** (Contact, Task), where parent context must stay visible. | Right-side, 480px, overlay scrim, parent stays rendered behind. | Bottom sheet, max 90vh, swipe-to-dismiss. |
| **Modal** | A single decision or a single field. Confirmations, destructive acknowledgements. | Centered, 420px max, never scrolls internally. | Centered, 16px inset. Never a full-screen takeover. |
| **Inline / popover** | Changing one enumerated value on a record already on screen: project status, task status, assignee, priority. | Popover menu anchored to the trigger. | Action sheet from the bottom. |

Applied:

| Action | Surface |
| --- | --- |
| Create / Edit Client | Dedicated page |
| Create Project | Dedicated page |
| Edit Project fields | Dedicated page |
| Create / Edit Contact | Drawer |
| Create / Edit Task | Drawer |
| Create / Edit Service | Drawer (three fields, always launched from the Services list) |
| Change project status, task status, assignee, priority | Inline popover |
| Archive anything, complete a project, reopen a completed project | Modal |

Hard rules: **never stack two overlays.** A drawer may open a confirmation modal; that is
the only permitted stack, and the drawer is inert while the modal is open. Drawers and
modals trap focus, close on `Esc`, restore focus to their trigger, and — for drawers only —
add a history entry so Android back closes the drawer instead of leaving the record.

---

## 11. Confirmation patterns

Confirm only where the action is irreversible in the UI or destroys a timestamp. Everything
else commits immediately and is undone by repeating the inverse action.

| Action | Confirm? | Why |
| --- | --- | --- |
| Change project status among non-terminal states | **No** | Freely reversible; recorded in activity. |
| Set project status → `complete` | **Yes**, modal | Writes `completed_at`. Deliberate act. |
| Move a project out of `complete` | **Yes**, modal | The schema requires `completed_at` to be cleared (`orders_completion_consistent`). The original completion time is **lost from the record** and survives only in `activity_events`. The modal must say so. |
| Set project status → `canceled` | **Yes**, modal | Signals abandonment; visible to the client later. |
| Archive client / contact / service / project | **Yes**, modal | No un-archive method exists in the repository layer. Effectively one-way in V1. |
| Change task status (including → `complete`) | **No** | Low stakes and frequent. Toast states that completion time was cleared when moving out of `complete`. |
| Change assignee, priority, sort position | **No** | Single-field, reversible, logged. |
| Leave a create/edit page with unsaved changes | **Yes**, modal | Prevents silent data loss. |

Confirmation modal anatomy:

- Title states the action in the imperative: *"Archive this client?"*
- Body states the **specific consequence**, never generic risk language: *"Wolf Reef Media
  will be hidden from lists and pickers. Its 3 projects stay intact. This cannot be undone
  in the app."*
- Primary button repeats the verb (**Archive client**), styled `--wf-danger` for
  archive/cancel, `--wf-navy` otherwise. Secondary button is **Cancel** and is focused by
  default for destructive confirms.
- No typed-name confirmation in V1; the actions are recoverable at the database level.

---

## 12. Loading states

| Situation | Treatment |
| --- | --- |
| Route load (list or detail) | Skeleton matching the final layout: correct row count guess (6 rows), correct column widths, correct header height. No spinner, no layout shift on resolve. |
| Skeleton flash guard | Delay skeleton render by 150ms. Faster responses render content directly. |
| Tab switch inside a record | Only the tab panel skeletons. The record header never re-skeletons. |
| Form submit | The submit button enters a pending state: same label, 16px inline spinner before it, button and all form inputs disabled. Never replace the label with "Loading…". |
| Inline value change (status, assignee, priority, task reorder) | **Optimistic.** Apply immediately, mark the control busy with reduced opacity, roll back and show the error treatment on failure. |
| Drawer open for editing | Drawer animates in already populated from the list row's data; if a fetch is needed, skeleton inside the drawer body only. |
| Background refresh after a mutation | Silent. No skeleton, no spinner; the list updates in place. |

Never: full-page spinner overlays, blocking "Please wait" dialogs, progress bars for
operations with no measurable progress, artificial minimum delays.

---

## 13. Empty states

Two distinct kinds. Do not use one for the other.

**True empty** — the collection has no records at all:

```
        No clients yet
        Clients are the businesses you deliver work for.
        Every project belongs to one.

        [ New client ]
```

- Title: 16px/500, plain statement of absence.
- Body: one or two sentences explaining what the object is and why it matters. Never
  "Get started by…".
- Exactly one primary action, matching the screen's primary action.
- Vertically centered in the content region, max 380px wide, no illustration, no icon
  larger than 24px.

**Filtered empty** — records exist but the current filter or tab excludes them:

```
        No clients match "acme"
        [ Clear filter ]
```

- Names the active filter value.
- Offers the reset, not the create.

Per-screen copy is specified in the contracts document. Empty states inside a record tab
(no contacts, no tasks) are compact: a single line plus an inline action, aligned left in
the panel rather than centered.

---

## 14. Error states

The service layer throws `ApplicationError` with a known `code`
(`src/lib/errors/application-error.ts`). The shell maps each code to exactly one
presentation. An implementation agent must not invent a third path.

| Code | Route load | Action / submit |
| --- | --- | --- |
| `VALIDATION_ERROR` | n/a | Field-level messages when the Zod issue carries a field path; otherwise a form-level banner above the first field. **Never a toast.** Focus moves to the first invalid field. |
| `NOT_FOUND` | Full-page state: "This client no longer exists or was archived." + link back to the list. | Toast "That record no longer exists.", then refresh the list. |
| `PERMISSION_DENIED` | Full-page state: "You don't have access to this area." + Sign out link. No retry button. | Persistent inline banner at the affected control. Never retried automatically. |
| `CONFLICT` | n/a | Message placed **at the control that caused it**, with the resolving action offered inline. Example: setting a second primary contact violates `client_contacts_one_active_primary_per_company_key` → "Sarah Chen is already the primary contact. [Make this contact primary instead]". |
| `DATABASE_ERROR` | Full-page state with **Try again**. | Banner above the form or a toast with **Retry** for inline changes. Optimistic changes roll back first. |
| Network / unknown | Same as `DATABASE_ERROR`. | Same as `DATABASE_ERROR`. |
| Expired session (Supabase 401) | Redirect to `/login?next=<path>`; after sign-in, return to `<path>`. | Same. Never show a raw auth error. |

Global rules:

- Error copy names the object and the failed operation. Never "Something went wrong."
- Never surface raw Postgres messages, constraint names, or codes to the user. Log them.
- An optimistic change that fails must visibly revert **before** the error is announced, so
  the user never sees a false success.
- Errors are announced through an `aria-live="assertive"` region; toasts through
  `aria-live="polite"`.

---

## 15. Success feedback

- **Inline change** (status, assignee, priority, reorder): the control itself shows the new
  value. That is the confirmation. No toast.
- **Drawer save** (contact, task, service): drawer closes, the affected row flashes a
  `--wf-navy-wash` background for 600ms, no toast.
- **Page save** (client, project): navigate to the record, then a bottom-right toast
  (bottom-center on mobile), 4 seconds, one line: *"Project #1042 created."* — the number is
  `orders.order_number`, rendered as the project number.
- **Archive:** toast confirming the archive, and the row leaves the list.
- **Undo** appears in a toast **only** where a true inverse operation exists in the service
  layer: assignment changes and status changes. Archive has **no** un-archive method in the
  repositories and therefore never offers Undo — this is why archive is confirmed instead
  (§11).
- Toasts stack to a maximum of three, newest at the bottom, and are dismissible.
- Every success message states what happened to which record. Never a bare "Saved".

---

## 16. Responsive behavior

| Range | Shell | Content |
| --- | --- | --- |
| `< 768px` | Mobile shell: contextual top bar + bottom bar. | Stacked row lists, full-width buttons, bottom sheets, single-column detail. |
| `768px – 1023px` | Desktop shell, condensed: top bar padding 16px, nav labels only. | Tables allowed at a reduced column set (see §19). Drawers 400px. Record detail single-column. |
| `1024px – 1279px` | Desktop shell. | Full tables. Project Detail two-column (summary 320px + main). |
| `≥ 1280px` | Desktop shell. | Container caps at 1280px and centers; no further layout change. |

Rules:

- The breakpoint at 768px is a **shell switch**, not a reflow. The two shells are separate
  component trees.
- Touch targets are ≥ 44×44px below 768px and ≥ 32px above it.
- Bottom bar respects `env(safe-area-inset-bottom)`.
- No horizontal page scrolling at any width. Wide content scrolls inside its own container.
- The layout is not tested below 360px.

---

## 17. Accessibility basics

- **Focus:** every interactive element shows `outline: 2px solid var(--wf-navy);
  outline-offset: 2px` on `:focus-visible`. Focus is never suppressed.
- **Keyboard:** all actions are reachable without a pointer. This specifically requires a
  **non-drag alternative for task reordering** — every task row's overflow menu contains
  *Move up* / *Move down*, both writing `sort_position` through
  `TaskService.reorder`.
- **Overlays:** drawers and modals trap focus, close on `Esc`, and restore focus to their
  trigger. The background is `inert`.
- **Tables** are real `<table>` elements with `<th scope="col">`, a visually hidden
  `<caption>`, and no ARIA grid roles.
- **Status is never conveyed by color alone.** Every badge carries text. Overdue carries
  both the `--wf-danger` color and the word "Overdue".
- **Contrast:** body text ≥ 4.5:1, large text and UI borders ≥ 3:1. `--wf-gold` fails 4.5:1
  on white and is therefore **never used for text** — accents, borders, and fills behind
  dark text only.
- **Forms:** every input has a persistent visible `<label>`; placeholders are never labels.
  Errors are tied by `aria-describedby` and the input carries `aria-invalid`.
- **Announcements:** toasts `aria-live="polite"`; error banners `aria-live="assertive"`;
  optimistic status changes announce the resulting value.
- **Motion:** honor `prefers-reduced-motion`.
- **Titles:** `document.title` follows `Record name · Section · Wolf Forge`.

---

## 18. Information-density rules

The workspace is dense but not cramped.

- **Spacing scale:** 4 / 8 / 12 / 16 / 24 / 32 / 48. Nothing off-scale.
- **Table rows:** 44px desktop, 56px touch. Cell padding 12px horizontal.
- **Column ceiling:** 6 columns at ≥1280px, 5 at 1024–1279px, 4 at 768–1023px. Columns drop
  from the right in a per-screen priority order defined in the contracts document.
- **One badge per row.** Where a row has both a status and a priority, priority renders as a
  text-weight treatment or a leading marker, not a second badge.
- **Alignment:** text left, numbers and dates right, actions right-most and fixed width.
- **Dates:** relative within 7 days ("3 days ago", "in 2 days"), absolute beyond
  ("12 Aug 2026"), and every date carries a `title` with the full timestamp. Times display
  in the viewer's local zone; all storage is `timestamptz`.
- **Truncation:** single-line ellipsis with a `title` attribute. Never wrap to a third line
  in a table cell.
- **Record header metadata:** maximum six key-value pairs before the content begins.
- **Vertical rhythm:** 24px between major sections, 16px within a section.
- **Section counts** are permitted only when they are the length of a fetched collection.

---

## 19. Table and list behavior

**Desktop (≥768px): table.** **Mobile (<768px): stacked rows.** Same data, different
component. A mobile row shows: primary identifier (16px/500), one metadata line
(`--wf-text-muted`, 13px), and a trailing status badge; tapping the row navigates, and a
trailing "…" opens the action sheet.

- **Row click** navigates to the record. The whole row is the target. Interactive controls
  inside a row (status menu, overflow) stop propagation.
- **Sorting:** each list ships with the default order its repository already returns —
  companies and services by `name` ascending, orders by `created_at` descending, contacts by
  `is_primary` then `name`, tasks by `sort_position` then `created_at`. Additional sorting is
  **client-side over the fetched set only** and the column header must indicate it.
- **Filtering:** status and assignment filters on the Projects list map to real columns.
  `OrderRepository.list` supports `companyId`, `status`, and `includeArchived` server-side;
  any other filter is applied client-side over the fetched set. Active filters render as
  removable chips above the table with a **Clear all**.
- **Archived records** are excluded everywhere by default. Only the Projects list exposes an
  **Include archived** toggle, because only `ListOrdersFilter` supports it. Archived rows
  render at 60% opacity with an "Archived" badge and are read-only.
- **Pagination:** none in V1 — the repositories return unbounded collections. Every list
  therefore **caps rendering at 200 rows** and shows a persistent notice: *"Showing the
  first 200 of N. Server-side pagination is required before production data."* This cap is a
  known limitation, not a feature. **[REQUIRES NEW READ METHOD before real data]**
- **No row selection, no bulk actions, no inline cell editing** in V1.
- **Column resize, reorder, and hide** are out of scope.
- **Sticky table header** below the top bar on desktop lists.

---

## 20. Long-term features intentionally absent from V1

William's nine feature groups define the platform's destination. V1 ships none of them
whole. Absences are deliberate and each has a named reason.

| Group | V1 status | Reason |
| --- | --- | --- |
| **1. Client Portal** | Absent | The `client` role and its RLS policies exist, but no portal surface does. The portal is a separate application shell (§21) and must not be an afterthought bolted onto staff screens. |
| **2. Proposals & Sales** | Absent | No proposal, package, checkout, subscription, or contract tables exist. `services` is a name/description catalog with no price. |
| **3. Billing & Payments** | Absent | No invoice, payment, or subscription tables. No processor integration. Locked decision: billing follows core fulfillment. |
| **4. Project & Service Delivery** | **Partially shipped** | Projects (backend `orders`), tasks, assignment, status, and the activity spine ship. Files, client-facing status views, client requests, and fulfillment automation do not — no storage bucket, no request table, no rules engine. |
| **5. Forms & Questionnaires** | Absent | No form definition, submission, or custom-field tables. |
| **6. Client Communication** | Absent | No message or notification tables and no delivery transport. `orders.notes` is an internal free-text field and must never be presented as client-visible. |
| **7. Automation** | Absent | No trigger or action model. `activity_events` is the append-only spine automation will later read from, which is why it ships now. |
| **8. Integrations** | Absent | No credential storage, no webhook endpoints, no public API surface. |
| **9. White-label / Agency Branding** | **Partially shipped** | Wolf Forge brand tokens ship as a single theme layer. Custom domains and per-tenant branding do not — there is no tenant/branding table. |

Two consequences an implementation agent must respect:

- **Project Detail gets no invoice, payment, file, message, or form UI in V1** — not even
  placeholder tabs.
- **`orders.notes` is internal.** Label it "Internal notes" so its meaning does not have to
  change when client-visible communication ships.

---

## 21. How the shell absorbs the future without a redesign

Each of the six named future areas has a pre-decided attachment point.

### Sales

- **Nav:** new slot `Sales`, placed between Home and Clients. Services is retired as a slot
  and re-registered as its **Packages** tab; `/services` redirects to `/sales/packages`
  (§5.2).
- **Records:** proposals and packages get their own detail screens with the same header +
  contextual-tab anatomy. A **Proposals** tab appends to Client Detail.
- **Shell impact:** two registry entries and one redirect.

### Billing

- **Nav:** new slot `Billing` after Projects.
- **Records:** **Invoices** and **Subscriptions** tabs append to Client Detail; an
  **Invoice** tab appends to Project Detail. Project Detail's summary column gains a billing
  summary card in the space already reserved beneath the project metadata.
- **Shell impact:** one slot, three tab registrations. No layout change — the two-column
  Project Detail was chosen now so this card has somewhere to land.

### Support

- **Nav:** new slot `Support`.
- **Records:** a **Messages/Tickets** tab appends to Client Detail and to Project Detail.
- **Shell impact:** the top bar right cluster gains an unread indicator on the avatar. Its
  position is already reserved between the Create control and the avatar.

### Forms

- **Nav:** no slot of its own. Form *definitions* live under Settings; form *responses*
  attach to records.
- **Records:** a **Forms** tab appends to Client Detail (intake, onboarding) and to Project
  Detail (per-project questionnaires).
- **Shell impact:** none beyond tab registration.

### Automation

- **Nav:** no slot. Automation is configuration, not a daily destination — it belongs under
  a future `Settings` area reached from the avatar menu, whose slot in the menu already
  exists conceptually (§9).
- **Surface:** automation results appear in the existing Activity timeline with
  `actor_profile_id` null. The activity schema already supports system-authored events via
  `ActivityService.recordSystemAction`, so no new display surface is needed — the timeline
  must render a null actor as "Automation" from day one so it does not need changing later.
- **Shell impact:** none.

### Client Portal — architectural separation

The portal is **a second application shell, not a permission mode of this one.**

| Concern | Internal workspace | Client portal |
| --- | --- | --- |
| Route namespace | `/` | `/portal/*` (or a separate host) |
| Shell components | `shell/internal/*` | `shell/portal/*` — no shared navigation, header, or table components |
| Nav registry | internal slots | its own slots: Overview, Projects, Files, Messages, Invoices, Services, Forms |
| Session gate | `roles.name ∈ {owner, admin, manager, staff}` | `roles.name = 'client'` |
| Data scope | RLS internal policies | RLS client policies, already scoped by `private.current_user_company_id()` |
| Vocabulary | Project, Task, Client | Project, Update, (their own company name) |
| Branding | Wolf Forge | Wolf Forge now; per-client branding later |

Both shells now say **Project** for the same backend `orders` row — that is the point of the
terminology lock, and it does **not** soften the separation below. Shared vocabulary is not
shared components, shared fields, or a shared session.

Binding rules for the implementation agent:

1. **What may be shared:** `src/domain`, `src/repositories`, `src/services`, design tokens,
   and primitive components (button, input, badge). Nothing else.
2. **What must never be shared:** navigation, page headers, list/table components, the
   Create control, drawers containing internal fields, and the activity timeline renderer —
   internal activity summaries contain staff names and internal notes.
3. **Field-level separation:** `orders.notes`, `assigned_to_profile_id`, internal activity
   summaries, and task-level detail are internal. The portal renders a **reduced projection
   of the backend `orders` row** whose fields are chosen explicitly, never by spreading the
   row.
4. **A staff user must never be routed into the portal shell, and a client user must never
   reach an internal route** — the login redirect resolves the shell by role before any
   internal component mounts (see the Login contract).
5. Building the portal must require **zero changes** to the internal shell. If it does not,
   the separation was violated.

### Wayfront / SPP reference boundary

Wayfront/SPP informs **workflow, feature scope, and business logic only**. No Twig template,
no layout, no permanent sidebar, no proprietary copy, and no visual pattern is reproduced.
Where this document names an SPP concept (packages, checkout, tickets) it names a
*capability*, not an implementation.
