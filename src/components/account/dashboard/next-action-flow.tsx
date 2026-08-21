import {
  ArrowRight,
  CalendarClock,
  ClipboardList,
  FolderKanban,
  MessageSquare,
  ReceiptText,
} from "lucide-react";
import Link from "next/link";
import type { ComponentType } from "react";
import type { NextAction, NextActionFlow as Flow } from "../../../domain/client-portal/next-action";
import styles from "./next-action-flow.module.css";

/**
 * What the client should do next.
 *
 * The Dashboard's old attention list gave five different problems the same
 * visual weight, which meant an overdue invoice and an unfinished onboarding
 * form looked equally urgent and the client had to read all five to find the
 * one that mattered. This section ranks them instead: the first is presented at
 * a size that answers the question on sight, and the rest follow at a calmer
 * weight.
 *
 * Server rendered, like the rest of the Dashboard. Every entrance here is CSS,
 * so there is no client bundle, no effect and no state — and nothing to
 * disagree with the server's own count.
 */

const actionIcons: Record<string, ComponentType<{ "aria-hidden": true }>> = {
  invoices: ReceiptText,
  subscriptions: CalendarClock,
  projects: FolderKanban,
  messages: MessageSquare,
  onboarding: ClipboardList,
};

function ActionIcon({ id }: { id: string }) {
  const Icon = actionIcons[id] ?? ClipboardList;
  return <Icon aria-hidden={true} />;
}

/**
 * The one action that matters most.
 *
 * Larger, deeper and first in the tab order. Urgency is carried by a hairline
 * accent and the eyebrow, not by a red card: a client whose invoice is late
 * does not need to be shouted at, they need to know which invoice and where to
 * pay it.
 */
function FeaturedActionCard({ action }: { action: NextAction }) {
  return (
    <Link
      href={action.href}
      className={styles.featured}
      data-tone={action.tone}
      data-urgent={action.urgent || undefined}
    >
      <span className={styles.featuredHead}>
        <span className={styles.eyebrow}>
          <ActionIcon id={action.id} />
          {action.eyebrow}
        </span>
        {action.amountLabel ? (
          <span className={styles.amount}>{action.amountLabel}</span>
        ) : null}
      </span>

      <strong className={styles.featuredTitle}>{action.title}</strong>

      {action.detail ? <span className={styles.featuredDetail}>{action.detail}</span> : null}
      {action.meta ? <span className={styles.meta}>{action.meta}</span> : null}

      <span className={styles.featuredCta}>
        {action.cta}
        <ArrowRight aria-hidden={true} />
      </span>
    </Link>
  );
}

/** Everything after the first. Same information, quieter. */
function ActionCard({ action, index }: { action: NextAction; index: number }) {
  return (
    <li
      className={styles.secondaryItem}
      /* Drives the entrance stagger; the featured card occupies slot 0. */
      style={{ "--wf-action-index": index + 1 } as React.CSSProperties}
    >
      <Link href={action.href} className={styles.card} data-tone={action.tone}>
        <span className={styles.eyebrow}>
          <ActionIcon id={action.id} />
          {action.eyebrow}
        </span>

        <strong className={styles.cardTitle}>{action.title}</strong>

        {action.detail ? <span className={styles.cardDetail}>{action.detail}</span> : null}
        {action.meta ? <span className={styles.meta}>{action.meta}</span> : null}

        <span className={styles.cardCta}>
          {action.cta}
          <ArrowRight aria-hidden={true} />
        </span>
      </Link>
    </li>
  );
}

export function NextActionFlowSection({ flow }: { flow: Flow }) {
  if (!flow.featured) return null;

  return (
    <section className={styles.section} aria-labelledby="portal-attention">
      <header className="portal-section-head">
        <h2 id="portal-attention">Needs your attention</h2>
      </header>

      {/*
        * One list, so the whole queue is a single set of items to assistive
        * technology and to the keyboard. The featured card is the first item
        * rather than a separate landmark above the list.
        */}
      <ul className={styles.flow}>
        <li
          className={styles.featuredItem}
          style={{ "--wf-action-index": 0 } as React.CSSProperties}
        >
          <FeaturedActionCard action={flow.featured} />
        </li>

        {flow.secondary.map((action, index) => (
          <ActionCard key={action.id} action={action} index={index} />
        ))}
      </ul>
    </section>
  );
}
