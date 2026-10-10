"use client";

import { ArrowRight, Check, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  purchaseServiceWithBalanceAction,
  type StorePurchaseActionResult,
} from "../../../app/actions/store-purchase";
import {
  storePurchaseBlockedLabel,
  type StorePurchaseOffer,
} from "../../../domain/store/purchase";
import { formatCurrencyCents } from "../../../lib/format";
import { PortalDialog } from "../ui/portal-dialog";
import styles from "./purchase-with-balance.module.css";

/**
 * Buying an investment with the Wolf Forge Balance.
 *
 * Three faces, in order: the button, the confirmation, and the outro. Money can
 * only move from the middle one, and only once — the request id is minted when
 * the confirmation opens and reused for every retry of that same decision, so a
 * double click, a dropped response or an impatient second press all resolve to
 * the one purchase the database already made.
 *
 * When the offer is not purchasable there is no button to press. The reason is
 * stated instead, because a disabled control with no explanation is how a client
 * ends up messaging support to ask why.
 */

/** Matches the outro animation before it hands over to the destination. */
const outroMs = 1900;

function newRequestId(): string {
  return crypto.randomUUID();
}

export function PurchaseWithBalance({
  serviceId,
  serviceName,
  offer,
}: {
  serviceId: string;
  serviceName: string;
  offer: StorePurchaseOffer;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<StorePurchaseActionResult | null>(null);

  const cancelRef = useRef<HTMLButtonElement>(null);

  /*
   * One request id per decision. Minted when the dialog opens rather than per
   * click, so every attempt at THIS purchase carries the same identity and the
   * database can recognise a retry. Cancelling and reopening starts a new
   * decision, and therefore a new id.
   */
  const requestIdRef = useRef<string | null>(null);

  /* Blocks a second in-flight submit even before React re-renders. */
  const submittingRef = useRef(false);

  const priceLabel = useMemo(
    () => formatCurrencyCents(offer.priceCents, offer.currency),
    [offer.priceCents, offer.currency],
  );

  /*
   * The outro owns the transition out. It navigates by pushing rather than
   * replacing so the client can come back to the Store, and it refreshes first
   * because the balance and the projects list both changed server-side.
   */
  useEffect(() => {
    if (!done?.ok) return;
    const timer = window.setTimeout(() => {
      router.refresh();
      router.push(done.destinationHref);
    }, outroMs);
    return () => window.clearTimeout(timer);
  }, [done, router]);

  if (!offer.purchasable) {
    return (
      <div className={styles.blocked}>
        <p className={styles.blockedLine}>{storePurchaseBlockedLabel(offer.reason)}</p>

        {offer.reason === "insufficient_balance" &&
        offer.balanceCents !== null &&
        offer.shortfallCents !== null ? (
          <dl className={styles.shortfall}>
            <div>
              <dt>Available</dt>
              <dd>{formatCurrencyCents(offer.balanceCents, offer.currency)}</dd>
            </div>
            <div>
              <dt>Required</dt>
              <dd>{priceLabel}</dd>
            </div>
          </dl>
        ) : null}
      </div>
    );
  }

  const openConfirm = () => {
    requestIdRef.current = newRequestId();
    setError(null);
    setOpen(true);
  };

  const closeConfirm = () => {
    if (pending) return;
    setOpen(false);
  };

  async function confirm() {
    if (submittingRef.current) return;
    const requestId = requestIdRef.current;
    if (!requestId) return;

    submittingRef.current = true;
    setPending(true);
    setError(null);

    const result = await purchaseServiceWithBalanceAction({ serviceId, requestId });

    if (!result.ok) {
      // Failure stays exactly here. No outro, no navigation, no success state.
      submittingRef.current = false;
      setPending(false);
      setError(result.error);
      return;
    }

    setOpen(false);
    setDone(result);
  }

  return (
    <>
      <button type="button" className={styles.purchase} onClick={openConfirm}>
        <span>Purchase with Wolf Forge Balance</span>
        <ArrowRight aria-hidden={true} />
      </button>

      <p className={styles.balanceLine}>
        Balance {formatCurrencyCents(offer.balanceCents, offer.currency)}
      </p>

      <PortalDialog
        open={open}
        onClose={closeConfirm}
        title={`Purchase ${serviceName}?`}
        description="This will be paid immediately from your Wolf Forge Balance."
        /* A stray backdrop click must not cancel a purchase mid-flight. */
        closeOnBackdrop={!pending}
        initialFocusRef={cancelRef}
        footer={
          <div className={styles.dialogActions}>
            <button
              type="button"
              ref={cancelRef}
              className={styles.cancel}
              onClick={closeConfirm}
              disabled={pending}
            >
              Cancel
            </button>

            <button
              type="button"
              className={styles.confirm}
              onClick={() => void confirm()}
              aria-busy={pending || undefined}
              disabled={pending}
              data-pending={pending || undefined}
            >
              {pending ? "Processing…" : "Confirm purchase"}
            </button>
          </div>
        }
      >
        <dl className={styles.summary}>
          <div>
            <dt>Service</dt>
            <dd>{serviceName}</dd>
          </div>
          <div>
            <dt>Price</dt>
            <dd className={styles.summaryAmount}>{priceLabel}</dd>
          </div>
          <div>
            <dt>Payment method</dt>
            <dd>Wolf Forge Balance</dd>
          </div>
          <div>
            <dt>Available balance</dt>
            <dd>{formatCurrencyCents(offer.balanceCents, offer.currency)}</dd>
          </div>
          <div>
            <dt>Balance after purchase</dt>
            <dd>{formatCurrencyCents(offer.balanceAfterCents, offer.currency)}</dd>
          </div>
        </dl>

        {error ? (
          <p className={styles.dialogError} role="alert">
            {error}
          </p>
        ) : null}

        <p aria-live="polite" className={styles.srOnly}>
          {pending ? "Processing your purchase." : ""}
        </p>
      </PortalDialog>

      {done?.ok
        ? createPortal(
            <div className={styles.outro} role="status" aria-live="polite">
              <div className={styles.outroCard}>
                <span className={styles.outroMark} aria-hidden={true}>
                  <ShieldCheck />
                  <Check className={styles.outroCheck} />
                </span>

                <strong className={styles.outroTitle}>Purchase confirmed</strong>

                <p className={styles.outroBody}>
                  {done.replayed ? <>Your earlier purchase of <b>{done.serviceName}</b> is confirmed.</> : <><b>{done.serviceName}</b> has been added to your Wolf Forge services.</>}
                </p>

                <p className={styles.outroNote}>
                  {done.replayed ? "You have not been charged again." : "The Wolf Forge team has been notified and will begin fulfillment."}
                </p>

                <span className={styles.outroSweep} aria-hidden={true} />
                <span className={styles.outroReturn}>{done.destinationHref?.startsWith("/account/invoices/") ? "Opening your receipt…" : "Taking you to your projects…"}</span>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
