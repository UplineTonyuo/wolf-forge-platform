"use client";

import {
  Building2,
} from "lucide-react";
import Link from "next/link";
import {
  useSearchParams,
} from "next/navigation";
import {
  ClientsFilterPanel,
  type ClientTypeCounts,
} from "./clients-filter-panel";

export function ClientsHeaderTools({
  query,
  status,
  counts,
}: {
  query: string;
  status: string;
  counts: ClientTypeCounts;
}) {
  const searchParams =
    useSearchParams();

  const companyView =
    searchParams.get("view") ===
    "companies";

  return (
    <div className="clients-header-tools">
      <Link
        className={
          companyView
            ? "clients-header-tool is-active"
            : "clients-header-tool"
        }
        href={
          companyView
            ? "/clients"
            : "/clients?view=companies"
        }
        aria-pressed={companyView}
      >
        <Building2
          size={16}
          aria-hidden="true"
        />

        <span>
          Companies
        </span>
      </Link>

      <ClientsFilterPanel
        query={query}
        status={status}
        counts={counts}
      />
    </div>
  );
}