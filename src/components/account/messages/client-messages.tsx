"use client";

import { ArrowRight, LoaderCircle, MessagesSquare, Plus, Send } from "lucide-react";
import { RouteTransitionLink as Link } from "../../shell/route-transition";
import { lazy, Suspense, useEffect, useRef, useState, useTransition } from "react";
import { createClientTicketAction } from "../../../app/actions/tickets";
import { ticketAttention } from "../../../domain/client-portal/attention";
import type { ClientTicketSummary } from "../../../domain/tickets/schema";
import { formatDateTime } from "../../../lib/format";
import { useBrowserTimeZone } from "../../../lib/use-browser-time-zone";
import { OPEN_MESSAGE_COMPOSER_EVENT } from "../command/client-quick-action";
import { AttentionPill } from "../ui/attention-pill";
import { cartDraftBody, cartDraftSubject } from "../../../domain/client-portal/cart";
import { useCart } from "../cart/cart-store";
import { PortalDialog } from "../ui/portal-dialog";
import ticketStyles from "../../tickets/tickets.module.css";

// The dialog mounts its children only when opened; keep editor code off the list's initial path.
const TicketRichTextEditor = lazy(() => import("../../tickets/ticket-rich-text-editor").then((module) => ({ default: module.TicketRichTextEditor })));

function EditorLoading() {
  return <div className={ticketStyles.ticketRichEditor} role="status">
    <div className={ticketStyles.ticketRichToolbar} aria-hidden="true"><span className="internal-page-skeleton-bar" style={{ width: 180 }} /></div>
    <div className={ticketStyles.ticketRichComposer}>Loading message editor…</div>
  </div>;
}

/**
 * The client communication centre.
 *
 * The underlying model is unchanged: these are public.tickets rows, created and
 * replied to through the same audited RPCs, with RLS deciding which the account
 * can read and ticket_messages_authorized_select hiding every internal note.
 * What changed is the presentation — a client is having a conversation, not
 * filing a ticket.
 *
 * There is deliberately no unread dot. public.ticket_messages carries no
 * per-recipient read state and public.tickets has no last-seen column, so an
 * unread indicator would be invented. "Waiting on you" is a real status the
 * team sets, and it carries the same signal honestly.
 *
 * This page owns the only New message composer in the portal. The command bar's
 * quick action asks it to open rather than mounting a second one, so validation
 * and submission have exactly one implementation.
 */
