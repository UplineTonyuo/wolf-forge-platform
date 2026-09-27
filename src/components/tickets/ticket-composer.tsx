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
  type TicketComposerActionInput,
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
 * A composer targets either an explicit Ticket or a Project's own conversation.
 */
type TicketComposerTarget =
  | { kind: "ticket"; ticketId: string }
  | { kind: "order"; orderId: string };

/**
 * When supplied, the composer clears and hands the draft to `onSend`
 * synchronously instead of waiting on the server round-trip — the caller owns
 * rendering the outgoing message as a pending bubble and reconciling it via
 * `onSettled`. Without this prop the composer keeps its original blocking
 * behavior (draft stays until the request resolves).
 */
type TicketComposerOptimistic = {
  onSend: (draft: {
    requestId: string;
    body: string;
    attachment: File | null;
    replyTo: OrderReplyTarget | null;
    target: TicketComposerActionInput["target"];
  }) => void;
  onSettled: (requestId: string, ok: boolean) => void;
};

export function TicketComposer({
  target,
  mode,
  disabled = false,
  attached = false,
  replyTo = null,
  onCancelReply,
  hideSubmitIcon = false,
  optimistic,
  compact = false,
  contactName = null,
}: {
  target: TicketComposerTarget;
  mode: TicketComposerMode;
  disabled?: boolean;
  attached?: boolean;
  replyTo?: OrderReplyTarget | null;
  onCancelReply?: () => void;
  hideSubmitIcon?: boolean;
  optimistic?: TicketComposerOptimistic;
  /** Compact icon-only footer + real-name placeholder, used only by the staff Ticket surfaces. */
  compact?: boolean;
  contactName?: string | null;
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
    // Note: there is no client-side MIME/size validation here — that check
    // only happens server-side in sendTicketComposerAction / the DB RPC.
    if (file?.type.startsWith("image/") && typeof URL.createObjectURL === "function") {
      const url = URL.createObjectURL(file);
      previewUrlRef.current = url;
      setPreviewUrl(url);
    }
  }

  const isNote =
    mode === "note";

  /* Real client/contact name when this is the compact staff reply composer;
     falls back to a neutral phrase rather than a hardcoded name. */
  const composerPlaceholder =
    compact && !isNote
      ? `Message ${contactName?.trim() || "client"}...`
      : undefined;

  /* Under optimistic sends the draft is already cleared and in the thread as
   * a pending bubble, so an in-flight request must not block typing the next
   * message — only the external `disabled` prop should. */
  const busy =
    disabled || (!optimistic && pending);

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

    const pendingAttachment = attachment;
    const pendingReplyTo = replyTo;

    submittingRef.current = true;

    if (optimistic) {
      optimistic.onSend({
        requestId,
        body: normalized,
        attachment: pendingAttachment,
        replyTo: pendingReplyTo,
        target,
      });

      requestIdRef.current = "";
      requestSignatureRef.current = "";
      setBody("");
      clearAttachment();
      if (fileInputRef.current) fileInputRef.current.value = "";
      if (!isNote) setResetKey((value) => value + 1);
      onCancelReply?.();
    }

    startTransition(
      async () => {
        try {
          const formData = new FormData();
          formData.set("body", normalized);
          if (pendingAttachment) formData.set("attachment", pendingAttachment);
          const result = await sendTicketComposerAction({
            requestId,
            mode,
            target,
            replyTo: pendingReplyTo
              ? {
                  ticketId: pendingReplyTo.ticketId,
                  messageId: pendingReplyTo.messageId,
                  attachmentId: pendingReplyTo.replyAttachment?.id ?? null,
                }
              : null,
          }, formData);

          if (!result.ok) {
            if (optimistic) optimistic.onSettled(requestId, false);
            else setError(result.error);

            return;
          }

          if (optimistic) {
            optimistic.onSettled(requestId, true);
          } else {
            requestIdRef.current = "";
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
          }

          router.refresh();
        } catch {
          if (optimistic) optimistic.onSettled(requestId, false);
          else setError("Could not confirm sending. Your text is still here. Please try again.");
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
      data-compact={compact || undefined}
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
          {replyTo.replyAttachment?.isImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/ticket-attachments/${replyTo.replyAttachment.id}`}
              alt=""
              className={styles.composerReplyThumbnail}
            />
          ) : null}
          <div>
            <strong>Replying to {replyTo.authorName}</strong>
            <p>
              {replyTo.replyAttachment && !replyTo.replyAttachment.isImage
                ? replyTo.replyAttachment.originalName
                : replyTo.replyPreview}
            </p>
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
          label={composerPlaceholder ?? "Write a reply"}
          placeholder={composerPlaceholder}
          onChange={setBody}
          onPasteFile={pickAttachment}
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
          {!compact ? (
            <span>
              {body.length.toLocaleString()}
              {" / 50,000"}
            </span>
          ) : null}

          {!isNote ? (
            <span className={styles.composerShortcutHint}>
              {compact ? "Ctrl+Enter" : "Ctrl+Shift+Enter to send"}
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
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0] ?? null;
                  pickAttachment(file);
                }}
              />
              <button
                type="button"
                className={styles.addFileButton}
                disabled={busy}
                aria-label="Add file"
                title="Add file"
                onClick={() => {
                  fileInputRef.current?.click();
                }}
              >
                <Paperclip aria-hidden="true" />
                {!compact ? "Add file" : null}
              </button>
            </>
          ) : null}
          <button
            type="submit"
            aria-busy={!optimistic && pending}
            aria-label={compact && !isNote ? (!optimistic && pending ? "Sending..." : "Send reply") : undefined}
            title={compact && !isNote ? "Send reply" : undefined}
            className="button-primary"
            disabled={busy || (!body.trim() && !attachment)}
          >
            {!hideSubmitIcon ? <Send aria-hidden="true" /> : null}
            {!compact || isNote ? (!optimistic && pending ? "Sending..." : isNote ? "Add note" : "Send reply") : null}
          </button>
        </div>
      </footer>
    </form>
  );
}
