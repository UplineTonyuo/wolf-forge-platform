import type { Metadata } from "next";
import {
  ServicesFolderWorkspace,
  type FolderDeskItem,
  type FolderDeskService,
} from "../../../components/services/services-folder-workspace";
import { ServicesRootActions } from "../../../components/services/services-root-actions";
import { PageFrame } from "../../../components/ui/page-frame";
import { toClientSafeError } from "../../../lib/errors/application-error";
import {
  sanitizeServiceDescription,
  serviceDescriptionToPlainText,
} from "../../../lib/service-description-html";
import type {
  ServiceFolderRow,
  ServiceRow,
} from "../../../lib/supabase/database-rows";
import { getInternalContext } from "../../../lib/supabase/next-server";

export const metadata: Metadata = {
  title: "Services",
};

function flattenFolders(
  folders: ServiceFolderRow[],
) {
  const result: ServiceFolderRow[] = [];
  const visited = new Set<string>();

  function visit(
    parentId: string | null,
  ) {
    for (
      const folder of folders.filter(
        (candidate) =>
          candidate.parent_id ===
          parentId,
      )
    ) {
      if (visited.has(folder.id)) {
        continue;
      }

      visited.add(folder.id);
      result.push(folder);
      visit(folder.id);
    }
  }

  visit(null);

  for (const folder of folders) {
    if (!visited.has(folder.id)) {
      result.push(folder);
    }
  }

  return result;
}

function formatMoney(
  service: ServiceRow,
) {
  return new Intl.NumberFormat(
    "en-US",
    {
      style: "currency",
      currency: service.currency,
      minimumFractionDigits:
        service.price % 1 === 0
          ? 0
          : 2,
      maximumFractionDigits: 2,
    },
  ).format(service.price);
}

function formatCatalogDate(
  value: string,
) {
  return new Intl.DateTimeFormat(
    "en",
    {
      day: "numeric",
      month: "short",
      year: "numeric",
    },
  ).format(new Date(value));
}

function summarizeService(
  service: ServiceRow,
) {
  const plain =
    serviceDescriptionToPlainText(
      service.description,
    ).trim();

  if (plain.length <= 140) {
    return plain;
  }

  const clipped =
    plain.slice(0, 140);

  const lastSpace =
    clipped.lastIndexOf(" ");

  return `${
    (
      lastSpace > 55
        ? clipped.slice(
            0,
            lastSpace,
          )
        : clipped
    ).trimEnd()
  }…`;
}

export default async function ServicesPage({
  searchParams,
}: {
  searchParams: Promise<{
    folder?: string;
    archived?: string;
    folderCreated?: string;
    folderArchived?: string;
  }>;
}) {
  const parameters =
    await searchParams;

  const context =
    await getInternalContext();

  try {
    const [
      services,
      folders,
    ] = await Promise.all([
      context.services.catalog.listCatalog(),
      context.services.catalog.listFolders(),
    ]);

    const serviceCounts =
      new Map<string, number>();

    for (const service of services) {
      if (!service.folder_id) {
        continue;
      }

      serviceCounts.set(
        service.folder_id,
        (
          serviceCounts.get(
            service.folder_id,
          ) ?? 0
        ) + 1,
      );
    }

    const unfiledCount =
      services.filter(
        (service) =>
          service.folder_id === null,
      ).length;

    const orderedFolders =
      flattenFolders(folders);

    const folderItems:
      FolderDeskItem[] = [
        ...orderedFolders.map(
          (folder) => ({
            id: folder.id,
            name: folder.name,
            description:
              folder.description,
            serviceCount:
              serviceCounts.get(
                folder.id,
              ) ?? 0,
          }),
        ),
        {
          id: "unfiled",
          name: "Unfiled",
          description:
            "Services without a folder",
          serviceCount:
            unfiledCount,
          system: true,
        },
      ];

    const serviceItems:
      FolderDeskService[] =
      services.map(
        (service) => ({
          id: service.id,
          name: service.name,
          folderId:
            service.folder_id ??
            "unfiled",
          priceLabel:
            formatMoney(service),
          createdLabel:
            formatCatalogDate(
              service.created_at,
            ),
          summary:
            summarizeService(
              service,
            ),
          descriptionHtml:
            sanitizeServiceDescription(
              service.description,
            ),
          recurring:
            service.recurring,
          isActive:
            service.is_active,
          isPublic:
            service.is_public,
        }),
      );

    const requestedFolder =
      parameters.folder ??
      null;

    const initialFolderId =
      folderItems.some(
        (folder) =>
          folder.id ===
          requestedFolder,
      )
        ? requestedFolder
        : folderItems[0]?.id ??
          null;

    return (
      <PageFrame
        title="Services"
        description="Configure the catalog that becomes Wolf Forge Project work."
        action={
          <ServicesRootActions />
        }
      >
        {parameters.archived ? (
          <div className="success-banner">
            Service soft deleted.
          </div>
        ) : null}

        {parameters.folderCreated ? (
          <div className="success-banner">
            Folder created.
          </div>
        ) : null}

        {parameters.folderArchived ? (
          <div className="success-banner">
            Folder soft deleted. Its services are now Unfiled.
          </div>
        ) : null}

        <ServicesFolderWorkspace
          folders={folderItems}
          services={serviceItems}
          initialFolderId={
            initialFolderId
          }
        />
      </PageFrame>
    );
  }
  catch (error) {
    return (
      <PageFrame
        title="Services"
        action={
          <ServicesRootActions />
        }
      >
        <div className="error-state">
          <strong>
            Services could not be loaded.
          </strong>

          <span>
            {
              toClientSafeError(
                error,
              ).message
            }
          </span>
        </div>
      </PageFrame>
    );
  }
}