"use client";

import {
  Send,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useRef,
  useState,
  useTransition,
  type FormEvent,
} from "react";
import {
  addTicketInternalNoteAction,
  adminReplyTicketAction,
  clientReplyTicketAction,
} from "../../app/actions/tickets";
import { TicketRichTextEditor } from "./ticket-rich-text-editor";
import styles from "./tickets.module.css";

type TicketComposerMode =
  | "admin"
  | "client"
  | "note";

export function TicketComposer({
  ticketId,
  mode,
  disabled = false,
}: {
  ticketId: string;
  mode: TicketComposerMode;
  disabled?: boolean;
}) {
  const router =
    useRouter();

  const [
    body,
    setBody,
  ] =
    useState("");

  const [
    error,
    setError,
  ] =
    useState<string | null>(
      null,
    );

  const [
    resetKey,
    setResetKey,
  ] =
    useState(0);

  const [
    pending,
    startTransition,
  ] =
    useTransition();

  const requestIdRef =
    useRef("");

  const isNote =
    mode === "note";

  const busy =
    disabled || pending;

  async function submit(
    event:
      FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    const normalized =
      body.trim();

    if (
      busy ||
      !normalized
    ) {
      return;
    }

    setError(null);

    if (
      !requestIdRef.current
    ) {
      requestIdRef.current =
        crypto.randomUUID();
    }

    const requestId =
      requestIdRef.current;

    startTransition(
      async () => {
        const result =
          mode === "admin"
            ? await adminReplyTicketAction(
                ticketId,
                requestId,
                normalized,
              )
            : mode === "client"
              ? await clientReplyTicketAction(
                  ticketId,
                  requestId,
                  normalized,
                )
              : await addTicketInternalNoteAction(
                  ticketId,
                  requestId,
                  normalized,
                );

        if (!result.ok) {
          setError(
            result.error,
          );

          return;
        }

        requestIdRef.current =
          "";

        setBody("");

        if (!isNote) {
          setResetKey(
            (value) =>
              value + 1,
          );
        }

        router.refresh();
      },
    );
  }

  return (
    <form
      className={
        isNote
          ? styles.noteComposer
          : styles.composer
      }
      onSubmit={submit}
    >
      {!isNote ? (
        <header>
          <strong>
            Reply
          </strong>
        </header>
      ) : null}

      {isNote ? (
        <textarea
          rows={4}
          maxLength={50_000}
          value={body}
          placeholder="Send a private message to your team. Wolf Forge only..."
          disabled={busy}
          onChange={(event) =>
            setBody(
              event.currentTarget.value,
            )
          }
        />
      ) : (
        <TicketRichTextEditor
          key={resetKey}
          disabled={busy}
          label="Write a reply"
          onChange={setBody}
        />
      )}

      {error ? (
        <p
          className={
            styles.actionError
          }
          role="alert"
        >
          {error}
        </p>
      ) : null}

      <footer>
        <span>
          {body.length.toLocaleString()}
          {" / 50,000"}
        </span>

        <button
          type="submit"
          className="button-primary"
          aria-busy={pending || undefined}
          disabled={
            busy ||
            !body.trim()
          }
        >
          <Send aria-hidden="true" />
          {pending
            ? "Sending..."
            : isNote
              ? "Add note"
              : "Send reply"}
        </button>
      </footer>
    </form>
  );
}