import { formatCurrencyCents, formatDate } from "../../lib/format";
import type { ClientInvoiceSummary } from "../../repositories/invoice-repository";
import type { FormAssignmentSummary } from "../forms/schema";
import { clientProjectIsOpen, type ClientProjectView } from "../orders/client-projections";
import type { SubscriptionSummary } from "../subscriptions/schema";
import type { ClientTicketSummary } from "../tickets/schema";
import {
  invoiceAttention,
  projectAttention,
  subscriptionAttention,
  ticketAttention,
  type AttentionTone,
} from "./attention";
import { composeClientBalance, type ClientBalance } from "./balance";
import { composeClientOnboarding, type ClientOnboarding } from "./onboarding";

/**
 * The client Dashboard read model.
 *
 * Composed from the same module-gated reads the individual pages use, so the
 * Dashboard can never show a section the account is not entitled to: a denied
 * module arrives here as null and the section simply does not exist. Every
 * number is a count of real rows. There are no KPIs, no percentages over
 * invented denominators and no sample history.
 */

export type ClientAttentionItem = {
  id: string;
  tone: AttentionTone;
  label: string;
  detail: string;
  href: string;
  cta: string;
};

export type ClientActiveProject = {
  id: string;
  reference: string;
  title: string;
  serviceName: string | null;
  toneLabel: string;
  tone: AttentionTone;
  progressPercent: number | null;
  progressLabel: string | null;
  dueLabel: string | null;
  href: string;
};

export type ClientRecentMessage = {
  id: string;
  reference: string;
  subject: string;
  toneLabel: string;
  tone: AttentionTone;
  activityAt: string;
  messageCount: number;
  href: string;
};

export type ClientNextBilling = {
  serviceName: string;
  dateLabel: string;
  amountLabel: string;
  href: string;
};

export type ClientNavCounts = {
  /** Outstanding onboarding items, or null when the module is not granted. */
  onboarding: number | null;
  /** Conversations explicitly waiting on the client, or null when not granted. */
  messages: number | null;
  /** Projects still in flight, or null when not granted. */
  projects: number | null;
  /**
   * Reports this person has not opened, or null when Reporting is not granted.
   * Resolved by its own RPC rather than composed here, because read state is
   * per profile and the summary sources are per company.
   */
  reporting?: number | null;
};

export type ClientPortalSummary = {
  activeProjects: ClientActiveProject[];
  totalProjects: number | null;
  attention: ClientAttentionItem[];
  balance: ClientBalance | null;
  onboarding: ClientOnboarding | null;
  nextBilling: ClientNextBilling | null;
  activeSubscriptionCount: number | null;
  recentMessages: ClientRecentMessage[];
  messagesGranted: boolean;
  counts: ClientNavCounts;
  /**
   * True when the account holds no projects, no onboarding items, no invoices,
   * no subscriptions and no conversations. The Dashboard renders one welcome
   * state for this rather than a page of empty cards.
   */
  isBrandNew: boolean;
};

export type ClientPortalSources = {
  projects: ClientProjectView[] | null;
  assignments: FormAssignmentSummary[] | null;
  invoices: ClientInvoiceSummary[] | null;
  tickets: ClientTicketSummary[] | null;
  subscriptions: SubscriptionSummary[] | null;
};

const ACTIVE_PROJECT_LIMIT = 4;
const RECENT_MESSAGE_LIMIT = 3;

function toActiveProject(project: ClientProjectView): ClientActiveProject {
  const attention = projectAttention(project.status);

  return {
    id: project.id,
    reference: project.reference,
    title: project.title,
    serviceName: project.serviceName,
    tone: attention.tone,
    toneLabel: attention.label,
    progressPercent: project.progress.percent,
    progressLabel:
      project.progress.total === 0
        ? null
        : `${project.progress.completed} of ${project.progress.total} steps complete`,
    dueLabel: project.dueLabel,
    href: `/account/projects/${project.id}`,
  };
}

function toRecentMessage(ticket: ClientTicketSummary): ClientRecentMessage {
  const attention = ticketAttention(ticket.status);

  return {
    id: ticket.ticket_id,
    reference: ticket.public_ref,
    subject: ticket.subject,
    tone: attention.tone,
    toneLabel: attention.label,
    activityAt: ticket.last_message_at ?? ticket.updated_at,
    messageCount: ticket.message_count,
    href: `/account/messages/${ticket.ticket_id}`,
  };
}

/**
 * The earliest real next-billing date across live subscriptions.
 *
 * Canceled subscriptions have no next date and are excluded. A subscription the
 * billing engine has not scheduled a cycle for reports null and is likewise
 * excluded rather than being given a guessed date.
 */
function toNextBilling(subscriptions: SubscriptionSummary[]): ClientNextBilling | null {
  const upcoming = subscriptions
    .filter((entry) => entry.status !== "canceled" && entry.next_payment_on)
    .sort((left, right) => (left.next_payment_on ?? "").localeCompare(right.next_payment_on ?? ""));

  const next = upcoming[0];
  if (!next) return null;

  return {
    serviceName: next.service_name,
    dateLabel: formatDate(next.next_payment_on),
    amountLabel: formatCurrencyCents(next.amount_cents, next.currency),
    href: `/account/subscriptions/${next.subscription_id}`,
  };
}

