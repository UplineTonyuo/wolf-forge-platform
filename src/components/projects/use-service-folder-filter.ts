"use client";

import { useDeferredValue, useMemo, useState } from "react";
import type { ServiceFolderRow } from "../../lib/supabase/database-rows";
import { normalize, rankName } from "./project-pickers";

/**
 * The narrow service shape every folder -> service picker needs, matching
 * the convention already used by `SubscriptionServicePicker` rather than
 * requiring the full `ServiceRow` database shape.
 */
export type ServiceFilterOption = {
  id: string;
  name: string;
  folder_id: string | null;
};

/**
 * Shared folder -> service selection state for the Projects Service filter,
 * used by both the desktop popover and the mobile Filters sheet so the two
 * surfaces can never drift into two different filtering behaviors.
 */
export function useServiceFolderFilter(
  folders: ServiceFolderRow[],
  services: ServiceFilterOption[],
  selectedServiceId: string,
) {
  const selectedService = useMemo(
    () => services.find((service) => service.id === selectedServiceId) ?? null,
    [services, selectedServiceId],
  );

  const [folderId, setFolderId] = useState(selectedService?.folder_id ?? "");
  const [serviceQuery, setServiceQuery] = useState("");
  const deferredQuery = useDeferredValue(serviceQuery);

  const availableFolders = useMemo(
    () =>
      folders
        .filter((folder) => !folder.archived_at)
        .sort((a, b) =>
          a.sort_order !== b.sort_order ? a.sort_order - b.sort_order : a.name.localeCompare(b.name),
        ),
    [folders],
  );

  const folderCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const service of services) {
      const key = service.folder_id ?? "";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [services]);

  const selectedFolder = availableFolders.find((folder) => folder.id === folderId) ?? null;

  const folderServices = useMemo(() => {
    if (!folderId) return [];

    const query = normalize(deferredQuery);

    return services
      .filter((service) => service.folder_id === folderId)
      .map((service) => ({ service, rank: rankName(service.name, query) }))
      .filter((entry) => Number.isFinite(entry.rank))
      .sort((a, b) =>
        a.rank !== b.rank ? a.rank - b.rank : a.service.name.localeCompare(b.service.name),
      )
      .map((entry) => entry.service);
  }, [services, folderId, deferredQuery]);

  function openFolder(nextFolderId: string) {
    setFolderId(nextFolderId);
    setServiceQuery("");
  }

  function changeFolder() {
    setFolderId("");
    setServiceQuery("");
  }

  return {
    availableFolders,
    folderCounts,
    folderId,
    selectedFolder,
    openFolder,
    changeFolder,
    folderServices,
    serviceQuery,
    setServiceQuery,
    selectedService,
  };
}
