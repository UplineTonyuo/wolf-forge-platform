"use client";

import { CheckCircle2, Inbox, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { addTicketToInboxAction } from "../../app/actions/tickets";
import styles from "./tickets.module.css";

/**
 * Explicitly save this Ticket for the viewer, independently of legacy shared
 * Inbox visibility. Only a deliberate personal save can confer call eligibility.
 *
 * Nothing is copied, moved or migrated by it. The Ticket, its messages, its
 * attachments and its reactions are the same rows before and after; the only
 * thing that changes is this account's private Inbox membership. "View in Inbox" then
 * deep-links the Inbox drawer at this exact Ticket through the URL contract
 * the drawer already honours (`?inbox=tickets&ticket=<id>`, see
 * useTeamMessagesChat) -- there is no second conversation system behind this
 * button, and no second conversation component behind it either.
 *
 * Confirmation uses the project's native `<dialog>` + showModal() pattern (the
 * same one archive-coupon-button.tsx uses), so role, focus trap, Escape and
 * focus restore come from the platform instead of hand-rolled key handling.
 * The mutation is idempotent in the database, so a double submit settles on one
 * membership rather than two.
 */

/**
 * How long the acknowledgement stays up. Long enough to read three short lines,
 * short enough that the flow still feels like one gesture -- and, because it is
 * a plain timeout, it runs the same way under reduced motion.
 */
const SUCCESS_HOLD_MS = 900;

/**
 * Must match the exit duration on `.inboxDialog` in tickets.module.css. The
 * revalidation is scheduled off this number rather than off `transitionend`,
 * deliberately: a dropped or unsupported transition event would otherwise leave
 * the page showing "Add to Ticket conversation" for a write that succeeded.
 * The refresh may therefore start a few frames early in theory; it can never
 * fail to run.
 */
const EXIT_MS = 160;

/**
 * The dialog's whole life, as one field. `success` is only ever entered from a
 * resolved successful mutation -- never optimistically -- so the acknowledgement
 * cannot appear for a write that did not land.
 */
type Phase = "idle" | "submitting" | "success";
export function TicketInboxAction({
  ticketId,
  inboxAddedAt,
  personalInboxAddedAt,
  canManage,
}: {
  ticketId: string;
  inboxAddedAt: string | null;
  personalInboxAddedAt?: string | null;
  /** tickets.edit. Read-only staff still see the state, just not the button. */
  canManage: boolean;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  /*
   * Only `startTransition` is used now. The buttons read `submitting`, which is set
   * synchronously in the submit handler -- `pending` only flips on the next render,
   * which is a tick later than duplicate-submit protection wants to be.
   */
  const [, startTransition] = useTransition();
  const submitting = phase === "submitting";

  /*
   * Hold the acknowledgement, then close. Closing is what starts the exit and
   * what schedules the revalidation, so this effect owns only the one timer it
   * has to: the hold.
   */
  useEffect(() => {
    if (phase !== "success") return;
    const holdTimer = window.setTimeout(() => dialogRef.current?.close(), SUCCESS_HOLD_MS);
    return () => window.clearTimeout(holdTimer);
  }, [phase]);

  /*
   * Runs on every close -- the timer above, Escape, Cancel or a backdrop click.
   *
   * The revalidation is deliberately not fired the moment the action resolves. A
   * Server Action that calls `revalidatePath` already makes Next re-render this
   * route as soon as it returns, which is what used to unmount the dialog the
   * instant the write landed and cut the acknowledgement to a couple of frames.
   * The `phase !== "success"` guard on the branch below is what holds the dialog
   * open across that re-render; this timer is what lets the exit play before the
   * page is allowed to move on.
   *
   * Off a fixed duration rather than `transitionend`, on purpose: a transition
   * event that never arrived would leave the page showing "Add to Ticket
   * conversation" for a write that succeeded.
   */
  const refreshTimerRef = useRef(0);
  useEffect(() => () => window.clearTimeout(refreshTimerRef.current), []);

  function handleClose() {
    setError(null);
    if (phase !== "success") return;
    refreshTimerRef.current = window.setTimeout(() => {
      router.refresh();
      setPhase("idle");
    }, EXIT_MS);
  }

  if (inboxAddedAt && (personalInboxAddedAt || !canManage) && phase !== "success") {
    return (
      <div className={styles.inboxAction}>
        <Link
          href={`/tickets/${ticketId}?inbox=tickets&ticket=${ticketId}`}
          className="button-primary"
        >
          <Inbox aria-hidden="true" />
          View in Inbox
        </Link>
        <p className={styles.inboxActionNote}>
          {personalInboxAddedAt ? "Saved to your Inbox. " : "Visible in the team Inbox. You have not saved this Ticket personally. "}
          This Ticket&rsquo;s messages, attachments
          and internal notes are unchanged either way.
        </p>
      </div>
    );
  }

  if (!canManage) return null;

  function open() {
    /*
     * Reset on open, never on close: the success phase is what decides whether the
     * dialog or the View-in-Inbox branch renders, and the close that ends that
     * phase is scheduled by the phase itself. Clearing it here is what keeps a
     * stale acknowledgement from surviving into the next time it is opened.
     */
    setError(null);
    setPhase("idle");
    dialogRef.current?.showModal();
  }

  function confirm() {
    /* Belt and braces with the disabled buttons: a second submit that somehow
       reaches here while one is in flight is dropped rather than written twice. */
    if (submitting) return;
    setError(null);
    setPhase("submitting");
    startTransition(async () => {
      const result = await addTicketToInboxAction(ticketId);
      if (!result.ok) {
        /* Not success, so no acknowledgement: the dialog stays open, the
           error shows, and both buttons come back enabled. */
        setPhase("idle");
        setError(result.error);
        return;
      }
      setPhase("success");
    });
  }

  return (
    <div className={styles.inboxAction}>
      <button
        type="button"
        className="button-primary"
        onClick={open}
      >
        <Inbox aria-hidden="true" />
        {inboxAddedAt ? "Save to my Inbox" : "Add to Ticket conversation"}
      </button>
      {inboxAddedAt ? (
        <Link href={`/tickets/${ticketId}?inbox=tickets&ticket=${ticketId}`} className="button-secondary">
          <Inbox aria-hidden="true" />
          View in Inbox
        </Link>
      ) : null}
      <p className={styles.inboxActionNote}>
        {inboxAddedAt
          ? "Already visible in Inbox → Tickets. Save it personally to be considered for client calls while eligible."
          : "Saves this Ticket’s existing conversation to your Inbox → Tickets."}
      </p>

      <dialog
        ref={dialogRef}
        className={`${styles.dialog} ${styles.inboxDialog}`}
        aria-labelledby={
          phase === "success" ? "ticket-inbox-success-title" : "ticket-inbox-dialog-title"
        }
        onClose={handleClose}
        /* Escape closes a native dialog for free; block it mid-flight so the
           confirming click cannot leave the dialog gone and the write still
           in the air. The acknowledgement is its own beat and is not
           interruptible. */
        onCancel={(event) => {
          if (submitting) event.preventDefault();
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget && !submitting) {
            event.currentTarget.close();
          }
        }}
      >
        <form
          key={phase}
          className={styles.inboxSwap}
          onSubmit={(event) => {
            event.preventDefault();
            if (phase === "success") return;
            confirm();
          }}
        >
            {phase === "success" ? (
              <div className={styles.inboxSuccess}>
                <span className={styles.inboxSuccessIcon}>
                  <CheckCircle2 aria-hidden="true" />
                </span>
                <h2 id="ticket-inbox-success-title">Ticket added to Inbox</h2>
                <p>This ticket is now available in Inbox &rarr; Tickets.</p>
              </div>
            ) : (
              <>
                <header>
                  <h2 id="ticket-inbox-dialog-title">Add this Ticket to Inbox?</h2>
                </header>
                <div className={styles.dialogBody}>
                  <p>
                    This saves the Ticket to your own Inbox &rarr; Tickets for conversation and makes you a call candidate while you remain eligible.
                    Nothing is copied: the same messages, attachments and reactions are read in
                    both places.
                  </p>
                  {error ? (
                    <p className={styles.actionError} role="alert">
                      {error}
                    </p>
                  ) : null}
                </div>
                <footer>
                  <button
                    type="button"
                    className="button-secondary"
                    disabled={submitting}
                    onClick={() => dialogRef.current?.close()}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="button-primary" disabled={submitting} aria-busy={submitting}>
                    {submitting ? (
                      <>
                        <LoaderCircle className="spinner" aria-hidden="true" />
                        Adding...
                      </>
                    ) : (
                      "Add to Inbox"
                    )}
                  </button>
                </footer>
              </>
            )}
        </form>
      </dialog>
    </div>
  );
}
