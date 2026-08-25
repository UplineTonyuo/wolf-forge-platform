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
import type { ServiceFolderRow } from "../../lib/supabase/database-rows";
import { assignServiceIconsById } from "../services/service-icons";
import pickerStyles from "../projects/project-pickers.module.css";
import styles from "./subscription-service-picker.module.css";

export type SubscriptionPickerService = {
  id: string;
  name: string;
  folder_id: string | null;
  sort_order: number;
  is_active: boolean;
};

function normalize(value: string) {
  return value.toLocaleLowerCase().trim().replace(/\s+/g, " ");
}

export function SubscriptionServicePicker({
  folders,
  services,
  value,
  onChange,
  disabled = false,
  error,
}: {
  folders: ServiceFolderRow[];
  services: SubscriptionPickerService[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  error?: string;
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
            left.sort_order - right.sort_order || left.name.localeCompare(right.name),
        ),
    [folders],
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
        service.folder_id === folderId &&
        (!needle || normalize(service.name).includes(needle)),
    );
  }, [activeServices, deferredQuery, folderId]);

  useEffect(() => {
    if (stage === "services") searchRef.current?.focus();
  }, [stage]);

  useEffect(() => {
    function closeOnOutsideClick(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setStage("closed");
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setStage("closed");
    }

    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  function chooseFolder(nextFolderId: string) {
    setFolderId(nextFolderId);
    if (selectedService?.folder_id !== nextFolderId) onChange("");
    setQuery("");
    setStage("services");
  }

  const SelectedIcon = selectedService
    ? serviceIcons.get(selectedService.id) ?? Package
    : Package;

  return (
    <div className={pickerStyles.servicePicker} ref={rootRef}>
      <input type="hidden" name="service_id" value={value} />

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
          aria-haspopup="listbox"
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
            <small>SERVICE</small>
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

        <div
          className={`${pickerStyles.panel} ${pickerStyles.folderPanel} ${
            stage !== "closed" ? pickerStyles.panelOpen : ""
          }`}
          aria-hidden={stage === "closed"}
        >
          <span className={pickerStyles.panelAccent} />

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
                          <small>{selectedFolder?.name}</small>
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
        </div>
      </div>

      {error ? <p className="field-error">{error}</p> : null}
    </div>
  );
}
