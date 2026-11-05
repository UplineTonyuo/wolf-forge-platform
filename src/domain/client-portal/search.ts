import { projectAttention, ticketAttention, type AttentionTone } from "./attention";

/**
 * Client portal global search.
 *
 * Pure matching and ranking over already-authorized rows. This module never
 * reads anything: the server action hands it rows that RLS and the client-safe
 * projections already decided the account may see, and its only job is to
 * decide which of them match and in what order.
 *
 * Keeping it pure is what makes the ranking testable without a database, and
 * what keeps every authorization decision in one place upstream.
 */

export const clientSearchKinds = ["project", "message", "service"] as const;
export type ClientSearchKind = (typeof clientSearchKinds)[number];

export type ClientSearchResult = {
  kind: ClientSearchKind;
  id: string;
  /** The primary line: project title, conversation subject, service name. */
  title: string;
  /** Reference and state, e.g. "WF-P0237 · Waiting on you". */
  subtitle: string;
  href: string;
  /** Drives the result's pill colour, from the shared attention vocabulary. */
  tone: AttentionTone | null;
};

export type ClientSearchResponse =
  | { ok: true; query: string; results: ClientSearchResult[] }
  | { ok: false; error: string };

/** Below this a query matches almost everything and the panel is just noise. */
export const MIN_QUERY_LENGTH = 2;

/** Keeps the panel a panel rather than a page. */
export const MAX_RESULTS_PER_GROUP = 5;

/**
 * Match strength, lowest wins.
 *
 * Deterministic and ordered exactly as specified: an exact reference beats a
 * reference prefix, which beats an exact name, which beats a name prefix, which
 * beats a substring anywhere. No scoring heuristics, no fuzzy distance.
 */
export const MATCH_RANK = {
  exactReference: 0,
  referenceStartsWith: 1,
  exactTitle: 2,
  titleStartsWith: 3,
  contains: 4,
  /** Category-only hits, e.g. a service found through its folder name. */
  related: 5,
} as const;

export type MatchRank = (typeof MATCH_RANK)[keyof typeof MATCH_RANK];

export function normalize(value: string): string {
  return value.trim().toLocaleLowerCase();
}

/**
 * Reduces a reference to its comparable core.
 *
 * "WF-P0237" and "wf p0237" both become "wfp0237", so a client typing the
 * reference with or without its dash gets the same answer.
 */
export function normalizeReference(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]/gu, "");
}

/**
 * Scores a candidate against the query, or null when it does not match.
 *
 * References are matched leniently at the tail as well as the head: a client
 * reading a number off an email is as likely to type "0237" as "WF-P0237". A
 * tail match needs at least three characters so a stray digit cannot pull in
 * every reference on the account.
 */
export function rankCandidate(
  query: string,
  candidate: { title: string; reference?: string | null; related?: string | null },
): MatchRank | null {
  const needle = normalize(query);
  if (!needle) return null;

  const title = normalize(candidate.title);
  const related = candidate.related ? normalize(candidate.related) : null;

  if (candidate.reference) {
    const reference = normalizeReference(candidate.reference);
    const referenceNeedle = normalizeReference(query);

    if (referenceNeedle.length > 0) {
      if (reference === referenceNeedle) return MATCH_RANK.exactReference;
      if (reference.startsWith(referenceNeedle)) return MATCH_RANK.referenceStartsWith;
      if (referenceNeedle.length >= 3 && reference.endsWith(referenceNeedle)) {
        return MATCH_RANK.referenceStartsWith;
      }
      if (referenceNeedle.length >= 3 && reference.includes(referenceNeedle)) {
        return MATCH_RANK.contains;
      }
    }
  }

  if (title === needle) return MATCH_RANK.exactTitle;
  if (title.startsWith(needle)) return MATCH_RANK.titleStartsWith;
  if (title.includes(needle)) return MATCH_RANK.contains;
  if (related?.includes(needle)) return MATCH_RANK.related;

  return null;
}

export type ClientSearchCandidate = ClientSearchResult & {
  reference?: string | null;
  related?: string | null;
};

