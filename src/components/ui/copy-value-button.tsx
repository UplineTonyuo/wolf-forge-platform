"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import styles from "./copy-value-button.module.css";

export function CopyValueButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard access can be denied by the browser; the value stays selectable as text.
    }
  }

  return (
    <button type="button" className={styles.button} aria-label={`Copy ${label}`} onClick={copy}>
      {copied ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
    </button>
  );
}
