"use client";

import { ArrowRight, Info, ShoppingCart, Trash2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  cadenceShortLabels,
  cartCtaLabel,
  cartTotals,
  type CartItem,
} from "../../../domain/client-portal/cart";
import { useHeaderPanels } from "../command/header-panels";
import { useServiceChooser } from "../services/service-chooser-context";
import { PortalDialog } from "../ui/portal-dialog";
import { clearCart, onCartAdd, removeItem, useCart } from "./cart-store";
import styles from "./cart.module.css";

/**
 * The cart in the client header.
 *
 * A request cart, not a checkout: it collects the investments a client wants to
 * talk about and hands off to the existing ticket flow. No payment surface is
 * implied and none is invented — the portal has never been able to create a
 * project or take money, and pretending otherwise would be a fake button.
 *
 * It opens a centred dialog rather than an anchored popover. The cart is the
 * point of the interaction, not a glance, so it is deliberately NOT wired into
 * the header panel manager: that manager opens on hover, and a cart that
 * appeared because the pointer crossed an icon read as an accident. Clicking is
 * the only way in.
 *
 * The dialog itself is the portal's one PortalDialog, in its `feature` size —
 * focus trapping, focus return, Escape, backdrop click and scroll lock are
 * therefore the same implementation every other portal dialog uses rather than
 * a weaker second copy.
 */

/** Must match the .row[data-leaving] animation in cart.module.css. */
const rowExitMs = 200;

/** Per-row offset while clearing. Small enough to read as one gesture. */
const clearStaggerMs = 30;

/** However long the cart is, clearing never becomes a wait. */
const clearStaggerCapMs = 180;

function clearStaggerFor(index: number): number {
  return Math.min(index * clearStaggerMs, clearStaggerCapMs);
}

/** Reduced motion clears at once rather than playing a staged exit. */
function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * One investment in the cart. Name, category, the Store's curated preview line,
 * price and cadence — never the full inclusion list, which stays on the detail
 * page.
 */
function CartRow({
  item,
  clearing,
  clearDelayMs,
}: {
  item: CartItem;
  /** True while the whole cart is playing its exit before the state clears. */
  clearing?: boolean;
  clearDelayMs?: number;
}) {
  /*
   * The row plays its own exit before the store drops it, so removing an
   * investment collapses cleanly instead of the list snapping shut. Entry is
   * deliberately not animated: the dialog's own entrance already carries the
   * content in, and a row sliding the other way fought it.
   */
  const [leaving, setLeaving] = useState(false);

  const remove = () => {
    if (leaving || clearing) return;
    setLeaving(true);
    window.setTimeout(() => removeItem(item.id), rowExitMs);
  };

  return (
    <li
      className={styles.row}
      data-leaving={leaving || clearing || undefined}
      style={clearing ? ({ animationDelay: `${clearDelayMs}ms` } as React.CSSProperties) : undefined}
    >
      <div className={styles.rowMain}>
        <div className={styles.rowHead}>
          <Link className={styles.rowName} href={`/account/store/${item.id}`}>
            {item.name}
          </Link>
          {item.categoryName ? (
            <span className={styles.rowCategory}>{item.categoryName}</span>
          ) : null}
        </div>

        {item.summary ? <p className={styles.rowSummary}>{item.summary}</p> : null}

        <div className={styles.rowFoot}>
          <span className={styles.rowPrice}>{item.priceLabel}</span>
          <span className={styles.rowCadence} data-cadence={item.cadence}>
            {cadenceShortLabels[item.cadence]}
          </span>
        </div>
      </div>

      <button
        type="button"
        className={styles.remove}
        disabled={clearing}
        onClick={remove}
        aria-label={`Remove ${item.name} from your cart`}
      >
        <Trash2 aria-hidden={true} />
      </button>
    </li>
  );
}

