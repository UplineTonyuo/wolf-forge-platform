"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { endClientSupportAction } from "../../app/actions/client-support";
import type { ClientSupportProof } from "../../domain/auth/client-support";
import styles from "./client-support-banner.module.css";

export function ClientSupportBanner({ support }: { support: ClientSupportProof }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setTimeout(() => router.replace("/client-support/exit"), Math.max(0, Date.parse(support.expiresAt) - Date.now()));
    return () => clearTimeout(timer);
  }, [support.expiresAt, router]);
  return (
    <aside className={styles.toolbar} aria-label="Client support session">
      <span className={styles.identity}>Client view · <strong>{support.displayName ?? "client"}</strong></span>
      <form action={endClientSupportAction}>
        <button type="submit" className={`button-secondary ${styles.backButton}`}>
          <ArrowLeft size={16} aria-hidden="true" />
          Back to admin account
        </button>
      </form>
    </aside>
  );
}