export function ClientMessages({
  summaries,
  /** True when arriving from the command bar's "Message Wolf Forge" action. */
  composeOnMount = false,
  /** True when arriving from the cart's "Discuss these investments" action. */
  seedFromCart = false,
}: {
  summaries: ClientTicketSummary[];
  composeOnMount?: boolean;
  seedFromCart?: boolean;
}) {
  const timeZone = useBrowserTimeZone();
  const [composerOpen, setComposerOpen] = useState(composeOnMount);
  const subjectRef = useRef<HTMLInputElement>(null);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");

  /*
   * The cart hands its selection over here rather than dropping it: the client
   * assembled that list precisely so they would not have to retype it, and a
   * composer that opened empty made the cart's own promise — "this starts a
   * conversation" — false.
   *
   * Adjusted during render rather than from an effect, the pattern PortalDialog
   * and HeaderPanel already use here: the cart hydrates from localStorage one
   * render after mount, so a lazy initialiser would read an empty cart.
   */
  const cartItems = useCart();
  const [cartSeeded, setCartSeeded] = useState(!seedFromCart);

  if (!cartSeeded && cartItems.length > 0) {
    setCartSeeded(true);
    setSubject(cartDraftSubject(cartItems));
    setMessage(cartDraftBody(cartItems));
  }
  const [requestId] = useState(() => crypto.randomUUID());

  /*
   * The editor is uncontrolled, so it is remounted rather than reset: bumping
   * this key is what clears it after a send and what lets a later cart handoff
   * seed it again.
   */
  const [composerKey, setComposerKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /* The quick action broadcasts; this page answers. */
  useEffect(() => {
    const open = () => setComposerOpen(true);
    window.addEventListener(OPEN_MESSAGE_COMPOSER_EVENT, open);
    return () => window.removeEventListener(OPEN_MESSAGE_COMPOSER_EVENT, open);
  }, []);

  const live = summaries.filter((ticket) => !ticket.archived_at);
  const waiting = live.filter((ticket) => ticketAttention(ticket.status).tone === "waiting_on_you");

  // Most recently active first, so the conversation the client is thinking
  // about is the one at the top.
  const ordered = [...live].sort((left, right) =>
    (right.last_message_at ?? right.updated_at).localeCompare(
      left.last_message_at ?? left.updated_at,
    ),
  );

  const canSubmit = subject.trim().length > 0 && message.trim().length > 0;

  function createConversation() {
    if (!canSubmit) return;
    setError(null);
    startTransition(async () => {
      const result = await createClientTicketAction({ requestId, subject, message });
      if (!result.ok) {
        setError(result.error);
        return;
      }

      // Sent: drop the draft and remount the editor so the next one opens clean.
      setSubject("");
      setMessage("");
      setComposerKey((key) => key + 1);
    });
  }

  /* A stray backdrop click must not discard a half-written message. */
  const closeComposer = () => {
    if (pending) return;
    setComposerOpen(false);
  };

  return (
    <div className="portal-page">
      <header className="portal-page-head portal-page-head-actions">
        <div>
          <h1>Tickets</h1>
          <p>
            {live.length === 0
              ? "Talk to Wolf Forge here. Every reply stays attached to your account."
              : waiting.length > 0
                ? `${waiting.length} ${waiting.length === 1 ? "conversation is" : "conversations are"} waiting on your reply.`
                : "Wolf Forge has everything needed right now."}
          </p>
        </div>

        {/*
         * Kept alongside the command bar's quick action rather than removed.
         * Both open the same single composer, and starting a conversation is
         * the primary job of this page — a client should not have to know that
         * a global `+` also offers it.
         */}
        <button
          className="portal-primary-action"
          type="button"
          onClick={() => setComposerOpen(true)}
        >
          <Plus aria-hidden={true} />
          New message
        </button>
      </header>

      {ordered.length === 0 ? (
        <section className="portal-zero-state">
          <MessagesSquare aria-hidden={true} />
          <h2>No conversations yet</h2>
          <p>
            When you need something (a question, a change, a new idea), start a message and the
            Wolf Forge team picks it up here.
          </p>
          <button
            className="portal-primary-action"
            type="button"
            onClick={() => setComposerOpen(true)}
          >
            Start a conversation
          </button>
        </section>
      ) : (
        <ul className="portal-message-list" aria-label="Your tickets">
          {ordered.map((ticket) => {
            const attention = ticketAttention(ticket.status);

            return (
              <li key={ticket.ticket_id}>
                <Link href={`/account/messages/${ticket.ticket_id}`} className="portal-message-row">
                  <span className="portal-message-main">
                    <span className="portal-project-ref">{ticket.public_ref}</span>
                    <strong>{ticket.subject}</strong>
                    <span>
                      {ticket.message_count} {ticket.message_count === 1 ? "message" : "messages"} ·
                      updated {formatDateTime(ticket.last_message_at ?? ticket.updated_at, timeZone)}
                    </span>
                  </span>

                  <span className="portal-message-meta">
                    <AttentionPill tone={attention.tone} label={attention.label} />
                    <ArrowRight aria-hidden={true} />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <PortalDialog
        open={composerOpen}
        onClose={closeComposer}
        title="New message"
        description="Tell us what you need. Your company and identity are attached securely from your account."
        initialFocusRef={subjectRef}
        closeOnBackdrop={!pending}
        footer={
          <>
            <button
              className="portal-ghost-action"
              type="button"
              onClick={closeComposer}
              disabled={pending}
            >
              Cancel
            </button>
            <button
              className="portal-primary-action"
              type="submit"
              form="portal-new-message"
              aria-busy={pending || undefined}
              disabled={pending || !canSubmit}
            >
              {pending ? (
                <LoaderCircle className="spinner" aria-hidden={true} />
              ) : (
                <Send aria-hidden={true} />
              )}
              Send message
            </button>
          </>
        }
      >
        <form
          id="portal-new-message"
          className="portal-dialog-form"
          onSubmit={(event) => {
            event.preventDefault();
            createConversation();
          }}
        >
          <label>
            <span>Subject</span>
            <input
              ref={subjectRef}
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              maxLength={500}
              required
            />
          </label>

          {/*
            * The same editor the ticket reply composer uses, not a second one:
            * toolbar, typography, focus treatment and keyboard behaviour are
            * defined once. It opens on whatever the cart seeded, if anything.
            */}
          <div className="portal-dialog-field">
            <span>Message</span>
            <Suspense fallback={<EditorLoading />}><TicketRichTextEditor
              key={composerKey}
              label="Write a message"
              placeholder="Write a message..."
              initialValue={message}
              disabled={pending}
              onChange={setMessage}
            /></Suspense>
          </div>

          {error ? (
            <p className="portal-dialog-error" role="alert">
              {error}
            </p>
          ) : null}
        </form>
      </PortalDialog>
    </div>
  );
}
