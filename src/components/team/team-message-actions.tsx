"use client";

import {
  ArrowLeft,
  Check,
  Copy,
  Forward,
  ListPlus,
  Loader2,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { stripTeamFormatting } from "../../domain/team/formatting";
import type {
  TeamConversationView,
  TeamMessageView,
} from "../../domain/team/projections";
import { useClientMounted, useExitTransition } from "./use-exit-transition";
import styles from "./team-messages.module.css";

type ActionMode = "menu" | "forward" | "delete-me" | "delete-everyone";

export function TeamMessageActions({
  message,
  destinations,
  canCreateTask,
  onClose,
  onCreateTask,
  onForward,
  onDeleteForMe,
  onDeleteForEveryone,
}: {
  message: TeamMessageView | null;
  destinations: TeamConversationView[];
  canCreateTask: boolean;
  onClose: () => void;
  onCreateTask: (message: TeamMessageView) => void;
  onForward: (message: TeamMessageView, destinationConversationId: string) => Promise<string | null>;
  onDeleteForMe: (message: TeamMessageView) => Promise<string | null>;
  onDeleteForEveryone: (message: TeamMessageView) => Promise<string | null>;
}) {
  const mounted = useClientMounted();
  const transition = useExitTransition(message !== null, 180);
  const [retainedMessage, setRetainedMessage] = useState(message);
  const [mode, setMode] = useState<ActionMode>("menu");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  if (message && message.id !== retainedMessage?.id) {
    setRetainedMessage(message);
    setMode("menu");
    setQuery("");
    setError(null);
    setBusy(false);
  }

  const activeMessage = message ?? retainedMessage;

  useEffect(() => {
    if (!transition.render) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = cardRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
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
  }, [onClose, transition.render]);

  const filteredDestinations = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return destinations;
    return destinations.filter((destination) =>
      `${destination.name} ${destination.destinationSearchText}`
        .toLocaleLowerCase()
        .includes(needle),
    );
  }, [destinations, query]);

  if (!mounted || !transition.render || !activeMessage) return null;

  const closing = transition.phase === "closing";

  async function copyVisibleText() {
    setBusy(true);
    setError(null);
    try {
      await navigator.clipboard.writeText(stripTeamFormatting(activeMessage!.body));
      onClose();
    } catch {
      setError("Could not copy this message. Try again.");
      setBusy(false);
    }
  }

  async function runMutation(operation: () => Promise<string | null>) {
    setBusy(true);
    setError(null);
    const nextError = await operation();
    if (nextError) {
      setError(nextError);
      setBusy(false);
      return;
    }
    onClose();
  }

  return createPortal(
    <div
      className={[
        styles.messageActionBackdrop,
        closing ? styles.messageActionBackdropClosing : styles.messageActionBackdropOpen,
      ].join(" ")}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label="Message actions"
        className={[
          styles.messageActionCard,
          closing ? styles.messageActionCardClosing : styles.messageActionCardOpen,
        ].join(" ")}
      >
        <div className={styles.messageActionCardHeader}>
          {mode === "menu" ? <strong>Message actions</strong> : (
            <button
              type="button"
              className={styles.messageActionBack}
              onClick={() => {
                setMode("menu");
                setError(null);
              }}
              aria-label="Back to message actions"
            >
              <ArrowLeft aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            className={styles.messageActionClose}
            onClick={onClose}
            aria-label="Close message actions"
          >
            <X aria-hidden="true" />
          </button>
        </div>

        {mode === "menu" ? (
          <div className={styles.messageActionList}>
            <ActionButton icon={<Forward />} label="Forward" onClick={() => setMode("forward")} />
            <ActionButton icon={<Copy />} label="Copy" onClick={() => void copyVisibleText()} />
            {canCreateTask ? (
              <ActionButton
                icon={<ListPlus />}
                label="Create Task"
                onClick={() => {
                  onClose();
                  onCreateTask(activeMessage);
                }}
              />
            ) : null}
            <ActionButton
              icon={<Trash2 />}
              label="Delete for me"
              onClick={() => setMode("delete-me")}
            />
            {activeMessage.isMine ? (
              <div className={styles.messageActionDestructiveGroup}>
                <ActionButton
                  icon={<Trash2 />}
                  label="Delete for everyone"
                  destructive
                  onClick={() => setMode("delete-everyone")}
                />
              </div>
            ) : null}
          </div>
        ) : null}

        {mode === "forward" ? (
          <div className={styles.forwardPicker}>
            <div className={styles.forwardSearch}>
              <Search aria-hidden="true" />
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search conversations"
                aria-label="Search forward destinations"
              />
            </div>
            <div className={styles.forwardDestinationList}>
              {filteredDestinations.map((destination) => (
                <button
                  key={destination.conversationId}
                  type="button"
                  disabled={busy}
                  onClick={() => void runMutation(() =>
                    onForward(activeMessage, destination.conversationId)
                  )}
                >
                  <span>{destination.name}</span>
                  <small>{destination.kind === "group" ? `${destination.memberCount} members` : "Direct message"}</small>
                </button>
              ))}
              {filteredDestinations.length === 0 ? (
                <p className={styles.forwardEmpty}>No accessible Team conversation matches.</p>
              ) : null}
            </div>
          </div>
        ) : null}

        {mode === "delete-me" || mode === "delete-everyone" ? (
          <div className={styles.messageDeleteConfirm}>
            <span className={styles.messageDeleteIcon}><Trash2 aria-hidden="true" /></span>
            <strong>
              {mode === "delete-me"
                ? "Delete this message for you?"
                : "Delete this message for everyone?"}
            </strong>
            <p>
              {mode === "delete-me"
                ? "Other people in the conversation will still see it."
                : "People in this conversation will no longer be able to view it."}
            </p>
            <div className={styles.messageDeleteActions}>
              <button type="button" onClick={() => setMode("menu")} disabled={busy}>Cancel</button>
              <button
                type="button"
                className={mode === "delete-everyone" ? styles.messageDeleteDanger : ""}
                disabled={busy}
                onClick={() => void runMutation(() =>
                  mode === "delete-me"
                    ? onDeleteForMe(activeMessage)
                    : onDeleteForEveryone(activeMessage)
                )}
              >
                {busy ? <Loader2 className={styles.spin} aria-hidden="true" /> : <Check aria-hidden="true" />}
                Delete
              </button>
            </div>
          </div>
        ) : null}

        {error ? <p className={styles.messageActionError} role="alert">{error}</p> : null}
      </div>
    </div>,
    document.body,
  );
}

function ActionButton({
  icon,
  label,
  destructive = false,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  destructive?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={destructive ? styles.messageActionOptionDanger : styles.messageActionOption}
      onClick={onClick}
    >
      <span aria-hidden="true">{icon}</span>
      {label}
    </button>
  );
}
