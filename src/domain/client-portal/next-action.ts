import { formatCurrencyCents } from "../../lib/format";
import type { AttentionTone } from "./attention";
import type {
  ClientActiveProject,
  ClientAttentionItem,
  ClientPortalSummary,
} from "./summary";

/**
 * The Dashboard's next-action ordering.
 *
 * Presentation only. Every item here was already derived by
 * composeClientPortalSummary from real rows; this module decides which one a
 * client should look at first and what extra context can honestly sit beside
 * it. No item is added, removed, relabelled or re-routed, and nothing is
 * counted a second time — the attention list stays the single source of what
 * needs the client.
 *
 * Ranked so the thing that costs the client something comes first:
 *
 *   0  money already late
 *   10 a subscription that failed to collect
 *   20 work Wolf Forge cannot continue without them
 *   30 someone waiting on a reply
 *   40 onboarding still open
 *   50 money owed but not yet late
 *
 * The ranks are spaced so a future category can be inserted without renumbering
 * the others.
 */

export type NextActionRank = number;

export type NextAction = {
  id: string;
  tone: AttentionTone;
  /** Short category word above the title. Derived, never a raw status. */
  eyebrow: string;
  title: string;
  detail: string;
  href: string;
  cta: string;
  rank: NextActionRank;
  /** True only for money that is genuinely past its due date. */
  urgent: boolean;
  /**
   * A single real figure to show beside the title, or null.
   *
   * Only ever populated when exactly one currency is outstanding: balances in
   * different currencies are never added together, so a headline number would
   * have to invent an exchange rate to exist.
   */
  amountLabel: string | null;
  /** One extra line of real context, or null when the data does not carry one. */
  meta: string | null;
};

export type NextActionFlow = {
  featured: NextAction | null;
  secondary: NextAction[];
  /** Every action, featured first. The count a client is shown. */
  all: NextAction[];
  count: number;
};

/** Chips beside the hero counter. Only rendered when the number is real. */
export type AttentionChip = {
  id: string;
  label: string;
  tone: AttentionTone;
};

function rankOf(item: ClientAttentionItem, summary: ClientPortalSummary): NextActionRank {
  switch (item.id) {
    case "invoices":
      return (summary.balance?.totalOverdueInvoices ?? 0) > 0 ? 0 : 50;
    case "subscriptions":
      return 10;
    case "projects":
      return 20;
    case "messages":
      return 30;
    case "onboarding":
      return 40;
    default:
      /*
       * An id this module has not been taught about still appears, just last.
       * Dropping it would hide something the domain decided was actionable.
       */
      return 60;
  }
}

function eyebrowOf(item: ClientAttentionItem, urgent: boolean): string {
  switch (item.id) {
    case "invoices":
      return urgent ? "Overdue" : "Invoice";
    case "subscriptions":
      return "Subscription";
    case "projects":
      return "Order";
    case "messages":
      return "Message";
    case "onboarding":
      return "Forms";
    default:
      return "Action";
  }
}

/**
 * The one figure that can sit beside an invoice action.
 *
 * Null unless a single currency is outstanding — see the type note above, and
 * composeClientBalance, which deliberately keeps currencies apart.
 */
function amountLabelOf(item: ClientAttentionItem, summary: ClientPortalSummary): string | null {
  if (item.id !== "invoices") return null;

  const currencies = summary.balance?.currencies ?? [];
  if (currencies.length !== 1) return null;

  const only = currencies[0]!;
  return formatCurrencyCents(only.outstandingCents, only.currency);
}

/**
 * One extra line, taken from data the summary already carries.
 *
 * Every branch reads something real or returns null. There is no due date here
 * because the Dashboard read model does not carry one, and no requested-field
 * description because the project model does not expose what was asked for.
 */
function metaOf(item: ClientAttentionItem, summary: ClientPortalSummary): string | null {
  if (item.id === "onboarding") {
    const progress = summary.onboarding?.progress;
    if (!progress || progress.total === 0) return null;
    return `${progress.completed} of ${progress.total} complete`;
  }

  if (item.id === "projects") {
    const blocked = summary.activeProjects.filter(
      (project) => project.tone === "waiting_on_you",
    );
    const first = blocked[0];
    if (!first) return null;
    return blocked.length === 1 ? first.reference : `${first.reference} and ${blocked.length - 1} more`;
  }

  if (item.id === "invoices") {
    const overdue = summary.balance?.totalOverdueInvoices ?? 0;
    return overdue > 0 ? `${overdue} ${overdue === 1 ? "invoice" : "invoices"} past due` : null;
  }

  return null;
}

function toNextAction(item: ClientAttentionItem, summary: ClientPortalSummary): NextAction {
  const rank = rankOf(item, summary);
  const urgent = item.id === "invoices" && rank === 0;

  return {
    id: item.id,
    tone: item.tone,
    eyebrow: eyebrowOf(item, urgent),
    title: item.label,
    detail: item.detail,
    href: item.href,
    cta: item.cta,
    rank,
    urgent,
    amountLabel: amountLabelOf(item, summary),
    meta: metaOf(item, summary),
  };
}

/**
 * Orders the attention list and promotes the first item.
 *
 * A stable sort: two items of equal rank keep the order the domain produced,
 * so this can never reshuffle equivalent work between renders.
 */
export function composeNextActionFlow(summary: ClientPortalSummary): NextActionFlow {
  const all = summary.attention
    .map((item) => toNextAction(item, summary))
    .sort((left, right) => left.rank - right.rank);

  return {
    featured: all[0] ?? null,
    secondary: all.slice(1),
    all,
    /*
     * The same length the domain produced. The Dashboard never counts actions
     * a second way, so the hero figure and the list can never disagree.
     */
    count: summary.attention.length,
  };
}

/**
 * Supporting chips beside the hero counter.
 *
 * Each one is a count the summary already computed. A module the account does
 * not hold reports null upstream and produces no chip at all, rather than a
 * zero — the client is not told about things they cannot see.
 */
export function composeAttentionChips(summary: ClientPortalSummary): AttentionChip[] {
  const chips: AttentionChip[] = [];
  const overdue = summary.balance?.totalOverdueInvoices ?? 0;

  if (overdue > 0) {
    chips.push({
      id: "overdue",
      tone: "payment_due",
      label: `${overdue} overdue`,
    });
  }

  const waitingReplies = summary.counts.messages;
  if (waitingReplies !== null && waitingReplies > 0) {
    chips.push({
      id: "replies",
      tone: "waiting_on_you",
      label: `${waitingReplies} ${waitingReplies === 1 ? "reply" : "replies"} waiting`,
    });
  }

  const openProjects = summary.counts.projects;
  if (openProjects !== null && openProjects > 0) {
    chips.push({
      id: "projects",
      tone: "in_progress",
      label: `${openProjects} ${openProjects === 1 ? "order" : "orders"} active`,
    });
  }

  return chips;
}

/**
 * What to say about a project's delivery state.
 *
 * Returns the real percentage when delivery tasks exist, and otherwise the
 * project's own translated status — never a zero bar, and never a percentage
 * over a denominator that does not exist.
 */
export function activeProjectProgressState(
  project: ClientActiveProject,
): { kind: "measured"; percent: number; label: string } | { kind: "stated"; label: string } {
  if (project.progressPercent === null) {
    return { kind: "stated", label: project.toneLabel };
  }

  return {
    kind: "measured",
    percent: project.progressPercent,
    label: project.progressLabel ?? `${project.progressPercent}% complete`,
  };
}
