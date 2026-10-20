"use client";

import { useEffect, useRef, useState } from "react";
import { randomUuid } from "../../lib/random-uuid";
import { deleteConversationDraft, readConversationDraft, writeConversationDraft, type ConversationDraft } from "../../lib/tickets/client-draft-store";
import { useClientDraftSession } from "./client-draft-provider";

export function usePersistentReplyDraft(conversation: string, confirmedRequestIds: string[], restore: (draft: ConversationDraft) => void) {
  const context = useClientDraftSession();
  const session = context.session;
  const [loaded, setLoaded] = useState<string | null>(null);
  const [status, setStatus] = useState<"empty" | "saving" | "saved" | "error">("empty");
  const restoreRef = useRef(restore);
  const confirmedRef = useRef(confirmedRequestIds);
  const storedRevision = useRef<string | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const generation = useRef(0);
  useEffect(() => { restoreRef.current = restore; confirmedRef.current = confirmedRequestIds; });
  const scope = session ? `${session.epoch}:${conversation}` : null;

  useEffect(() => {
    if (!session || !scope) return;
    let canceled = false;
    const read = readConversationDraft(session, conversation).then(async (draft) => {
      if (canceled) return;
      if (draft && confirmedRef.current.includes(draft.requestId)) {
        await deleteConversationDraft(session, conversation, draft.requestId);
        if (canceled) return;
      } else if (draft) {
        storedRevision.current = draft.requestId;
        restoreRef.current(draft);
        setStatus("saved");
      }
      setLoaded(scope);
    }).catch(() => { if (!canceled) { setStatus("error"); setLoaded(scope); } });
    queue.current = read;
    return () => { canceled = true; };
  }, [session, scope, conversation]);

  useEffect(() => {
    if (status !== "saving" && status !== "error") return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [status]);

  function save(body: string, attachment: File | null, requestId = randomUuid(), replyTo: ConversationDraft["replyTo"] = null): Promise<string> {
    if (!session || loaded !== scope) return Promise.reject(new Error("Draft storage unavailable"));
    const draft: ConversationDraft = { body, attachment, requestId, replyTo, updatedAt: Date.now() };
    const version = ++generation.current;
    setStatus("saving");
    const write = queue.current.then(async () => {
      await writeConversationDraft(session, conversation, draft, storedRevision.current);
      storedRevision.current = body || attachment ? requestId : null;
      if (generation.current === version) setStatus(body || attachment ? "saved" : "empty");
      return requestId;
    });
    queue.current = write.catch(() => { if (generation.current === version) setStatus("error"); });
    return write;
  }

  async function clear() {
    if (!session) return;
    await queue.current;
    await deleteConversationDraft(session, conversation, storedRevision.current);
    storedRevision.current = null;
    ++generation.current;
    setStatus("empty");
  }

  return {
    enabled: context.enabled,
    loading: context.enabled && !context.error && (!session || loaded !== scope),
    status: context.error ? "error" as const : status,
    save,
    clear,
  };
}
