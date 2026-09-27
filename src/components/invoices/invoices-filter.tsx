"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { FilterOptionGroup, MobileFilterSheet } from "../ui/mobile-filter-sheet";

export const invoiceStatusOptions = [
  { value: "all", label: "All" },
  { value: "unpaid", label: "Unpaid" },
  { value: "paid", label: "Paid" },
  { value: "payment_pending", label: "Payment Pending" },
  { value: "refunded", label: "Refunded" },
  { value: "void", label: "Void" },
  { value: "overdue", label: "Overdue" },
];

export function InvoicesFilter({ value }: { value: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const [draft, setDraft] = useState(value);
  function apply(status: string) {
    const next = new URLSearchParams(params.toString());
    if (status === "all") next.delete("state");
    else next.set("state", status);
    router.push(`/invoices${next.size ? `?${next}` : ""}`);
  }
  return <MobileFilterSheet label="Filter invoices" alwaysVisible activeCount={value === "all" ? 0 : 1} onOpen={() => setDraft(value)} onClear={() => apply("all")} onApply={() => apply(draft)}>
    <FilterOptionGroup label="Status" options={invoiceStatusOptions} value={draft} onChange={setDraft} />
  </MobileFilterSheet>;
}
