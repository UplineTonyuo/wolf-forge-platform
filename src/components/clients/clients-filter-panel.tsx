"use client";

import { Search } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { FilterOptionGroup, MobileFilterSheet } from "../ui/mobile-filter-sheet";
import sheet from "../ui/mobile-filter-sheet.module.css";
import styles from "./clients-filter-panel.module.css";

export type ClientTypeCounts = Record<"" | "contact" | "lead" | "client" | "client_team", number>;

const typeOptions = [
  { value: "", label: "All" },
  { value: "contact", label: "Contact" },
  { value: "lead", label: "Lead" },
  { value: "client", label: "Client" },
  { value: "client_team", label: "Client Team" },
] as const;

/**
 * The Clients Filter: the shared filter modal, holding exactly the two filters
 * the Clients page resolves on the server -- `q` (company name search) and
 * `status` (the same canonical values the status tabs write). Anything else
 * here would be a control that does nothing.
 */
export function ClientsFilterPanel({
  query,
  status,
  counts,
}: {
  /** The applied `q`, as the server read it. */
  query: string;
  /** The applied lifecycle status; "" is All. */
  status: string;
  counts: ClientTypeCounts;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [draftQuery, setDraftQuery] = useState(query);
  const [draftStatus, setDraftStatus] = useState(status);

  function navigate(nextQuery: string, nextStatus: string) {
    // Carries every other param (e.g. `view`) through untouched.
    const next = new URLSearchParams(searchParams.toString());

    if (nextQuery.trim()) next.set("q", nextQuery.trim());
    else next.delete("q");

    if (nextStatus) next.set("status", nextStatus);
    else next.delete("status");

    const search = next.toString();
    if (search === searchParams.toString()) return;

    router.push(search ? `${pathname}?${search}` : pathname);
  }

  return (
    <MobileFilterSheet
      label="Filter clients"
      alwaysVisible
      activeCount={(query.trim() ? 1 : 0) + (status ? 1 : 0)}
      onOpen={() => {
        setDraftQuery(query);
        setDraftStatus(status);
      }}
      onClear={() => navigate("", "")}
      onApply={() => navigate(draftQuery, draftStatus)}
    >
      <label className={sheet.group}>
        <span className={sheet.groupLabel}>Search</span>

        <span className={styles.searchBox}>
          <Search aria-hidden="true" />
          <input
            type="search"
            data-autofocus
            value={draftQuery}
            placeholder="Business name"
            autoComplete="off"
            onChange={(event) => setDraftQuery(event.target.value)}
          />
        </span>
      </label>

      <FilterOptionGroup
        label="Type"
        value={draftStatus}
        onChange={setDraftStatus}
        options={typeOptions.map((option) => ({ ...option, count: counts[option.value] }))}
      />
    </MobileFilterSheet>
  );
}
