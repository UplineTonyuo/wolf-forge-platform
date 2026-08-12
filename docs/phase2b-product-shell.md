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

1. **The shell is a thin rail, and everything else is temporary.** Permanent global chrome
   is one 64–72px icon rail on desktop. Category menus are **floating panels that appear on
   demand and retract**, never persistent columns. The rail never expands into a large
   permanent sidebar, and no secondary panel stays open once a destination is chosen. The
   workspace beside the rail owns the rest of the viewport.
2. **Navigation exposes only what works.** A destination appears in navigation only when
   every action inside it is implemented end to end. No placeholders, no "coming soon",
   no disabled nav items.
3. **Objects are the nouns.** Client, Contact, Service, Project, Task, Activity. The
   navigation is a map of real records, not a map of features.
4. **Depth is expensive.** Maximum two levels of navigation: a rail category, and the panel
   rows inside it. Below that, contextual horizontal tabs exist **only inside record detail
   screens** — they are part of a record, not a third navigation tier.
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
- **Icons:** single-weight line icons, 16px in dense UI, 20px in nav. Navigation icons carry
  visible text labels except in the desktop rail, where the icon-only format is intentional
  and accessible names plus tooltips supply the label (§2.1).
- **Motion:** the navigation rail, its category panels, Quick Create, and page replacement
  follow the **locked motion language in §2.4** — that section is authoritative and no
  navigation timing may be invented outside it. Everything else in the system uses 120ms for
  hover/focus, 180ms for drawer and menu entry, and 240ms for bottom sheets, easing
  `cubic-bezier(0.2, 0, 0, 1)`. Nothing animates on initial page paint. Respect
  `prefers-reduced-motion: reduce` by dropping to opacity-only transitions everywhere,
  including the rail.
- **Gold is rationed.** Gold appears on exactly four things in V1: the attention-state badge,
  the "needs attention" section marker on Home, the thin indicator on the selected row inside
  a category panel (§2.2), and the Quick Create ring (§6). Nowhere else.

Explicitly forbidden: gradient fills, glassmorphism as a *surface* treatment, oversized
rounded pills, multi-color status rainbows, decorative illustrations, sparklines, donut
charts, KPI tiles with percentage deltas, "AI" visual language, and any permanent expanded
sidebar. The workspace blur behind an open panel (§2.2) is a **scrim**, not glassmorphism:
panels themselves are opaque with a 1px border, never translucent frosted glass.

---

## 2. Desktop global layout — the navigation rail

Wolf Forge Platform is an internal SPP / operating system, not a marketing website. Its
navigation is therefore a **persistent thin rail plus temporary floating category panels** —
permanent access to every category in a fixed 64–72px column, with the category's contents
summoned only when asked for.

> **Superseded decision.** Earlier drafts of this document locked "global top navigation" and
> "no sidebar of any kind, at any breakpoint, ever." **Both statements are obsolete and are
> replaced by this section.** The rail is not the sidebar that decision rejected: it is
> icon-width, it never expands into a permanent labelled column, and its menus are transient.

```
┌────┬─────────────────────────────────────────────────────────────────────────┐
│    │                                                                         │
│ ⊙  │  ┌─ workspace ────────────────────────────────────────────────────┐     │
│ ACT│  │  Page title                              [ secondary ] [ Primary ]   │
│    │  │  supporting line / breadcrumb                                  │     │
│ ⊟  │  │  ──────────────────────────────────────────────────────────    │     │
│ BIL│  │  contextual tabs (record detail screens only)                  │     │
│    │  │                                                                │     │
│ ▲  │  │  content                                                       │     │
│ WF │  │                                                                │     │
│    │  │                                                                │     │
│ ⚙  │  │                                                                │     │
│ SET│  └────────────────────────────────────────────────────────────────┘     │
│    │                                                                         │
└────┴─────────────────────────────────────────────────────────────────────────┘
 64-72px                        full working area
```

### 2.1 Rail anatomy

- **Width:** 64–72px, fixed. It does not expand, collapse, pin, unpin, or remember a width.
  There is no expand affordance, because there is no expanded state.
