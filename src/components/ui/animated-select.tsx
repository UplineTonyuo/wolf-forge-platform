"use client";

import { Check, ChevronDown } from "lucide-react";
import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { useAnimatedPopover } from "./use-animated-popover";
import styles from "./animated-select.module.css";

export type AnimatedSelectOption = { value: string; label: string };

const VIEWPORT_MARGIN = 12;

/**
 * Custom animated listbox select — a trigger button plus a popover option list,
 * used in place of native <select> so the opened menu matches the Wolf Forge
 * UI and can animate. The selected value is carried in a hidden input under
 * `name`, so existing form/server-action submission contracts are preserved.
 */
export function AnimatedSelect({
  name,
  label,
  options,
  value,
  onChange,
  disabled = false,
  required = false,
  menuLabel,
}: {
  name: string;
  label: string;
  options: AnimatedSelectOption[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
  menuLabel: string;
}) {
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const { render, phase, show, hide } = useAnimatedPopover();
  const [activeIndex, setActiveIndex] = useState(-1);
  const [menuAlign, setMenuAlign] = useState<"left" | "right">("left");
  const [menuMaxWidth, setMenuMaxWidth] = useState<number | null>(null);

  const isOpen = render && phase === "open";
  const selected = options.find((option) => option.value === value);
  const selectedIndex = options.findIndex((option) => option.value === value);

  // Keep the popover inside the viewport: a toolbar filter near the right
  // edge flips to right-aligned instead of running off-screen, and the width
  // is capped to whichever edge is closer so a long option label truncates
  // instead of overflowing.
  useLayoutEffect(() => {
    if (!isOpen) return;
    const root = rootRef.current;
    if (!root) return;
    const rect = root.getBoundingClientRect();
    const spaceRight = window.innerWidth - rect.left - VIEWPORT_MARGIN;
    const spaceLeft = rect.right - VIEWPORT_MARGIN;
    const align = spaceRight >= spaceLeft ? "left" : "right";
    const available = align === "left" ? spaceRight : spaceLeft;
    setMenuAlign(align);
    setMenuMaxWidth(Math.max(rect.width, Math.min(available, 520)));
  }, [isOpen]);

  function openMenu() {
    if (disabled) return;
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    show();
  }

  function closeMenu() {
    hide();
  }

  function chooseOption(option: AnimatedSelectOption) {
    onChange(option.value);
    closeMenu();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (disabled) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!render) {
        openMenu();
        return;
      }
      setActiveIndex((index) => Math.min(index + 1, options.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!render) {
        openMenu();
        return;
      }
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(options.length - 1);
    } else if (event.key === "Enter") {
      if (isOpen && activeIndex >= 0 && options[activeIndex]) {
        event.preventDefault();
        chooseOption(options[activeIndex]);
      }
    } else if (event.key === "Escape") {
      if (render) {
        event.preventDefault();
        closeMenu();
      }
    }
  }

  return (
    <div
      className={styles.root}
      ref={rootRef}
      onKeyDown={handleKeyDown}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) {
          closeMenu();
        }
      }}
    >
      <button
        type="button"
        className={styles.trigger}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        aria-label={`${label}: ${selected?.label ?? "Select"}`}
        aria-activedescendant={
          isOpen && activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined
        }
        disabled={disabled}
        onClick={() => (render ? closeMenu() : openMenu())}
      >
        <span className={styles.triggerValue}>
          {selected?.label ?? "Select"}
        </span>

        <ChevronDown className={styles.caret} aria-hidden="true" />
      </button>

      <input type="hidden" name={name} value={value} required={required || undefined} />

      {render ? (
        <div
          className={
            isOpen ? `${styles.menu} ${styles.menuOpen}` : `${styles.menu} ${styles.menuClosing}`
          }
          data-align={menuAlign}
          style={menuMaxWidth ? { maxWidth: menuMaxWidth } : undefined}
          role="listbox"
          id={listboxId}
          aria-label={menuLabel}
        >
          {options.map((option, index) => (
            <button
              type="button"
              role="option"
              id={`${listboxId}-${index}`}
              tabIndex={-1}
              aria-selected={option.value === value}
              className={[
                styles.option,
                index === activeIndex ? styles.optionActive : "",
                option.value === value ? styles.optionSelected : "",
              ]
                .filter(Boolean)
                .join(" ")}
              key={option.value}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => chooseOption(option)}
              title={option.label}
            >
              <span className={styles.optionLabel}>{option.label}</span>

              {option.value === value ? (
                <Check className={styles.optionCheck} aria-hidden="true" />
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
