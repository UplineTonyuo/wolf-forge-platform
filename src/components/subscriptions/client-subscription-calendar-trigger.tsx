"use client";

import { CalendarDays } from "lucide-react";
import { useCallback, useState } from "react";
import { loadClientSubscriptionCalendarAction } from "../../app/actions/subscription-calendar";
import { SubscriptionCalendarModal } from "./subscription-calendar";
import styles from "./subscriptions.module.css";

/**
 * Client portal entry point to the same Subscription calendar the Owner/Admin
 * dashboard opens, in the client perspective: only their own subscriptions,
 * and recurring money is described as investment, never spend.
 */
export function ClientSubscriptionCalendarTrigger() {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  return (
    <>
      <button
        type="button"
        className={styles.clientCalendarTrigger}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <CalendarDays size={15} aria-hidden="true" />
        Billing calendar
      </button>

      {open ? (
        <SubscriptionCalendarModal
          perspective="client"
          loadSources={loadClientSubscriptionCalendarAction}
          onClose={close}
        />
      ) : null}
    </>
  );
}