- **Surface:** `--wf-white` with a 1px `--wf-border` right edge. Full viewport height,
  `position: fixed`, `z-index: 200` — above the workspace scrim so **the rail always stays
  sharp while the workspace blurs.**
- **Contents, top to bottom:**

  | Order | Item | Type | Behavior |
  | --- | --- | --- | --- |
  | 1 | **Activity** | category icon | opens the Activity panel (§4) |
  | 2 | **Billing** | category icon | reserved — **absent in V1** (§4) |
  | 3 | **Wolf Forge logo** | Quick Create | vertically centered, visually prominent (§6) |
  | 4 | **Setup** | category icon | opens the Setup panel (§4) |

- **The logo is centered in the rail's vertical axis**, not stacked immediately after the
  category icons. It is the visual anchor of the rail and the largest target in it.
- **Icons are single-weight line icons, 20px**, each with an accessible name and a tooltip on
  hover after 400ms. This is the one place in the system where a navigation control carries
  **no permanent visible text label** — the rail is icon-only by definition, so every rail
  control must expose its name through `aria-label`, its tooltip, and the panel it opens.
- **Rail state:** the icon whose category is currently open, and the icon owning the current
  destination, both render in `--wf-navy` with a 2px `--wf-navy` left indicator flush to the
  rail's left edge. Inactive icons are `--wf-text-muted`.
- The rail **never scrolls** and never holds more than six controls. When a seventh category
  is needed, categories merge — the rail does not grow a scrollbar.

### 2.2 Floating category panels

Clicking a category icon opens a **temporary bordered panel adjacent to the rail**. It is not
a second column: it overlays the workspace, and it retracts.

```
┌────┬──────────────────────┬──────────────────────────────────────┐
│ ⊙ ▏│  ACTIVITY            │                                      │
│    │  ─────────────────   │        workspace, blurred            │
│    │  Projects         ◂  │        while the panel is open       │
│ ▲  │  Clients             │                                      │
│ WF │  To Do               │                                      │
│    │                      │        (Tickets omitted — unbuilt)   │
│ ⚙  └──────────────────────┘                                      │
│    │                                                             │
└────┴─────────────────────────────────────────────────────────────┘
      panel: 240px, opaque, 1px border, 6px radius
```

The rail above is drawn **as V1 renders it**: Activity · logo · Setup. The Billing icon is
absent because neither of its rows is built, and Tickets is absent from the panel for the
same reason (§4).

- **Panel:** 240px wide, `--wf-white`, 1px `--wf-border`, 6px radius, popover shadow
  (`0 4px 12px rgba(0,13,81,0.08)`). Anchored to its rail icon, offset 8px from the rail's
  right edge, top-aligned to the icon and clamped to stay inside the viewport.
- **Header:** the category name in 11px/600 uppercase `--wf-text-muted` with 0.06em tracking,
  above a 1px divider.
- **Rows:** 40px, 14px/400 text, 12px horizontal padding. Hover fills `--wf-navy-wash`.
- **Selected destination row** (the category item matching the current route):
  `--wf-navy-wash` background, a thin 2px `--wf-gold` left indicator, `translateX(3px)`, and
  600-weight text. This is the only gold in navigation.
- **Only one panel is open at a time.** Opening a second category closes the first with no
  intermediate blur flash — the scrim persists across the swap.
- **The panel is not a menu bar.** It closes the moment a destination is chosen, and it never
  stays open alongside content.

**Opening an exposed category** — Activity or Setup in V1; Billing after it has a working
destination:

1. the rail icon takes quick press feedback;
2. the workspace behind blurs;
3. the bordered panel expands outward from the rail;
4. rows appear with a tiny stagger.

The rail itself never blurs.

**Choosing a destination** — e.g. Projects:

1. the selected row briefly confirms;
2. the panel retracts toward the rail;
3. the blur clears;
4. the destination loads in the workspace;
5. the new page enters with a subtle fade and a small upward settle.

**Dismissing without choosing** — by tapping the active icon again, clicking the blurred
workspace, or pressing `Escape` — retracts the panel and clears the blur, and **the current
page does not move.** Dismissal is never mistaken for navigation.

