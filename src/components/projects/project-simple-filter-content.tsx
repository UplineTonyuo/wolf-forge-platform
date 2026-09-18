"use client";

import { useDeferredValue, useMemo, useState, type ReactNode } from "react";
import { FilterOptionList } from "./project-filter-option-list";
import { FilterSearchBox } from "./project-filter-search-box";
import { normalize, rankName } from "./project-pickers";

export type SimpleFilterOption = {
  id: string;
  label: string;
  sublabel?: string;
  icon?: ReactNode;
  status?: string;
  avatarUrl?: string | null;
};

const SEARCH_THRESHOLD = 8;

/**
 * The shared search + option-list body for Person, Client and Status —
 * used standalone inside the mobile Filters sheet (which already supplies
 * the modal chrome) and wrapped in `ProjectFilterPopover` on desktop, so
 * both surfaces run the exact same filtering logic.
 */
export function SimpleFilterContent({
  fixedOptions,
  options,
  value,
  onSelect,
  searchPlaceholder,
  compactSearch = false,
}: {
  /** Always-visible rows that never participate in search, e.g. "Everyone". */
  fixedOptions: SimpleFilterOption[];
  options: SimpleFilterOption[];
  value: string;
  onSelect: (id: string) => void;
  searchPlaceholder: string;
  compactSearch?: boolean;
}) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const showSearch = options.length > SEARCH_THRESHOLD;

  const filtered = useMemo(() => {
    const normalizedQuery = normalize(deferredQuery);

    return options
      .map((option) => ({ option, rank: rankName(option.label, normalizedQuery) }))
      .filter((entry) => Number.isFinite(entry.rank))
      .sort((a, b) => (a.rank !== b.rank ? a.rank - b.rank : a.option.label.localeCompare(b.option.label)))
      .map((entry) => entry.option);
  }, [options, deferredQuery]);

  return (
    <>
      {showSearch ? (
        <FilterSearchBox value={query} onChange={setQuery} placeholder={searchPlaceholder} compact={compactSearch} />
      ) : null}
      <FilterOptionList options={[...fixedOptions, ...filtered]} selectedId={value} onSelect={onSelect} />
    </>
  );
}
