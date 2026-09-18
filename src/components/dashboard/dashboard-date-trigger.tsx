"use client";

import { CalendarDays } from "lucide-react";
import { usePathname } from "next/navigation";
import { useCallback, useState } from "react";
import { loadOwnerSubscriptionCalendarAction } from "../../app/actions/subscription-calendar";
import { SubscriptionCalendarModal } from "../subscriptions/subscription-calendar";
import styles from "./dashboard-date-trigger.module.css";

/**
 * Dashboard command-bar calendar.
 *
 * The trigger keeps its original placement, icon, and reveal animation; what it
 * opens is now the Owner/Admin Subscription calendar (recurring revenue), not a
 * reporting date-range popup. Dashboard reporting ranges stay on the compact
 * control in the Dashboard header and on the unchanged reporting backend.
 */
export function DashboardDateTrigger() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const close = useCallback(() => setOpen(false), []);

  if (pathname !== "/dashboard") return null;

  return (
    <>
      <button
        type="button"
        className={`${styles.trigger} workspace-command-calendar`}
        aria-label="Open subscription calendar"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Subscription calendar"
        onClick={() => setOpen(true)}
      >
        <CalendarDays size={17} aria-hidden="true" />
        <span className={styles.triggerGlow} aria-hidden="true" />
      </button>

      {open ? (
        <SubscriptionCalendarModal
          perspective="owner"
          loadSources={loadOwnerSubscriptionCalendarAction}
          onClose={close}
        />
      ) : null}
    </>
  );
}
