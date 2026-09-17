"use client";

import { Search } from "lucide-react";
import styles from "./project-filter-search-box.module.css";

/**
 * The one search input every Projects filter selector uses (Person, Client,
 * Status, and Service's in-folder search) on both desktop and mobile.
 * `compact` sizes it for a desktop popover instead of the mobile sheet.
 */
export function FilterSearchBox({
  value,
  onChange,
  placeholder,
  compact = false,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  compact?: boolean;
}) {
  return (
    <div className={compact ? `${styles.searchBox} ${styles.compact}` : styles.searchBox}>
      <Search size={compact ? 14 : 15} aria-hidden="true" />
      <input
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
