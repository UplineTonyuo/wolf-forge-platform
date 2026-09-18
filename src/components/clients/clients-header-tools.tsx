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
} from "./clients-filter-panel";

export function ClientsHeaderTools({
  initialQuery,
  initialStatus,
}: {
  initialQuery: string;
  initialStatus: string;
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
        initialQuery={initialQuery}
        initialStatus={initialStatus}
      />
    </div>
  );
}