/**
 * Applies the ranking and trims the group.
 *
 * Ties break on match position first (an earlier hit reads as more relevant)
 * and then alphabetically, so the same query always produces the same order.
 */
export function rankResults(
  query: string,
  candidates: ClientSearchCandidate[],
  limit = MAX_RESULTS_PER_GROUP,
): ClientSearchResult[] {
  const needle = normalize(query);

  const scored = candidates
    .map((candidate) => ({ candidate, rank: rankCandidate(query, candidate) }))
    .filter(
      (entry): entry is { candidate: ClientSearchCandidate; rank: MatchRank } =>
        entry.rank !== null,
    );

  scored.sort((left, right) => {
    if (left.rank !== right.rank) return left.rank - right.rank;

    const leftIndex = normalize(left.candidate.title).indexOf(needle);
    const rightIndex = normalize(right.candidate.title).indexOf(needle);
    const leftPosition = leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex;
    const rightPosition = rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex;

    if (leftPosition !== rightPosition) return leftPosition - rightPosition;
    return left.candidate.title.localeCompare(right.candidate.title);
  });

  return scored.slice(0, limit).map(({ candidate }) => ({
    kind: candidate.kind,
    id: candidate.id,
    title: candidate.title,
    subtitle: candidate.subtitle,
    href: candidate.href,
    tone: candidate.tone,
  }));
}

/** Group order in the panel. Sections with no matches are not rendered at all. */
export const clientSearchGroups: Array<{ kind: ClientSearchKind; label: string }> = [
  { kind: "project", label: "Orders" },
  { kind: "message", label: "Tickets" },
  { kind: "service", label: "Services" },
];

export function groupResults(
  results: ClientSearchResult[],
): Array<{ kind: ClientSearchKind; label: string; results: ClientSearchResult[] }> {
  return clientSearchGroups
    .map((group) => ({
      ...group,
      results: results.filter((result) => result.kind === group.kind),
    }))
    .filter((group) => group.results.length > 0);
}

/**
 * A project candidate.
 *
 * Only the client-safe view model reaches this, so there is no internal note,
 * assignee or task title available to match against even by accident. The
 * service name is searchable as `related`, which is why "seo" can surface a
 * project delivered under an SEO service.
 */
export function toProjectCandidate(project: {
  id: string;
  reference: string;
  title: string;
  status: string;
  serviceName: string | null;
}): ClientSearchCandidate {
  const attention = projectAttention(project.status);

  return {
    kind: "project",
    id: project.id,
    title: project.title,
    subtitle: `${project.reference} · ${attention.label}`,
    href: `/account/projects/${project.id}`,
    tone: attention.tone,
    reference: project.reference,
    related: project.serviceName,
  };
}

/**
 * A conversation candidate.
 *
 * Subject and reference only. Message bodies are deliberately not searched:
 * public.ticket_messages holds internal notes alongside client-visible replies,
 * and although RLS would refuse to return the internal ones, searching bodies
 * would mean pulling message rows onto this path at all. Subject plus reference
 * answers the real queries without ever loading a message.
 */
export function toMessageCandidate(ticket: {
  ticket_id: string;
  public_ref: string;
  subject: string;
  status: string;
}): ClientSearchCandidate {
  const attention = ticketAttention(ticket.status);

  return {
    kind: "message",
    id: ticket.ticket_id,
    title: ticket.subject,
    subtitle: `${ticket.public_ref} · ${attention.label}`,
    href: `/account/messages/${ticket.ticket_id}`,
    tone: attention.tone,
    reference: ticket.public_ref,
  };
}

export function toServiceCandidate(service: {
  id: string;
  name: string;
  folderName: string | null;
  priceLabel: string;
  recurringLabel: string | null;
}): ClientSearchCandidate {
  const price = service.recurringLabel ?? service.priceLabel;

  return {
    kind: "service",
    id: service.id,
    title: service.name,
    subtitle: service.folderName ? `${service.folderName} · ${price}` : price,
    href: `/account/store/${service.id}`,
    tone: null,
    related: service.folderName,
  };
}