### 2.3 The workspace

Everything right of the rail is the full working area. After a destination is chosen it is
the whole application:

```
[RAIL] | Projects
       |
       | project filters / controls
       | project table
       | project detail
       | tasks
       | activity
```

- **Container:** `max-width: 1280px` for list screens, `max-width: 1200px` for detail
  screens, centered within the area right of the rail, 32px horizontal padding, 24px top
  padding.
- **Page header block:** title (24px/600) left, actions right, on one baseline. Maximum
  **one** primary button and **two** visible secondary buttons; anything further goes to an
  overflow "…" menu. A breadcrumb, when present, sits above the title at 13px muted and shows
  at most two ancestors.
- **Contextual horizontal navigation** appears only inside record detail screens (Client
  Detail, Project Detail), directly under the page header block, as underlined tabs. It never
  appears at the category level in V1.
- **The workspace scrolls; the rail does not.** Sticky table headers stick below the top of
  the workspace, not below a global bar.
- While a panel or Quick Create is open the workspace is `inert` and carries
  `filter: blur(3px)` plus a `rgba(0,13,81,0.04)` tint. Blur is applied to a wrapper element,
  never to `body`, so the rail and panel are unaffected.

### 2.4 Locked motion language

Motion is fast, deliberate, premium, and operational. **No floaty SaaS animation, no
bouncing, no excessive travel.** These timings are locked; an implementation agent may not
substitute its own.

| Interaction | Duration |
| --- | --- |
| Tap / press feedback | 80–100ms |
| Workspace blur (in and out) | 160–180ms |
| Floating panel open | 200–240ms |
| Floating panel close | 150–180ms |
| Page replacement | 180–220ms |
| Quick Create | 220–260ms |

**Standard easing:** `cubic-bezier(0.22, 1, 0.36, 1)` for every entrance and every retraction
in this section.

**Panel entrance:**

```
opacity     0    → 1
scale       .94  → 1
translateX  -10px → 0
```

Transform origin is the rail edge, so the panel reads as expanding *out of* the rail.

**Panel exit — closes toward the rail:**

```
scale       1 → .96
translateX  0 → -8px
opacity     1 → 0
```

**Row stagger:** 20–25ms per row on entrance, subtle only. A four-row panel is fully settled
within ~100ms of the panel itself. Rows do not stagger on exit — the panel leaves as one
object.

**Page replacement:**

```
old page:  opacity 1 → 0,  translateY 0    → -4px   ~100ms
new page:  opacity 0 → 1,  translateY 8px  → 0      ~180ms
```

The page title may enter ~40ms **before** the main content, so the destination names itself
first. Total page replacement stays within the 180–220ms budget; the two phases overlap
rather than running end to end.

**Reduced motion.** Under `prefers-reduced-motion: reduce`, every transform above is dropped
and only opacity remains, at the same durations. The workspace blur is replaced by a flat
scrim with no blur filter. Nothing in the rail moves.

**Not permitted anywhere in navigation:** spring or bounce easing, overshoot beyond the
values above, travel greater than 10px, rotation, blur on the panel or rail themselves,
sequential "cascading" reveals longer than the stagger budget, and any animation on initial
page paint.

---

## 3. Mobile global layout — the rail becomes a dock

Mobile is purpose-built. **It is not the desktop rail shrunk down.** A 64px vertical column
on a 390px screen would cost 17% of the width permanently and put every control in the
hardest-to-reach corner.

**The chosen adaptation: rotate the rail into a bottom dock and expand its panels upward.**
This is the cleanest option because it preserves all four things that make the rail work —
category grouping, Quick Create prominence, fast access to working modules, and the identical
blur/panel interaction language — while moving every target into the thumb zone. The
category model is unchanged; only the axis and the panel's direction of travel change.

