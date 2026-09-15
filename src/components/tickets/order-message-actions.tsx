"use client";

import {
  ArrowLeft,
  Copy,
  Forward,
  MessageSquareReply,
  MoreHorizontal,
  Search,
  SmilePlus,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  forwardTicketMessageToTeamAction,
  toggleTicketMessageReactionAction,
} from "../../app/actions/tickets";
import type { TeamConversationView, TeamReactionView } from "../../domain/team/projections";
import { randomUuid } from "../../lib/random-uuid";
import {
  teamPickerReactionCodes,
  teamReactionEmoji,
  type TeamReactionCode,
} from "../../domain/team/schema";
import { TeamReactionChips } from "../team/team-message-reactions";
import { useAnimatedPopover } from "../ui/use-animated-popover";
import styles from "./tickets.module.css";

const reactionLabels: Record<TeamReactionCode, string> = {
  like: "Like",
  heart: "Heart",
  laugh: "Laugh",
  wow: "Wow",
  celebrate: "Celebrate",
  fire: "Fire",
  eyes: "Eyes",
  pray: "Pray",
  check: "Check",
};

export type OrderReplyTarget = {
  messageId: string;
  ticketId: string;
  authorName: string;
  body: string;
};

export function OrderMessageActions({
  message,
  sourceLabel,
  reactions,
  destinations,
  onReply,
  canReact,
}: {
  message: OrderReplyTarget;
  sourceLabel: string;
  reactions: TeamReactionView[];
  destinations: TeamConversationView[];
  onReply?: (message: OrderReplyTarget) => void;
  canReact: boolean;
}) {
  const router = useRouter();
  const {
    render: menuRendered,
    phase: menuPhase,
    animateOpen: animateMenuOpen,
    show: showMenu,
    showWithoutMotion: showMenuWithoutMotion,
    hide: hideMenu,
  } = useAnimatedPopover(150);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstItemRef = useRef<HTMLButtonElement>(null);
  const firstReactionRef = useRef<HTMLButtonElement>(null);
  const forwardCardRef = useRef<HTMLDivElement>(null);
  const forwardSearchRef = useRef<HTMLInputElement>(null);
  const mutationRef = useRef(false);
  const forwardRequestRef = useRef({ signature: "", id: "" });
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [reactionPicker, setReactionPicker] = useState(false);
  const [forwardOpen, setForwardOpen] = useState(false);
  const [forwardQuery, setForwardQuery] = useState("");
  const [destination, setDestination] = useState<TeamConversationView | null>(null);
  const [comment, setComment] = useState("");
  const [forwardError, setForwardError] = useState<string | null>(null);

  const closeMenu = useCallback(() => {
    hideMenu();
    setReactionPicker(false);
    triggerRef.current?.focus({ preventScroll: true });
  }, [hideMenu]);

  const closeForward = useCallback(() => {
    setForwardOpen(false);
    setDestination(null);
    setForwardQuery("");
    setForwardError(null);
    triggerRef.current?.focus({ preventScroll: true });
  }, []);

  const filteredDestinations = useMemo(() => {
    const needle = forwardQuery.trim().toLocaleLowerCase();
    if (!needle) return destinations;
    return destinations.filter((item) =>
      [item.name, item.destinationSearchText].join(" ").toLocaleLowerCase().includes(needle),
    );
  }, [destinations, forwardQuery]);

  useEffect(() => {
    if (!menuRendered) return;
    (reactionPicker ? firstReactionRef : firstItemRef).current?.focus();
    function dismiss(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) closeMenu();
    }
    document.addEventListener("click", dismiss);
    return () => document.removeEventListener("click", dismiss);
  }, [closeMenu, menuRendered, reactionPicker]);

  useEffect(() => {
    if (!forwardOpen) return;
    (destination
      ? forwardCardRef.current?.querySelector<HTMLTextAreaElement>("textarea")
      : forwardSearchRef.current
    )?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeForward();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = forwardCardRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown, { capture: true });
    return () => document.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [closeForward, destination, forwardOpen]);

  async function copy() {
    if (mutationRef.current) return;
    mutationRef.current = true;
    setBusy(true);
    setFeedback("");
    try {
      await navigator.clipboard.writeText(message.body);
      setFeedback("Message copied.");
      closeMenu();
    } catch {
      setFeedback("Could not copy. Try again or select the message text.");
    } finally {
      mutationRef.current = false;
      setBusy(false);
    }
  }

  async function toggleReaction(code: TeamReactionCode) {
    if (mutationRef.current) return;
    mutationRef.current = true;
    setBusy(true);
    setFeedback("");
    try {
      const result = await toggleTicketMessageReactionAction(message.messageId, code);
      if (!result.ok) {
        setFeedback(result.error);
        return;
      }
      closeMenu();
      router.refresh();
    } catch {
      setFeedback("Could not update the reaction. Please try again.");
    } finally {
      mutationRef.current = false;
      setBusy(false);
    }
  }

  async function sendForward() {
    if (!destination || mutationRef.current) return;
    const normalizedComment = comment.trim();
    const signature = destination.conversationId + "\0" + normalizedComment;
    if (forwardRequestRef.current.signature !== signature) {
      forwardRequestRef.current = { signature, id: randomUuid() };
    }
    mutationRef.current = true;
    setBusy(true);
    setForwardError(null);
    try {
      const result = await forwardTicketMessageToTeamAction({
        requestId: forwardRequestRef.current.id,
        sourceMessageId: message.messageId,
        destinationConversationId: destination.conversationId,
        comment: normalizedComment || null,
      });
      if (!result.ok) {
        setForwardError(result.error);
        return;
      }
      forwardRequestRef.current = { signature: "", id: "" };
      setComment("");
      setFeedback("Message forwarded.");
      closeForward();
    } catch {
      setForwardError("Could not forward this message. Your comment is still here.");
    } finally {
      mutationRef.current = false;
      setBusy(false);
    }
  }

  const menuItems = [
    onReply ? "reply" : null,
    canReact ? "react" : null,
    destinations.length > 0 ? "forward" : null,
    "copy",
  ].filter(Boolean);

  return (
    <>
      <div
        ref={rootRef}
        className={styles.orderMessageActions}
        data-open={menuRendered || undefined}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) hideMenu();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && menuRendered) {
            event.preventDefault();
            event.stopPropagation();
            closeMenu();
          }
          if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          if (!menuRendered) {
            showMenuWithoutMotion();
            return;
          }
          const items = Array.from(
            rootRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"], [role="menuitemcheckbox"]') ?? [],
          );
          if (!items.length) return;
          const current = items.indexOf(document.activeElement as HTMLButtonElement);
          const next = event.key === "Home"
            ? 0
            : event.key === "End"
              ? items.length - 1
              : event.key === "ArrowUp"
                ? (current - 1 + items.length) % items.length
                : (current + 1) % items.length;
          items[next]?.focus();
        }}
      >
        <button
          ref={triggerRef}
          type="button"
          aria-label="Message actions"
          aria-haspopup="menu"
          aria-expanded={menuRendered}
          aria-controls={menuRendered ? menuId : undefined}
          onClick={(event) => {
            if (menuRendered) closeMenu();
            else {
              setFeedback("");
              setReactionPicker(false);
              if (event.detail === 0) showMenuWithoutMotion();
              else showMenu();
            }
          }}
        >
          <MoreHorizontal aria-hidden="true" />
        </button>

        {menuRendered ? (
          <div
            id={menuId}
            role="menu"
            aria-label={reactionPicker ? "Reactions" : "Message actions"}
            className={styles.orderMessageMenu}
            data-phase={menuPhase}
            data-motion={animateMenuOpen || undefined}
          >
            {reactionPicker ? (
              <>
                <button
                  type="button"
                  role="menuitem"
                  aria-label="Back to message actions"
                  onClick={() => setReactionPicker(false)}
                >
                  <ArrowLeft aria-hidden="true" />
                  Back
                </button>
                <div className={styles.orderReactionPicker}>
                  {teamPickerReactionCodes.map((code, index) => (
                    <button
                      key={code}
                      ref={index === 0 ? firstReactionRef : undefined}
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={reactions.some((reaction) =>
                        reaction.code === code && reaction.reactedByMe
                      )}
                      aria-label={reactionLabels[code]}
                      disabled={busy}
                      onClick={() => void toggleReaction(code)}
                    >
                      <span aria-hidden="true">{teamReactionEmoji[code]}</span>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <>
                {onReply ? (
                  <button
                    ref={firstItemRef}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      closeMenu();
                      onReply(message);
                    }}
                  >
                    <MessageSquareReply aria-hidden="true" />
                    Reply
                  </button>
                ) : null}
                {canReact ? (
                  <button
                    ref={!onReply ? firstItemRef : undefined}
                    type="button"
                    role="menuitem"
                    onClick={() => setReactionPicker(true)}
                  >
                    <SmilePlus aria-hidden="true" />
                    React
                  </button>
                ) : null}
                {destinations.length > 0 ? (
                  <button
                    ref={!onReply && !canReact ? firstItemRef : undefined}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      hideMenu();
                      setForwardOpen(true);
                    }}
                  >
                    <Forward aria-hidden="true" />
                    Forward
                  </button>
                ) : null}
                <button
                  ref={menuItems.length === 1 ? firstItemRef : undefined}
                  type="button"
                  role="menuitem"
                  aria-disabled={busy}
                  onClick={() => void copy()}
                >
                  <Copy aria-hidden="true" />
                  {busy ? "Copying…" : "Copy"}
                </button>
              </>
            )}
            {feedback && feedback !== "Message copied." && feedback !== "Message forwarded." ? (
              <p role="alert">{feedback}</p>
            ) : null}
          </div>
        ) : null}
      </div>

      {reactions.length > 0 ? (
        <div className={styles.orderReactionChips} role="group" aria-label="Message reactions">
          <TeamReactionChips reactions={reactions} onToggle={(code) => void toggleReaction(code)} />
        </div>
      ) : null}

      <span className="sr-only" role="status">
        {feedback === "Message copied." || feedback === "Message forwarded." ? feedback : ""}
      </span>

      {forwardOpen && typeof document !== "undefined"
        ? createPortal(
            <div
              className={styles.orderForwardBackdrop}
              onPointerDown={(event) => {
                if (event.target === event.currentTarget && !busy) closeForward();
              }}
            >
              <div
                ref={forwardCardRef}
                role="dialog"
                aria-modal="true"
                aria-label="Forward message"
                className={styles.orderForwardCard}
              >
                <header>
                  {destination ? (
                    <button
                      type="button"
                      aria-label="Back to destinations"
                      onClick={() => {
                        setDestination(null);
                        setForwardError(null);
                      }}
                      disabled={busy}
                    >
                      <ArrowLeft aria-hidden="true" />
                    </button>
                  ) : <strong>Forward message</strong>}
                  <button
                    type="button"
                    aria-label="Close forward message"
                    onClick={closeForward}
                    disabled={busy}
                  >
                    <X aria-hidden="true" />
                  </button>
                </header>

                {destination ? (
                  <div className={styles.orderForwardReview}>
                    <h2>Forward to: {destination.name}</h2>
                    <div className={styles.orderForwardPreview}>
                      <span>Forwarded from {sourceLabel}</span>
                      <strong>{message.authorName}</strong>
                      <p>{message.body}</p>
                    </div>
                    <label>
                      <span>Add a message</span>
                      <textarea
                        rows={3}
                        maxLength={1_000}
                        value={comment}
                        onChange={(event) => setComment(event.currentTarget.value)}
                        placeholder="Add a message..."
                        disabled={busy}
                      />
                    </label>
                    {forwardError ? <p className={styles.actionError} role="alert">{forwardError}</p> : null}
                    <footer>
                      <button type="button" onClick={closeForward} disabled={busy}>Cancel</button>
                      <button
                        type="button"
                        className="button-primary"
                        aria-busy={busy}
                        disabled={busy}
                        onClick={() => void sendForward()}
                      >
                        {busy ? "Sending..." : "Send"}
                      </button>
                    </footer>
                  </div>
                ) : (
                  <div className={styles.orderForwardPicker}>
                    <label>
                      <Search aria-hidden="true" />
                      <input
                        ref={forwardSearchRef}
                        value={forwardQuery}
                        onChange={(event) => setForwardQuery(event.currentTarget.value)}
                        placeholder="Search conversations"
                        aria-label="Search forward destinations"
                      />
                    </label>
                    <div>
                      {filteredDestinations.map((item) => (
                        <button
                          key={item.conversationId}
                          type="button"
                          onClick={() => setDestination(item)}
                        >
                          <span>{item.name}</span>
                          <small>
                            {item.kind === "group" ? item.memberCount + " members" : "Direct message"}
                          </small>
                        </button>
                      ))}
                      {filteredDestinations.length === 0 ? (
                        <p>No accessible Team conversation matches.</p>
                      ) : null}
                    </div>
                  </div>
                )}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
