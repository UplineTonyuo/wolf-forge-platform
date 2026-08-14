"use client";

import {
  Building2,
  Check,
  ChevronDown,
  Folder,
  Layers3,
  Package,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type {
  CompanyRow,
  ServiceFolderRow,
  ServiceRow,
} from "../../lib/supabase/database-rows";

import styles from "./project-pickers.module.css";


/* ==========================================================
   SHARED HELPERS
   ========================================================== */

function normalize(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function rankName(
  name: string,
  query: string,
) {
  const normalizedName =
    normalize(name);

  const normalizedQuery =
    normalize(query);

  if (!normalizedQuery) {
    return 100;
  }

  if (
    normalizedName ===
    normalizedQuery
  ) {
    return 0;
  }

  if (
    normalizedName.startsWith(
      normalizedQuery,
    )
  ) {
    return 1;
  }

  const words =
    normalizedName.split(" ");

  if (
    words.some((word) =>
      word.startsWith(
        normalizedQuery,
      ),
    )
  ) {
    return 2;
  }

  const index =
    normalizedName.indexOf(
      normalizedQuery,
    );

  if (index >= 0) {
    return 10 + index;
  }

  return Number.POSITIVE_INFINITY;
}


/* ==========================================================
   CLIENT PICKER
   ========================================================== */

export function ProjectClientPicker({
  clients,
  initialClientId,
  locked,
  error,
}: {
  clients: CompanyRow[];
  initialClientId?: string | null;
  locked: boolean;
  error?: string;
}) {
  const rootRef =
    useRef<HTMLDivElement>(null);

  const searchRef =
    useRef<HTMLInputElement>(null);

  const [
    selectedId,
    setSelectedId,
  ] = useState(
    initialClientId ?? "",
  );

  const [open, setOpen] =
    useState(false);

  const [query, setQuery] =
    useState("");

  const deferredQuery =
    useDeferredValue(query);

  const selectedClient =
    useMemo(
      () =>
        clients.find(
          (client) =>
            client.id ===
            selectedId,
        ) ?? null,
      [clients, selectedId],
    );

  const suggestions =
    useMemo(() => {
      const ranked =
        clients
          .map((client) => ({
            client,
            rank: rankName(
              client.name,
              deferredQuery,
            ),
          }))
          .filter(
            (entry) =>
              Number.isFinite(
                entry.rank,
              ),
          )
          .sort((a, b) => {
            if (
              a.rank !== b.rank
            ) {
              return (
                a.rank - b.rank
              );
            }

            return a.client.name.localeCompare(
              b.client.name,
            );
          });

      /*
       * Never render thousands of DOM rows.
       * Search can operate across the entire array,
       * while the UI displays only the strongest matches.
       */
      return ranked
        .slice(0, 10)
        .map(
          (entry) =>
            entry.client,
        );
    }, [
      clients,
      deferredQuery,
    ]);

  useEffect(() => {
    if (!open) return;

    const timer =
      window.setTimeout(
        () => {
          searchRef.current?.focus();
        },
        90,
      );

    return () =>
      window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    function outside(
      event: MouseEvent,
    ) {
      if (
        rootRef.current &&
        !rootRef.current.contains(
          event.target as Node,
        )
      ) {
        setOpen(false);
      }
    }

    function keyboard(
      event: KeyboardEvent,
    ) {
      if (
        event.key === "Escape"
      ) {
        setOpen(false);
      }
    }

    document.addEventListener(
      "mousedown",
      outside,
    );

    document.addEventListener(
      "keydown",
      keyboard,
    );

    return () => {
      document.removeEventListener(
        "mousedown",
        outside,
      );

      document.removeEventListener(
        "keydown",
        keyboard,
      );
    };
  }, []);

  if (locked) {
    return (
      <div
        className={
          styles.lockedValue
        }
      >
        <span
          className={
            styles.primaryIcon
          }
        >
          <Building2
            size={17}
            aria-hidden="true"
          />
        </span>

        <span>
          <strong>
            {selectedClient?.name ??
              "Unavailable client"}
          </strong>

          <small>
            Client is locked for
            this project.
          </small>
        </span>
      </div>
    );
  }

  return (
    <div
      className={styles.picker}
      ref={rootRef}
    >
      <input
        type="hidden"
        name="company_id"
        value={selectedId}
      />

      <button
        type="button"
        className={`${styles.pickerTrigger} ${
          open
            ? styles.pickerTriggerOpen
            : ""
        } ${
          error
            ? styles.pickerInvalid
            : ""
        }`}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => {
          setOpen(
            (current) =>
              !current,
          );

          if (!open) {
            setQuery("");
          }
        }}
      >
        <span
          className={
            styles.primaryIcon
          }
        >
          <Building2
            size={17}
            aria-hidden="true"
          />
        </span>

        <span
          className={
            styles.triggerCopy
          }
        >
          <small>CLIENT</small>

          <strong>
            {selectedClient?.name ??
              "Search for a client"}
          </strong>
        </span>

        <ChevronDown
          className={
            open
              ? styles.chevronOpen
              : styles.chevron
          }
          size={17}
          aria-hidden="true"
        />
      </button>

      <div
        className={`${styles.panel} ${
          open
            ? styles.panelOpen
            : ""
        }`}
        aria-hidden={!open}
      >
        <div
          className={
            styles.panelAccent
          }
        />

        <div
          className={
            styles.searchHeader
          }
        >
          <div
            className={
              styles.searchBox
            }
          >
            <Search
              size={17}
              aria-hidden="true"
            />

            <input
              ref={searchRef}
              value={query}
              placeholder="Type a client name..."
              autoComplete="off"
              onChange={(event) =>
                setQuery(
                  event.target.value,
                )
              }
            />

            {query ? (
              <button
                type="button"
                aria-label="Clear client search"
                onClick={() =>
                  setQuery("")
                }
              >
                <X
                  size={15}
                  aria-hidden="true"
                />
              </button>
            ) : null}
          </div>

          <div
            className={
              styles.searchMeta
            }
          >
            <Sparkles
              size={13}
              aria-hidden="true"
            />

            <span>
              Best matches appear
              first
            </span>
          </div>
        </div>

        <div
          className={
            styles.resultList
          }
          role="listbox"
        >
          {suggestions.length >
          0 ? (
            suggestions.map(
              (
                client,
                index,
              ) => {
                const selected =
                  client.id ===
                  selectedId;

                return (
                  <button
                    key={
                      client.id
                    }
                    type="button"
                    role="option"
                    aria-selected={
                      selected
                    }
                    className={`${styles.resultRow} ${
                      selected
                        ? styles.resultRowSelected
                        : ""
                    }`}
                    style={{
                      "--row-index":
                        index,
                    } as React.CSSProperties}
                    onClick={() => {
                      setSelectedId(
                        client.id,
                      );

                      setQuery("");
                      setOpen(false);
                    }}
                  >
                    <span
                      className={
                        styles.rowIcon
                      }
                    >
                      <Building2
                        size={16}
                        aria-hidden="true"
                      />
                    </span>

                    <span
                      className={
                        styles.rowCopy
                      }
                    >
                      <strong>
                        {client.name}
                      </strong>

                      <small>
                        Client account
                      </small>
                    </span>

                    <span
                      className={
                        styles.rowCheck
                      }
                    >
                      {selected ? (
                        <Check
                          size={15}
                          aria-hidden="true"
                        />
                      ) : null}
                    </span>
                  </button>
                );
              },
            )
          ) : (
            <div
              className={
                styles.emptyResults
              }
            >
              <Search
                size={18}
                aria-hidden="true"
              />

              <strong>
                No client found
              </strong>

              <span>
                Try another name or
                spelling.
              </span>
            </div>
          )}
        </div>
      </div>

      {error ? (
        <p className="field-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}


/* ==========================================================
   SERVICE PICKER
   ========================================================== */

export function ProjectServicePicker({
  folders,
  services,
  initialServiceId,
  error,
}: {
  folders: ServiceFolderRow[];
  services: ServiceRow[];
  initialServiceId?: string | null;
  error?: string;
}) {
  const rootRef =
    useRef<HTMLDivElement>(null);

  const serviceSearchRef =
    useRef<HTMLInputElement>(null);

  const initialService =
    services.find(
      (service) =>
        service.id ===
        initialServiceId,
    ) ?? null;

  const [
    folderId,
    setFolderId,
  ] = useState(
    initialService?.folder_id ??
      "",
  );

  const [
    selectedServiceId,
    setSelectedServiceId,
  ] = useState(
    initialServiceId ?? "",
  );

  const [
    folderOpen,
    setFolderOpen,
  ] = useState(false);

  const [
    serviceOpen,
    setServiceOpen,
  ] = useState(false);

  const [
    serviceQuery,
    setServiceQuery,
  ] = useState("");

  const deferredServiceQuery =
    useDeferredValue(
      serviceQuery,
    );

  const selectedFolder =
    folders.find(
      (folder) =>
        folder.id === folderId,
    ) ?? null;

  const selectedService =
    services.find(
      (service) =>
        service.id ===
        selectedServiceId,
    ) ?? null;

  const folderServices =
    useMemo(() => {
      if (!folderId) return [];

      const query =
        normalize(
          deferredServiceQuery,
        );

      return services
        .filter(
          (service) =>
            service.folder_id ===
            folderId,
        )
        .map((service) => ({
          service,
          rank: rankName(
            service.name,
            query,
          ),
        }))
        .filter((entry) =>
          Number.isFinite(
            entry.rank,
          ),
        )
        .sort((a, b) => {
          if (
            a.rank !== b.rank
          ) {
            return (
              a.rank - b.rank
            );
          }

          return a.service.name.localeCompare(
            b.service.name,
          );
        })
        .slice(0, 30)
        .map(
          (entry) =>
            entry.service,
        );
    }, [
      services,
      folderId,
      deferredServiceQuery,
    ]);

  const availableFolders =
    useMemo(
      () =>
        folders
          .filter(
            (folder) =>
              !folder.archived_at,
          )
          .sort((a, b) => {
            if (
              a.sort_order !==
              b.sort_order
            ) {
              return (
                a.sort_order -
                b.sort_order
              );
            }

            return a.name.localeCompare(
              b.name,
            );
          }),
      [folders],
    );

  useEffect(() => {
    if (!serviceOpen) return;

    const timer =
      window.setTimeout(
        () =>
          serviceSearchRef.current?.focus(),
        100,
      );

    return () =>
      window.clearTimeout(timer);
  }, [serviceOpen]);

  useEffect(() => {
    function outside(
      event: MouseEvent,
    ) {
      if (
        rootRef.current &&
        !rootRef.current.contains(
          event.target as Node,
        )
      ) {
        setFolderOpen(false);
        setServiceOpen(false);
      }
    }

    function keyboard(
      event: KeyboardEvent,
    ) {
      if (
        event.key === "Escape"
      ) {
        setFolderOpen(false);
        setServiceOpen(false);
      }
    }

    document.addEventListener(
      "mousedown",
      outside,
    );

    document.addEventListener(
      "keydown",
      keyboard,
    );

    return () => {
      document.removeEventListener(
        "mousedown",
        outside,
      );

      document.removeEventListener(
        "keydown",
        keyboard,
      );
    };
  }, []);

  function chooseFolder(
    nextFolderId: string,
  ) {
    setFolderId(
      nextFolderId,
    );

    /*
     * Choosing a different folder invalidates
     * the previous service selection.
     */
    if (
      services.find(
        (service) =>
          service.id ===
          selectedServiceId,
      )?.folder_id !==
      nextFolderId
    ) {
      setSelectedServiceId(
        "",
      );
    }

    setFolderOpen(false);
    setServiceQuery("");

    window.setTimeout(
      () =>
        setServiceOpen(true),
      120,
    );
  }

  return (
    <div
      className={
        styles.servicePicker
      }
      ref={rootRef}
    >
      <input
        type="hidden"
        name="service_id"
        value={selectedServiceId}
      />

      <div
        className={
          styles.serviceFlow
        }
      >
        <div
          className={
            styles.flowStep
          }
        >
          <span
            className={
              styles.stepNumber
            }
          >
            1
          </span>

          <span>
            Folder
          </span>
        </div>

        <span
          className={
            styles.flowLine
          }
        />

        <div
          className={`${styles.flowStep} ${
            folderId
              ? styles.flowStepReady
              : ""
          }`}
        >
          <span
            className={
              styles.stepNumber
            }
          >
            2
          </span>

          <span>
            Service
          </span>
        </div>
      </div>

      <div
        className={
          styles.picker
        }
      >
        <button
          type="button"
          className={`${styles.pickerTrigger} ${
            folderOpen
              ? styles.pickerTriggerOpen
              : ""
          }`}
          aria-expanded={
            folderOpen
          }
          onClick={() => {
            setServiceOpen(false);

            setFolderOpen(
              (current) =>
                !current,
            );
          }}
        >
          <span
            className={
              styles.primaryIcon
            }
          >
            <Folder
              size={17}
              aria-hidden="true"
            />
          </span>

          <span
            className={
              styles.triggerCopy
            }
          >
            <small>
              SERVICE FOLDER
            </small>

            <strong>
              {selectedFolder?.name ??
                "Choose a folder"}
            </strong>
          </span>

          <ChevronDown
            className={
              folderOpen
                ? styles.chevronOpen
                : styles.chevron
            }
            size={17}
            aria-hidden="true"
          />
        </button>

        <div
          className={`${styles.panel} ${styles.folderPanel} ${
            folderOpen
              ? styles.panelOpen
              : ""
          }`}
          aria-hidden={
            !folderOpen
          }
        >
          <div
            className={
              styles.panelAccent
            }
          />

          <div
            className={
              styles.panelTitle
            }
          >
            <Layers3
              size={15}
              aria-hidden="true"
            />

            <div>
              <strong>
                Choose a service folder
              </strong>

              <span>
                Services will be
                narrowed to this
                folder.
              </span>
            </div>
          </div>

          <div
            className={
              styles.resultList
            }
          >
            {availableFolders.map(
              (
                folder,
                index,
              ) => {
                const selected =
                  folder.id ===
                  folderId;

                const count =
                  services.filter(
                    (service) =>
                      service.folder_id ===
                      folder.id,
                  ).length;

                return (
                  <button
                    key={
                      folder.id
                    }
                    type="button"
                    className={`${styles.resultRow} ${
                      selected
                        ? styles.resultRowSelected
                        : ""
                    }`}
                    style={{
                      "--row-index":
                        index,
                    } as React.CSSProperties}
                    onClick={() =>
                      chooseFolder(
                        folder.id,
                      )
                    }
                  >
                    <span
                      className={
                        styles.rowIcon
                      }
                    >
                      <Folder
                        size={16}
                        aria-hidden="true"
                      />
                    </span>

                    <span
                      className={
                        styles.rowCopy
                      }
                    >
                      <strong>
                        {folder.name}
                      </strong>

                      <small>
                        {count}{" "}
                        {count === 1
                          ? "service"
                          : "services"}
                      </small>
                    </span>

                    <span
                      className={
                        styles.rowCheck
                      }
                    >
                      {selected ? (
                        <Check
                          size={15}
                          aria-hidden="true"
                        />
                      ) : null}
                    </span>
                  </button>
                );
              },
            )}
          </div>
        </div>
      </div>

      <div
        className={`${styles.picker} ${styles.serviceStage} ${
          folderId
            ? styles.serviceStageReady
            : ""
        }`}
      >
        <button
          type="button"
          className={`${styles.pickerTrigger} ${
            serviceOpen
              ? styles.pickerTriggerOpen
              : ""
          } ${
            error
              ? styles.pickerInvalid
              : ""
          }`}
          aria-expanded={
            serviceOpen
          }
          disabled={!folderId}
          onClick={() => {
            if (!folderId) return;

            setFolderOpen(false);

            setServiceOpen(
              (current) =>
                !current,
            );

            if (!serviceOpen) {
              setServiceQuery("");
            }
          }}
        >
          <span
            className={
              styles.primaryIcon
            }
          >
            <Package
              size={17}
              aria-hidden="true"
            />
          </span>

          <span
            className={
              styles.triggerCopy
            }
          >
            <small>
              SERVICE
            </small>

            <strong>
              {selectedService?.name ??
                (folderId
                  ? "Choose a service"
                  : "Choose folder first")}
            </strong>
          </span>

          <ChevronDown
            className={
              serviceOpen
                ? styles.chevronOpen
                : styles.chevron
            }
            size={17}
            aria-hidden="true"
          />
        </button>

        <div
          className={`${styles.panel} ${
            serviceOpen
              ? styles.panelOpen
              : ""
          }`}
          aria-hidden={
            !serviceOpen
          }
        >
          <div
            className={
              styles.panelAccent
            }
          />

          <div
            className={
              styles.searchHeader
            }
          >
            <div
              className={
                styles.searchBox
              }
            >
              <Search
                size={17}
                aria-hidden="true"
              />

              <input
                ref={
                  serviceSearchRef
                }
                value={
                  serviceQuery
                }
                placeholder={`Search ${
                  selectedFolder?.name ??
                  ""
                } services...`}
                autoComplete="off"
                onChange={(event) =>
                  setServiceQuery(
                    event.target.value,
                  )
                }
              />

              {serviceQuery ? (
                <button
                  type="button"
                  aria-label="Clear service search"
                  onClick={() =>
                    setServiceQuery(
                      "",
                    )
                  }
                >
                  <X
                    size={15}
                    aria-hidden="true"
                  />
                </button>
              ) : null}
            </div>

            <div
              className={
                styles.searchMeta
              }
            >
              <Folder
                size={13}
                aria-hidden="true"
              />

              <span>
                {selectedFolder?.name}
              </span>
            </div>
          </div>

          <div
            className={
              styles.resultList
            }
          >
            {folderServices.length >
            0 ? (
              folderServices.map(
                (
                  service,
                  index,
                ) => {
                  const selected =
                    service.id ===
                    selectedServiceId;

                  return (
                    <button
                      key={
                        service.id
                      }
                      type="button"
                      className={`${styles.resultRow} ${
                        selected
                          ? styles.resultRowSelected
                          : ""
                      }`}
                      style={{
                        "--row-index":
                          index,
                      } as React.CSSProperties}
                      onClick={() => {
                        setSelectedServiceId(
                          service.id,
                        );

                        setServiceQuery(
                          "",
                        );

                        setServiceOpen(
                          false,
                        );
                      }}
                    >
                      <span
                        className={
                          styles.rowIcon
                        }
                      >
                        <Package
                          size={16}
                          aria-hidden="true"
                        />
                      </span>

                      <span
                        className={
                          styles.rowCopy
                        }
                      >
                        <strong>
                          {service.name}
                        </strong>

                        <small>
                          {
                            selectedFolder?.name
                          }
                        </small>
                      </span>

                      <span
                        className={
                          styles.rowCheck
                        }
                      >
                        {selected ? (
                          <Check
                            size={15}
                            aria-hidden="true"
                          />
                        ) : null}
                      </span>
                    </button>
                  );
                },
              )
            ) : (
              <div
                className={
                  styles.emptyResults
                }
              >
                <Package
                  size={18}
                  aria-hidden="true"
                />

                <strong>
                  No service found
                </strong>

                <span>
                  Try another search
                  inside this folder.
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {error ? (
        <p className="field-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}