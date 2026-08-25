"use client";

import { Building2, Check, ChevronDown, Search, UserRound } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useAnimatedPopover } from "./use-animated-popover";
import styles from "./searchable-select.module.css";

export type SearchableOption = {
  id: string;
  label: string;
  sublabel?: string;
  kind?: "client" | "company";
};

/**
 * Reusable searchable combobox used wherever a form needs to pick one of many
 * existing records by name (companies, services, ...) without a native select.
 *
 * The control is controlled by the parent via `value` (selected id). The parent
 * stays the source of truth so preselection works (e.g. a fixed Service when
 * editing a Subscription). Typing clears the current selection so a stale
 * preselected id can never be submitted silently.
 *
 * When `name` is provided, a hidden input carries the selected id under that
 * name so existing form/server-action submission contracts are preserved.
 */
export function SearchableSelect({
  name,
  label,
  options,
  value = "",
  onChange,
  placeholder,
  disabled = false,
  required = false,
  menuLabel,
  emptyMessage = "No matching options.",
  menuRequiresQuery = false,
  rank,
}: {
  name?: string;
  label: string;
  options: SearchableOption[];
  value?: string;
  onChange?: (id: string) => void;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  menuLabel: string;
  emptyMessage?: string;
  menuRequiresQuery?: boolean;
  rank?: (label: string, query: string) => number;
}) {
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const { render, phase, show, hide } = useAnimatedPopover();
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const isOpen = render && phase === "open";
  const selected = options.find((option) => option.id === value) ?? null;
  const hasQuery = query.trim().length > 0;
  const menuAllowed = !menuRequiresQuery || hasQuery;

  // While not editing, the field always reflects the current selection, so an
  // externally-preselected value (e.g. a fixed Service) is shown for free.
  const inputValue = editing ? query : (selected?.label ?? query);

  const filtered = useMemo(() => {
    const term = query.trim();
    if (!term) return options;

    if (rank) {
      return options
        .map((option) => ({ option, score: rank(option.label, term) }))
        .filter(({ score }) => Number.isFinite(score))
        .sort((left, right) =>
          left.score === right.score
            ? left.option.label.localeCompare(right.option.label)
            : left.score - right.score,
        )
        .map(({ option }) => option);
    }

    const normalizedTerm = term.toLocaleLowerCase();
    return options.filter((option) =>
      option.label.trim().toLocaleLowerCase().includes(normalizedTerm),
    );
  }, [options, query, rank]);

  useEffect(() => {
    if (!isOpen || activeIndex < 0) return;
    menuRef.current
      ?.querySelectorAll<HTMLElement>("[role='option']")
      [activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, isOpen]);

  function selectOption(option: SearchableOption) {
    setQuery(option.label);
    setEditing(false);
    setActiveIndex(-1);
    hide();
    onChange?.(option.id);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (disabled) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!menuAllowed) return;
      if (!render || phase !== "open") {
        show();
        setActiveIndex(0);
        return;
      }
      setActiveIndex((index) => Math.min(index + 1, filtered.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!menuAllowed) return;
      if (!render || phase !== "open") {
        show();
        setActiveIndex(Math.max(filtered.length - 1, 0));
        return;
      }
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Home" && isOpen) {
      event.preventDefault();
      setActiveIndex(filtered.length > 0 ? 0 : -1);
    } else if (event.key === "End" && isOpen) {
      event.preventDefault();
      setActiveIndex(filtered.length - 1);
    } else if (event.key === "Enter") {
      if (isOpen && activeIndex >= 0 && filtered[activeIndex]) {
        event.preventDefault();
        selectOption(filtered[activeIndex]);
      } else if (isOpen) {
        event.preventDefault();
      }
    } else if (event.key === "Escape") {
      if (render) {
        event.preventDefault();
        hide();
        setActiveIndex(-1);
        setEditing(false);
      }
    }
  }

  return (
    <div
      className={styles.root}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) {
          hide();
          setActiveIndex(-1);
        }
      }}
    >
      <div
        className={[
          styles.control,
          render ? styles.controlOpen : "",
          disabled ? styles.controlDisabled : "",
        ]
          .filter(Boolean)
          .join(" ")}
        onMouseDown={(event) => {
          // Only the bare control strip (icons/gutter, not the input) should be
          // treated as a trigger: keep focus so an open menu doesn't flicker.
          if (event.target === event.currentTarget) event.preventDefault();
        }}
        onClick={() => {
          if (!disabled) inputRef.current?.focus();
        }}
      >
        <Search className={styles.searchIcon} aria-hidden="true" />

        <input
          ref={inputRef}
          className={styles.input}
          role="combobox"
          aria-label={label}
          aria-expanded={isOpen}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={
            isOpen && activeIndex >= 0
              ? `${listboxId}-${activeIndex}`
              : undefined
          }
          autoComplete="off"
          spellCheck={false}
          value={inputValue}
          placeholder={placeholder}
          disabled={disabled}
          required={required}
          onFocus={() => {
            if (!disabled && menuAllowed && (!render || phase !== "open")) show();
          }}
          onChange={(event) => {
            const nextQuery = event.currentTarget.value;
            setQuery(nextQuery);
            setEditing(true);
            setActiveIndex(-1);
            if (menuRequiresQuery && !nextQuery.trim()) hide();
            else if (!render || phase !== "open") show();
            if (value) onChange?.("");
          }}
          onKeyDown={handleKeyDown}
        />

        {value ? (
          <Check className={styles.selectedIcon} aria-hidden="true" />
        ) : (
          <ChevronDown className={styles.chevron} aria-hidden="true" />
        )}

        {name ? <input type="hidden" name={name} value={value} /> : null}
      </div>

      {render && menuAllowed && !disabled ? (
        <div
          ref={menuRef}
          className={
            isOpen
              ? `${styles.menu} ${styles.menuOpen}`
              : `${styles.menu} ${styles.menuClosing}`
          }
          role="listbox"
          id={listboxId}
          aria-label={menuLabel}
          aria-hidden={!isOpen}
        >
          {filtered.length > 0 ? (
            filtered.map((option, index) => (
              <button
                type="button"
                role="option"
                id={`${listboxId}-${index}`}
                tabIndex={-1}
                aria-selected={option.id === value}
                className={
                  index === activeIndex
                    ? `${styles.option} ${styles.optionActive}`
                    : styles.option
                }
                key={option.id}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectOption(option)}
              >
                <span className={styles.optionIdentity}>
                  {option.kind ? (
                    <span
                      className={styles.optionKindIcon}
                      data-record-kind={option.kind}
                    >
                      {option.kind === "company" ? (
                        <Building2 size={15} aria-hidden="true" />
                      ) : (
                        <UserRound size={15} aria-hidden="true" />
                      )}
                    </span>
                  ) : null}
                  <span className={styles.optionLabel}>{option.label}</span>
                </span>

                {option.sublabel ? (
                  <span className={styles.optionSub}>{option.sublabel}</span>
                ) : null}
              </button>
            ))
          ) : (
            <p className={styles.empty}>{emptyMessage}</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