```
┌────────────────────────────┐          ┌────────────────────────────┐
│ ‹ Back   Screen title  (AP)│  52px    │ ‹ Back   Screen title  (AP)│
├────────────────────────────┤          ├────────────────────────────┤
│                            │          │░░░░░░ blurred workspace ░░░│
│  content, 16px padding     │   tap    │░░┌──────────────────────┐░░│
│  full-bleed lists          │  Activity│░░│ ACTIVITY             │░░│
│                            │  ──────▶ │░░│ ─────────────────    │░░│
│                            │          │░░│ Projects          ◂  │░░│
│                            │          │░░│ Clients              │░░│
│                            │          │░░│ To Do                │░░│
│                            │          │░░│                      │░░│
├────────────────────────────┤          ├──┴──────────────────────┴──┤
│   ⊙        ▲WF        ⚙    │  64px    │   ⊙        ▲WF        ⚙    │
└────────────────────────────┘  + safe  └────────────────────────────┘
  Activity  Quick    Setup                 dock stays sharp above
            Create                         the blur and the panel
```

Rules, each deliberate:

1. **The dock carries the same categories as the rail**, in the same order, with the Wolf
   Forge logo centered between them: Activity · **logo** · Setup. Billing joins in its
   reserved position when it ships (§4). 64px tall plus `env(safe-area-inset-bottom)`,
   `--wf-white`, 1px top border, `z-index: 200`.
2. **The logo keeps its prominence.** It is the center slot, rendered ~40px against ~24px
   category icons, and it is the only dock control with a filled `--wf-navy` treatment.
   Quick Create is the single most important action on mobile and is placed accordingly.
3. **Dock icons carry 10px labels** (Activity, Setup) because a mobile tooltip cannot exist.
   The logo carries no label — the mark is the label.
4. **Panels rise from the dock instead of expanding from the rail.** Same 240px-equivalent
   content at full width minus 16px insets, same opaque surface, same 1px border, same
   header, same rows, same gold selected-row indicator, same stagger. Only the entrance
   transform changes:

   ```
   opacity     0     → 1
   scale       .94   → 1
   translateY  +10px → 0      (panel exits back down toward the dock)
   ```

   Every duration and the easing curve are **identical to §2.4**. The dock stays sharp above
   the blurred workspace exactly as the rail does.
5. **Dismissal is identical:** tap the active category again, tap the blurred workspace, press
   Escape on a keyboard, or swipe the panel down. The current page does not move.
6. **The top bar is contextual, not global.** On a root destination it shows the screen title
   and the avatar. On a nested screen it shows a back affordance and the record name,
   truncated to one line. It carries **no navigation** — navigation lives only in the dock.
7. **Page-level action buttons sit at the bottom of the content**, full width, above the
   dock, rather than in the top bar. Destructive and low-frequency actions live in an
   overflow sheet opened from the top bar "…".
8. **Tables do not exist on mobile.** Every list is a stacked row list (see §19).
9. **Drawers become bottom sheets**, dismissible by swipe-down and by an explicit Cancel. A
   category panel and a drawer are never open at once.
10. **No hover states.** Every affordance is visible at rest; row actions are reached by
    tapping the row or its trailing "…" control.

Because categories are identical on both shells, **Services no longer diverges between
desktop and mobile** — it lives under Setup everywhere, and the account sheet no longer
carries navigation.

---

## 4. First-version navigation

### The category structure

Three categories, each a rail icon opening one floating panel. This is the **complete**
structure — including items that do not exist yet, so the shape is settled once.

| Rail icon | Panel contents | V1 status |
| --- | --- | --- |
| **Activity** | Projects · Tickets · Clients · To Do | **partially exposed** |
| **Billing** | Invoices · Subscriptions | **entire category absent in V1** |
| **Setup** | Services · Forms · Settings | **partially exposed** |

### What V1 actually renders

The exposure rule from §1 is unchanged and governs every row above: **a destination appears
only when every action inside it is implemented end to end.** Not-yet-built items are
**omitted from the DOM** — never greyed, never disabled, never "coming soon".

