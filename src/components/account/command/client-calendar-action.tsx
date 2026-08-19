"use client";

import { CalendarDays } from "lucide-react";
import { useCallback, useState } from "react";
import { loadClientSubscriptionCalendarAction } from "../../../app/actions/subscription-calendar";
import { SubscriptionCalendarModal } from "../../subscriptions/subscription-calendar";
import { useHeaderPanels } from "./header-panels";

/**
 * The Subscription calendar entry point in the client header.
 *
 * A direct action rather than a header panel, for the same reason the compose
 * button is: it opens a portalled modal, so there is no anchored surface to
 * float and nothing for the single-panel manager to own. It still dismisses
 * whatever panel was open, so no popover is left hanging behind the dialog.
 *
 * It replaces the catalogue explorer that used to sit in this slot. The Store
 * is already a rail destination with its own categories and filter, so the slot
 * is better spent on the one client-side view of billing timing that has no
 * other entry point in the header.
 *
 * The modal, its projection and its authorization are the Owner/Admin ones,
 * entered through the client perspective: `loadClientSubscriptionCalendarAction`
 * reads the same `private.can_read_subscription`-gated read models, so a client
 * session receives only its own company's subscriptions.
 */
export function ClientCalendarAction() {
  const panels = useHeaderPanels();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  return (
    <>
      <button
        type="button"
        className="portal-command-button"
        aria-label="Subscription calendar"
        title="Subscription calendar"
        aria-haspopup="dialog"
        aria-expanded={open}
        onPointerEnter={() => panels?.hoverLeave()}
        onClick={() => {
          panels?.close();
          setOpen(true);
        }}
      >
        <CalendarDays aria-hidden={true} />
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