export function ClientCartPanel() {
  const chooser = useServiceChooser();
  const panels = useHeaderPanels();
  const items = useCart();
  const [open, setOpen] = useState(false);

  /*
   * The arrival beat, and nothing more.
   *
   * Two interchangeable tokens rather than a boolean: re-applying the same CSS
   * animation to an element that already carries it does not restart it, so a
   * second add inside the first beat would be swallowed. Alternating the token
   * changes the animation-name, which restarts it every time — on the same
   * element, with no remount and nothing rendered.
   *
   * null at rest, so a first paint, a restored cart and a re-render are all
   * still. Nothing here is derived from the item count, and the count is never
   * derived from this.
   */
  const [bump, setBump] = useState<"a" | "b" | null>(null);

  useEffect(
    () =>
      onCartAdd(() => {
        if (prefersReducedMotion()) return;
        setBump((current) => (current === "a" ? "b" : "a"));
      }),
    [],
  );
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [clearing, setClearing] = useState(false);

  const close = useCallback(() => {
    setOpen(false);
    setConfirmingClear(false);
  }, []);

  /*
   * Clearing plays the rows out before the state drops them, so the list
   * visibly empties rather than blinking. The modal, the backdrop and the badge
   * all hold until the animation finishes — the badge reaches zero only when
   * the cart actually clears.
   */
  const startClear = useCallback((rowCount: number) => {
    setClearing(true);
    setConfirmingClear(false);

    const total = clearStaggerFor(rowCount - 1) + rowExitMs;
    window.setTimeout(() => {
      clearCart();
      setClearing(false);
    }, prefersReducedMotion() ? 0 : total);
  }, []);

  // The cart rides the same Store grant as everything it can hold.
  if (!chooser?.available) return null;

  const count = items.length;
  const totals = cartTotals(items);

  return (
    <>
      <button
        type="button"
        className="portal-command-button"
        aria-label={count === 0 ? "Your cart" : `Your cart, ${count} selected`}
        title="Your cart"
        aria-haspopup="dialog"
        aria-expanded={open}
        /*
         * Hover only leaves whatever panel was open; it never opens the cart.
         * Clicking closes that panel first so no popover is left behind the
         * dialog.
         */
        onPointerEnter={() => panels?.hoverLeave()}
        onClick={() => {
          panels?.close();
          setOpen(true);
        }}
      >
        {/*
          * One cart icon, for the whole session. It is never keyed and never
          * replaced: the add event only re-labels it for the length of one
          * animation, so this is the same DOM node before, during and after.
          */}
        <ShoppingCart
          className={styles.triggerIcon}
          data-bump={bump ?? undefined}
          aria-hidden={true}
        />
        {count > 0 ? (
          <em
            key={count}
            className={`wf-count-badge ${styles.badge}`}
            aria-hidden={true}
          >
            {count > 99 ? "99+" : count}
          </em>
        ) : null}
      </button>

      <PortalDialog
        open={open}
        onClose={close}
        size="feature"
        showClose
        title="Your investment cart"
        description={
          count === 0
            ? "Nothing selected yet."
            : `${count} ${count === 1 ? "investment" : "investments"} selected`
        }
        headerAction={
          count > 0 ? (
            <button
              type="button"
              className={styles.clear}
              data-confirming={confirmingClear || undefined}
              disabled={clearing}
              onClick={() => {
                if (!confirmingClear) {
                  setConfirmingClear(true);
                  return;
                }
                startClear(count);
              }}
              onBlur={() => setConfirmingClear(false)}
            >
              {confirmingClear ? "Remove all?" : "Clear cart"}
            </button>
          ) : null
        }
        footer={
          count > 0 ? (
            <div className={styles.foot} data-clearing={clearing || undefined}>
              <dl className={styles.totals}>
                {totals.map((total) => (
                  <div key={`${total.cadence}-${total.currency}`}>
                    <dt>{total.label}</dt>
                    <dd>{total.formatted}</dd>
                  </div>
                ))}
              </dl>

              <div className={styles.footActions}>
                <Link className={styles.cta} href="/account/messages?compose=1&from=cart" onClick={close}>
                  {cartCtaLabel(items)}
                  <ArrowRight aria-hidden={true} />
                </Link>
                {/*
                  * The promise comes first and is unchanged. The second sentence
                  * is the disclosure: adding an investment tells the client's
                  * team they are interested, which is exactly what it does. Said
                  * plainly and in place, because a consent modal over a cart
                  * would be both alarming and out of proportion.
                  */}
                <p className={styles.note}>
                  <Info aria-hidden={true} />
                  <span>
                    Nothing is ordered or charged. Adding an investment lets your Wolf Forge team
                    know you are interested, so they can help you explore it.
                  </span>
                </p>
              </div>
            </div>
          ) : null
        }
      >
        {count === 0 ? (
          <div className={styles.empty}>
            <span className={styles.emptyIcon}>
              <ShoppingCart aria-hidden={true} />
            </span>
            <div className={styles.emptyCopy}>
              <h3>Your cart is empty</h3>
              {/* The disclosure lives in both states, so it is present before anything is added. */}
              <p>
                Browse the Store and add investments you would like to explore. Adding one lets
                your Wolf Forge team know you are interested. Nothing is ordered or charged.
              </p>
              <Link className={styles.emptyAction} href="/account/store" onClick={close}>
                Browse investments
                <ArrowRight aria-hidden={true} />
              </Link>
            </div>
          </div>
        ) : (
          <ul className={styles.list} data-clearing={clearing || undefined}>
            {items.map((item, index) => (
              <CartRow
                key={item.id}
                item={item}
                clearing={clearing}
                clearDelayMs={clearStaggerFor(index)}
              />
            ))}
          </ul>
        )}
      </PortalDialog>
    </>
  );
}
