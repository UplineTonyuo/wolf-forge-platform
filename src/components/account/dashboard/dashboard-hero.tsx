import { ArrowDown } from "lucide-react";
import type { AttentionChip } from "../../../domain/client-portal/next-action";
import styles from "./next-action-flow.module.css";

/**
 * The Dashboard's command panel.
 *
 * Same navy identity the portal already uses; what changes is that the greeting
 * now carries the account's actual state on the right, so the answer to "how
 * much is waiting on me" is visible before anything is read.
 *
 * The counter is an anchor rather than a button: it moves to the queue below,
 * which is behaviour a link already has, keeps the panel a server component,
 * and still works with JavaScript unavailable.
 */
export function DashboardHero({
  companyName,
  greeting,
  contextLine,
  count,
  chips,
}: {
  companyName: string;
  greeting: string;
  contextLine: string;
  /** The real number of attention items. Zero hides the counter entirely. */
  count: number;
  chips: AttentionChip[];
}) {
  return (
    <section className={styles.hero}>
      <div className={styles.heroCopy}>
        <span className="portal-eyebrow">{companyName}</span>
        <h1>{greeting}</h1>
        <p>{contextLine}</p>
      </div>

      {count > 0 ? (
        <div className={styles.heroAside}>
          <a className={styles.counter} href="#portal-attention">
            {/*
              * Keyed on the count so the figure replays its entrance whenever
              * the real number changes between renders. There is no local
              * counter behind this — the value is the server's, and a stale one
              * simply never animates.
              */}
            <strong key={count} className={styles.counterValue}>
              {count}
            </strong>
            <span className={styles.counterLabel}>
              {count === 1 ? "action" : "actions"}
              <ArrowDown aria-hidden={true} />
            </span>
          </a>

          {chips.length > 0 ? (
            <ul className={styles.chips}>
              {chips.map((chip) => (
                <li key={chip.id} className={styles.chip} data-tone={chip.tone}>
                  {chip.label}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
