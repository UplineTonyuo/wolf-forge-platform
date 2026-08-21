import { formatDate } from "../../lib/format";
import {
  reportLaneLabels,
  reportLaneSchema,
  reportStatusLabels,
  reportStatusSchema,
  type ClientReportRow,
  type InternalReportRow,
  type ReportLane,
  type ReportStatus,
} from "./schema";

/**
 * The client-facing report view model.
 *
 * Pure. The database id is deliberately absent from everything the page prints:
 * it is needed to mark a report read, so it is carried, but nothing renders it.
 */
export type ClientReportView = {
  id: string;
  lane: ReportLane;
  laneLabel: string;
  packageLabel: string;
  title: string;
  url: string | null;
  sentAt: string;
  sentLabel: string;
  /** False means unread for *this* person, which is what earns the "New" mark. */
  isRead: boolean;
};

export function toClientReportView(row: ClientReportRow): ClientReportView {
  /*
   * An unrecognised type still renders rather than vanishing — a report the
   * client can open matters more than a label this build happens to know.
   */
  const parsed = reportLaneSchema.safeParse(row.report_lane);
  const lane: ReportLane = parsed.success ? parsed.data : "seo_package";

  return {
    id: row.report_id,
    lane,
    laneLabel: parsed.success ? reportLaneLabels[lane] : "Report",
    packageLabel: row.package_label,
    title: row.title,
    url: row.report_url,
    sentAt: row.sent_at,
    sentLabel: formatDate(row.sent_at),
    isRead: row.is_read,
  };
}

/** Newest first. The RPC already orders this way; restating it keeps it true. */
export function toClientReportViews(rows: ClientReportRow[]): ClientReportView[] {
  return rows
    .map(toClientReportView)
    .sort((left, right) => right.sentAt.localeCompare(left.sentAt));
}

export type ClientReportingSummary = {
  total: number;
  unread: number;
  /** The newest report's date label, or null when there are none. */
  latestLabel: string | null;
};

/** Counts only, all derived from the rows actually returned. */
export function summariseClientReports(views: ClientReportView[]): ClientReportingSummary {
  return {
    total: views.length,
    unread: views.filter((view) => !view.isRead).length,
    latestLabel: views[0]?.sentLabel ?? null,
  };
}

/**
 * Whether a stored link is still safe to render as an anchor.
 *
 * Defence in depth: the value already passed the domain schema and the database
 * CHECK before it was stored, but the render path re-checks rather than trusting
 * that a row can only have arrived one way.
 */
export function isSafeReportUrl(url: unknown): url is string {
  if (typeof url !== "string") return false;

  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/* -----------------------------------------------------------------------------
 * Phase 2 — the internal workspace
 * -------------------------------------------------------------------------- */

/**
 * One row of the internal Reporting list.
 *
 * Drafts and sent reports share a row shape because they are the same thing at
 * different stages; what differs is which timestamp is meaningful, so the view
 * resolves that once here rather than in the markup.
 */
export type InternalReportView = {
  id: string;
  companyId: string;
  companyName: string;
  lane: ReportLane;
  laneLabel: string;
  packageLabel: string;
  title: string;
  status: ReportStatus;
  statusLabel: string;
  sectionCount: number;
  entryCount: number;
  /** "Sent 18 Aug 2026" or "Edited 20 Aug 2026" — whichever the row actually has. */
  timeLabel: string;
  /** The instant the list is ordered by, newest first. */
  orderedAt: string;
  sentByName: string | null;
};

export function toInternalReportView(row: InternalReportRow): InternalReportView {
  const lane = reportLaneSchema.safeParse(row.report_lane);
  const status = reportStatusSchema.safeParse(row.status);

  /* An unknown status renders as a draft: the safe reading is "not delivered". */
  const resolvedStatus: ReportStatus = status.success ? status.data : "draft";
  const resolvedLane: ReportLane = lane.success ? lane.data : "seo_package";
  const orderedAt = row.sent_at ?? row.updated_at;

  return {
    id: row.report_id,
    companyId: row.company_id,
    companyName: row.company_name,
    lane: resolvedLane,
    laneLabel: lane.success ? reportLaneLabels[resolvedLane] : "Report",
    packageLabel: row.package_label,
    title: row.title,
    status: resolvedStatus,
    statusLabel: reportStatusLabels[resolvedStatus],
    sectionCount: row.section_count,
    entryCount: row.entry_count,
    timeLabel:
      resolvedStatus === "sent" && row.sent_at
        ? `Sent ${formatDate(row.sent_at)}`
        : `Edited ${formatDate(row.updated_at)}`,
    orderedAt,
    sentByName: row.sent_by_name,
  };
}

export function toInternalReportViews(rows: InternalReportRow[]): InternalReportView[] {
  return rows
    .map(toInternalReportView)
    .sort((left, right) => right.orderedAt.localeCompare(left.orderedAt));
}

export type InternalReportCounts = { draft: number; sent: number; total: number };

export function countInternalReports(views: InternalReportView[]): InternalReportCounts {
  const draft = views.filter((view) => view.status === "draft").length;
  return { draft, sent: views.length - draft, total: views.length };
}
