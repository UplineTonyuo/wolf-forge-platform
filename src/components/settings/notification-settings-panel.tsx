"use client";

import { useActionState, useId } from "react";
import { Loader2 } from "lucide-react";
import { updateMyNotificationSoundAction } from "../../app/actions/profile";
import { initialProfileActionState } from "../../domain/profile/schema";
import styles from "./settings-foundation.module.css";

export function NotificationSettingsPanel({ soundEnabled }: { soundEnabled: boolean }) {
  const [state, submit, pending] = useActionState(
    updateMyNotificationSoundAction,
    initialProfileActionState,
  );
  const soundId = useId();

  return (
    <form action={submit} className={styles.sectionStack}>
      <section className={styles.surfaceSection}>
        <div className={styles.sectionHeading}>
          <span className={styles.eyebrow}>Persisted preference</span>
          <h2>Workspace notification sound</h2>
          <p>Personal to this account. It controls the command-bar notification chime.</p>
        </div>
        <label className={styles.preferenceRow} htmlFor={soundId}>
          <span>
            <strong>Play notification sound</strong>
            <small>Applies when a new in-app notification reaches the workspace.</small>
          </span>
          <input id={soundId} name="notification_sound_enabled" type="checkbox" defaultChecked={soundEnabled} />
        </label>
      </section>

      <section className={styles.surfaceSection}>
        <div className={styles.sectionHeading}>
          <span className={styles.eyebrow}>Delivery coverage</span>
          <h2>Notification categories</h2>
          <p>These categories describe existing product activity; per-category delivery preferences are not persisted yet.</p>
        </div>
        <ul className={styles.foundationList}>
          <li><strong>Client &amp; account communication</strong><span>Foundation only</span></li>
          <li><strong>Invoices &amp; payments</strong><span>Foundation only</span></li>
          <li><strong>Tickets</strong><span>Foundation only</span></li>
          <li><strong>Subscriptions</strong><span>Foundation only</span></li>
        </ul>
      </section>

      <div className={styles.formFooter}>
        <span role={state.error ? "alert" : "status"}>
          {state.error ?? (state.savedAt ? "Notification preference saved." : "Only the sound preference is saved today.")}
        </span>
        <button type="submit" className={styles.primaryButton} disabled={pending}>
          {pending ? <Loader2 aria-hidden="true" /> : null}
          {pending ? "Saving" : "Save preference"}
        </button>
      </div>
    </form>
  );
}
