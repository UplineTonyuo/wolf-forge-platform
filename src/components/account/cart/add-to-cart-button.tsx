"use client";

import { Check, Plus } from "lucide-react";
import { useState } from "react";
import type { CartItem } from "../../../domain/client-portal/cart";
import { addItem, useCart } from "./cart-store";
import styles from "./cart.module.css";

/**
 * Add or remove one investment, from anywhere it is shown.
 *
 * Add-only. Once an investment is in the cart this control becomes
 * informational: clicking it again does nothing, because a Store card is a
 * browsing surface and removing something there — one stray click away from a
 * price — is not a decision this screen should carry. Removal lives in the cart
 * modal, where the client can see everything they are dropping. The button
 * reads its state from the cart store, so a card and the detail page for the
 * same investment can never disagree.
 *
 * On a Store card this sits above the stretched title link, which is why it
 * stops propagation — otherwise the click would navigate rather than add.
 *
 * Hovering or focusing it expands the circle into a pill: "Add to cart?" with
 * the plus rotating to an x, or "In cart" once selected — the check never
 * rotates, because nothing about it is a pending action.
 */
/** Must match the addConfirm animation in cart.module.css. */
const confirmPulseMs = 300;

export function AddToCartButton({
  item,
  variant = "icon",
  size = "sm",
  className,
}: {
  item: CartItem;
  /** "icon" for the card corner, "full" for the detail page's action column. */
  variant?: "icon" | "full";
  /** "lg" is the flagship spotlight, sized to sit beside its 40px CTA. */
  size?: "sm" | "lg";
  className?: string;
}) {
  const items = useCart();
  const added = items.some((entry) => entry.id === item.id);

  /*
   * Only this button's own click pulses. The cart can also change from the
   * modal or another card, and confirming an action the client took elsewhere
   * would be noise.
   */
  const [pulse, setPulse] = useState(false);

  const label = added ? `${item.name} is in your cart` : `Add ${item.name} to your cart`;

  return (
    <button
      type="button"
      className={[variant === "full" ? styles.addFull : styles.addIcon, className]
        .filter(Boolean)
        .join(" ")}
      data-added={added}
      data-size={size}
      data-pulse={pulse || undefined}
      aria-label={variant === "icon" ? label : undefined}
      title={variant === "icon" ? (added ? "In your cart" : "Add to cart") : undefined}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        // Informational once selected; removal belongs to the cart modal.
        if (added) return;

        addItem(item);
        setPulse(true);
        window.setTimeout(() => setPulse(false), confirmPulseMs);
      }}
    >
      {added ? <Check aria-hidden={true} /> : <Plus aria-hidden={true} />}

      {/*
        * Supplemental only — the accessible name above already carries the
        * meaning, and it never says "remove". The rotation is decoration.
        */}
      {variant === "icon" ? (
        <span className={styles.addPrompt} aria-hidden={true}>
          <span>{added ? "In cart" : "Add to cart?"}</span>
        </span>
      ) : null}

      {variant === "full" ? <span>{added ? "In your cart" : "Add to cart"}</span> : null}
    </button>
  );
}