export function composeClientPortalSummary(
  sources: ClientPortalSources,
  now: Date = new Date(),
): ClientPortalSummary {
  const { projects, assignments, invoices, tickets, subscriptions } = sources;

  const onboarding = assignments ? composeClientOnboarding(assignments) : null;
  const balance = invoices ? composeClientBalance(invoices, now) : null;

  const openProjects = (projects ?? []).filter((project) => clientProjectIsOpen(project.status));

  // Projects the client is blocking come first: they are the ones that will not
  // move until someone acts.
  const orderedProjects = [...openProjects].sort((left, right) => {
    const leftBlocked = projectAttention(left.status).tone === "waiting_on_you" ? 0 : 1;
    const rightBlocked = projectAttention(right.status).tone === "waiting_on_you" ? 0 : 1;
    return leftBlocked - rightBlocked;
  });

  const liveTickets = (tickets ?? []).filter((ticket) => !ticket.archived_at);
  const waitingTickets = liveTickets.filter(
    (ticket) => ticketAttention(ticket.status).tone === "waiting_on_you",
  );

  const recentMessages = [...liveTickets]
    .sort((left, right) =>
      (right.last_message_at ?? right.updated_at).localeCompare(
        left.last_message_at ?? left.updated_at,
      ),
    )
    .slice(0, RECENT_MESSAGE_LIMIT)
    .map(toRecentMessage);

  const blockedProjects = openProjects.filter(
    (project) => projectAttention(project.status).tone === "waiting_on_you",
  );

  const attention: ClientAttentionItem[] = [];

  if (onboarding && onboarding.outstanding.length > 0) {
    const count = onboarding.outstanding.length;
    attention.push({
      id: "onboarding",
      tone: "waiting_on_you",
      label: count === 1 ? "Complete 1 required form" : `Complete ${count} required forms`,
      detail: onboarding.outstanding
        .slice(0, 3)
        .map((item) => item.title)
        .join(" · "),
      href: "/account/projects#forms",
      cta: "Review forms",
    });
  }

  if (waitingTickets.length > 0) {
    const count = waitingTickets.length;
    attention.push({
      id: "messages",
      tone: "waiting_on_you",
      label:
        count === 1
          ? "1 conversation is waiting on your reply"
          : `${count} conversations are waiting on your reply`,
      detail: waitingTickets
        .slice(0, 3)
        .map((ticket) => ticket.subject)
        .join(" · "),
      href: "/account/messages",
      cta: "Open messages",
    });
  }

  if (blockedProjects.length > 0) {
    const count = blockedProjects.length;
    attention.push({
      id: "projects",
      tone: "waiting_on_you",
      label:
        count === 1
          ? "1 order needs information from you"
          : `${count} orders need information from you`,
      detail: blockedProjects
        .slice(0, 3)
        .map((project) => project.title)
        .join(" · "),
      href: "/account/projects",
      cta: "Review orders",
    });
  }

  if (balance && balance.currencies.length > 0) {
    const overdue = balance.totalOverdueInvoices;
    attention.push({
      id: "invoices",
      tone: "payment_due",
      label:
        overdue > 0
          ? `${overdue} ${overdue === 1 ? "invoice is" : "invoices are"} overdue`
          : `${balance.totalCollectibleInvoices} ${balance.totalCollectibleInvoices === 1 ? "invoice is" : "invoices are"} awaiting payment`,
      // Per currency, never summed. See composeClientBalance.
      detail: balance.currencies
        .map((entry) => formatCurrencyCents(entry.outstandingCents, entry.currency))
        .join(" · "),
      href: "/account/invoices",
      cta: "Review invoices",
    });
  }

  const pastDueSubscriptions = (subscriptions ?? []).filter(
    (entry) => subscriptionAttention(entry.status).tone === "payment_due",
  );

  if (pastDueSubscriptions.length > 0) {
    attention.push({
      id: "subscriptions",
      tone: "payment_due",
      label:
        pastDueSubscriptions.length === 1
          ? "1 subscription needs a payment"
          : `${pastDueSubscriptions.length} subscriptions need a payment`,
      detail: pastDueSubscriptions.map((entry) => entry.service_name).join(" · "),
      href: "/account/subscriptions",
      cta: "Review subscriptions",
    });
  }

  const isBrandNew =
    (projects?.length ?? 0) === 0
    && (assignments?.length ?? 0) === 0
    && (invoices?.length ?? 0) === 0
    && (tickets?.length ?? 0) === 0
    && (subscriptions?.length ?? 0) === 0;

  return {
    activeProjects: orderedProjects.slice(0, ACTIVE_PROJECT_LIMIT).map(toActiveProject),
    totalProjects: projects ? projects.length : null,
    attention,
    balance,
    onboarding,
    nextBilling: subscriptions ? toNextBilling(subscriptions) : null,
    activeSubscriptionCount: subscriptions
      ? subscriptions.filter((entry) => entry.status === "active").length
      : null,
    recentMessages,
    messagesGranted: tickets !== null,
    counts: {
      onboarding: onboarding ? onboarding.outstanding.length : null,
      messages: tickets ? waitingTickets.length : null,
      projects: projects ? openProjects.length : null,
    },
    isBrandNew,
  };
}

/** Re-exported so pages import one attention vocabulary, not two. */
export { invoiceAttention, projectAttention, subscriptionAttention, ticketAttention };
