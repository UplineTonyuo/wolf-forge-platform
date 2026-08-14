import { ArrowDown, ArrowUp, Folder, MoreHorizontal, Pencil, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { FilterInput } from "../../../components/ui/filter-input";
import { DataError, EmptyState } from "../../../components/ui/list-states";
import { PageFrame } from "../../../components/ui/page-frame";
import { toClientSafeError } from "../../../lib/errors/application-error";
import {
  compareServiceNameMatches,
  serviceNameSearchScore,
} from "../../../lib/service-name-search";
import type { ServiceFolderRow, ServiceRow } from "../../../lib/supabase/database-rows";
import { getInternalContext } from "../../../lib/supabase/next-server";

export const metadata: Metadata = { title: "Services" };

type ServiceSort = "name" | "price" | "created";
type SortDirection = "asc" | "desc";

function flattenFolders(folders: ServiceFolderRow[]) {
  const result: Array<{ folder: ServiceFolderRow; depth: number }> = [];
  const visited = new Set<string>();

  function visit(parentId: string | null, depth: number) {
    for (const folder of folders.filter((candidate) => candidate.parent_id === parentId)) {
      if (visited.has(folder.id)) continue;
      visited.add(folder.id);
      result.push({ folder, depth });
      visit(folder.id, depth + 1);
    }
  }

  visit(null, 0);
  for (const folder of folders) {
    if (!visited.has(folder.id)) result.push({ folder, depth: 0 });
  }
  return result;
}

function formatMoney(service: ServiceRow) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: service.currency,
    minimumFractionDigits: service.price % 1 === 0 ? 0 : 2,
  }).format(service.price);
}

function formatCatalogDate(value: string) {
  return new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));
}

function sortServices(services: ServiceRow[], sort: ServiceSort, direction: SortDirection) {
  const multiplier = direction === "asc" ? 1 : -1;
  return [...services].sort((left, right) => {
    if (sort === "price") return (left.price - right.price) * multiplier;
    if (sort === "created") return left.created_at.localeCompare(right.created_at) * multiplier;
    return left.name.localeCompare(right.name) * multiplier;
  });
}

function ServicesHeaderActions() {
  return (
    <div className="services-header-actions">
      <Link className="button-primary" href="/services/new"><Plus aria-hidden="true" />New Service</Link>
      <details className="services-actions-menu">
        <summary className="button-secondary"><MoreHorizontal aria-hidden="true" />Actions</summary>
        <div><Link href="/services/folders/new"><Folder aria-hidden="true" />New Folder</Link></div>
      </details>
    </div>
  );
}

function SortLink({
  label,
  column,
  currentSort,
  direction,
  folder,
  query,
}: {
  label: string;
  column: ServiceSort;
  currentSort: ServiceSort;
  direction: SortDirection;
  folder: string;
  query: string;
}) {
  const nextDirection = currentSort === column && direction === "asc" ? "desc" : "asc";
  const params = new URLSearchParams({ folder, sort: column, direction: nextDirection });
  if (query) params.set("q", query);
  return (
    <Link
      className="services-sort-link"
      href={`/services?${params}`}
    >
      <span>
        {label}
      </span>

      {currentSort === column ? (
        direction === "asc" ? (
          <ArrowUp
            aria-hidden="true"
          />
        ) : (
          <ArrowDown
            aria-hidden="true"
          />
        )
      ) : null}
    </Link>
  );
}

