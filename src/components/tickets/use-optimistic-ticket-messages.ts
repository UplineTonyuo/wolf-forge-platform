"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  sendTicketComposerAction,
  type TicketComposerActionInput,
} from "../../app/actions/tickets";
import type { TicketDetailMessage } from "../../domain/tickets/schema";
import type { OrderReplyTarget } from "./order-message-actions";

export type OptimisticTicketDraft = {
  requestId: string;
  body: string;
  attachment: File | null;
  replyTo: OrderReplyTarget | null;
  target: TicketComposerActionInput["target"];
};

type PendingEntry = TicketDetailMessage & { draft: OptimisticTicketDraft };

/**
 * Order/Project conversation has no realtime subscription — a send is
 * confirmed only when the next `router.refresh()` delivers a new server
 * `messages` array. So a pending bubble is retired on the first refresh
 * *after* its send resolved ok, never immediately on resolve — that would
 * show a gap between the optimistic bubble disappearing and the canonical
 * one arriving.
 */
export function useOptimisticTicketMessages(
  serverMessages: TicketDetailMessage[],
  options: { mode: "admin" | "client"; viewerProfileId?: string | null; confirmation?: "request-id"; onRetryAccepted?: () => void },
) {
  const router = useRouter();
  const [pending, setPending] = useState<PendingEntry[]>([]);
  const awaitingRefresh = useRef<Set<string>>(new Set());
  const prevServerMessages = useRef(serverMessages);

  useEffect(() => {
    if (prevServerMessages.current === serverMessages) return;
    prevServerMessages.current = serverMessages;
    if (!awaitingRefresh.current.size) return;
    const settledIds = options.confirmation === "request-id"
      ? new Set(serverMessages.flatMap(message => message.requestId ? [message.requestId] : []))
      : awaitingRefresh.current;
    if (options.confirmation === "request-id") settledIds.forEach(id => awaitingRefresh.current.delete(id));
    else awaitingRefresh.current = new Set();
    setPending((current) => current.filter((message) => !settledIds.has(message.requestId ?? "")));
  }, [serverMessages, options.confirmation]);

  function addOptimistic(draft: OptimisticTicketDraft) {
    const now = new Date().toISOString();
    const message: PendingEntry = {
      id: `pending-${draft.requestId}`,
      requestId: draft.requestId,
      ticket_id: draft.replyTo?.ticketId ?? "",
      author_profile_id: options.viewerProfileId ?? null,
      author_name: null,
      author_avatar_url: null,
      author_type: options.mode === "admin" ? "internal" : "client",
      message_kind: "reply",
      visibility: "client",
      body: draft.body,
      created_at: now,
      reply_to_message_id: draft.replyTo?.messageId ?? null,
      reply_quote_text: draft.replyTo?.body ?? null,
      reply_source_author_name: draft.replyTo?.authorName ?? null,
      reply_source_available: true,
      reactions: [],
      attachments: draft.attachment
        ? [{
            id: `pending-attachment-${draft.requestId}`,
            original_name: draft.attachment.name,
            mime_type: draft.attachment.type || "application/octet-stream",
            size_bytes: draft.attachment.size,
            scan_status: "pending",
            created_at: now,
          }]
        : [],
      pending: true,
      failed: false,
      draft,
    };
    setPending((current) => [...current.filter((entry) => entry.requestId !== draft.requestId), message]);
  }

  function settle(requestId: string, ok: boolean) {
    if (ok) {
      awaitingRefresh.current.add(requestId);
      return;
    }
    setPending((current) =>
      current.map((entry) => (entry.requestId === requestId ? { ...entry, pending: false, failed: true } : entry)),
    );
  }

  async function retry(requestId: string) {
    const entry = pending.find((candidate) => candidate.requestId === requestId);
    if (!entry) return;

    setPending((current) =>
      current.map((candidate) => (candidate.requestId === requestId ? { ...candidate, pending: true, failed: false } : candidate)),
    );

    const formData = new FormData();
    formData.set("body", entry.draft.body);
    if (entry.draft.attachment) formData.set("attachment", entry.draft.attachment);

    try {
      const result = await sendTicketComposerAction({
        requestId,
        mode: options.mode,
        target: entry.draft.target,
        replyTo: entry.draft.replyTo
          ? { ticketId: entry.draft.replyTo.ticketId, messageId: entry.draft.replyTo.messageId }
          : null,
      }, formData);

      if (!result.ok) {
        settle(requestId, false);
        return;
      }

      settle(requestId, true);
      if (options.onRetryAccepted) options.onRetryAccepted();
      else router.refresh();
    } catch {
      settle(requestId, false);
    }
  }

  const messages = useMemo(() => {
    const confirmed=options.confirmation==="request-id"?new Set(serverMessages.flatMap(message=>message.requestId?[message.requestId]:[])):null;
    return [...serverMessages,...pending.filter(message=>!confirmed?.has(message.requestId??""))];
  }, [serverMessages, pending, options.confirmation]);

  const confirm = useCallback((ids: string[]) => {
    if (!ids.length) return;
    const confirmed = new Set(ids);
    ids.forEach(id=>awaitingRefresh.current.delete(id));
    setPending(previous=>previous.filter(message=>!confirmed.has(message.requestId??"")));
  },[]);
  const clear = useCallback(()=>{awaitingRefresh.current.clear();setPending([])},[]);
  return { messages, addOptimistic, settle, retry, confirm, clear, pendingRequestIds: pending.map(message=>message.requestId!).filter(Boolean) };
}
