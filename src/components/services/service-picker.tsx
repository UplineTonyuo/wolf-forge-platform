"use client";

import {
  ArrowLeft,
  Check,
  ChevronDown,
  Folder,
  Layers3,
  Package,
  Search,
  X,
} from "lucide-react";
import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  createElement,
  type CSSProperties,
} from "react";
import { SheetFrame } from "../ui/mobile-filter-sheet";
import { formatCurrencyCents } from "../../lib/format";
import { assignServiceIconsById } from "../services/service-icons";
import pickerStyles from "../projects/project-pickers.module.css";
import styles from "../subscriptions/subscription-service-picker.module.css";

export type SubscriptionPickerService = {
  id: string;
  name: string;
  folder_id: string | null;
  sort_order?: number;
  is_active: boolean;
  price?: number;
  currency?: string;
};
export type PickerFolder = { id: string; name: string; sort_order?: number; archived_at?: string | null };

function normalize(value: string) {
  return value.toLocaleLowerCase().trim().replace(/\s+/g, " ");
}

export function ServicePicker({
  folders,
  services,
  value,
  onChange,
  disabled = false,
  error,
  name = "service_id",
  label = "Service",
}: {
  folders: PickerFolder[];
  services: SubscriptionPickerService[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  error?: string;
  name?: string;
  label?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const selectedService = services.find((service) => service.id === value) ?? null;
  const [folderId, setFolderId] = useState(selectedService?.folder_id ?? "");
  const [stage, setStage] = useState<"closed" | "folders" | "services">("closed");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);

  const activeServices = useMemo(
    () => services.filter((service) => service.is_active),
    [services],
  );
  const availableFolders = useMemo(
    () =>
      folders
        .filter((folder) => !folder.archived_at)
        .sort(
          (left, right) =>
            (left.sort_order ?? 0) - (right.sort_order ?? 0) || left.name.localeCompare(right.name),
        ).concat(activeServices.some((service) => !service.folder_id || !folders.some((folder) => folder.id === service.folder_id && !folder.archived_at)) ? [{ id: "unfiled", name: "Unfiled" }] : []),
    [folders, activeServices],
  );
  const selectedFolder = availableFolders.find((folder) => folder.id === folderId) ?? null;
  const serviceIcons = useMemo(
    () =>
      assignServiceIconsById(
        services.map((service) => ({
          id: service.id,
          name: service.name,
          folderId: service.folder_id,
        })),
      ),
    [services],
  );
  const folderServices = useMemo(() => {
    const needle = normalize(deferredQuery);
    return activeServices.filter(
      (service) =>
        (service.folder_id === folderId || (folderId === "unfiled" && !availableFolders.some((folder) => folder.id === service.folder_id))) &&
        (!needle || normalize(service.name).includes(needle)),
    );
  }, [activeServices, deferredQuery, folderId, availableFolders]);

  useEffect(() => {
    if (stage === "services") searchRef.current?.focus();
  }, [stage]);

  function chooseFolder(nextFolderId: string) {
    setFolderId(nextFolderId);
    setQuery("");
    setStage("services");
  }

  const SelectedIcon = selectedService
    ? serviceIcons.get(selectedService.id) ?? Package
    : Package;

  return (
    <div className={pickerStyles.servicePicker} ref={rootRef} onKeyDown={(event) => {
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      const list = (event.target as HTMLElement).closest('[role="listbox"]');
      if (!list) return;
      const options = Array.from(list.querySelectorAll<HTMLButtonElement>('[role="option"]'));
      const index = options.indexOf(event.target as HTMLButtonElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : Math.max(0, Math.min(options.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)));
      event.preventDefault();
      options[next]?.focus();
    }}>
      {name ? <input type="hidden" name={name} value={value} /> : null}

      <div className={pickerStyles.serviceFlow} aria-hidden="true">
        <span className={pickerStyles.flowStep}>
          <span className={pickerStyles.stepNumber}>1</span>
          Folder
        </span>
        <span className={pickerStyles.flowLine} />
        <span
          className={`${pickerStyles.flowStep} ${
            folderId ? pickerStyles.flowStepReady : ""
          }`}
        >
          <span className={pickerStyles.stepNumber}>2</span>
          Service
        </span>
      </div>

      <div className={pickerStyles.picker}>
        <button
          type="button"
          className={`${pickerStyles.pickerTrigger} ${
            stage !== "closed" ? pickerStyles.pickerTriggerOpen : ""
          } ${error ? pickerStyles.pickerInvalid : ""}`}
          aria-expanded={stage !== "closed"}
          aria-haspopup="dialog"
          aria-label={`${label}: ${selectedService?.name ?? "Choose a service"}`}
          disabled={disabled}
          onClick={() => {
            setQuery("");
            setStage((current) => (current === "closed" ? "folders" : "closed"));
          }}
        >
          <span
            className={pickerStyles.primaryIcon}
            data-service-icon={SelectedIcon.displayName ?? SelectedIcon.name}
          >
            {createElement(SelectedIcon, { size: 17, "aria-hidden": true })}
          </span>
          <span className={pickerStyles.triggerCopy}>
            <small>{label}</small>
            <strong>{selectedService?.name ?? "Choose a service"}</strong>
          </span>
          <ChevronDown
            className={
              stage !== "closed" ? pickerStyles.chevronOpen : pickerStyles.chevron
            }
            size={17}
            aria-hidden="true"
          />
        </button>

        <SheetFrame open={stage !== "closed"} onClose={() => setStage("closed")} label="Choose a service" eyebrow="SERVICE" closeLabel="Close service picker">

          {stage === "folders" ? (
            <>
              <div className={pickerStyles.panelTitle}>
                <Layers3 size={15} aria-hidden="true" />
                <div>
                  <strong>Choose a service folder</strong>
                  <span>Services will be narrowed to this folder.</span>
                </div>
              </div>
              <div className={pickerStyles.resultList} role="listbox" aria-label="Service folders">
                {availableFolders.map((folder, index) => {
                  const selected = folder.id === folderId;
                  const count = activeServices.filter(
                    (service) => service.folder_id === folder.id,
                  ).length;
                  return (
                    <button
                      key={folder.id}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      className={`${pickerStyles.resultRow} ${
                        selected ? pickerStyles.resultRowSelected : ""
                      }`}
                      style={{ "--row-index": index } as CSSProperties}
                      onClick={() => chooseFolder(folder.id)}
                    >
                      <span className={pickerStyles.rowIcon}>
                        <Folder size={16} aria-hidden="true" />
                      </span>
                      <span className={pickerStyles.rowCopy}>
                        <strong>{folder.name}</strong>
                        <small>{count} {count === 1 ? "service" : "services"}</small>
                      </span>
                      <span className={pickerStyles.rowCheck}>
                        {selected ? <Check size={15} aria-hidden="true" /> : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          ) : stage === "services" ? (
            <>
              <div className={pickerStyles.searchHeader}>
                <button
                  type="button"
                  className={styles.changeFolder}
                  onClick={() => {
                    setQuery("");
                    setStage("folders");
                  }}
                >
                  <ArrowLeft size={14} aria-hidden="true" />
                  Change folder
                </button>
                <div className={pickerStyles.searchBox}>
                  <Search size={17} aria-hidden="true" />
                  <input
                    ref={searchRef}
                    value={query}
                    placeholder={`Search ${selectedFolder?.name ?? "folder"} services...`}
                    aria-label="Search services in selected folder"
                    autoComplete="off"
                    onChange={(event) => setQuery(event.currentTarget.value)}
                  />
                  {query ? (
                    <button type="button" aria-label="Clear service search" onClick={() => setQuery("")}>
                      <X size={15} aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
                <div className={pickerStyles.searchMeta}>
                  <Folder size={13} aria-hidden="true" />
                  <span>{selectedFolder?.name}</span>
                </div>
              </div>
              <div className={pickerStyles.resultList} role="listbox" aria-label="Services">
                {folderServices.length ? (
                  folderServices.map((service, index) => {
                    const selected = service.id === value;
                    const ServiceIcon = serviceIcons.get(service.id) ?? Package;
                    return (
                      <button
                        key={service.id}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        className={`${pickerStyles.resultRow} ${
                          selected ? pickerStyles.resultRowSelected : ""
                        }`}
                        style={{ "--row-index": index } as CSSProperties}
                        onClick={() => {
                          onChange(service.id);
                          setQuery("");
                          setStage("closed");
                        }}
                      >
                        <span
                          className={pickerStyles.rowIcon}
                          data-service-icon={ServiceIcon.displayName ?? ServiceIcon.name}
                        >
                          {createElement(ServiceIcon, { size: 16, "aria-hidden": true })}
                        </span>
                        <span className={pickerStyles.rowCopy}>
                          <strong>{service.name}</strong>
                          <small>{selectedFolder?.name}{service.price !== undefined && service.currency ? ` · ${formatCurrencyCents(Math.round(service.price * 100), service.currency)}` : ""}</small>
                        </span>
                        <span className={pickerStyles.rowCheck}>
                          {selected ? <Check size={15} aria-hidden="true" /> : null}
                        </span>
                      </button>
                    );
                  })
                ) : (
                  <div className={pickerStyles.emptyResults}>
                    <Package size={18} aria-hidden="true" />
                    <strong>No service found</strong>
                    <span>Try another search inside this folder.</span>
                  </div>
                )}
              </div>
            </>
          ) : null}
        </SheetFrame>
      </div>

      {error ? <p className="field-error">{error}</p> : null}
    </div>
  );
}
