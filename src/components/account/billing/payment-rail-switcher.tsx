"use client";

import { ArrowRight } from "lucide-react";
import { useState } from "react";
import {
  defaultPaymentRailId,
  hasAlternativePaymentRail,
  type ClientPaymentRail,
  type PaymentRailId,
} from "../../../domain/payments/payment-rails";
import { PortalDialog } from "../ui/portal-dialog";
import styles from "./payment-rails.module.css";

/**
 * "Change payment method".
 *
 * The only client component on this surface. Everything else about the payment
 * method page is server rendered, so what ships to the browser is this dialog
 * and the rails it was given — labels, statuses and one balance figure, all of
 * which the page already displays.
 *
 * WHY NOTHING IS SAVED HERE.
 *
 * There is no preferred-payment-method column anywhere in the schema, and this
 * phase does not add one. Two reasons, in order:
 *
 *   1. Only one rail can settle an invoice today. A stored preference of
 *      "PayPal" would be a promise the platform could not keep, and the invoice
 *      page would have to silently ignore it — which is exactly the kind of
 *      disagreement between two surfaces this codebase keeps avoiding.
 *   2. Where a preference would live is a real decision (company-wide, or per
 *      person? does it survive a provider being disconnected?) and it should be
 *      made when there is a second usable rail to make it about.
 *
 * So the selection is dialog-local: it shows the client what their options will
 * be and lets them see the real state of each. `resolveSelectedPaymentRailId`
 * in the domain refuses any unavailable rail regardless, so even if a
 * preference is added later it cannot make the portal display a payment method
 * that does not work.
 */
export function PaymentRailSwitcher({ rails }: { rails: ClientPaymentRail[] }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<PaymentRailId>(defaultPaymentRailId);

  const canChoose = hasAlternativePaymentRail(rails);

  return (
    <>
      <button type="button" className={styles.changeAction} onClick={() => setOpen(true)}>
        Change payment method
        <ArrowRight aria-hidden={true} />
      </button>

      <PortalDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Select payment method"
        description="How your account settles invoices with Wolf Forge."
        showClose={true}
      >
        <fieldset className={styles.options}>
          <legend className={styles.optionsLegend}>Payment method</legend>

          {rails.map((rail) => (
            <label
              key={rail.id}
              className={styles.option}
              data-available={rail.isAvailable}
              data-selected={rail.id === selected}
            >
              <input
                className={styles.optionInput}
                type="radio"
                name="payment-rail"
                value={rail.id}
                checked={rail.id === selected}
                /*
                 * The gate, and it is the same fact the page and the database
                 * agree on. A rail Wolf Forge has not connected cannot be
                 * chosen at all — not chosen-then-warned — so there is no state
                 * in which this dialog shows an unusable method as selected.
                 */
                disabled={!rail.isAvailable}
                /*
                 * Guarded as well as disabled. `disabled` is the affordance; this
                 * is the rule. A change event can still arrive from a
                 * programmatic dispatch or an extension, and an unusable rail
                 * must not become the selected one by any route.
                 */
                onChange={() => {
                  if (!rail.isAvailable) return;
                  setSelected(rail.id);
                }}
              />

              <span className={styles.radio} aria-hidden={true} />

              <span className={styles.optionText}>
                <span className={styles.optionLabel}>{rail.label}</span>
                {rail.detail ? <span className={styles.optionDetail}>{rail.detail}</span> : null}
                <span className={styles.optionDesc}>{rail.description}</span>
              </span>

              {/*
                * One trailing column carrying whichever fact is true: why the
                * rail cannot be used, or that it is the account's default. Never
                * both, and never an empty chip holding the column open.
                */}
              {rail.statusLabel ? (
                <span className={styles.optionStatus}>{rail.statusLabel}</span>
              ) : rail.isDefault ? (
                <span className={styles.defaultChip}>Default</span>
              ) : null}
            </label>
          ))}
        </fieldset>

        <p className={styles.dialogNote}>
          {canChoose
            ? "Your selection applies when you settle an invoice."
            : "Wolf Forge Balance is the only payment method available right now. PayPal and bank transfer will appear here once Wolf Forge connects them."}
        </p>
      </PortalDialog>
    </>
  );
}
