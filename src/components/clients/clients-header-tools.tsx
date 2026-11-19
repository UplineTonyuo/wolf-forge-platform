"use client";

import {
  Building2,
} from "lucide-react";
import Link from "next/link";
import { ClientsFilterPanel } from "./clients-filter-panel";
import type { MobileFilterOption } from "../ui/mobile-filter-sheet";

export function ClientsHeaderTools({
  query,
  status,
  options,
}: {
  query: string;
  status: string;
  options: MobileFilterOption[];
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
        options={options}
      />
    </div>
  );
}