export default async function ServicesPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    folder?: string;
    sort?: string;
    direction?: string;
    archived?: string;
    folderCreated?: string;
    folderArchived?: string;
  }>;
}) {
  const parameters = await searchParams;
  const q = parameters.q ?? "";
  const folderParameter = parameters.folder ?? "unfiled";
  const sort: ServiceSort = ["name", "price", "created"].includes(parameters.sort ?? "")
    ? parameters.sort as ServiceSort
    : "name";
  const direction: SortDirection = parameters.direction === "desc" ? "desc" : "asc";
  const context = await getInternalContext();

  try {
    const [services, folders] = await Promise.all([
      context.services.catalog.listCatalog(),
      context.services.catalog.listFolders(),
    ]);
    const selectedFolder = folders.find((folder) => folder.id === folderParameter) ?? null;
    const selectedFolderId = selectedFolder?.id ?? null;
    const needle = q.trim();

    const visibleServices =
      services.filter((service) => {
        /*
         * When there is an active search, search the ENTIRE
         * service catalog regardless of folder.
         *
         * Without a search, preserve normal folder behavior.
         */
        if (needle) {
          return (
            serviceNameSearchScore(
              service.name,
              needle,
            ) !== null
          );
        }

        return selectedFolderId
          ? service.folder_id === selectedFolderId
          : service.folder_id === null;
      });

    const sortedServices =
      needle
        ? [...visibleServices]
            .sort((left, right) =>
              compareServiceNameMatches(
                left.name,
                right.name,
                needle,
              ),
            )
            .slice(0, 200)
        : sortServices(
            visibleServices,
            sort,
            direction,
          ).slice(0, 200);
    const serviceCounts = new Map<string, number>();
    for (const service of services) {
      if (service.folder_id) serviceCounts.set(service.folder_id, (serviceCounts.get(service.folder_id) ?? 0) + 1);
    }
    const unfiledCount = services.filter((service) => service.folder_id === null).length;
    const folderQueryValue = selectedFolder?.id ?? "unfiled";

    return (
      <PageFrame
        title="Services"
        description="Configure the catalog that becomes Wolf Forge Project work."
        action={<ServicesHeaderActions />}
      >
        {parameters.archived ? <div className="success-banner">Service soft deleted.</div> : null}
        {parameters.folderCreated ? <div className="success-banner">Folder created.</div> : null}
        {parameters.folderArchived ? <div className="success-banner">Folder soft deleted. Its services are now Unfiled.</div> : null}

        <section className="services-folder-section" aria-labelledby="services-folders-heading">
          <div className="services-section-heading">
            <div><span>Catalog structure</span><h2 id="services-folders-heading">Folders</h2></div>
            <Link href="/services/folders/new"><Plus aria-hidden="true" />New Folder</Link>
          </div>
          <div className="services-folder-list">
            {flattenFolders(folders).map(({ folder, depth }) => (
              <div className={selectedFolder?.id === folder.id ? "services-folder-row is-active" : "services-folder-row"} key={folder.id} style={{ "--folder-depth": depth } as React.CSSProperties}>
                <Link className="services-folder-link" href={`/services?folder=${folder.id}`}>
                  <Folder aria-hidden="true" />
                  <span><strong>{folder.name}</strong>{folder.description ? <small>{folder.description}</small> : null}</span>
                  <b>{serviceCounts.get(folder.id) ?? 0}</b>
                </Link>
                <Link className="services-folder-edit" href={`/services/folders/${folder.id}`} aria-label={`Edit ${folder.name}`}><Pencil aria-hidden="true" /></Link>
              </div>
            ))}
            <div className={!selectedFolder ? "services-folder-row is-active" : "services-folder-row"}>
              <Link className="services-folder-link" href="/services?folder=unfiled">
                <Folder aria-hidden="true" /><span><strong>Unfiled</strong><small>Services without a folder</small></span><b>{unfiledCount}</b>
              </Link>
            </div>
          </div>
        </section>

        <section className="services-catalog-section" aria-labelledby="services-catalog-heading">
          <div className="services-section-heading services-catalog-heading">
            <div>
              <span>Service catalog</span>
              <h2 id="services-catalog-heading">
                {needle
                  ? "Search results"
                  : selectedFolder?.name ?? "Unfiled services"}
              </h2>
            </div>
            {!needle && selectedFolder ? (
              <Link href={`/services/folders/${selectedFolder.id}`}>
                <Pencil aria-hidden="true" />
                Edit Folder
              </Link>
            ) : null}
          </div>
          <FilterInput
            label="Filter services"
            initialValue={q}
            suggestions={services.map(
              (service) => service.name,
            )}
          />

          {sortedServices.length === 0 ? (
            <EmptyState
              title={q ? `No services match "${q}".` : "No services in this folder."}
              body={q ? "Try a different search." : "Create a service or assign an existing service to this folder."}
            />
          ) : (
            <>
              <div className="services-table-shell">
                <table className="services-table">
                  <caption className="sr-only">
                    {needle
                      ? "Service search results"
                      : `Services in ${selectedFolder?.name ?? "Unfiled"}`}
                  </caption>
                  <thead><tr>
                    <th><SortLink label="Service" column="name" currentSort={sort} direction={direction} folder={folderQueryValue} query={q} /></th>
                    <th><SortLink label="Price" column="price" currentSort={sort} direction={direction} folder={folderQueryValue} query={q} /></th>
                    <th><SortLink label="Created" column="created" currentSort={sort} direction={direction} folder={folderQueryValue} query={q} /></th>
                  </tr></thead>
                  <tbody>{sortedServices.map((service) => (
                    <tr key={service.id}>
                      <td><Link className="services-table-name" href={`/services/${service.id}`}>{service.name}</Link></td>
                      <td className="services-price-cell">{formatMoney(service)}</td>
                      <td><time dateTime={service.created_at}>{formatCatalogDate(service.created_at)}</time></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
              <div className="mobile-record-list services-mobile-list">{sortedServices.map((service) => (
                <Link className="mobile-record-row" href={`/services/${service.id}`} key={service.id}>
                  <div><strong>{service.name}</strong><span>{formatMoney(service)}</span></div>
                  <time dateTime={service.created_at}>{formatCatalogDate(service.created_at)}</time>
                </Link>
              ))}</div>
            </>
          )}
        </section>
      </PageFrame>
    );
  } catch (error) {
    return <PageFrame title="Services" action={<ServicesHeaderActions />}><DataError message={toClientSafeError(error).message} /></PageFrame>;
  }
}
