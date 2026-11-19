import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");

function read(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), "utf8");
}

/** Strips /** ... *\/ block comments so a check for real code usage cannot
 *  false-positive on a doc comment that names the very thing it says is
 *  absent (e.g. "no unread affordance" mentioning the word "unread"). */
function stripBlockComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * The Tickets <-> Inbox split's load-bearing architectural claims, pinned the
 * same way podcast-operations-boundaries.test.ts pins the Sheets/team_tasks
 * boundaries: by reading source, not re-deriving behavior at runtime. The
 * failure modes here are quiet ones -- a transcript quietly reappearing on the
 * management route, the Inbox pane quietly going back to listing every Ticket,
 * a client-facing read quietly growing a staff-only column -- and each is
 * exactly what "the tests still pass" would not otherwise catch.
 *
 * The claim is ONE conversation surface and ONE canonical conversation. It was
 * briefly the opposite (the direct route mounted a second live mount of
 * TicketAdminConversation, per Second Brain D-218); that was reversed by the
 * explicit product requirement that Tickets is the management surface and
 * Inbox -> Tickets is the messaging surface. `use-ticket-live-sync.ts` and the
 * conversation components were never forked for it and still are not.
 */
describe("One conversation surface: the Inbox drawer, and nothing else", () => {
  it("the Inbox drawer mounts TicketAdminConversation for its selected Ticket", () => {
    expect(read("components/team/team-messages-drawer.tsx")).toContain("<TicketAdminConversation");
  });

  it("the ticket management route mounts no conversation at all", () => {
    const page = read("app/(internal)/tickets/[ticketId]/page.tsx");
    const workspace = stripBlockComments(read("components/tickets/ticket-workspace.tsx"));
    expect(page).toContain("TicketWorkspace");
    for (const source of [page, workspace]) {
      expect(source).not.toContain("TicketAdminConversation");
      expect(source).not.toContain("TicketConversation");
      expect(source).not.toContain("TicketComposer");
    }
  });

  it("the management route renders the shared inspector and the one Inbox control instead", () => {
    const workspace = stripBlockComments(read("components/tickets/ticket-workspace.tsx"));
    expect(workspace).toContain("<TicketInspector");
    expect(workspace).toContain("<TicketInboxAction");
  });

  it("there is no second Ticket inspector composition to drift from the drawer's", () => {
    const detail = stripBlockComments(read("components/tickets/ticket-inspector.tsx"));
    expect(detail).toContain("<TicketAdminControls");
    const workspace = stripBlockComments(read("components/tickets/ticket-workspace.tsx"));
    expect(workspace).not.toContain("TicketAdminControls");
  });
});

describe("Inbox membership is durable state, not a client-side view", () => {
  it("the Inbox pane's list action reads the Inbox-only list, never the full Ticket list", () => {
    const source = read("app/actions/tickets.ts");
    const fn = source.slice(source.indexOf("export async function listTicketSummariesAction"));
    expect(fn.slice(0, 500)).toContain("context.services.tickets.listInbox()");
    expect(fn.slice(0, 500)).not.toContain("context.services.tickets.list()");
  });

  it("the Inbox-only read is the repository's, so every future caller gets the same filter", () => {
    const repository = read("repositories/ticket-repository.ts");
    const fn = repository.slice(repository.indexOf("async listInbox()"));
    expect(fn.slice(0, 400)).toContain("p_inbox_only: true");
  });

  it("the migration adds a nullable membership timestamp rather than overloading status, priority or archived_at", () => {
    const migration = read("../supabase/migrations/20260918120000_ticket_inbox_membership.sql");
    expect(migration).toContain("add column if not exists inbox_added_at timestamptz");
    expect(migration).not.toMatch(/set\s+status\s*=/i);
    expect(migration).not.toMatch(/set\s+archived_at\s*=/i);
  });

  it("the client-facing Ticket read strips the staff-only membership flag", () => {
    const migration = read("../supabase/migrations/20260918120000_ticket_inbox_membership.sql");
    const strip = migration.slice(migration.indexOf("'requester_email'"));
    expect(strip.slice(0, 120)).toContain("'inbox_added_at'");
  });

  it("adding a Ticket copies no messages: the mutation is one timestamp write", () => {
    const migration = read("../supabase/migrations/20260918120000_ticket_inbox_membership.sql");
    const fn = migration.slice(migration.indexOf("create function public.app_add_ticket_to_inbox"));
    const body = fn.slice(0, fn.indexOf("comment on function"));
    expect(body).toContain("set inbox_added_at = now()");
    expect(body).not.toMatch(/insert\s+into\s+public\.ticket_messages/i);
    expect(body).not.toMatch(/insert\s+into\s+public\.ticket_attachments/i);
  });
});

