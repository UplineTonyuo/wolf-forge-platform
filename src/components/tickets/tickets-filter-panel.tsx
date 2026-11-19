"use client";

import { Flag, Inbox, ListChecks, X } from "lucide-react";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { ticketPriorityOptions, ticketStatusOptions } from "../../lib/tickets/presentation";
import { FilterOptionList, type FilterOptionRow } from "../projects/project-filter-option-list";
import { useWorkflowLabels } from "../settings/workflow-labels";
import { useExitTransition } from "../team/use-exit-transition";
import sheetStyles from "../projects/project-detail-actions.module.css";
import footerStyles from "../projects/projects-filter-sheet.module.css";
import styles from "./tickets.module.css";

const CLOSE_DURATION_MS = 190;

/**
 * Inbox membership is read from the one canonical column, `inbox_added_at` --
 * the same field behind the In Inbox label, Add to Ticket conversation and the
 * Inbox's own visibility. "Not in Inbox" is therefore `null`, not a second
 * flag, and nothing here writes membership.
 */
export type InboxFilter = "all" | "in" | "out";

export const inboxFilterOptions: Array<[InboxFilter, string]> = [
  ["all", "All Tickets"],
  ["in", "In Inbox"],
  ["out", "Not in Inbox"],
];

/**
 * The three Ticket filter groups, rendered from the same option rows every
 * Projects filter uses (check mark, tinted selection). Shared by the desktop
 * anchored panel and the mobile sheet so both surfaces run the same
 * selections, and none of them is a per-filter dropdown of its own.
 */
function TicketFilterSections({
  status,
  priority,
  inbox,
  onStatusChange,
  onPriorityChange,
  onInboxChange,
}: {
  status: string;
  priority: string;
  inbox: InboxFilter;
  onStatusChange: (value: string) => void;
  onPriorityChange: (value: string) => void;
  onInboxChange: (value: InboxFilter) => void;
}) {
  const workspaceStatuses = useWorkflowLabels("tickets");
  const statuses = workspaceStatuses.length ? workspaceStatuses : ticketStatusOptions.map(([key, name]) => ({ key, name }));
  const statusRows: FilterOptionRow[] = [
    { id: "all", label: "All statuses", icon: <ListChecks size={16} aria-hidden="true" /> },
    ...statuses.map(({ key, name }) => ({
      id: key,
      label: name,
      icon: <ListChecks size={16} aria-hidden="true" />,
    })),
  ];

  const priorityRows: FilterOptionRow[] = [
    { id: "all", label: "All priorities", icon: <Flag size={16} aria-hidden="true" /> },
    ...ticketPriorityOptions.map(([value, label]) => ({
      id: value,
      label,
      icon: <Flag size={16} aria-hidden="true" />,
    })),
  ];

  const inboxRows: FilterOptionRow[] = inboxFilterOptions.map(([value, label]) => ({
    id: value,
    label,
    icon: <Inbox size={16} aria-hidden="true" />,
  }));

  return (
    <>
      <div className={styles.filterSection}>
        <span className={styles.filterSectionLabel}>Status</span>
        <FilterOptionList options={statusRows} selectedId={status} onSelect={onStatusChange} />
      </div>

      <div className={styles.filterSection}>
        <span className={styles.filterSectionLabel}>Priority</span>
        <FilterOptionList options={priorityRows} selectedId={priority} onSelect={onPriorityChange} />
      </div>

      <div className={styles.filterSection}>
        <span className={styles.filterSectionLabel}>Inbox</span>
        <FilterOptionList
          options={inboxRows}
          selectedId={inbox}
          onSelect={(id) => onInboxChange(id as InboxFilter)}
        />
      </div>
    </>
  );
}

/**
 * The desktop anchored panel behind the toolbar's Filter button. Selections
 * apply live, exactly as they do in the Projects filter panel; "Apply filters"
 * then only closes it. "Clear filters" resets the three groups and is scoped
 * away from the Ticket search on purpose.
 */
export function TicketsFilterPanel({
  status,
  priority,
  inbox,
  onStatusChange,
  onPriorityChange,
  onInboxChange,
  onClear,
  onApply,
}: {
  status: string;
  priority: string;
  inbox: InboxFilter;
  onStatusChange: (value: string) => void;
  onPriorityChange: (value: string) => void;
  onInboxChange: (value: InboxFilter) => void;
  onClear: () => void;
  onApply: () => void;
}) {
  return (
    <div className={styles.filterPanel} role="dialog" aria-label="Filters">
      <TicketFilterSections
        status={status}
        priority={priority}
        inbox={inbox}
        onStatusChange={onStatusChange}
        onPriorityChange={onPriorityChange}
        onInboxChange={onInboxChange}
      />

      <div data-call-avoid className={styles.filterPanelFooter}>
        <button type="button" className={styles.filterClearButton} onClick={onClear}>
          Clear filters
        </button>
        <button type="button" className={styles.filterApplyButton} onClick={onApply}>
          Apply filters
        </button>
      </div>
    </div>
  );
}

/**
 * The mobile (<=800px) Filters sheet. Reuses the Projects filter sheet's
 * exact chrome -- backdrop, panel, header, body and its Clear/Apply footer --
 * so mobile is the same bottom sheet the rest of Wolf Forge already opens.
 */
export function TicketsFilterSheet({
  open,
  onClose,
  status,
  priority,
  inbox,
  onStatusChange,
  onPriorityChange,
  onInboxChange,
  onClear,
}: {
  open: boolean;
  onClose: () => void;
  status: string;
  priority: string;
  inbox: InboxFilter;
  onStatusChange: (value: string) => void;
  onPriorityChange: (value: string) => void;
  onInboxChange: (value: InboxFilter) => void;
  onClear: () => void;
}) {
  const { render } = useExitTransition(open, CLOSE_DURATION_MS);
  /* See `ProjectFilterPopover`: `useExitTransition`'s phase also reads
     "closing" during the brief pre-entry window, and these classes start their
     keyframes from fully visible, which flashed on open. */
  const closing = render && !open;

  useEffect(() => {
    if (!render) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [render, onClose]);

  if (!render) return null;

  return createPortal(
    <div
      className={`${sheetStyles.backdrop} ${closing ? sheetStyles.backdropClosing : sheetStyles.backdropOpen}`}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className={`${sheetStyles.panel} ${styles.filterSheet} ${closing ? sheetStyles.panelClosing : sheetStyles.panelOpen}`}
        role="dialog"
        aria-modal="true"
        aria-label="Filters"
      >
        <div className={sheetStyles.goldLine} aria-hidden="true" />

        <header className={sheetStyles.panelHeader}>
          <div className={sheetStyles.panelHeading}>
            <span className={sheetStyles.eyebrow}>FILTERS</span>
            <h2>Filters</h2>
          </div>

          <button type="button" className={sheetStyles.closeButton} aria-label="Close filters" onClick={onClose}>
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className={`${sheetStyles.panelBody} ${styles.filterSheetBody}`}>
          <TicketFilterSections
            status={status}
            priority={priority}
            inbox={inbox}
            onStatusChange={onStatusChange}
            onPriorityChange={onPriorityChange}
            onInboxChange={onInboxChange}
          />
        </div>

        <footer className={footerStyles.sheetFooter}>
          <button type="button" className={footerStyles.clearButton} onClick={onClear}>
            Clear filters
          </button>
          <button type="button" className={footerStyles.applyButton} onClick={onClose}>
            Apply filters
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
