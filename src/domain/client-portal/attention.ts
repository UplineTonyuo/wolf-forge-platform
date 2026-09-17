/**
 * The client portal's shared attention vocabulary.
 *
 * One vocabulary, five tones, used identically by Projects, Onboarding,
 * Messages, Invoices and the Dashboard. Every tone here is *derived* from a
 * state the database already persists — nothing in this module adds a status to
 * a table, and no mapping invents a state the backend cannot produce.
 *
 * The point of the indirection is that a client should never have to learn our
 * internal words. "waiting_reply" on an order and "waiting_on_client" on a
 * ticket are the same fact to a client: Wolf Forge is blocked on them.
 */

export const attentionTones = [
  /** Blocked on the client. The one tone that means "act now". */
  "waiting_on_you",
  /** Wolf Forge holds the work. Informational, not actionable. */
  "in_progress",
  /** Money is owed. Separated from waiting_on_you so billing reads distinctly. */
  "payment_due",
  /** Done, settled, closed. */
  "completed",
  /** Nothing is happening and nothing is required. */
  "idle",
] as const;

export type AttentionTone = (typeof attentionTones)[number];

export type AttentionState = {
  tone: AttentionTone;
  /** Client-facing label. Never an internal status string. */
  label: string;
};

/** Tones that belong in a "Needs your attention" list. */
const actionableTones = new Set<AttentionTone>(["waiting_on_you", "payment_due"]);

export function attentionIsActionable(tone: AttentionTone): boolean {
  return actionableTones.has(tone);
}

/**
 * Project delivery status, translated.
 *
 * `waiting_reply` and `pending_update` are the only two order statuses that
 * mean the client is the blocker; the rest are Wolf Forge's problem and are
 * presented as such rather than as an operational status code.
 */
export function projectAttention(status: string): AttentionState {
  switch (status) {
    case "waiting_reply":
      return { tone: "waiting_on_you", label: "Waiting on you" };
    case "pending_update":
      return { tone: "waiting_on_you", label: "Needs information" };
    case "working":
    case "submitted":
      return { tone: "in_progress", label: "Wolf Forge working" };
    case "pending":
      return { tone: "in_progress", label: "Getting started" };
    case "complete":
      return { tone: "completed", label: "Completed" };
    case "canceled":
      return { tone: "idle", label: "Closed" };
    default:
      return { tone: "in_progress", label: "In progress" };
  }
}

/**
 * Ticket status, translated.
 *
 * `waiting_on_client` is the only status that puts the ball in the client's
 * court, so it is the only one that earns an actionable tone. There is no
 * per-message unread flag in the ticket model, so this is the honest basis for
 * a "needs you" indicator — see clientPortalUnreadIsSupported below.
 */
export function ticketAttention(status: string): AttentionState {
  switch (status) {
    case "waiting_on_client":
      return { tone: "waiting_on_you", label: "Waiting on you" };
    case "waiting_on_team":
    case "in_progress":
      return { tone: "in_progress", label: "Wolf Forge working" };
    case "open":
      return { tone: "in_progress", label: "Open" };
    case "resolved":
      return { tone: "completed", label: "Resolved" };
    case "closed":
      return { tone: "idle", label: "Closed" };
    default:
      return { tone: "in_progress", label: "Open" };
  }
}

/**
 * Invoice presentation state, translated.
 *
 * The states come from app_get_invoice_financials, which already distinguishes
 * overdue, partially refunded and void. Nothing is re-derived here.
 */
export function invoiceAttention(presentationState: string): AttentionState {
  switch (presentationState) {
    case "overdue":
      return { tone: "payment_due", label: "Overdue" };
    case "unpaid":
      return { tone: "payment_due", label: "Unpaid" };
    case "payment_pending":
      return { tone: "in_progress", label: "Payment pending" };
    case "paid":
      return { tone: "completed", label: "Paid" };
    case "partially_refunded":
      return { tone: "completed", label: "Partially refunded" };
    case "refunded":
      return { tone: "completed", label: "Refunded" };
    case "void":
      return { tone: "idle", label: "Void" };
    case "draft":
      return { tone: "idle", label: "Draft" };
    default:
      return { tone: "idle", label: "Unknown" };
  }
}

/**
 * Form assignment status, translated.
 *
 * 'completed' is the value app_submit_form actually writes — see the
 * form_assignments_status_valid check constraint. Comparing against "submitted"
 * here would silently never match.
 */
export function onboardingAttention(
  status: string,
  hasDraftSubmission: boolean,
): AttentionState {
  if (status === "completed") return { tone: "completed", label: "Completed" };
  if (status === "archived" || status === "canceled") {
    return { tone: "idle", label: "No longer required" };
  }
  return hasDraftSubmission
    ? { tone: "waiting_on_you", label: "In progress" }
    : { tone: "waiting_on_you", label: "Not started" };
}

/** Subscription status, translated out of billing-engine language. */
export function subscriptionAttention(status: string): AttentionState {
  switch (status) {
    case "past_due":
      return { tone: "payment_due", label: "Payment due" };
    case "active":
      return { tone: "in_progress", label: "Active" };
    case "paused":
      return { tone: "idle", label: "Paused" };
    case "canceled":
      return { tone: "idle", label: "Ended" };
    default:
      return { tone: "idle", label: "Inactive" };
  }
}

/**
 * Whether the ticket model can back a per-conversation unread indicator.
 *
 * It cannot: public.ticket_messages has no per-recipient read state and there
 * is no last-seen column on public.tickets. Rather than fake a dot, the portal
 * asks this and renders a real "waiting on you" state instead. When a read
 * model for this exists, this is the single place that flips.
 */
export const clientPortalUnreadIsSupported = false;
