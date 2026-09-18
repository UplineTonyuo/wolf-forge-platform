"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { FilterOptionGroup, MobileFilterSheet } from "../ui/mobile-filter-sheet";

/** The two views the Coupons index has always had. There is no third. */
const viewOptions = [
  { value: "active", label: "Active" },
  { value: "archived", label: "Archived" },
];

type CouponView = "active" | "archived";

/**
 * The mobile Coupons filter: the Active/Archived strip, moved into the shared
 * Filter sheet.
 *
 * It writes the same `?view=archived` param the desktop tabs write -- absent
 * means Active -- and leaves every other query value alone, so mobile and
 * desktop are two controls over one set of semantics rather than two
 * implementations of one filter. There is deliberately no "All" option: the
 * list is loaded per view and the two views are mutually exclusive.
 */
export function CouponsFilter({
  initialView,
}: {
  initialView: CouponView;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const viewParam = searchParams.get("view");
  const currentView: CouponView =
    viewParam === null ? initialView : viewParam === "archived" ? "archived" : "active";

  const [draft, setDraft] = useState<CouponView>(currentView);

  function show(view: CouponView) {
    const next = new URLSearchParams(searchParams.toString());

    if (view === "archived") {
      next.set("view", "archived");
    } else {
      next.delete("view");
    }

    const query = next.toString();

    router.push(query ? `${pathname}?${query}` : pathname);
  }

  return (
    <MobileFilterSheet
      label="Filter coupons"
      activeCount={currentView === "archived" ? 1 : 0}
      onOpen={() => setDraft(currentView)}
      onClear={() => {
        setDraft("active");
        show("active");
      }}
      onApply={() => show(draft)}
    >
      <FilterOptionGroup
        label="Status"
        value={draft}
        onChange={(next) => setDraft(next as CouponView)}
        options={viewOptions}
      />
    </MobileFilterSheet>
  );
}
