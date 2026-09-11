import "server-only";

import {
  mergeAssignedVaOptions,
  parsePodcastWorkflowRows,
  type PodcastOperationItem,
} from "../domain/operations/podcast-workflow";
import {
  createPodcastWorkflowSource,
  logPodcastSourceFetchFailure,
  resolvePodcastMonthSelection,
  PodcastSourceUnavailableError,
  type PodcastMonthOption,
  type PodcastWorkflowSource,
} from "../lib/integrations/google-sheets-source";

export { PodcastSourceUnavailableError };
export type { PodcastMonthOption };

export type PodcastWorkflowSnapshot = {
  items: PodcastOperationItem[];
  sourceMonth: string;
  /**
   * Wall-clock time of this fetch, not the underlying HTTP cache's actual
   * write time (Next's fetch cache doesn't expose that from inside a Server
   * Component render) — an honest "as of this page load" reading rather
   * than a precise cache-age figure. Reasonable for a read-only operational
   * view refreshed on normal navigation/revalidation, not a sub-second SLA.
   */
  lastSyncedAt: string;
  /** Sheet data-validation options unioned with actual parsed values — see `mergeAssignedVaOptions`. */
  vaOptions: string[];
};

/**
 * A snapshot plus the month-selector's own state: the full server-discovered
 * allowlist (`monthOptions`, newest first) and which one was actually used
 * (`selectedMonth`, `null` only when the workbook has no dated Podcast tab at
 * all — `snapshot.sourceMonth` still names whatever legacy tab was read).
 */
export type PodcastWorkflowSnapshotBundle = {
  snapshot: PodcastWorkflowSnapshot;
  monthOptions: PodcastMonthOption[];
  selectedMonth: string | null;
};

/**
 * The one seam between the read-only Podcast SEO UI and its data: swap the
 * `PodcastWorkflowSource` (Google Sheets today) without touching the domain
 * parser or any component, and — when a write-back feature is built later —
 * give it its own separate write path through this same seam rather than
 * threading mutations through this read service.
 */
export class PodcastWorkflowService {
  constructor(private readonly source: PodcastWorkflowSource) {}

  /** Unchanged behavior: always the newest tab, no month awareness. */
  async getSnapshot(): Promise<PodcastWorkflowSnapshot> {
    return this.buildSnapshot(await this.source.fetchLatestPodcastTab());
  }

  /**
   * Month-aware snapshot for the Podcast SEO header selector. `requestedMonth`
   * is untrusted input (a URL query value); it is resolved against the
   * source's own freshly-discovered allowlist by `resolvePodcastMonthSelection`
   * — an unrecognized, missing, or malformed value safely falls back to the
   * newest option rather than erroring or guessing a range.
   */
  async getSnapshotForMonth(requestedMonth: string | null): Promise<PodcastWorkflowSnapshotBundle> {
    const monthOptions = await this.source.listAvailablePodcastMonths();
    const resolved = resolvePodcastMonthSelection(monthOptions, requestedMonth);
    const sheet = resolved
      ? await this.source.fetchPodcastTab(resolved.tabTitle)
      : await this.source.fetchLatestPodcastTab();
    return {
      snapshot: this.buildSnapshot(sheet),
      monthOptions,
      selectedMonth: resolved?.value ?? null,
    };
  }

  private buildSnapshot(sheet: {
    sourceMonth: string;
    rows: string[][];
    assignedVaValidationOptions?: string[];
  }): PodcastWorkflowSnapshot {
    const items = parsePodcastWorkflowRows(sheet.rows, sheet.sourceMonth);
    return {
      items,
      sourceMonth: sheet.sourceMonth,
      lastSyncedAt: new Date().toISOString(),
      vaOptions: mergeAssignedVaOptions(sheet.assignedVaValidationOptions ?? [], items),
    };
  }
}

/**
 * The one loader shared by the initial server-rendered page and the
 * client-triggered `/api/operations/podcast-seo/snapshot` refetch, so both
 * paths fetch, parse, and fall back identically. `null` distinguishes "the
 * source could not be reached" (logged, and rendered as the existing
 * "Podcast source unavailable" empty state) from a genuine zero-row result;
 * anything else is a real bug and is rethrown rather than swallowed into a
 * false "unavailable".
 */
export async function loadPodcastWorkflowSnapshotOrNull(): Promise<PodcastWorkflowSnapshot | null> {
  try {
    const source = createPodcastWorkflowSource();
    const service = new PodcastWorkflowService(source);
    return await service.getSnapshot();
  } catch (error) {
    await logPodcastSourceFetchFailure(error);
    if (error instanceof PodcastSourceUnavailableError) return null;
    throw error;
  }
}

/**
 * Month-aware counterpart of `loadPodcastWorkflowSnapshotOrNull`, used by the
 * page and the live-sync refetch route once a month selector is involved.
 * Same `null`-means-unavailable contract; `monthOptions` is `[]` and
 * `selectedMonth` is `null` in that case too, since neither could be
 * discovered.
 */
export async function loadPodcastWorkflowSnapshotBundleOrNull(
  requestedMonth: string | null,
): Promise<PodcastWorkflowSnapshotBundle | null> {
  try {
    const source = createPodcastWorkflowSource();
    const service = new PodcastWorkflowService(source);
    return await service.getSnapshotForMonth(requestedMonth);
  } catch (error) {
    await logPodcastSourceFetchFailure(error);
    if (error instanceof PodcastSourceUnavailableError) return null;
    throw error;
  }
}
