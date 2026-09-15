"use client";

import {
  FileText,
  Film,
  Paperclip,
  Send,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type FormEvent,
} from "react";
import {
  sendTicketComposerAction,
} from "../../app/actions/tickets";
import { randomUuid } from "../../lib/random-uuid";
import { TICKET_ATTACHMENT_ACCEPT } from "../../lib/tickets/ticket-attachment-file";
import type { OrderReplyTarget } from "./order-message-actions";
import { TicketRichTextEditor } from "./ticket-rich-text-editor";
import styles from "./tickets.module.css";

type TicketComposerMode =
  | "admin"
  | "client"
  | "note";

/**
 * A composer either replies to an existing Ticket, or — for an Order with no
 * Ticket yet — targets the Order directly. The first real order message then
 * creates and links the canonical Ticket atomically (Slice 1's
 * app_send_order_message), so this component never creates a Ticket itself.
 */
type TicketComposerTarget =
  | { kind: "ticket"; ticketId: string }
  | { kind: "order"; orderId: string };

export function TicketComposer({
  target,
  mode,
  disabled = false,
  attached = false,
  replyTo = null,
  onCancelReply,
  hideSubmitIcon = false,
}: {
  target: TicketComposerTarget;
  mode: TicketComposerMode;
  disabled?: boolean;
  attached?: boolean;
  replyTo?: OrderReplyTarget | null;
  onCancelReply?: () => void;
  hideSubmitIcon?: boolean;
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

  const [attachment, setAttachment] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  const [
    pending,
    startTransition,
  ] =
    useTransition();

  const requestIdRef =
    useRef("");
  const requestSignatureRef = useRef("");
  const submittingRef = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!replyTo) return;
    formRef.current?.querySelector<HTMLElement>('[contenteditable="true"], textarea')?.focus();
  }, [replyTo]);

  /* Object URLs are released on unmount so a long session cannot leak them. */
  useEffect(
    () => () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    },
    [],
  );

  function clearAttachment() {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
    setPreviewUrl(null);
    setAttachment(null);
  }

  function pickAttachment(file: File | null) {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
    setPreviewUrl(null);
    setAttachment(file);
    if (file?.type.startsWith("image/") && typeof URL.createObjectURL === "function") {
      const url = URL.createObjectURL(file);
      previewUrlRef.current = url;
      setPreviewUrl(url);
    }
  }

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
      busy || submittingRef.current ||
      (!normalized && !attachment)
    ) {
      return;
    }

    setError(null);

    const requestSignature = `${replyTo?.messageId ?? ""}\0${normalized}\0${attachment?.name ?? ""}\0${attachment?.size ?? 0}\0${attachment?.lastModified ?? 0}`;
    if (!requestIdRef.current || requestSignatureRef.current !== requestSignature) {
      requestIdRef.current =
        randomUuid();
      requestSignatureRef.current = requestSignature;
    }

    const requestId =
      requestIdRef.current;

    submittingRef.current = true;
    startTransition(
      async () => {
        try {
          const formData = new FormData();
          formData.set("body", normalized);
          if (attachment) formData.set("attachment", attachment);
          const result = await sendTicketComposerAction({
            requestId,
            mode,
            target,
            replyTo: replyTo ? { ticketId: replyTo.ticketId, messageId: replyTo.messageId } : null,
          }, formData);

          if (!result.ok) {
            setError(
              result.error,
            );

            return;
          }

          requestIdRef.current =
            "";
          requestSignatureRef.current = "";

          setBody("");
          clearAttachment();
          if (fileInputRef.current) fileInputRef.current.value = "";

          if (!isNote) {
            setResetKey(
              (value) =>
                value + 1,
            );
          }

          onCancelReply?.();

          router.refresh();
        } catch {
          setError("Could not confirm sending. Your text is still here. Please try again.");
        } finally {
          submittingRef.current = false;
        }
      },
    );
  }

  return (
    <form
      ref={formRef}
      className={
        isNote
          ? styles.noteComposer
          : styles.composer
      }
      onSubmit={submit}
      data-sending={attached && pending && !disabled || undefined}
    >
      {!isNote && !attached ? (
        <header>
          <strong>
            Reply
          </strong>
        </header>
      ) : null}

      {!isNote && replyTo ? (
        <div className={styles.composerReplyContext}>
          <div>
            <strong>Replying to {replyTo.authorName}</strong>
            <p>{replyTo.body}</p>
          </div>
          <button type="button" onClick={onCancelReply} disabled={busy} aria-label="Cancel reply">
            Cancel
          </button>
        </div>
      ) : null}

      {isNote ? (
        <textarea
          aria-label="Add internal note"
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

      {attachment ? (
        <div className={styles.attachmentDraft}>
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- local blob: preview URL, not eligible for next/image optimization
            <img src={previewUrl} alt="" />
          ) : attachment.type.startsWith("video/") ? (
            <Film aria-hidden="true" />
          ) : (
            <FileText aria-hidden="true" />
          )}
          <span>{attachment.name}</span>
          <button
            type="button"
            aria-label={`Remove ${attachment.name}`}
            disabled={busy}
            onClick={() => {
              clearAttachment();
              if (fileInputRef.current) fileInputRef.current.value = "";
            }}
          >
            <X aria-hidden="true" />
          </button>
        </div>
      ) : null}

      <footer>
        <div className={styles.composerMeta}>
          <span>
            {body.length.toLocaleString()}
            {" / 50,000"}
          </span>

          {!isNote ? (
            <span className={styles.composerShortcutHint}>
              Ctrl+Shift+Enter to send
            </span>
          ) : null}
        </div>

        <div className={styles.composerActions}>
          {!isNote ? (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept={TICKET_ATTACHMENT_ACCEPT}
                className="sr-only"
                tabIndex={-1}
                onChange={(event) => pickAttachment(event.currentTarget.files?.[0] ?? null)}
              />
              <button
                type="button"
                className={styles.addFileButton}
                disabled={busy}
                onClick={() => fileInputRef.current?.click()}
              >
                <Paperclip aria-hidden="true" />
                Add file
              </button>
            </>
          ) : null}
          <button
            type="submit"
            aria-busy={pending}
            className="button-primary"
            disabled={busy || (!body.trim() && !attachment)}
          >
            {!hideSubmitIcon ? <Send aria-hidden="true" /> : null}
            {pending ? "Sending..." : isNote ? "Add note" : "Send reply"}
          </button>
        </div>
      </footer>
    </form>
  );
}
