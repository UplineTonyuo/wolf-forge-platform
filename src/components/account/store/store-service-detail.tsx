import { ArrowLeft, ArrowRight } from "lucide-react";
import Link from "next/link";
import { storeContactLabel } from "../../../domain/services/store-projections";
import type { StoreServiceView } from "../../../domain/services/store-projections";
import { AddToCartButton } from "../cart/add-to-cart-button";
import styles from "./store-service-detail.module.css";

/**
 * The description is captured marketing HTML from the real catalog. It is run
 * through the shared sanitizeServiceDescription boundary in the projection, so
 * only the allow-listed tag set reaches the browser, and it keeps rendering
 * under the global .portal-service-description rules rather than re-stating
 * that typography here.
 *
 * Still browse-only: nothing here orders or charges. The primary action is the
 * existing support ticket flow, and the secondary one collects this investment
 * in the header cart so several can be raised in one conversation.
 *
 * The contact label is not fixed copy — Franchise in a Box is William's
 * engagement, so it names him. Every other investment stays with the team.
 */

/** Splits "$97 / month" so the cadence sits quietly beside the amount. */
function splitPrice(label: string): { amount: string; cadence: string | null } {
  const separator = label.indexOf(" / ");
  if (separator === -1) return { amount: label, cadence: null };
  return { amount: label.slice(0, separator), cadence: label.slice(separator + 1) };
}

export function StoreServiceDetail({
  service,
  folderName,
  backHref,
}: {
  service: StoreServiceView;
  folderName: string | null;
  backHref: string;
}) {
  const { amount, cadence } = splitPrice(service.recurringLabel ?? service.priceLabel);
  const contactLabel = storeContactLabel(service.name);

  return (
    <div className={styles.detail}>
      <Link href={backHref} className="portal-back">
        <ArrowLeft aria-hidden={true} />
        {folderName ?? "Store"}
      </Link>

      <header className={styles.head}>
        <span className={styles.eyebrow}>{folderName ?? "Wolf Forge catalogue"}</span>
        <h1>{service.name}</h1>
        <div className={styles.headMeta}>
          <span className={styles.tag} data-recurring={service.recurring}>
            {service.recurring ? "Recurring" : "One-time"}
          </span>
        </div>
      </header>

      {service.imageUrl ? (
        <div className={styles.hero}>
          <img src={service.imageUrl} alt="" />
        </div>
      ) : null}

      <div className={styles.body}>
        {service.descriptionHtml ? (
          <div
            className="portal-service-description"
            dangerouslySetInnerHTML={{ __html: service.descriptionHtml }}
          />
        ) : (
          <p className="portal-empty">
            A full description for this service is on its way. Ask us and we will walk you through
            it.
          </p>
        )}

        <aside className={styles.aside}>
          <div className={styles.priceCard}>
            <span className={styles.price}>
              {amount}
              {cadence ? <em>{cadence}</em> : null}
            </span>

            <dl className={styles.facts}>
              <div>
                <dt>Billing</dt>
                <dd>{service.recurring ? "Recurring" : "One-time"}</dd>
              </div>
              {folderName ? (
                <div>
                  <dt>Category</dt>
                  <dd>{folderName}</dd>
                </div>
              ) : null}
            </dl>

            <div className={styles.actions}>
              <Link className={styles.cta} href="/account/messages?compose=1">
                {contactLabel}
                <ArrowRight aria-hidden={true} />
              </Link>

              <AddToCartButton
                variant="full"
                item={{
                  id: service.id,
                  name: service.name,
                  priceLabel: service.recurringLabel ?? service.priceLabel,
                  amount: service.amount,
                  currency: service.currency,
                  recurring: service.recurring,
                  cadence: service.cadence,
                  categoryName: folderName,
                  summary: service.summary,
                }}
              />
            </div>

            <p className={styles.asideNote}>
              {contactLabel === "Talk to William"
                ? "William runs this engagement personally and will confirm scope, timing and territory."
                : "Your Wolf Forge team will confirm scope, timing and the right starting point."}
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
