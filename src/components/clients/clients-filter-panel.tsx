"use client";

import {
  CalendarDays,
  Check,
  ChevronDown,
  Clock3,
  ListFilter,
  Rows3,
  Search,
  SlidersHorizontal,
  Target,
  UserRound,
  X,
} from "lucide-react";
import {
  FormEvent,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import {
  usePathname,
  useRouter,
  useSearchParams,
} from "next/navigation";
import styles from "./clients-filter-panel.module.css";

type FilterDraft = {
  search: string;
  status: string;
  manager: string;
  pipeline: string;
  created: string;
  updated: string;
  rows: string;
};

type Option = {
  value: string;
  label: string;
};

type FilterSelectProps = {
  icon: ReactNode;
  label: string;
  value: string;
  placeholder: string;
  options: Option[];
  open: boolean;
  onToggle: () => void;
  onChange: (value: string) => void;
};

const defaults: FilterDraft = {
  search: "",
  status: "",
  manager: "",
  pipeline: "",
  created: "",
  updated: "",
  rows: "25",
};

const typeOptions: Option[] = [
  { value: "", label: "All" },
  { value: "contact", label: "Contact" },
  { value: "lead", label: "Lead" },
  { value: "client", label: "Client" },
  {
    value: "client_team",
    label: "Client Team",
  },
];

const managerOptions: Option[] = [
  {
    value: "",
    label: "All assigned managers",
  },
  {
    value: "assigned",
    label: "Assigned",
  },
  {
    value: "unassigned",
    label: "Unassigned",
  },
];

const pipelineOptions: Option[] = [
  {
    value: "",
    label: "All pipeline stages",
  },
  {
    value: "new",
    label: "New",
  },
  {
    value: "working",
    label: "Working",
  },
  {
    value: "qualified",
    label: "Qualified",
  },
  {
    value: "proposal",
    label: "Proposal",
  },
  {
    value: "won",
    label: "Won",
  },
  {
    value: "lost",
    label: "Lost",
  },
];

const dateOptions: Option[] = [
  {
    value: "",
    label: "Any time",
  },
  {
    value: "today",
    label: "Today",
  },
  {
    value: "7d",
    label: "Last 7 days",
  },
  {
    value: "30d",
    label: "Last 30 days",
  },
  {
    value: "90d",
    label: "Last 90 days",
  },
];

const rowsOptions: Option[] = [
  {
    value: "10",
    label: "10 rows",
  },
  {
    value: "25",
    label: "25 rows",
  },
  {
    value: "50",
    label: "50 rows",
  },
  {
    value: "100",
    label: "100 rows",
  },
];

function FilterSelect({
  icon,
  label,
  value,
  placeholder,
  options,
  open,
  onToggle,
  onChange,
}: FilterSelectProps) {
  const selected =
    options.find(
      (option) =>
        option.value === value,
    )?.label ?? placeholder;

  return (
    <div
      className={
        open
          ? `${styles.selectShell} ${styles.selectShellOpen}`
          : styles.selectShell
      }
    >
      <button
        type="button"
        className={styles.selectTrigger}
        aria-expanded={open}
        onClick={onToggle}
      >
        <span
          className={styles.selectIcon}
          aria-hidden="true"
        >
          {icon}
        </span>

        <span className={styles.selectCopy}>
          <span className={styles.selectLabel}>
            {label}
          </span>

          <span className={styles.selectValue}>
            {selected}
          </span>
        </span>

        <span
          className={styles.chevron}
          aria-hidden="true"
        >
          <ChevronDown size={16} />
        </span>
      </button>

      <div
        className={
          open
            ? `${styles.optionTray} ${styles.optionTrayOpen}`
            : styles.optionTray
        }
        aria-hidden={!open}
      >
        <div className={styles.optionTrayInner}>
          {options.map((option) => {
            const selectedOption =
              option.value === value;

            return (
              <button
                key={
                  option.value ||
                  "__all"
                }
                type="button"
                className={
                  selectedOption
                    ? `${styles.option} ${styles.optionSelected}`
                    : styles.option
                }
                onClick={() => {
                  onChange(option.value);
                }}
              >
                <span>
                  {option.label}
                </span>

                <span
                  className={styles.optionCheck}
                  aria-hidden="true"
                >
                  {selectedOption ? (
                    <Check size={14} />
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/*
 * The panel is a bottom sheet at <=640px -- the width at which `.panel`
 * switches to `position: fixed`. Above that it is an absolutely positioned
 * popover anchored to its own trigger, so it has to stay where it is.
 *
 * Below it the panel must LEAVE the route subtree. `.workspace-route-stage`
 * carries a transform and `will-change: transform` for the route transition,
 * which makes it the containing block for fixed descendants: the sheet
 * anchors to the page column rather than the viewport and renders off the
 * top of the screen. Portalling to <body> is the same fix
 * ProjectsFilterSheet already uses for its own mobile sheet.
 */
const sheetQuery = "(max-width: 640px)";

function subscribeToSheet(onChange: () => void) {
  const list = window.matchMedia(sheetQuery);
  list.addEventListener("change", onChange);
  return () => list.removeEventListener("change", onChange);
}

function readSheet() {
  return window.matchMedia(sheetQuery).matches;
}

export function ClientsFilterPanel({
  initialQuery,
  initialStatus,
}: {
  initialQuery: string;
  initialStatus: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams =
    useSearchParams();

  const rootRef =
    useRef<HTMLDivElement>(null);

  const panelRef =
    useRef<HTMLDivElement>(null);

  const sheet =
    useSyncExternalStore(
      subscribeToSheet,
      readSheet,
      () => false,
    );

  const currentQuery =
    searchParams.get("q")?.trim() ??
    initialQuery.trim();

  const currentStatus =
    searchParams.get("status") ??
    initialStatus;

  const [open, setOpen] =
    useState(false);

  const [
    openSelect,
    setOpenSelect,
  ] = useState<string | null>(null);

  const [draft, setDraft] =
    useState<FilterDraft>({
      ...defaults,
      search: currentQuery,
      status: currentStatus,
    });

  const [
    lastCurrentQuery,
    setLastCurrentQuery,
  ] = useState(currentQuery);

  const [
    lastCurrentStatus,
    setLastCurrentStatus,
  ] = useState(currentStatus);

  if (
    lastCurrentQuery !==
    currentQuery
  ) {
    setLastCurrentQuery(
      currentQuery,
    );
    setDraft((current) => ({
      ...current,
      search: currentQuery,
    }));
  }

  if (
    lastCurrentStatus !==
    currentStatus
  ) {
    setLastCurrentStatus(
      currentStatus,
    );
    setDraft((current) => ({
      ...current,
      status: currentStatus,
    }));
  }

  const closePanel =
    useCallback(() => {
      setOpenSelect(null);
      setOpen(false);
    }, []);

  useEffect(() => {
    if (!open) {
      return;
    }

    function outside(
      event: MouseEvent,
    ) {
      const target =
        event.target as Node;

      if (
        rootRef.current &&
        !rootRef.current.contains(
          target,
        ) &&
        !panelRef.current?.contains(
          target,
        )
      ) {
        closePanel();
      }
    }

    function escape(
      event: KeyboardEvent,
    ) {
      if (event.key === "Escape") {
        if (openSelect) {
          setOpenSelect(null);
        } else {
          closePanel();
        }
      }
    }

    document.addEventListener(
      "mousedown",
      outside,
    );

    document.addEventListener(
      "keydown",
      escape,
    );

    return () => {
      document.removeEventListener(
        "mousedown",
        outside,
      );

      document.removeEventListener(
        "keydown",
        escape,
      );
    };
  }, [
    closePanel,
    open,
    openSelect,
  ]);

  const activeCount =
    useMemo(() => {
      let count = 0;

      if (draft.search.trim()) {
        count += 1;
      }

      if (draft.status) {
        count += 1;
      }

      if (draft.manager) {
        count += 1;
      }

      if (draft.pipeline) {
        count += 1;
      }

      if (draft.created) {
        count += 1;
      }

      if (draft.updated) {
        count += 1;
      }

      if (
        draft.rows !==
        defaults.rows
      ) {
        count += 1;
      }

      return count;
    }, [draft]);

  function update<
    K extends keyof FilterDraft,
  >(
    key: K,
    value: FilterDraft[K],
  ) {
    setDraft((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function toggleSelect(
    name: string,
  ) {
    setOpenSelect((current) =>
      current === name
        ? null
        : name,
    );
  }

  function apply(
    event?: FormEvent,
  ) {
    event?.preventDefault();

    const next =
      new URLSearchParams(
        searchParams.toString(),
      );

    const search =
      draft.search.trim();

    if (search) {
      next.set("q", search);
    } else {
      next.delete("q");
    }

    if (draft.status) {
      next.set("status", draft.status);
    } else {
      next.delete("status");
    }

    /*
     * Search and Type both reuse the Clients page's existing
     * `status`/`q` URL filters -- the same values and semantics the
     * status tabs used, not a second filter vocabulary.
     *
     * The remaining advanced controls are intentionally frontend-ready
     * only until their authoritative backend fields are connected.
     */

    closePanel();

    const query =
      next.toString();

    router.push(
      query
        ? `${pathname}?${query}`
        : pathname,
    );
  }

  function reset() {
    setDraft({
      ...defaults,
      search: "",
    });

    setOpenSelect(null);
  }

  /*
   * Identity above the sheet breakpoint, a portal to <body> below it. Kept as
   * a wrapper rather than a branch so the panel markup stays in one place.
   */
  const panelLayer = (node: ReactNode) =>
    sheet ? createPortal(node, document.body) : node;

  return (
    <div
      className={styles.root}
      ref={rootRef}
    >
      <button
        type="button"
        className={
          open
            ? `${styles.trigger} ${styles.triggerOpen}`
            : styles.trigger
        }
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          if (open) {
            closePanel();
          } else {
            setOpen(true);
          }
        }}
      >
        <SlidersHorizontal
          size={16}
          aria-hidden="true"
        />

        <span>Filter</span>

        {activeCount > 0 ? (
          <span
            className={styles.badge}
          >
            {activeCount}
          </span>
        ) : null}
      </button>

      {panelLayer(
        <div
          ref={panelRef}
          className={
            open
              ? `${styles.panel} ${styles.panelOpen}`
              : styles.panel
          }
          role="dialog"
          aria-label="Filter clients"
          aria-hidden={!open}
        >
        <div
          className={styles.topAccent}
          aria-hidden="true"
        />

        <header
          className={styles.header}
        >
          <div>
            <span
              className={styles.eyebrow}
            >
              CLIENT DIRECTORY
            </span>

            <h3>
              Filter clients
            </h3>

            <p>
              Refine the current
              workspace view.
            </p>
          </div>

          <button
            type="button"
            className={styles.close}
            aria-label="Close filter"
            onClick={closePanel}
          >
            <X size={17} />
          </button>
        </header>

        <div
          className={styles.actionBar}
        >
          <button
            type="button"
            className={styles.reset}
            onClick={reset}
          >
            Reset
          </button>

          <button
            type="button"
            className={styles.apply}
            onClick={() => apply()}
          >
            Apply filter
          </button>
        </div>

        <form
          className={styles.body}
          onSubmit={apply}
        >
          <div
            className={`${styles.field} ${styles.searchField}`}
          >
            <label
              htmlFor="wf-client-filter-search"
            >
              <Search size={14} />

              <span>
                Search clients
              </span>
            </label>

            <div
              className={styles.searchBox}
            >
              <Search
                size={17}
                aria-hidden="true"
              />

              <input
                id="wf-client-filter-search"
                value={draft.search}
                placeholder="Name, company, email, or status"
                autoComplete="off"
                onChange={(event) =>
                  update(
                    "search",
                    event.target.value,
                  )
                }
              />
            </div>
          </div>

          <div className={styles.field}>
            <FilterSelect
              icon={
                <ListFilter
                  size={17}
                />
              }
              label="Type"
              value={draft.status}
              placeholder="All"
              options={typeOptions}
              open={
                openSelect ===
                "status"
              }
              onToggle={() =>
                toggleSelect(
                  "status",
                )
              }
              onChange={(value) => {
                update(
                  "status",
                  value,
                );
                setOpenSelect(null);
              }}
            />
          </div>

          <div className={styles.field}>
            <FilterSelect
              icon={
                <UserRound
                  size={17}
                />
              }
              label="Assigned manager"
              value={draft.manager}
              placeholder="All assigned managers"
              options={managerOptions}
              open={
                openSelect ===
                "manager"
              }
              onToggle={() =>
                toggleSelect(
                  "manager",
                )
              }
              onChange={(value) => {
                update(
                  "manager",
                  value,
                );
                setOpenSelect(null);
              }}
            />
          </div>

          <div className={styles.field}>
            <FilterSelect
              icon={
                <Target size={17} />
              }
              label="Pipeline stage"
              value={draft.pipeline}
              placeholder="All pipeline stages"
              options={pipelineOptions}
              open={
                openSelect ===
                "pipeline"
              }
              onToggle={() =>
                toggleSelect(
                  "pipeline",
                )
              }
              onChange={(value) => {
                update(
                  "pipeline",
                  value,
                );
                setOpenSelect(null);
              }}
            />
          </div>

          <div className={styles.field}>
            <FilterSelect
              icon={
                <CalendarDays
                  size={17}
                />
              }
              label="Created date"
              value={draft.created}
              placeholder="Any time"
              options={dateOptions}
              open={
                openSelect ===
                "created"
              }
              onToggle={() =>
                toggleSelect(
                  "created",
                )
              }
              onChange={(value) => {
                update(
                  "created",
                  value,
                );
                setOpenSelect(null);
              }}
            />
          </div>

          <div className={styles.field}>
            <FilterSelect
              icon={
                <Clock3 size={17} />
              }
              label="Updated date"
              value={draft.updated}
              placeholder="Any time"
              options={dateOptions}
              open={
                openSelect ===
                "updated"
              }
              onToggle={() =>
                toggleSelect(
                  "updated",
                )
              }
              onChange={(value) => {
                update(
                  "updated",
                  value,
                );
                setOpenSelect(null);
              }}
            />
          </div>

          <div className={styles.field}>
            <FilterSelect
              icon={
                <Rows3 size={17} />
              }
              label="Rows per page"
              value={draft.rows}
              placeholder="25 rows"
              options={rowsOptions}
              open={
                openSelect ===
                "rows"
              }
              onToggle={() =>
                toggleSelect(
                  "rows",
                )
              }
              onChange={(value) => {
                update(
                  "rows",
                  value,
                );
                setOpenSelect(null);
              }}
            />
          </div>

          <button
            type="submit"
            className={styles.hiddenSubmit}
            tabIndex={-1}
            aria-hidden="true"
          >
            Apply
          </button>
        </form>
        </div>
      )}
    </div>
  );
}
