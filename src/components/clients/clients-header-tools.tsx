"use client";

import {
  Building2,
} from "lucide-react";
import Link from "next/link";
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
  return (
    <div className="clients-header-tools">
      <Link
        className="clients-header-tool"
        href="/companies"
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
