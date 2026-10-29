"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { endClientSupportAction } from "../../app/actions/client-support";
import type { ClientSupportProof } from "../../domain/auth/client-support";
import styles from "./client-support-banner.module.css";

export function ClientSupportBanner({ support }: { support: ClientSupportProof }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setTimeout(() => router.replace("/client-support/exit"), Math.max(0, Date.parse(support.expiresAt) - Date.now()));
    return () => clearTimeout(timer);
  }, [support.expiresAt, router]);
  return <aside className={styles.banner} aria-label="Client support session">
    <div><strong>Acting as {support.displayName ?? "client"}</strong><p>Actions are recorded under your administrator account. Ends at <time dateTime={support.expiresAt}>{new Date(support.expiresAt).toISOString().slice(11, 16)} UTC</time>.</p></div>
    <form action={endClientSupportAction}><button type="submit" className="button-secondary">Exit client view</button></form>
  </aside>;
}
