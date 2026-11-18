"use client";

import { MessageSquare } from "lucide-react";
import { useState, type ReactNode } from "react";
import { PortalDialog } from "../account/ui/portal-dialog";
import styles from "../projects/project-detail.module.css";

export function OrderConversationDialog({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [visited, setVisited] = useState(false);

  return (
    <section className={styles.fieldsCard} aria-labelledby="order-conversation-heading">
      <h2 id="order-conversation-heading" className={styles.sectionHeading}>Order conversation</h2>
      <button type="button" className="button-primary" aria-haspopup="dialog" aria-expanded={open}
        onClick={() => { setVisited(true); setOpen(true); }}>
        <MessageSquare size={16} aria-hidden="true" /> Open message
      </button>
      {visited && (
        <PortalDialog open={open} onClose={() => setOpen(false)} title="Order conversation"
          size="feature" layout="conversation" showClose>
          {children}
        </PortalDialog>
      )}
    </section>
  );
}
