"use client";

import {
  Building2,
  ExternalLink,
  MessageSquare,
  MessageSquarePlus,
  Plus,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  type FormEvent,
} from "react";
import { createPortal } from "react-dom";
import { createInternalTicketAction } from "../../app/actions/tickets";
import {
  intentCadenceLabels,
  type InvestmentIntentView,
} from "../../domain/store-interest/projections";
import styles from "./investment-intent.module.css";

/**
 * The per-row Investment Intent actions.
 *
 * One compact `+` per row replaces the two links that used to sit in the cell.
 * Open client and Open investment keep the exact destinations and permission
 * behaviour they always had -- they only moved into the menu. The menu gains a
 * third entry that depends on the row: CREATE an investment conversation when
 * there is no live one, OPEN it when there is.
 *
 * `activeTicketId` is advisory. It decides which of the two entries to show,
 * never whether a second conversation is allowed -- the partial unique index on
 * public.tickets is the authority, and this component is built to lose that
 * race politely.
 */

/**
 * The read model carries no client contact identity, so there is no first name
 * to greet with. Inventing one would put a stranger's name in a real client's
 * inbox, so the neutral greeting is the truthful default rather than a
 * placeholder waiting to be replaced.
 */
export function conversationGreeting(): string {
  return "Hi there,";
}

export function defaultConversationSubject(view: {
  serviceName: string;
}): string {
  return `Interested in ${view.serviceName}`;
}

/**
 * Deliberately says nothing about carts, analytics, tracking or internal
 * status. The client is being told their interest was noticed -- not that they
 * were watched.
 */
export function defaultConversationMessage(view: {
  serviceName: string;
}): string {
  return [
    conversationGreeting(),
    "",
    `We noticed you're interested in ${view.serviceName}.`,
    "",
    "If you'd like, we can walk you through the scope, timing, what's included, and the best next steps.",
    "",
    "Feel free to send us any questions you have.",
  ].join("\n");
}