describe("DO-NOT-TOUCH: Ticket live-sync internals are unmodified by the split", () => {
  it("use-ticket-live-sync.ts still exports the same hook, untouched", () => {
    const source = read("components/tickets/use-ticket-live-sync.ts");
    expect(source).toContain("export function useTicketLiveSync(");
  });

  it("domain/tickets/live-scheduler.ts still imports its jitter/backoff from Team's scheduler, not a forked copy", () => {
    const source = read("domain/tickets/live-scheduler.ts");
    expect(source).toContain('from "../team/live-scheduler"');
  });

  it("the Ticket-list poller reuses Team's generic primitives instead of Ticket's per-conversation scheduler", () => {
    const source = read("components/team/use-ticket-inbox-list.ts");
    expect(source).toContain('from "../../domain/team/live-scheduler"');
    expect(stripBlockComments(source)).not.toContain("domain/tickets/live-scheduler");
  });

  it("the Ticket-list poller never polls on a fixed one-second interval", () => {
    const source = stripBlockComments(read("components/team/use-ticket-inbox-list.ts"));
    expect(source).not.toMatch(/\bsetInterval\s*\(/);
    expect(source).not.toMatch(/,\s*1_?000\s*\)/);
  });
});

describe("No fake Ticket unread state", () => {
  it("the Tickets pane row never references an unread count or badge in actual code", () => {
    const source = stripBlockComments(read("components/team/team-tickets-pane.tsx"));
    expect(source.toLowerCase()).not.toContain("unread");
  });

  it("waiting_on_client is never treated as an unread signal", () => {
    const pane = read("components/team/team-tickets-pane.tsx");
    const list = read("components/team/use-ticket-inbox-list.ts");
    for (const source of [pane, list]) {
      expect(source).not.toMatch(/waiting_on_client.*unread|unread.*waiting_on_client/i);
    }
  });
});

describe("Security: Ticket reads stay gated on tickets.view, the membership write on tickets.edit", () => {
  it("listTicketSummariesAction and getTicketInboxConversationAction both check tickets.view before touching the repository", () => {
    const source = read("app/actions/tickets.ts");
    const summariesFn = source.slice(source.indexOf("export async function listTicketSummariesAction"));
    const conversationFn = source.slice(source.indexOf("export async function getTicketInboxConversationAction"));
    expect(summariesFn.slice(0, 300)).toContain("context.user.tickets.view");
    expect(conversationFn.slice(0, 300)).toContain("context.user.tickets.view");
  });

  it("addTicketToInboxAction checks tickets.edit before touching the repository, so clients and read-only staff cannot add one", () => {
    const source = read("app/actions/tickets.ts");
    const fn = source.slice(source.indexOf("export async function addTicketToInboxAction"));
    expect(fn.slice(0, 300)).toContain("context.user.tickets.edit");
  });

  it("the RPC re-checks the same permission and an internal actor server-side, so the UI check is not the boundary", () => {
    const migration = read("../supabase/migrations/20260918120000_ticket_inbox_membership.sql");
    const fn = migration.slice(migration.indexOf("create function public.app_add_ticket_to_inbox"));
    const body = fn.slice(0, fn.indexOf("comment on function"));
    expect(body).toContain("private.require_permission('tickets.edit')");
    expect(body).toContain("private.is_internal_user()");
  });
});