| Category | Row | Route | V1 | Why |
| --- | --- | --- | --- | --- |
| Activity | **Projects** | `/orders` | **ships** | Projects list → Project Detail. *UI: Project · Backend: order.* |
| Activity | Tickets | — | absent | No ticket, message, or request table exists. |
| Activity | **Clients** | `/clients` | **ships** | Client list → Client detail. |
| Activity | **To Do** | `/` | **ships** | The implemented attention queue contracted under the HOME section heading. |
| Billing | Invoices | — | absent | No invoice tables, no processor. |
| Billing | Subscriptions | — | absent | No subscription tables. |
| Setup | **Services** | `/services` | **ships** | The service catalog is real and working. |
| Setup | Forms | — | absent | No form definition or submission tables. |
| Setup | Settings | — | absent | No user-editable preference exists in the schema (§9). |

Consequences an implementation agent must respect:

- **The Billing icon does not render in V1 at all.** Both of its rows are unbuilt, and a
  category icon that opens an empty panel is a fake working page by another name. Its
  **position in the rail order is reserved** (§5.1) so it appears between Activity and the
  logo the day Invoices ships, with no rail redesign and no re-learning of icon positions.
- **The Setup icon renders**, because Services works. Its panel holds exactly one row in V1.
  A one-row panel is correct and is not padded out.
- **The V1 rail is therefore:** Activity · **logo** · Setup. Billing retains its reserved
  position but does not render until at least one real Billing destination exists.

**To Do is the locked navigation label** for the implemented attention queue at `/`, which
the screen contracts retain under the HOME section heading for document continuity. It is
one screen, not two: the route, data, queries, and blocks remain unchanged, and `/` remains
the post-sign-in landing route.

Rationale for the shape:

- **Projects sits under Activity, not at the root.** The rail's whole purpose is that
  categories absorb growth: Tickets and To Do join Projects and Clients without adding a rail
  icon. Tasks still get **no destination of their own** — `TaskRepository` exposes only
  `listForOrder`, so a cross-project task list is not backed by the data layer and must not
  be shown, in any category.
- **Services sits under Setup, not Activity.** Catalog editing is configuration, not daily
  operational throughput. This also resolves the old desktop/mobile split cleanly (§3).
- **Services is still destined for a future Sales area** (SPP calls these
  products/packages). §5 defines how it moves without a shell redesign.
- **Nothing else appears.** Sales, Support, Automation, Integrations, and the Client Portal
  are absent from navigation because no screen behind them works.

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

Mobile uses **the same categories, the same rows, and the same exposure rule** — rotated into
the dock described in §3. There is no separate mobile information architecture to maintain.

| Dock slot | Type | Target |
| --- | --- | --- |
| Activity | category | opens the Activity panel: Projects · Clients · To Do |
| **Wolf Forge logo** | action | opens Quick Create (§6) |
| Setup | category | opens the Setup panel: Services |
| Avatar (top bar) | menu | identity and **Sign out** only (§9) |

Billing takes its reserved dock position, left of the logo, when Invoices ships.

The avatar sheet **no longer carries navigation** — Services moved into Setup, so the sheet
holds identity and Sign out only. The old "Services lives in the account sheet on mobile"
divergence is retired.

---

## 5. Future navigation expansion strategy

The shell must absorb new modules without being redesigned. Three mechanisms do this.

### 5.1 The category registry

Navigation is data, not markup. **One registry drives the desktop rail, its panels, the
mobile dock, and the mobile panels** — there is no second mobile structure to keep in sync:

```ts
interface NavCategory {
  id: string;                    // 'activity'
  label: string;                 // 'Activity'      — panel header
  icon: IconName;                // rail / dock glyph
  order: number;                 // reserved position, held even while absent
  items: NavItem[];
}

interface NavItem {
  id: string;                    // 'projects'
  label: string;                 // 'Projects'      — UI vocabulary, never 'Orders'
  route: string;                 // '/orders'       — backend vocabulary, unchanged
  enabled: boolean;              // false = absent from the DOM, not disabled
  order: number;
}
```

Two rendering rules follow, and both are binding:

1. **`enabled: false` items are omitted from the rendered panel**, never greyed or disabled.
2. **A category whose every item is disabled does not render its rail icon at all.** This is
   what keeps Billing reserved without producing a fake working page: the entry exists in the
   registry with its `order` held, and the icon simply appears the day its first item flips to
   `enabled: true`.