export function InvestmentIntentActions({
  view,
  onConversationCreated,
}: {
  view: InvestmentIntentView;
  onConversationCreated: (intentId: string, ticketId: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [draftOpen, setDraftOpen] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  const label = `${view.companyName} and ${view.serviceName}`;

  return (
    <div ref={containerRef} className={`client-actions-picker ${styles.rowActionPicker}`}>
      <button
        type="button"
        className={
          menuOpen
            ? "client-actions-trigger is-open"
            : "client-actions-trigger"
        }
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label={`Actions for ${label}`}
        onClick={() => setMenuOpen((value) => !value)}
      >
        <Plus aria-hidden="true" />
      </button>

      <div
        className={menuOpen ? "client-actions-menu is-open" : "client-actions-menu"}
        role="menu"
        aria-hidden={!menuOpen}
        aria-label={`Actions for ${label}`}
      >
        <Link
          role="menuitem"
          tabIndex={menuOpen ? 0 : -1}
          className="client-actions-option"
          href={`/clients/${view.companyId}`}
          onClick={() => setMenuOpen(false)}
        >
          <Building2 aria-hidden="true" />
          Open client
        </Link>

        <Link
          role="menuitem"
          tabIndex={menuOpen ? 0 : -1}
          className="client-actions-option"
          href={`/services/${view.serviceId}`}
          onClick={() => setMenuOpen(false)}
        >
          <ExternalLink aria-hidden="true" />
          Open investment
        </Link>

        {view.activeTicketId ? (
          <Link
            role="menuitem"
            tabIndex={menuOpen ? 0 : -1}
            className="client-actions-option"
            href={`/tickets/${view.activeTicketId}`}
            onClick={() => setMenuOpen(false)}
          >
            <MessageSquare aria-hidden="true" />
            Open investment conversation
          </Link>
        ) : (
          <button
            type="button"
            role="menuitem"
            tabIndex={menuOpen ? 0 : -1}
            className="client-actions-option"
            onClick={() => {
              setMenuOpen(false);
              setDraftOpen(true);
            }}
          >
            <MessageSquarePlus aria-hidden="true" />
            Create investment conversation
          </button>
        )}
      </div>

      {draftOpen ? (
        <ConversationDraftModal
          view={view}
          onClose={() => setDraftOpen(false)}
          onCreated={(ticketId) => {
            setDraftOpen(false);
            onConversationCreated(view.id, ticketId);
          }}
        />
      ) : null}
    </div>
  );
}

function ConversationDraftModal({
  view,
  onClose,
  onCreated,
}: {
  view: InvestmentIntentView;
  onClose: () => void;
  onCreated: (ticketId: string) => void;
}) {
  const router = useRouter();
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  const [subject, setSubject] = useState(() => defaultConversationSubject(view));
  const [message, setMessage] = useState(() => defaultConversationMessage(view));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) onClose();
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [pending, onClose]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;

    if (!subject.trim() || !message.trim()) {
      setError("Complete the subject and message.");
      return;
    }

    setError(null);

    startTransition(async () => {
      const result = await createInternalTicketAction({
        requestId: crypto.randomUUID(),
        companyId: view.companyId,
        investmentServiceId: view.serviceId,
        subject: subject.trim(),
        message: message.trim(),
        // The ordinary default. Nothing about an investment conversation
        // justifies a different priority, and the user is not asked.
        priority: "normal",
      });

      if (result.ok) {
        onCreated(result.ticketId);
        router.refresh();
        return;
      }

      setError(result.error);

      /*
       * Lost the race, or the row was already stale. Reload so the menu flips
       * to "Open investment conversation" on authoritative data instead of
       * leaving the user staring at a failed Create.
       */
      if (result.conflict) router.refresh();
    });
  };

  if (!mounted) return null;

  return createPortal(
    <div className="client-balance-modal is-open" aria-hidden={false}>
      <button
        type="button"
        className="client-balance-backdrop"
        aria-label="Close investment conversation"
        onClick={() => {
          if (!pending) onClose();
        }}
      />

      <section
        className="client-balance-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Create investment conversation"
      >
        <header className="client-balance-panel-header">
          <div>
            <span>Investment conversation</span>
            <h2>Create investment conversation</h2>
          </div>

          <button type="button" onClick={onClose} disabled={pending} aria-label="Close">
            <X aria-hidden="true" />
          </button>
        </header>

        <form className="client-balance-form" onSubmit={submit}>
          <dl className={styles.draftContext}>
            <div className={styles.draftContextRow}>
              <dt className={styles.draftContextLabel}>Client</dt>
              <dd className={styles.draftContextValue}>{view.companyName}</dd>
            </div>

            <div className={styles.draftContextRow}>
              <dt className={styles.draftContextLabel}>Investment</dt>
              <dd className={styles.draftContextValue}>
                <strong>{view.serviceName}</strong>
                <span className={styles.draftContextMeta}>
                  {[
                    view.categoryName,
                    view.priceLabel,
                    intentCadenceLabels[view.cadence],
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </dd>
            </div>
          </dl>

          <label className="client-balance-field">
            <span>Subject</span>
            <input
              value={subject}
              disabled={pending}
              onChange={(event) => setSubject(event.target.value)}
            />
          </label>

          <label className="client-balance-field">
            <span>Message</span>
            <textarea
              rows={9}
              value={message}
              disabled={pending}
              onChange={(event) => setMessage(event.target.value)}
            />
          </label>

          {error ? (
            <p className="client-balance-error" role="alert">
              {error}
            </p>
          ) : null}

          <footer className="client-balance-actions">
            <button type="button" onClick={onClose} disabled={pending}>
              Cancel
            </button>
            <button type="submit" disabled={pending}>
              {pending ? "Creating…" : "Create conversation"}
            </button>
          </footer>
        </form>
      </section>
    </div>,
    document.body,
  );
}