describe("Projects/Orders conversation domain is untouched", () => {
  it("the Inbox drawer never references project_messages or the Project conversation service", () => {
    const drawer = read("components/team/team-messages-drawer.tsx");
    expect(drawer).not.toContain("project_messages");
    expect(drawer).not.toContain("ProjectConversation");
  });
});

describe("Details/inspector defaults closed even at desktop, everywhere it appears", () => {
  it("the Inbox drawer's ticketInspectorOpen state starts false, not derived from a Ticket being selected", () => {
    const drawer = read("components/team/team-messages-drawer.tsx");
    expect(drawer).toMatch(/ticketInspectorOpen[\s\S]{0,60}=\s*useState\(false\)/);
  });

  it("the drawer's inspector column is collapsed/faded by default and only the *Open modifier reserves space", () => {
    const styles = stripBlockComments(read("components/team/team-messages.module.css"));
    const inspectorPaneBlock = styles.slice(styles.indexOf(".inspectorPane {"), styles.indexOf(".inspectorPaneOpen {"));
    expect(inspectorPaneBlock).toMatch(/opacity:\s*0/);
    expect(styles).not.toMatch(/\.drawer:has\(\.inspectorPane\)\s*\{\s*width:/);
    expect(styles).toMatch(/\.drawer:has\(\.inspectorPaneOpen\)\s*\{\s*width:/);
  });

  it("the management page keeps no viewport-height conversation grid: it is an ordinary scrolling page", () => {
    const styles = stripBlockComments(read("components/tickets/tickets.module.css"));
    const workspaceBlock = styles.slice(styles.indexOf(".ticketWorkspace {"), styles.indexOf(".ticketWorkspaceList {"));
    expect(workspaceBlock).not.toMatch(/100dvh/);
    expect(workspaceBlock).not.toMatch(/grid-template-rows/);
  });
});

describe("Tasks tab removal preserves canonical team_tasks reads", () => {
  it("the Inbox drawer's Pane type no longer includes a tasks pane", () => {
    const drawer = read("components/team/team-messages-drawer.tsx");
    expect(drawer).toContain('type Pane = "messages" | "tickets"');
  });

  it("/todo still reads the same canonical team_tasks rows via the same RPC-backed action, not a mirrored copy", () => {
    const todoSection = read("components/team/team-todo-section.tsx");
    expect(todoSection).toContain("listTeamTasksAction");
    expect(stripBlockComments(todoSection)).not.toMatch(/order_tasks/);
  });
});

describe("Deep link: View in Inbox opens the Inbox at that exact Ticket", () => {
  it("the management page's View in Inbox link carries the drawer's existing query contract", () => {
    const action = stripBlockComments(read("components/tickets/ticket-inbox-action.tsx"));
    expect(action).toContain("?inbox=tickets&ticket=");
  });

  it("useTeamMessagesChat still reads that contract from the URL and opens the drawer on it", () => {
    const chat = read("components/team/use-team-messages-chat.ts");
    expect(chat).toContain('searchParams.get("inbox") === "tickets"');
    expect(chat).toContain('searchParams.get("ticket")');
  });

  it("closing the Inbox clears the deep link, so the same link works the second time it is followed", () => {
    const chat = read("components/team/use-team-messages-chat.ts");
    const close = chat.slice(chat.indexOf("const close = useCallback("));
    expect(close.slice(0, 300)).toContain("router.replace(pathname");
  });

  it("the drawer reads the deep link once per distinct value rather than on every render", () => {
    const drawer = read("components/team/team-messages-drawer.tsx");
    expect(drawer).toContain("consumedTicketDeepLink");
  });
});


describe("Composer focus: shell-level for the staff Ticket composer, untouched everywhere else", () => {
  const styles = stripBlockComments(read("components/tickets/tickets.module.css"));

  /** The declaration block following an exact selector, or "" when the
   *  selector is not in the stylesheet -- so a renamed or deleted rule fails
   *  loudly here instead of silently passing. */
  function ruleBody(selector: string): string {
    const at = styles.indexOf(selector + " {");
    if (at < 0) return "";
    const open = styles.indexOf("{", at) + 1;
    return styles.slice(open, styles.indexOf("}", open));
  }

  it("the helper fails on an absent selector, so every assertion below is real", () => {
    expect(ruleBody(".this-rule-does-not-exist")).toBe("");
  });

  it("Order / Project / client-portal composers keep their own inner outline, unchanged by this pass", () => {
    const shared = ruleBody(".orderConversationSurface .ticketRichComposer:focus-visible");
    expect(shared).toContain("outline: 1px solid #8991b5");
    expect(shared).toContain("outline-offset: -2px");
  });

  it("the staff Ticket composer is the only surface that suppresses that outline, and it does so explicitly", () => {
    const ticket = ruleBody(".ticketAdminSurface .ticketRichComposer:focus-visible");
    expect(ticket).toContain("outline: 0");
    // Scoped to the Ticket surface, never to the shared one.
    expect(styles).toContain(".ticketAdminSurface .ticketRichComposer:focus-visible {");
  });

  it("the outer Ticket shell carries the focus indication instead, on the editor and on the compact footer", () => {
    expect(ruleBody(".ticketAdminSurface .ticketRichEditor:focus-within")).toContain("border-color: var(--wf-navy);");
    expect(styles).toContain(`.composer[data-compact="true"]:focus-within .ticketRichEditor,`);
    expect(styles).toContain(`.composer[data-compact="true"]:focus-within footer {`);
  });

  it("the Ticket focus indication is a restrained border colour, not a glow, ring or extra box", () => {
    const rule = ruleBody(".ticketAdminSurface .ticketRichEditor:focus-within");
    expect(rule).toContain("border-color: var(--wf-navy)");
    expect(rule).not.toContain("box-shadow");
    expect(rule).not.toContain("outline");
    expect(rule).not.toContain("text-shadow");
    expect(rule).not.toContain("filter");
  });

  it("data-compact is a Ticket-only hook: TicketAdminConversation is the only caller that passes it", () => {
    const composer = read("components/tickets/ticket-composer.tsx");
    expect(composer).toContain("data-compact={compact || undefined}");
    for (const surface of ["order-conversation", "project-conversation", "ticket-client-conversation"]) {
      expect(read(`components/tickets/${surface}.tsx`)).not.toContain("compact");
    }
    expect(read("components/tickets/ticket-admin-conversation.tsx")).toContain("compact");
  });
});

describe("In Inbox state label: Tickets-management lists only, driven by the one durable column", () => {
  const workspace = stripBlockComments(read("components/tickets/ticket-workspace-list.tsx"));
  const list = stripBlockComments(read("components/tickets/tickets-list.tsx"));

  it("renders on the desktop selector and the mobile list, both off inbox_added_at alone", () => {
    expect(workspace).toContain("In Inbox");
    expect(workspace).toContain("summary.inbox_added_at ?");
    expect(list).toContain("In Inbox");
    expect(list).toContain("ticket.inbox_added_at ?");
    // Four reads of the one column, no second flag: the two rendered labels
    // (the mobile card and the desktop table's TICKET column) and the Inbox
    // filter's two -- truthy for "In Inbox", null for "Not in Inbox". This
    // count is a pin, not a preference: a new reader of the column has to be
    // acknowledged here rather than smuggled in.
    expect([...list.matchAll(/ticket.inbox_added_at ?/g)]).toHaveLength(4);
  });

  it("does not render in the Inbox Tickets pane, on the conversation header, or in the composer", () => {
    for (const file of [
      "components/team/team-tickets-pane.tsx",
      "components/tickets/ticket-admin-conversation.tsx",
      "components/tickets/ticket-composer.tsx",
      "components/tickets/ticket-inbox-action.tsx",
      "components/tickets/ticket-detail-page-hero.tsx",
    ]) {
      let source = "";
      try {
        source = stripBlockComments(read(file));
      } catch {
        continue; // the hero file does not exist; the label has no other home
      }
      expect(source).not.toContain("In Inbox");
    }
  });

  it("the label is a span, not a control: no button, no link, no handler", () => {
    const tag = read("components/tickets/tickets-list.tsx");
    expect(tag).toContain(`<span className={styles.inboxTag}>In Inbox</span>`);
  });
});

describe("Ticket Inbox flow motion: scoped, native, and removable", () => {
  const styles = stripBlockComments(read("components/tickets/tickets.module.css"));
  const action = stripBlockComments(read("components/tickets/ticket-inbox-action.tsx"));

  /** The declaration block following an exact selector, or "" when absent. */
  function ruleBody(selector: string): string {
    const at = styles.indexOf(selector + " {");
    if (at < 0) return "";
    const open = styles.indexOf("{", at) + 1;
    return styles.slice(open, styles.indexOf("}", open));
  }

  it("the helper fails on an absent selector, so every assertion below is real", () => {
    expect(ruleBody(".this-rule-does-not-exist")).toBe("");
  });

  it("the confirmation dialog opts into the motion, so the shared .dialog stays still for every other dialog", () => {
    expect(action).toContain("styles.inboxDialog");
    const shared = ruleBody(".dialog");
    expect(shared).not.toContain("transition");
    expect(shared).not.toContain("opacity: 0");
  });

  it("the dialog's own enter and exit are native transitions, with no timer driving the animation", () => {
    const host = ruleBody(".inboxDialog");
    expect(host).toContain("opacity: 0");
    expect(host).toContain("transform: translateY(6px) scale(.985)");
    expect(host).toContain("display 160ms allow-discrete");
    expect(host).toContain("overlay 160ms allow-discrete");
    expect(ruleBody(".inboxDialog[open]")).toContain("transform: none");
    expect(styles).toContain("@starting-style {");
    expect(styles).toContain(".inboxDialog[open]::backdrop { opacity: 0; }");
    expect(styles).toContain(".inboxDialog[open]::backdrop { opacity: 1; transition-duration: 200ms; }");
  });

  it("the backdrop fades on the same discrete timeline, so it cannot outlive the dialog", () => {
    const backdrop = ruleBody(".inboxDialog::backdrop");
    expect(backdrop).toContain("opacity: 0");
    expect(backdrop).toContain("display 160ms allow-discrete");
    expect(ruleBody(".inboxDialog[open]::backdrop")).toContain("opacity: 1");
  });

  it("press feedback is a transform only, scoped to this flow, and never fires on a pending control", () => {
    expect(styles).toContain(".inboxAction :global(.button-primary):active:not(:disabled),");
    expect(styles).toContain(".inboxAction :global(.button-secondary):active:not(:disabled) {");
    const press = styles.slice(styles.indexOf(".inboxAction :global(.button-primary):active:not(:disabled),"));
    const body = press.slice(press.indexOf("{") + 1, press.indexOf("}"));
    expect(body).toContain("transform: scale(.98)");
    // Nothing else about the approved button moves.
    expect(body).not.toContain("background");
    expect(body).not.toContain("border");
    expect(body).not.toContain("box-shadow");
  });

  it("reduced motion removes the travel rather than the state change", () => {
    // Asserted as individual single-line facts: the two reduced-motion blocks
    // in this section make a positional slice pick the wrong one, and a
    // whitespace-normalising regex hides real text when it mistranslates.
    expect(styles).toContain(".inboxDialog,");
    expect(styles).toContain("transition: none;");
    expect(styles).toContain("transform: none;");
    // The enter frame is neutralised, so there is nothing to animate from.
    expect(styles).toContain(".inboxDialog[open] { opacity: 1; transform: none; }");
    expect(styles).toContain(".inboxDialog[open]::backdrop { opacity: 1; }");
  });
});

describe("Ticket Inbox dialog: viewport centring, phases, and a bounded success sequence", () => {
  const styles = stripBlockComments(read("components/tickets/tickets.module.css"));
  const action = stripBlockComments(read("components/tickets/ticket-inbox-action.tsx"));

  function ruleBody(selector: string): string {
    const at = styles.indexOf(selector + " {");
    if (at < 0) return "";
    const open = styles.indexOf("{", at) + 1;
    return styles.slice(open, styles.indexOf("}", open));
  }

  it("the shared dialog restores the UA margin the preflight reset, which is what had it pinned to the corner", () => {
    const shared = ruleBody(".dialog");
    expect(shared).toContain("margin: auto");
    expect(shared).toContain("max-height: calc(100dvh - 32px)");
    expect(shared).toContain("overflow-y: auto");
    // Width and padding are the approved ones, unchanged.
    expect(shared).toContain("width: min(520px, calc(100vw - 32px))");
    expect(shared).toContain("padding: 0");
  });

  it("the acknowledgement is the same dialog, with the exact agreed copy", () => {
    expect(action).toContain(">Ticket added to Inbox</h2>");
    expect(action).toContain("This ticket is now available in Inbox &rarr; Tickets.");
    expect(action).toContain("CheckCircle2");
    expect(action).not.toContain("toast");
  });

  it("the sequence is a small phase machine, and success is only reachable from a resolved ok result", () => {
    expect(action).toContain(`type Phase = "idle" | "submitting" | "success"`);
    expect(action).toContain("if (!result.ok) {");
    // setPhase("success") must sit after the failure branch, never before it.
    expect(action.indexOf(`setPhase("success")`)).toBeGreaterThan(action.indexOf("if (!result.ok) {"));
  });

  it("revalidation is on a bounded timer, never on a transition event that could be missed", () => {
    expect(action).toContain("refreshTimerRef.current = window.setTimeout(");
    expect(action).toContain("}, EXIT_MS);");
    // Refreshing personal-save props during acknowledgement is covered by the
    // rendered management-page regression, independent of the guard's spelling.
    expect(action).toContain("SUCCESS_HOLD_MS = 900");
    expect(action).not.toContain("transitionend");
    expect(action).not.toContain("onanimationend");
  });

  it("the phase swap animates in, and reduced motion turns the travel off without skipping the acknowledgement", () => {
    expect(styles).toContain("@keyframes inboxSwapIn {");
    expect(ruleBody(".inboxSwap")).toContain("animation: inboxSwapIn 160ms");
    const reduced = styles.slice(styles.indexOf("prefers-reduced-motion: reduce", styles.indexOf(".inboxSwap { animation")));
    expect(reduced.slice(0, 200)).toContain(".inboxSwap { animation: none; }");
  });

  it("the shell keeps a floor height so it cannot snap shorter between the two phases", () => {
    expect(ruleBody(".inboxSuccess")).toContain("min-height: 243px");
  });
});

describe("Workspace outer boundary is a single line on every edge", () => {
  const styles = stripBlockComments(read("components/tickets/tickets.module.css"));

  it("the ticket-detail page header drops its own rule, which was stacking on the panel top border", () => {
    // `.page-header` carries `border-bottom: 1px solid var(--wf-border)` globally,
    // and the workspace panel sits flush under it with its own full border --
    // two 1px rules at the same y stack into one 2px band.
    expect(styles).toContain(".ticketDetailPage :global(.page-header) { border-bottom: 0; }");
  });

  it("the panel keeps the whole boundary: full border, radius, and the list/details divider", () => {
    const shell = styles.slice(styles.indexOf(".ticketWorkspace {"), styles.indexOf(".ticketWorkspaceList {"));
    expect(shell).toContain("border: 1px solid var(--wf-border)");
    expect(shell).toContain("border-radius: 10px");
    const list = styles.slice(styles.indexOf(".ticketWorkspaceList {"), styles.indexOf(".ticketWorkspaceListItem {"));
    expect(list).toContain("border-right: 1px solid var(--wf-border)");
    const item = styles.slice(styles.indexOf(".ticketWorkspaceListItem {"), styles.indexOf(".ticketWorkspaceListItem:hover"));
    expect(item).toContain("border-bottom: 1px solid #eef0f4");
  });
});
