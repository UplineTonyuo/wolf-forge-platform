"use client";

import { ArrowLeft, Folder, Package } from "lucide-react";
import { useMemo } from "react";
import type { ServiceFolderRow } from "../../lib/supabase/database-rows";
import { assignServiceIconsById } from "../services/service-icons";
import { FilterOptionList, type FilterOptionRow } from "./project-filter-option-list";
import { FilterSearchBox } from "./project-filter-search-box";
import { ProjectFilterPopover } from "./project-filter-popover";
import popoverStyles from "./project-filter-popover.module.css";
import { useServiceFolderFilter, type ServiceFilterOption } from "./use-service-folder-filter";

/**
 * Desktop Service filter control. Same folder -> service chooser used
 * everywhere else in Wolf Forge (`useServiceFolderFilter`'s data model),
 * rendered through the shared `ProjectFilterPopover` shell and the shared
 * `FilterOptionList`/`FilterSearchBox` primitives so Service shares its
 * shell, motion and row rendering with Person/Client/Status instead of
 * duplicating them.
 */
export function ProjectServiceFilterPicker({
  folders,
  services,
  value,
  onChange,
}: {
  folders: ServiceFolderRow[];
  services: ServiceFilterOption[];
  value: string;
  onChange: (value: string) => void;
}) {
  const picker = useServiceFolderFilter(folders, services, value === "all" ? "" : value);

  const iconByServiceId = useMemo(
    () =>
      assignServiceIconsById(
        services.map((service) => ({ id: service.id, name: service.name, folderId: service.folder_id })),
      ),
    [services],
  );

  const selectedServiceName = value === "all" ? null : services.find((service) => service.id === value)?.name ?? null;

  return (
    <ProjectFilterPopover
      triggerId="project-service-filter"
      triggerLabel={selectedServiceName ?? "All services"}
      ariaLabel="Choose a service"
      render={({ close }) => {
        if (!picker.folderId) {
          const folderOptions: FilterOptionRow[] = [
            { id: "all", label: "All services", icon: <Package size={16} aria-hidden="true" /> },
            ...picker.availableFolders.map((folder) => {
              const count = picker.folderCounts.get(folder.id) ?? 0;
              return {
                id: folder.id,
                label: folder.name,
                sublabel: `${count} ${count === 1 ? "service" : "services"}`,
                icon: <Folder size={16} aria-hidden="true" />,
              };
            }),
          ];

          return (
            <>
              <div className={popoverStyles.heading}>
                <span className={popoverStyles.eyebrow}>SERVICE</span>
                <strong>Choose a service</strong>
                <span className={popoverStyles.subLabel}>Choose a service folder</span>
              </div>
              <FilterOptionList
                options={folderOptions}
                selectedId={value}
                onSelect={(id) => {
                  if (id === "all") {
                    onChange("all");
                    close();
                    return;
                  }
                  picker.openFolder(id);
                }}
              />
            </>
          );
        }

        const serviceOptions: FilterOptionRow[] = picker.folderServices.map((service) => {
          const Icon = iconByServiceId.get(service.id) ?? Package;
          return {
            id: service.id,
            label: service.name,
            sublabel: picker.selectedFolder?.name,
            icon: <Icon size={16} aria-hidden="true" />,
          };
        });

        return (
          <>
            <button type="button" className={popoverStyles.backButton} onClick={picker.changeFolder}>
              <ArrowLeft size={14} aria-hidden="true" />
              Change folder
            </button>
            <FilterSearchBox
              value={picker.serviceQuery}
              onChange={picker.setServiceQuery}
              placeholder={`Search ${picker.selectedFolder?.name ?? ""} services...`}
              compact
            />
            <div className={popoverStyles.breadcrumb}>
              <Folder size={12} aria-hidden="true" />
              {picker.selectedFolder?.name}
            </div>
            <FilterOptionList
              options={serviceOptions}
              selectedId={value}
              onSelect={(id) => {
                onChange(id);
                close();
              }}
              emptyMessage="No service found in this folder."
            />
          </>
        );
      }}
    />
  );
}
