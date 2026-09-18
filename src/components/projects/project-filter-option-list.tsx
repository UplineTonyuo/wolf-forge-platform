"use client";

import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { projectInitials } from "../../domain/orders/projections";
import { AccountAvatar } from "../ui/account-avatar";
import sheetStyles from "./project-detail-actions.module.css";

export type FilterOptionRow = {
  id: string;
  label: string;
  sublabel?: string;
  /** Rendered inside the round `.optionAvatar` slot. Omit when `status` or
   * `avatarUrl` is set. */
  icon?: ReactNode;
  /** Order status this row represents, e.g. "working". Draws the existing
   * status-dot + tinted-selection treatment (`data-status` + `.statusDot`,
   * see `ProjectDetailActions`'s status picker) instead of an avatar icon. */
  status?: string;
  /**
   * Set (even to `null`) for a row that represents a real person, so it
   * draws the same photo-or-initials identity already used for assignees in
   * `OrderHeaderControls` (`AccountAvatar` + `projectInitials`) instead of a
   * generic icon. Leave unset for non-person rows like "Everyone"/"Unassigned".
   */
  avatarUrl?: string | null;
};

/**
 * The single option-row list used by every Wolf Forge Projects filter
 * selector (Person, Client, Status, and each level of Service's folder ->
 * service flow) on both desktop and mobile. Reuses the exact row markup
 * already shipped in `ProjectDetailActions` (`project-detail-actions.module.css`)
 * so every picker looks and behaves the same way.
 */
export function FilterOptionList({
  options,
  selectedId,
  onSelect,
  emptyMessage = "No matches found.",
}: {
  options: FilterOptionRow[];
  selectedId: string;
  onSelect: (id: string) => void;
  emptyMessage?: string;
}) {
  if (options.length === 0) {
    return (
      <div className={sheetStyles.optionList} style={{ minHeight: 0 }}>
        <p className={sheetStyles.subCopy}>{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className={sheetStyles.optionList} style={{ minHeight: 0 }}>
      {options.map((option) => {
        const selected = option.id === selectedId;

        return (
          <button
            key={option.id}
            type="button"
            data-status={option.status}
            className={selected ? `${sheetStyles.optionRow} ${sheetStyles.optionSelected}` : sheetStyles.optionRow}
            onClick={() => onSelect(option.id)}
          >
            {option.status ? (
              <span className={sheetStyles.statusDot} aria-hidden="true" />
            ) : option.avatarUrl !== undefined ? (
              <AccountAvatar
                avatarUrl={option.avatarUrl}
                size={31}
                shape="rounded"
                fallback={
                  <span style={{ color: "var(--wf-navy)", fontSize: 11, fontWeight: 700, letterSpacing: "0.01em" }}>
                    {projectInitials(option.label)}
                  </span>
                }
              />
            ) : (
              <span className={sheetStyles.optionAvatar}>{option.icon}</span>
            )}
            <span className={sheetStyles.optionCopy}>
              <strong>{option.label}</strong>
              {option.sublabel ? <small>{option.sublabel}</small> : null}
            </span>
            {selected ? <Check size={16} aria-hidden="true" /> : null}
          </button>
        );
      })}
    </div>
  );
}
