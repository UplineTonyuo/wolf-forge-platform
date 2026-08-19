"use client";

import { Check, ChevronDown, Search } from "lucide-react";
import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useAnimatedPopover } from "./use-animated-popover";
import styles from "./searchable-select.module.css";

export type SearchableOption = {
  id: string;
  label: string;
  sublabel?: string;
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
}) {
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const { render, phase, show, hide } = useAnimatedPopover();
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const isOpen = render && phase === "open";
  const selected = options.find((option) => option.id === value) ?? null;

  // While not editing, the field always reflects the current selection, so an
  // externally-preselected value (e.g. a fixed Service) is shown for free.
  const inputValue = editing ? query : (selected?.label ?? query);

  const filtered = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    if (!term) return options;
    return options.filter((option) =>
      option.label.toLocaleLowerCase().includes(term),
    );
  }, [options, query]);

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
      if (!render) {
        show();
        return;
      }
      setActiveIndex((index) => Math.min(index + 1, filtered.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!render) {
        show();
        return;
      }
      setActiveIndex((index) => Math.max(index - 1, 0));
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
            if (!disabled && !render) show();
          }}
          onChange={(event) => {
            setQuery(event.currentTarget.value);
            setEditing(true);
            setActiveIndex(-1);
            if (!render) show();
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

      {render && !disabled ? (
        <div
          className={
            isOpen
              ? `${styles.menu} ${styles.menuOpen}`
              : `${styles.menu} ${styles.menuClosing}`
          }
          role="listbox"
          id={listboxId}
          aria-label={menuLabel}
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
                <span className={styles.optionLabel}>{option.label}</span>

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
