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
import { TicketVoiceRecorder } from "./ticket-voice-recorder";
import { VoiceAudioPlayer } from "../audio/voice-audio-player";
import voiceStyles from "./ticket-voice-recorder.module.css";
import { usePersistentReplyDraft } from "./use-persistent-reply-draft";
import { useClientDraftSession } from "./client-draft-provider";
import { PortalDialog } from "../account/ui/portal-dialog";
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

export function TicketComposer(props: Parameters<typeof TicketComposerBody>[0]) {
  const { enabled } = useClientDraftSession();
  const conversation = props.target.kind === "ticket" ? props.target.ticketId : props.target.orderId;
  return <TicketComposerBody key={enabled ? `${props.target.kind}:${conversation}` : "legacy"} {...props} />;
}

function TicketComposerBody({
  target,
  mode,
  disabled = false,
  attached = false,
  replyTo: suppliedReplyTo = null,
  onCancelReply,
  hideSubmitIcon = false,
  optimistic: requestedOptimistic,
  confirmedRequestIds = [],
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
  confirmedRequestIds?: string[];
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
  const [voiceDurationMs, setVoiceDurationMs] = useState(0);
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
  const [discardOpen, setDiscardOpen] = useState(false);
  const [savingForSend, setSavingForSend] = useState(false);
  const [recordingVoice, setRecordingVoice] = useState(false);
  const [restoredReply, setRestoredReply] = useState<OrderReplyTarget | null>(null);
  const replyTo = suppliedReplyTo ?? restoredReply;
  const persistent = usePersistentReplyDraft(
    target.kind === "ticket" ? `ticket:${target.ticketId}` : `order:${target.orderId}`,
    confirmedRequestIds,
    (draft) => {
      setBody(draft.body);
      pickAttachment(draft.attachment);
      setRestoredReply(draft.replyTo ? { ...draft.replyTo, body: "", authorName: "a message", replyPreview: "Original message",
        replyAttachment: draft.replyTo.attachmentId ? { id: draft.replyTo.attachmentId, isImage: false, originalName: "Attachment" } : null } : null);
      requestIdRef.current = draft.requestId;
      requestSignatureRef.current = `${draft.replyTo?.messageId ?? ""}\0${draft.body.trim()}\0${draft.attachment?.name ?? ""}\0${draft.attachment?.size ?? 0}\0${draft.attachment?.lastModified ?? 0}`;
      setResetKey((value) => value + 1);
    },
  );
  // Durable drafts stay in the composer until the server confirms the send.
  const optimistic = persistent.enabled ? undefined : requestedOptimistic;

  function saveDraft(nextBody: string, nextAttachment: File | null) {
    if (!persistent.enabled || persistent.loading) return;
    void persistent.save(nextBody, nextAttachment, undefined, replyTo ? {
      ticketId: replyTo.ticketId, messageId: replyTo.messageId, attachmentId: replyTo.replyAttachment?.id ?? null,
    } : null).catch(() => undefined);
  }

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
    setVoiceDurationMs(0);
  }

  function pickAttachment(file: File | null, durationMs = 0) {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
    setPreviewUrl(null);
    setAttachment(file);
    setVoiceDurationMs(durationMs);
    // Note: there is no client-side MIME/size validation here — that check
    // only happens server-side in sendTicketComposerAction / the DB RPC.
    if ((file?.type.startsWith("image/") || file?.type.startsWith("audio/")) && typeof URL.createObjectURL === "function") {
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
    disabled || persistent.loading || savingForSend || (!optimistic && pending);

  async function submit(
    event:
      FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    const normalized =
      body.trim();

    if (
      busy || recordingVoice || submittingRef.current ||
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
    if (persistent.enabled) {
      setSavingForSend(true);
      try { await persistent.save(body, attachment, requestId, replyTo ? {
        ticketId: replyTo.ticketId, messageId: replyTo.messageId, attachmentId: replyTo.replyAttachment?.id ?? null,
      } : null); }
      catch {
        setError("Your draft could not be saved on this device. Keep this window open and try again.");
        submittingRef.current = false;
        setSavingForSend(false);
        return;
      }
      setSavingForSend(false);
    }

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
            if (persistent.enabled) await persistent.clear();
            setRestoredReply(null);
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
      data-client-view={mode === "client" || undefined}
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
          <button type="button" onClick={() => {
            setRestoredReply(null); onCancelReply?.();
            if (persistent.enabled) void persistent.save(body, attachment, undefined, null).catch(() => undefined);
          }} disabled={busy} aria-label="Cancel reply">
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
          onChange={(value) => { setBody(value); saveDraft(value, attachment); }}
          initialValue={body}
          onPasteFile={(file) => { if (!recordingVoice) { pickAttachment(file); saveDraft(body, file); } }}
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
        <div className={`${styles.attachmentDraft} ${attachment.type.startsWith("audio/") ? voiceStyles.draft : ""}`} data-voice={attachment.type.startsWith("audio/") || undefined}>
          {previewUrl && attachment.type.startsWith("audio/") ? (
            <VoiceAudioPlayer key={previewUrl} source={attachment} durationMs={voiceDurationMs} label="voice message preview" disabled={busy} />
          ) : previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- local blob: preview URL, not eligible for next/image optimization
            <img src={previewUrl} alt="" />
          ) : attachment.type.startsWith("video/") ? (
            <Film aria-hidden="true" />
          ) : (
            <FileText aria-hidden="true" />
          )}
          <span>{attachment.type.startsWith("audio/") ? "Voice message" : attachment.name}</span>
          <button
            type="button"
            aria-label={`Remove ${attachment.name}`}
            disabled={busy}
            onClick={() => {
              clearAttachment();
              saveDraft(body, null);
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

        <div className={`${styles.composerActions} ${voiceStyles.actions}`}>
          {!isNote && target.kind === "ticket" ? <TicketVoiceRecorder
            key={target.ticketId}
            ticketId={target.ticketId}
            disabled={busy || !!attachment}
            onRecordingChange={setRecordingVoice}
            onPickAttachment={(file, durationMs) => { pickAttachment(file, durationMs); saveDraft(body, file); }}
          /> : null}
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
                  saveDraft(body, file);
                }}
              />
              <button
                type="button"
                className={styles.addFileButton}
                disabled={busy || recordingVoice}
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
            disabled={busy || recordingVoice || (!body.trim() && !attachment)}
          >
            {!hideSubmitIcon ? <Send aria-hidden="true" /> : null}
            {!compact || isNote ? (!optimistic && pending ? "Sending..." : isNote ? "Add note" : "Send reply") : null}
          </button>
        </div>
      </footer>
      {persistent.enabled ? <div role="status" className={styles.draftStatus}>
        <span>{persistent.loading ? "Restoring draft…" : persistent.status === "saving" ? "Saving draft…" : persistent.status === "saved"
          ? "Draft saved on this device for 30 days. Signing out clears it."
          : persistent.status === "error" ? "Draft not saved. Keep this window open; device storage may be unavailable or another window changed this draft."
          : "Unsent text and files are saved on this device. Signing out clears them."}</span>
        {(body || attachment) && !persistent.loading ? <button className="button button-secondary" type="button" disabled={busy} onClick={() => setDiscardOpen(true)}>Discard draft</button> : null}
      </div> : null}
      <PortalDialog open={discardOpen} onClose={() => setDiscardOpen(false)} title="Discard unsent draft?">
        <p>This removes the unsent text and attachment from this device.</p>
        <div className={styles.draftActions}>
        <button className="button button-secondary" type="button" onClick={() => setDiscardOpen(false)}>Keep draft</button>
        <button className="button button-primary" type="button" onClick={() => { void persistent.clear().then(() => {
          setBody(""); clearAttachment(); setRestoredReply(null); onCancelReply?.(); setResetKey((value) => value + 1);
          if (fileInputRef.current) fileInputRef.current.value = "";
          setDiscardOpen(false);
        }).catch(() => setError("Could not discard the saved draft. Please try again.")); }}>Discard draft</button>
        </div>
      </PortalDialog>
    </form>
  );
}
