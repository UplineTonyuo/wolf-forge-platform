"use client";

import {
  ArrowLeft,
  BellRing,
  Building2,
  Check,
  ChevronRight,
  Folder,
  ListChecks,
  Package,
  UserRound,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { orderStatuses } from "../../domain/orders/schema";
import { projectStatusLabels, type ProjectTab } from "../../domain/orders/projections";
import type { ServiceFolderRow } from "../../lib/supabase/database-rows";
import { assignServiceIconsById } from "../services/service-icons";
import { useExitTransition } from "../team/use-exit-transition";
import { FilterOptionList, type FilterOptionRow } from "./project-filter-option-list";
import { FilterSearchBox } from "./project-filter-search-box";
import { SimpleFilterContent, type SimpleFilterOption } from "./project-simple-filter-content";
import { useServiceFolderFilter, type ServiceFilterOption } from "./use-service-folder-filter";
import type { ProjectOption } from "./projects-workspace";
import sheetStyles from "./project-detail-actions.module.css";
import styles from "./projects-filter-sheet.module.css";

const CLOSE_DURATION_MS = 190;

type SheetView = "menu" | "person" | "client" | "status" | "service-folders" | "service-list";

/**
 * Mobile Filters sheet (<=767px). Reuses the exact modal chrome (backdrop,
 * panel, header, option-row list) already shipped in `ProjectDetailActions`,
 * and the shared `SimpleFilterContent`/`FilterOptionList` primitives for
 * Person/Client/Status content, so mobile and desktop never run separate
 * filtering implementations.
 */
export function ProjectsFilterSheet({
  open,
  onClose,
  people,
  clients,
  serviceFolders,
  services,
  personFilter,
  onPersonFilterChange,
  clientFilter,
  onClientFilterChange,
  serviceFilter,
  onServiceFilterChange,
  statusFilter,
  onStatusFilterChange,
  unansweredOnly,
  responseStatesAvailable,
  onUnansweredOnlyChange,
  onClear,
  activeFilterCount,
}: {
  open: boolean;
  onClose: () => void;
  people: ProjectOption[];
  clients: ProjectOption[];
  serviceFolders: ServiceFolderRow[];
  services: ServiceFilterOption[];
  personFilter: string;
  onPersonFilterChange: (value: string) => void;
  clientFilter: string;
  onClientFilterChange: (value: string) => void;
  serviceFilter: string;
  onServiceFilterChange: (value: string) => void;
  statusFilter: ProjectTab;
  onStatusFilterChange: (value: ProjectTab) => void;
  unansweredOnly: boolean;
  responseStatesAvailable: boolean;
  onUnansweredOnlyChange: (value: boolean) => void;
  onClear: () => void;
  activeFilterCount: number;
}) {
  const [view, setView] = useState<SheetView>("menu");
  const { render } = useExitTransition(open, CLOSE_DURATION_MS);
  /*
   * See `ProjectFilterPopover` for why: `useExitTransition`'s `phase` reads
   * "closing" during the brief pre-entry window right after opening too, and
   * `backdropClosing`/`panelClosing` here start their keyframes from fully
   * visible, so that produced a flash-then-fade-in on open. Deriving
   * `closing` from `open` directly keeps it true only for a real exit.
   */
  const closing = render && !open;

  const picker = useServiceFolderFilter(serviceFolders, services, serviceFilter === "all" ? "" : serviceFilter);

  const iconByServiceId = useMemo(
    () =>
      assignServiceIconsById(
        services.map((service) => ({ id: service.id, name: service.name, folderId: service.folder_id })),
      ),
    [services],
  );

  const personOptions: SimpleFilterOption[] = useMemo(
    () => people.map((person) => ({ id: person.id, label: person.name, avatarUrl: person.avatarUrl ?? null })),
    [people],
  );

  const clientOptions: SimpleFilterOption[] = useMemo(
    () => clients.map((client) => ({ id: client.id, label: client.name, icon: <Building2 size={16} aria-hidden="true" /> })),
    [clients],
  );

  const statusOptions: SimpleFilterOption[] = useMemo(
    () => orderStatuses.map((status) => ({ id: status, label: projectStatusLabels[status], status })),
    [],
  );

  useEffect(() => {
    if (!render) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;

      if (view !== "menu") {
        setView("menu");
        return;
      }

      setView("menu");
      onClose();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [render, view, onClose]);

  if (!render) return null;

  function requestClose() {
    setView("menu");
    onClose();
  }

  function backToMenu() {
    setView("menu");
  }

  const personName =
    personFilter === "all"
      ? "Everyone"
      : personFilter === "unassigned"
        ? "Unassigned"
        : (people.find((person) => person.id === personFilter)?.name ?? "Everyone");

  const clientName =
    clientFilter === "all" ? "All clients" : (clients.find((client) => client.id === clientFilter)?.name ?? "All clients");

  const serviceName =
    serviceFilter === "all" ? "All services" : (services.find((service) => service.id === serviceFilter)?.name ?? "All services");

  const statusName = statusFilter === "all" ? "All statuses" : projectStatusLabels[statusFilter];

  const panelTitle =
    view === "person"
      ? "Person"
      : view === "client"
        ? "Client"
        : view === "status"
          ? "Status"
          : view === "service-folders" || view === "service-list"
            ? "Service"
            : "Filters";

  return createPortal(
    <div
      className={`${sheetStyles.backdrop} ${closing ? sheetStyles.backdropClosing : sheetStyles.backdropOpen}`}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <section
        className={`${sheetStyles.panel} ${closing ? sheetStyles.panelClosing : sheetStyles.panelOpen}`}
        role="dialog"
        aria-modal="true"
        aria-label={panelTitle}
      >
        <div className={sheetStyles.goldLine} aria-hidden="true" />

        <header className={sheetStyles.panelHeader}>
          <div className={sheetStyles.panelHeading}>
            <span className={sheetStyles.eyebrow}>FILTERS</span>
            <h2>{panelTitle}</h2>
          </div>

          <button type="button" className={sheetStyles.closeButton} aria-label="Close filters" onClick={requestClose}>
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className={sheetStyles.panelBody}>
          {view === "menu" ? (
            <div className={sheetStyles.menu}>
              <button type="button" className={sheetStyles.menuRow} onClick={() => setView("person")}>
                <span className={sheetStyles.menuIcon}>
                  <UserRound size={18} aria-hidden="true" />
                </span>
                <span className={sheetStyles.menuCopy}>
                  <strong>Person</strong>
                  <small>{personName}</small>
                </span>
                <ChevronRight className={sheetStyles.menuArrow} size={16} aria-hidden="true" />
              </button>

              <button type="button" className={sheetStyles.menuRow} onClick={() => setView("client")}>
                <span className={sheetStyles.menuIcon}>
                  <Building2 size={18} aria-hidden="true" />
                </span>
                <span className={sheetStyles.menuCopy}>
                  <strong>Client</strong>
                  <small>{clientName}</small>
                </span>
                <ChevronRight className={sheetStyles.menuArrow} size={16} aria-hidden="true" />
              </button>

              <button type="button" className={sheetStyles.menuRow} onClick={() => setView("service-folders")}>
                <span className={sheetStyles.menuIcon}>
                  <Package size={18} aria-hidden="true" />
                </span>
                <span className={sheetStyles.menuCopy}>
                  <strong>Service</strong>
                  <small>{serviceName}</small>
                </span>
                <ChevronRight className={sheetStyles.menuArrow} size={16} aria-hidden="true" />
              </button>

              <button type="button" className={sheetStyles.menuRow} onClick={() => setView("status")}>
                <span className={sheetStyles.menuIcon}>
                  <ListChecks size={18} aria-hidden="true" />
                </span>
                <span className={sheetStyles.menuCopy}>
                  <strong>Status</strong>
                  <small>{statusName}</small>
                </span>
                <ChevronRight className={sheetStyles.menuArrow} size={16} aria-hidden="true" />
              </button>

              <button
                type="button"
                className={sheetStyles.menuRow}
                aria-pressed={unansweredOnly}
                disabled={!responseStatesAvailable}
                onClick={() => onUnansweredOnlyChange(!unansweredOnly)}
              >
                <span className={sheetStyles.menuIcon}>
                  <BellRing size={18} aria-hidden="true" />
                </span>
                <span className={sheetStyles.menuCopy}>
                  <strong>Unanswered</strong>
                  <small>{unansweredOnly ? "On" : "Off"}</small>
                </span>
                {unansweredOnly ? <Check size={16} aria-hidden="true" /> : null}
              </button>
            </div>
          ) : null}

          {view === "person" ? (
            <div className={sheetStyles.subView}>
              <button type="button" className={sheetStyles.backButton} onClick={backToMenu}>
                <ArrowLeft size={15} aria-hidden="true" />
                Filters
              </button>

              <SimpleFilterContent
                fixedOptions={[
                  { id: "all", label: "Everyone", icon: <UserRound size={16} aria-hidden="true" /> },
                  { id: "unassigned", label: "Unassigned", icon: <UserRound size={16} aria-hidden="true" /> },
                ]}
                options={personOptions}
                value={personFilter}
                searchPlaceholder="Search people..."
                onSelect={(id) => {
                  onPersonFilterChange(id);
                  backToMenu();
                }}
              />
            </div>
          ) : null}

          {view === "client" ? (
            <div className={sheetStyles.subView}>
              <button type="button" className={sheetStyles.backButton} onClick={backToMenu}>
                <ArrowLeft size={15} aria-hidden="true" />
                Filters
              </button>

              <SimpleFilterContent
                fixedOptions={[{ id: "all", label: "All clients", icon: <Building2 size={16} aria-hidden="true" /> }]}
                options={clientOptions}
                value={clientFilter}
                searchPlaceholder="Search clients..."
                onSelect={(id) => {
                  onClientFilterChange(id);
                  backToMenu();
                }}
              />
            </div>
          ) : null}

          {view === "status" ? (
            <div className={sheetStyles.subView}>
              <button type="button" className={sheetStyles.backButton} onClick={backToMenu}>
                <ArrowLeft size={15} aria-hidden="true" />
                Filters
              </button>

              <SimpleFilterContent
                fixedOptions={[{ id: "all", label: "All statuses", icon: <ListChecks size={16} aria-hidden="true" /> }]}
                options={statusOptions}
                value={statusFilter}
                searchPlaceholder="Search statuses..."
                onSelect={(id) => {
                  onStatusFilterChange(id as ProjectTab);
                  backToMenu();
                }}
              />
            </div>
          ) : null}

          {view === "service-folders" ? (
            <div className={sheetStyles.subView}>
              <button type="button" className={sheetStyles.backButton} onClick={backToMenu}>
                <ArrowLeft size={15} aria-hidden="true" />
                Filters
              </button>

              <p className={sheetStyles.subCopy}>Choose a service folder.</p>

              <FilterOptionList
                options={[
                  { id: "all", label: "All services", icon: <Package size={16} aria-hidden="true" /> },
                  ...picker.availableFolders.map((folder): FilterOptionRow => {
                    const count = picker.folderCounts.get(folder.id) ?? 0;
                    return {
                      id: folder.id,
                      label: folder.name,
                      sublabel: `${count} ${count === 1 ? "service" : "services"}`,
                      icon: <Folder size={16} aria-hidden="true" />,
                    };
                  }),
                ]}
                selectedId={serviceFilter}
                onSelect={(id) => {
                  if (id === "all") {
                    onServiceFilterChange("all");
                    backToMenu();
                    return;
                  }
                  picker.openFolder(id);
                  setView("service-list");
                }}
              />
            </div>
          ) : null}

          {view === "service-list" ? (
            <div className={sheetStyles.subView}>
              <button
                type="button"
                className={sheetStyles.backButton}
                onClick={() => {
                  picker.changeFolder();
                  setView("service-folders");
                }}
              >
                <ArrowLeft size={15} aria-hidden="true" />
                Change folder
              </button>

              <FilterSearchBox
                value={picker.serviceQuery}
                onChange={picker.setServiceQuery}
                placeholder={`Search ${picker.selectedFolder?.name ?? ""} services...`}
              />

              <div className={styles.breadcrumb}>
                <Folder size={12} aria-hidden="true" />
                {picker.selectedFolder?.name}
              </div>

              <FilterOptionList
                options={picker.folderServices.map((service): FilterOptionRow => {
                  const Icon = iconByServiceId.get(service.id) ?? Package;
                  return {
                    id: service.id,
                    label: service.name,
                    sublabel: picker.selectedFolder?.name,
                    icon: <Icon size={16} aria-hidden="true" />,
                  };
                })}
                selectedId={serviceFilter}
                onSelect={(id) => {
                  onServiceFilterChange(id);
                  backToMenu();
                }}
                emptyMessage="No service found in this folder."
              />
            </div>
          ) : null}
        </div>

        {view === "menu" ? (
          <footer className={styles.sheetFooter}>
            <button type="button" className={styles.clearButton} onClick={onClear}>
              Clear filters
            </button>
            <button type="button" className={styles.applyButton} onClick={requestClose}>
              Apply filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
            </button>
          </footer>
        ) : null}
      </section>
    </div>,
    document.body,
  );
}
