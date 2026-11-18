"use client";

import { MessageSquare } from "lucide-react";
import { createContext, useState, type ReactNode } from "react";
import { PortalDialog } from "../account/ui/portal-dialog";
import styles from "../projects/project-detail.module.css";

export const OrderHeaderSlot = createContext<HTMLDivElement | null | undefined>(undefined);
export const OrderConversationVisible = createContext(true);

export function OrderConversationDialog({ orderNumber, children }: { orderNumber: number | string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [visited, setVisited] = useState(false);
  const [headerSlot, setHeaderSlot] = useState<HTMLDivElement | null>(null);

  return (
    <section className={styles.fieldsCard} aria-labelledby="order-conversation-heading">
      <h2 id="order-conversation-heading" className={styles.sectionHeading}>Order conversation</h2>
      <button type="button" className="button-primary" aria-haspopup="dialog" aria-expanded={open}
        onClick={() => { setVisited(true); setOpen(true); }}>
        <MessageSquare size={16} aria-hidden="true" /> Open message
      </button>
      {visited && (
        <PortalDialog open={open} onClose={() => setOpen(false)} title={`Order #${orderNumber}`}
          size="feature" layout="conversation" headerAction={<div ref={setHeaderSlot} />} showClose>
          <OrderHeaderSlot.Provider value={headerSlot}>
            <OrderConversationVisible.Provider value={open}>{children}</OrderConversationVisible.Provider>
          </OrderHeaderSlot.Provider>
        </PortalDialog>
      )}
    </section>
  );
}
