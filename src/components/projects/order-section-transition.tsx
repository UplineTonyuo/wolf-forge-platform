"use client";

import { createContext, useContext, useOptimistic, type ReactNode } from "react";
import { ProjectDetailsSkeleton, ProjectFilesSkeleton, ProjectHistorySkeleton } from "../shell/route-skeletons";
import styles from "./project-detail.module.css";

export type OrderSection = "details" | "files" | "history";
const PendingSection = createContext<{ section: OrderSection | null; begin: (section: OrderSection | null) => void } | null>(null);

/** Transition-scoped state disappears on commit, cancellation or navigation errors. */
export function OrderSectionProvider({ children }: { children: ReactNode }) {
  const [section, begin] = useOptimistic<OrderSection | null>(null);
  return <PendingSection.Provider value={{ section, begin }}>{children}</PendingSection.Provider>;
}

export function useOrderSectionTransition() { return useContext(PendingSection); }

export function OrderSectionContent({ children }: { children: ReactNode }) {
  const pending = useOrderSectionTransition()?.section;
  const Skeleton = pending === "files" ? ProjectFilesSkeleton : pending === "history" ? ProjectHistorySkeleton : ProjectDetailsSkeleton;
  return <>
    {pending ? <Skeleton /> : null}
    <div className={styles.sectionContent} hidden={Boolean(pending)} aria-busy={Boolean(pending)}>{children}</div>
  </>;
}
