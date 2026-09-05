import "server-only";

import {
  mergeAssignedVaOptions,
  parsePodcastWorkflowRows,
  type PodcastOperationItem,
} from "../domain/operations/podcast-workflow";
import {
  createPodcastWorkflowSource,
  logPodcastSourceFetchFailure,
  PodcastSourceUnavailableError,
  type PodcastWorkflowSource,
} from "../lib/integrations/google-sheets-source";

export { PodcastSourceUnavailableError };

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
 * The one seam between the read-only Podcast SEO UI and its data: swap the
 * `PodcastWorkflowSource` (Google Sheets today) without touching the domain
 * parser or any component, and — when a write-back feature is built later —
 * give it its own separate write path through this same seam rather than
 * threading mutations through this read service.
 */
export class PodcastWorkflowService {
  constructor(private readonly source: PodcastWorkflowSource) {}

  async getSnapshot(): Promise<PodcastWorkflowSnapshot> {
    const { sourceMonth, rows, assignedVaValidationOptions } = await this.source.fetchLatestPodcastTab();
    const items = parsePodcastWorkflowRows(rows, sourceMonth);
    return {
      items,
      sourceMonth,
      lastSyncedAt: new Date().toISOString(),
      vaOptions: mergeAssignedVaOptions(assignedVaValidationOptions ?? [], items),
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
