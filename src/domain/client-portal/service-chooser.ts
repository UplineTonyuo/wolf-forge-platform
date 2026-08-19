import type { StoreCatalog } from "../services/store-projections";

/**
 * The service chooser read model.
 *
 * Derived from the StoreCatalog the portal layout already loads for the rail —
 * the same rows, the same RLS-scoped query, no second request and no new search
 * endpoint. Filtering happens over this in-memory list because the catalog is
 * already present on the client; there is nothing here a backend search would
 * make more correct.
 *
 * A folder only reaches this list when composeStoreCatalog kept it, which
 * requires at least one public, active, non-archived service inside it.
 */

export type ChooserService = {
  id: string;
  name: string;
  priceLabel: string;
  recurringLabel: string | null;
  summary: string;
  folderId: string | null;
  /** Resolved folder name, so a search hit can say where it lives. */
  folderName: string | null;
  href: string;
};

export type ChooserFolder = {
  id: string;
  name: string;
  description: string | null;
  serviceCount: number;
};

export type ServiceChooserCatalog = {
  folders: ChooserFolder[];
  services: ChooserService[];
};

export function serviceRoute(serviceId: string): string {
  return `/account/store/${serviceId}`;
}

export function toServiceChooserCatalog(catalog: StoreCatalog): ServiceChooserCatalog {
  const services: ChooserService[] = [];

  for (const folder of catalog.folders) {
    for (const service of folder.services) {
      services.push({
        id: service.id,
        name: service.name,
        priceLabel: service.priceLabel,
        recurringLabel: service.recurringLabel,
        summary: service.summary,
        folderId: folder.id,
        folderName: folder.name,
        href: serviceRoute(service.id),
      });
    }
  }

  /*
   * Services whose folder is missing or archived are still real, purchasable
   * services — they are searchable here even though they belong to no category,
   * exactly as the Store page already renders them.
   */
  for (const service of catalog.ungrouped) {
    services.push({
      id: service.id,
      name: service.name,
      priceLabel: service.priceLabel,
      recurringLabel: service.recurringLabel,
      summary: service.summary,
      folderId: null,
      folderName: null,
      href: serviceRoute(service.id),
    });
  }

  return {
    folders: catalog.folders.map((folder) => ({
      id: folder.id,
      name: folder.name,
      description: folder.description,
      serviceCount: folder.services.length,
    })),
    services,
  };
}

/**
 * Predictive filtering over the loaded catalog.
 *
 * Case-insensitive, matches anywhere in the name — "seo" finds "Local SEO",
 * "back" finds "Backlink Service", "press" finds "Press Releases". A blank
 * query returns nothing rather than everything, because the caller shows
 * categories in that state instead of an undifferentiated list.
 *
 * The folder name is searched too, so typing a category name finds the services
 * inside it even when none of them repeats the category in their own name.
 */
export function filterChooserServices(
  services: ChooserService[],
  query: string,
): ChooserService[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];

  const matches = services.filter(
    (service) =>
      service.name.toLocaleLowerCase().includes(needle)
      || (service.folderName?.toLocaleLowerCase().includes(needle) ?? false),
  );

  // A name hit is a stronger signal than a category hit, so it sorts first;
  // within each group the earlier match position wins.
  return matches.sort((left, right) => {
    const leftIndex = left.name.toLocaleLowerCase().indexOf(needle);
    const rightIndex = right.name.toLocaleLowerCase().indexOf(needle);
    const leftRank = leftIndex === -1 ? 1 : 0;
    const rightRank = rightIndex === -1 ? 1 : 0;

    if (leftRank !== rightRank) return leftRank - rightRank;
    if (leftRank === 0 && leftIndex !== rightIndex) return leftIndex - rightIndex;
    return left.name.localeCompare(right.name);
  });
}

export function servicesInFolder(
  services: ChooserService[],
  folderId: string,
): ChooserService[] {
  return services.filter((service) => service.folderId === folderId);
}
