"use client";

import { Check, ChevronDown } from "lucide-react";
import { useId, useState } from "react";
import { scopeSummaryLine, type ServiceScope } from "../../../domain/services/service-summary";
import styles from "./invoice-scope.module.css";

/**
 * What a line item actually covers, on an invoice that should look like one.
 *
 * The catalogue descriptions are captured marketing HTML — emoji headlines and
 * runs of "✅ 100 Citations". Flattened into plain text, which is what this
 * replaces, they rendered as one long unbroken paragraph of check marks under
 * every line. That is the "cheap" the redesign is about.
 *
 * Collapsed is the default and shows one line: what a person wrote about the
 * service, or an honest count. Expanded shows the deliverables as a list. The
 * content is entirely the original description — `composeServiceScope` removes
 * emoji, bullet glyphs and duplicates, and invents nothing.
 *
 * Requirements are separated out and labelled, because "You must supply a 500
 * word article" appears beside real inclusions in the captures and must not be
 * listed as something the client is receiving.
 */
export function InvoiceItemScope({ scope }: { scope: ServiceScope }) {
  const panelId = useId();
  const [open, setOpen] = useState(false);

  /* One source of truth for the collapsed line: the internal invoice table
     renders the same string, so the two surfaces cannot describe an item
     differently. */
  const summary = scopeSummaryLine(scope);

  if (summary.length === 0 && !scope.hasDetail) return null;

  /*
   * A toggle only when it reveals something the summary does not already say.
   * A prose-only description whose single note *is* the summary gets no
   * control, because opening it would show the same sentence again.
   */
  const expandable =
    scope.deliverables.length > 0
    || scope.requirements.length > 0
    || scope.notes.some((note) => note !== summary);

  return (
    <div className={styles.scope}>
      {summary.length > 0 ? <span className={styles.summary}>{summary}</span> : null}

      {expandable ? (
        <>
          <button
            type="button"
            className={styles.toggle}
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? "Hide deliverables" : "View deliverables"}
            <ChevronDown className={styles.chevron} aria-hidden={true} />
          </button>

          {/*
            * Kept mounted and hidden with the `hidden` attribute rather than
            * unmounted, so the control's aria-controls always resolves to a
            * real element and assistive technology is not pointed at nothing.
            */}
          <div className={styles.panel} id={panelId} hidden={!open}>
            {scope.deliverables.length > 0 ? (
              <ul className={styles.list}>
                {scope.deliverables.map((line) => (
                  <li className={styles.item} key={line}>
                    <Check className={styles.mark} aria-hidden={true} />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            ) : null}

            {scope.requirements.length > 0 ? (
              <div className={styles.group}>
                <span className={styles.groupLabel}>What we&rsquo;ll need from you</span>
                <ul className={styles.list} data-tone="requirement">
                  {scope.requirements.map((line) => (
                    <li className={styles.item} key={line}>
                      <span className={styles.dash} aria-hidden={true} />
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {scope.notes
              .filter((note) => note !== summary)
              .map((note) => (
                <p className={styles.note} key={note}>
                  {note}
                </p>
              ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
