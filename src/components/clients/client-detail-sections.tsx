"use client";

import { Activity, FolderKanban, History, ReceiptText, UserRound } from "lucide-react";
import { startTransition, useOptimistic, type ReactNode } from "react";
import { RouteTransitionLink } from "../shell/route-transition";
import { ClientSectionSkeleton, type ClientSection } from "../shell/route-skeletons";

const sections = [
  { id: "details", label: "Details", icon: UserRound },
  { id: "projects", label: "Projects", icon: FolderKanban },
  { id: "invoices", label: "Invoices", icon: ReceiptText },
  { id: "activities", label: "Activities", icon: Activity },
  { id: "history", label: "History", icon: History },
] as const;

export function ClientDetailSections({ companyId, activeTab, children }: { companyId: string; activeTab: ClientSection; children: ReactNode }) {
  const [pending, begin] = useOptimistic<ClientSection | null>(null);
  const selected = pending ?? activeTab;
  return <>
    <nav className="client-detail-tabs" aria-label="Client sections">
      {sections.map(({ id, label, icon: Icon }) => <RouteTransitionLink
        key={id}
        href={id === "details" ? `/clients/${companyId}` : `/clients/${companyId}?tab=${id}`}
        scroll={false}
        data-route-skeleton="off"
        onNavigate={() => startTransition(() => begin(id === activeTab ? null : id))}
        aria-current={selected === id ? "page" : undefined}
        className={selected === id ? "client-detail-tab is-active" : "client-detail-tab"}
      ><Icon aria-hidden="true" />{label}</RouteTransitionLink>)}
    </nav>
    {pending ? <ClientSectionSkeleton section={pending} /> : null}
    <div className="client-section-content" hidden={pending !== null} aria-busy={pending !== null}>{children}</div>
  </>;
}
