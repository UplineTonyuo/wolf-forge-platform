"use client";

import { ChevronDown } from "lucide-react";
import { useState, type ReactNode } from "react";
import styles from "./agreement-disclosure.module.css";

export function AgreementDisclosure({ id, children }: { id: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <div className={styles.disclosure} data-open={open}>
    <button id={`${id}-toggle`} type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((current) => !current)}>
      <span>{open ? "Hide agreement" : "View agreement"}</span><ChevronDown aria-hidden="true" />
    </button>
    <div className={styles.collapse} aria-hidden={!open} inert={!open}>
      <div><div id={id} role="region" aria-labelledby={`${id}-toggle`} className={styles.content}>{children}</div></div>
    </div>
  </div>;
}