Shipping Invoices is therefore one boolean. No shell component changes, and the rail's icon
positions never shuffle, because `order` is reserved from the start.

### 5.2 The growth rule

The rail absorbs growth **inside categories first, and only then by adding a category.**

> A new destination joins an existing category as another panel row. A new rail icon is
> created only when a capability fits none of Activity, Billing, or Setup — and never when
> that would push the rail past six controls.

Applied to the known roadmap:

| Capability | Where it lands | Rail impact |
| --- | --- | --- |
| Tickets / client requests | Activity panel row (already reserved) | none |
| Invoices, Subscriptions | Billing panel rows; the reserved Billing icon appears | icon appears in its held position |
| Forms, Settings | Setup panel rows (already reserved) | none |
| Proposals, Packages, Checkout, Contracts | a new **Sales** category; Services migrates from Setup to Sales as **Packages**, `/services` redirects | one new icon |
| Automation | inside Settings after Settings is implemented | none |

Because every screen is written to a route and never to a nav position, moving a row between
categories is a registry edit plus a redirect. **No screen contract changes.**

The earlier "promotion rule" — where a top-nav slot holding two screens grew contextual tabs —
is retired along with the top bar. Categories now do that job, and record-level contextual
tabs (§5.3) stay what they always were: tabs *inside a record*, not a navigation tier.

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

## 6. Quick Create — the Wolf Forge logo

### Control

**The Wolf Forge logo in the rail is the Quick Create control.** It is not a home link, not
a wordmark, and not decoration. It sits at the rail's vertical center on desktop and at the
dock's center slot on mobile, and it is the most prominent target in the shell — creation is
the most consequential thing a user does, so it gets the anchor position.

- Desktop: click the logo, or press `C`.
- Mobile: tap the center dock slot.
- The logo carries an accessible name of **"Quick Create"** — never "Wolf Forge" or "Home",
  because the mark is a button and its name must say what it does.

It behaves conceptually like the Quick Action control from William's Treasure: one control,
one blur, one short list of things that can actually be created right now.

### Interaction

1. the logo takes its expressive press feedback (below);
2. the workspace behind blurs, exactly as a category panel blurs it (§2.2);
3. the Quick Create menu appears, anchored to the logo;
4. only implemented creation actions are listed.

Dismissal matches category panels precisely: click the logo again, click the blurred
workspace, or press `Escape`. The current page does not move.

### Motion

The logo is the one control permitted slightly more expressive feedback than the 80–100ms
rail press:

```
scale  1 → .88 → 1.05 → 1
```

A thin `--wf-gold` ring may expand briefly outward from the logo — one pulse, restrained, no
repeat, no glow, and it never persists after the menu opens. The menu itself then enters on
the §2.4 panel-entrance transform.

**Total interaction stays under ~260ms**, ring included. Under
`prefers-reduced-motion: reduce` the scale sequence and the ring are both dropped; the menu
fades only.

### Contents — context-aware, never dead

The menu always contains the two creates that need no parent:

- **New Client** → `/clients/new`
- **New Project** → `/orders/new`

The menu **gains** context-scoped entries when the current route supplies an unambiguous
parent:

- On any `/orders/:orderId*` route → **New Task** (opens the task drawer with the project
  pre-bound)

Rationale: a global "New Task" with no project context would have to open a picker over
every project in the system, and its backing method `OrderRepository.list()` has no search
or pagination. A create entry that is disabled, or that opens a modal asking "which
project?", is worse than one that appears exactly where it can succeed. Users still create
tasks from their parent project screen, which remains the primary path.

- On any `/services*` route → **New Service** (opens the service drawer)

**New Service — superseding the earlier exclusion.** Earlier drafts excluded New Service from
quick create outright, on the grounds that catalog editing is low-frequency configuration
rather than daily throughput. That reasoning still holds for the *global* menu, so New Service
is **not** offered everywhere — but it is genuinely implemented, and suppressing it while the
user is standing in the Setup category is friction for no benefit. It therefore appears
**where appropriate**: scoped to `/services*`, just as New Task is scoped to its parent
project. The blanket exclusion is retired and its open approval item is closed.

### V1 menu, resolved

| Entry | Appears | Target |
| --- | --- | --- |
| **New Client** | always | `/clients/new` |
| **New Project** | always | `/orders/new` |
| **New Task** | on `/orders/:orderId*` | task drawer, project pre-bound |
| **New Service** | on `/services*` | service drawer |

Never more than four entries at once, well inside the six-item ceiling.

### Rules

- The menu lists at most six items; beyond that it gains section headers.
- Every entry navigates or opens immediately. No sub-menus.
- **Nonfunctional actions are never exposed.** An entry appears only where it can succeed —
  no disabled rows, no entry that opens a picker asking which parent the user meant.
- A create started from quick create returns the user to the **created record**, not to the
  screen they launched from (see per-screen success behavior in the contracts document).
- Choosing an entry retracts the menu toward the logo and clears the blur on the §2.4 exit
  transform, then the destination or drawer opens.

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
- **A tab switch is not a page replacement.** It does not run the §2.4 page transition, does
  not blur anything, and does not move the record header. The panel body cross-fades over
  120ms with no translation. Contextual tabs are inside a record; the rail's motion language
  belongs to navigation between destinations.

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

- **A search slot is reserved at the top-right of the workspace header**, on the page
  header block's action baseline. In V1 it renders **nothing** — no greyed box, no
  non-functional icon.
- When the future global search / command system lands, it supports **Clients, Projects,
  Services, and Tickets**, including relationship-aware results. Its reserved shell slot
  prevents that capability from forcing a navigation redesign later.
- **Search is not a rail control.** The rail holds categories and Quick Create only; adding a
  search icon to it would make the rail a toolbar and break the "categories plus create"
  model. When the palette ships it opens over the blurred workspace using the §2.4 language,
  invoked by `⌘K` from anywhere.

The search system's ranking, indexing, result presentation, and commands are intentionally
left for a future specification after the required read methods exist.

---

## 9. Profile / account placement

- **Desktop:** a 28px circular avatar sits at the top-right of the workspace header, outside
  the navigation rail, showing the initials derived from `profiles.display_name`. Click opens
  a 240px account menu aligned to the avatar:

  ```
  Anthony Paghubasan
  Owner                      ← roles.name, title-cased
  ─────────────────────────
  Sign out
  ```

- **Mobile:** the same avatar sits in the contextual top bar and opens a bottom sheet
  containing identity and **Sign out**. It carries **no navigation** — Services moved into
  the Setup category (§3, §4), so the sheet is identity-only on both shells.
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
| `< 768px` | Mobile shell: contextual top bar + bottom dock (§3). | Stacked row lists, full-width buttons, bottom sheets, single-column detail. |
| `768px – 1023px` | Desktop shell: rail at 64px, workspace padding 16px. | Tables allowed at a reduced column set (see §19). Drawers 400px. Record detail single-column. |
| `1024px – 1279px` | Desktop shell. | Full tables. Project Detail two-column (summary 320px + main). |
| `≥ 1280px` | Desktop shell. | Container caps at 1280px and centers; no further layout change. |

Rules:

- The breakpoint at 768px is a **shell switch**, not a reflow. The two shells are separate
  component trees — rail-with-side-panels and dock-with-rising-panels — driven by the same
  category registry (§5.1).
- Touch targets are ≥ 44×44px below 768px and ≥ 32px above it. Rail icons are 40×40px hit
  areas centered in the 64–72px column; dock slots are ≥ 44×44px.
- The dock respects `env(safe-area-inset-bottom)`; the rail respects
  `env(safe-area-inset-left)`.
- **The rail is outside the workspace's max-width.** Container caps in §2.3 apply to the area
  right of the rail, so the rail never eats into the 1280px content measure.
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
- **The rail is icon-only, so its names must be explicit.** Every rail and dock control
  carries an `aria-label` (Activity, Billing, Setup, **Quick Create**).
  Category icons are `aria-expanded` buttons owning their panel via `aria-controls`; the open
  panel is a `menu` whose rows are `menuitem`s, arrow-navigable, with `Home`/`End` jumping to
  the first and last row. The rail is wrapped in a `<nav aria-label="Primary">`.
- **Panel focus:** opening a panel moves focus to its first row. `Esc` closes it and
  **returns focus to the rail icon that opened it** — never to the workspace. Choosing a row
  moves focus to the destination's `<h1>`. While a panel is open the blurred workspace is
  `inert`, so tabbing can never reach a control the user cannot see.
- **DOM order matches visual order on both shells.** On desktop the rail precedes the
  workspace in the DOM, matching its position on the left, and a **Skip to content** link is
  the first focusable element. On mobile the dock is visually at the bottom and therefore
  comes **last** in the DOM — it is not hoisted to the top for "nav first", which would break
  focus order (WCAG 2.4.3). A **Skip to navigation** link at the top of the mobile document
  reaches it in one keystroke.
- **Blur is decorative and must never be the only signal.** The open panel's own presence,
  the `aria-expanded` state, and the active icon indicator all convey the state without
  relying on the scrim.
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
- **Sticky table header** at the top of the scrolling workspace on desktop lists. There is no
  global bar to offset against — the rail is fixed beside the workspace, not above it.

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

- **Nav:** a new **Sales** category joins the rail below Activity. Services migrates out of
  Setup and is re-registered as Sales' **Packages** row; `/services` redirects to
  `/sales/packages` (§5.2).
- **Records:** proposals and packages get their own detail screens with the same header +
  contextual-tab anatomy. A **Proposals** tab appends to Client Detail.
- **Shell impact:** two registry entries and one redirect.

### Billing

- **Nav:** none required — **the Billing category is already reserved** in the registry with
  its rail position held (§4, §5.1). Shipping Invoices flips one `enabled` flag and the icon
  appears between Activity and the logo. Subscriptions appends as its second row.
- **Records:** **Invoices** and **Subscriptions** tabs append to Client Detail; an
  **Invoice** tab appends to Project Detail. Project Detail's summary column gains a billing
  summary card in the space already reserved beneath the project metadata.
- **Shell impact:** two `enabled` flags and three tab registrations. No layout change and no
  rail change — the Billing position was reserved from the start, and the two-column Project
  Detail was chosen now so this card has somewhere to land.

### Support

- **Nav:** none required — **Tickets is already a reserved row in the Activity panel** (§4).
  Shipping it flips one `enabled` flag; no new rail icon.
- **Records:** a **Messages/Tickets** tab appends to Client Detail and to Project Detail.
- **Shell impact:** the Activity rail icon gains an unread dot — a 6px `--wf-gold` marker at
  the icon's top-right, inside the 64–72px column. This is the only badge the rail may ever
  carry and it never shows a number. It is a deliberate fifth entry on the gold ration (§1),
  added only when Support ships.

### Forms

- **Nav:** none required — **Forms is already a reserved row in the Setup panel** (§4). Form
  *definitions* live there; form *responses* attach to records.
- **Records:** a **Forms** tab appends to Client Detail (intake, onboarding) and to Project
  Detail (per-project questionnaires).
- **Shell impact:** none beyond tab registration.

### Automation

- **Nav:** none required. Automation is configuration, not a daily destination — it belongs
  inside **Settings** after that destination is implemented. It does not add a fourth Setup
  row and never earns a rail icon of its own.
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
| Nav registry | internal categories (§5.1) | its own registry and its own shell chrome: Overview, Projects, Files, Messages, Invoices, Services, Forms. The internal rail is **not** reused. |
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
no layout, no proprietary copy, and no visual pattern is reproduced. Where this document
names an SPP concept (packages, checkout, tickets) it names a *capability*, not an
implementation.

**On the rail specifically:** the navigation rail is inspired by **the usefulness of SPP's
navigation model** — categories reachable from one fixed place, without a heavy permanent
column — and is **not copied from its visual design**. Wolf Forge's rail is icon-only at
64–72px with transient bordered panels, its own motion language (§2.4), and its own tokens
(§1). Nothing about SPP's chrome, spacing, iconography, or color is reproduced. The rail is
explicitly **not** a large permanent Wayfront-style sidebar; that pattern remains rejected,
which is the part of the old "no sidebar" decision that survives.
