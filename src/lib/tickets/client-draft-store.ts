import { randomUuid } from "../random-uuid";
import { TICKET_ATTACHMENT_MAX_BYTES } from "./ticket-attachment-file";

const databaseName = "wolf-forge-unsent-drafts";
const storeName = "drafts";
const sessionKey = "@session";
const retentionMs = 30 * 24 * 60 * 60 * 1000;
export type DraftSession = { owner: string; epoch: string };
export type ConversationDraft = {
  body: string;
  attachment: File | null;
  requestId: string;
  updatedAt: number;
  replyTo: { ticketId: string; messageId: string; attachmentId: string | null } | null;
};
type StoredDraft = Omit<ConversationDraft, "attachment"> & {
  attachment: { blob: Blob; name: string; type: string; lastModified: number } | null;
};

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("Draft storage unavailable"));
    request.onblocked = () => reject(new Error("Draft storage blocked"));
  });
}

async function transaction<T>(work: (store: IDBObjectStore, finish: (result: T) => void, fail: () => void) => void): Promise<T> {
  const db = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite", { durability: "strict" });
    let result: T;
    tx.oncomplete = () => { db.close(); resolve(result); };
    tx.onabort = tx.onerror = () => { db.close(); reject(new Error("Draft could not be saved")); };
    try { work(tx.objectStore(storeName), (value) => { result = value; }, () => tx.abort()); }
    catch { tx.abort(); }
  });
}

function active<T>(session: DraftSession, work: Parameters<typeof transaction<T>>[0]): Promise<T> {
  return transaction<T>((store, finish, fail) => {
    const request = store.get(sessionKey);
    request.onsuccess = () => {
      const current = request.result as DraftSession | undefined;
      if (current?.owner !== session.owner || current.epoch !== session.epoch) { fail(); return; }
      work(store, finish, fail);
    };
  });
}

export function prepareDraftSession(owner: string): Promise<DraftSession> {
  return transaction((store, finish) => {
    const request = store.get(sessionKey);
    request.onsuccess = () => {
      const current = request.result as DraftSession | undefined;
      if (current?.owner === owner) {
        const cursor = store.openCursor();
        cursor.onsuccess = () => {
          const entry = cursor.result;
          if (!entry) { finish(current); return; }
          if (entry.key !== sessionKey && !validDraft(entry.value)) entry.delete();
          entry.continue();
        };
        return;
      }
      const next = { owner, epoch: randomUuid() };
      store.clear();
      store.put(next, sessionKey);
      finish(next);
    };
  });
}

export function clearDeviceDrafts(): Promise<void> {
  // Clearing the lease also fences pending writes from other windows.
  return transaction((store, finish) => { store.clear(); finish(undefined); });
}

export function revokeTicketDrafts(session: DraftSession, ticketId?: string): Promise<void> {
  return active(session, (store, finish) => {
    const cursor = store.openCursor();
    cursor.onsuccess = () => {
      const entry = cursor.result;
      if (!entry) {
        store.put({ owner: session.owner, epoch: randomUuid() }, sessionKey);
        finish(undefined);
        return;
      }
      const key = String(entry.key);
      if (ticketId ? key === keyFor(session, `ticket:${ticketId}`) : key.startsWith(`${session.owner}:ticket:`)) entry.delete();
      entry.continue();
    };
  });
}

function keyFor(session: DraftSession, conversation: string) { return `${session.owner}:${conversation}`; }

function validDraft(value: unknown): value is StoredDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as StoredDraft;
  return typeof draft.body === "string" && draft.body.length <= 50_000
    && uuid(draft.requestId)
    && Number.isFinite(draft.updatedAt) && draft.updatedAt > Date.now() - retentionMs
    && (!draft.replyTo || (uuid(draft.replyTo.ticketId) && uuid(draft.replyTo.messageId)
      && (!draft.replyTo.attachmentId || uuid(draft.replyTo.attachmentId))))
    && (!draft.attachment || (draft.attachment.blob instanceof Blob
      && draft.attachment.blob.size > 0 && draft.attachment.blob.size <= TICKET_ATTACHMENT_MAX_BYTES
      && typeof draft.attachment.name === "string" && draft.attachment.name.length <= 255
      && typeof draft.attachment.type === "string" && draft.attachment.type.length <= 100
      && Number.isFinite(draft.attachment.lastModified)));
}

function uuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function readConversationDraft(session: DraftSession, conversation: string): Promise<ConversationDraft | null> {
  return active(session, (store, finish) => {
    const request = store.get(keyFor(session, conversation));
    request.onsuccess = () => {
      if (!validDraft(request.result)) { store.delete(keyFor(session, conversation)); finish(null); return; }
      const draft = request.result;
      const file = draft.attachment;
      finish({ ...draft, attachment: file ? new File([file.blob], file.name, { type: file.type, lastModified: file.lastModified }) : null });
    };
  });
}

export function writeConversationDraft(session: DraftSession, conversation: string, draft: ConversationDraft, previous: string | null): Promise<void> {
  if (draft.body.length > 50_000 || (draft.attachment && draft.attachment.size > TICKET_ATTACHMENT_MAX_BYTES)) {
    return Promise.reject(new Error("Draft exceeds storage limit"));
  }
  return active(session, (store, finish, fail) => {
    const request = store.get(keyFor(session, conversation));
    request.onsuccess = () => {
      const current = request.result as StoredDraft | undefined;
      if ((current?.requestId ?? null) !== previous) { fail(); return; }
      if (!draft.body && !draft.attachment) { store.delete(keyFor(session, conversation)); finish(undefined); return; }
      const file = draft.attachment;
      const stored: StoredDraft = { ...draft, attachment: file ? { blob: file, name: file.name, type: file.type, lastModified: file.lastModified } : null };
      const count = store.count();
      count.onsuccess = () => {
        if (!current && count.result >= 21) { fail(); return; }
        store.put(stored, keyFor(session, conversation));
        finish(undefined);
      };
    };
  });
}

export function deleteConversationDraft(session: DraftSession, conversation: string, requestId: string | null): Promise<void> {
  return active(session, (store, finish, fail) => {
    const request = store.get(keyFor(session, conversation));
    request.onsuccess = () => {
      const current = request.result as StoredDraft | undefined;
      if (current && current.requestId !== requestId) { fail(); return; }
      store.delete(keyFor(session, conversation));
      finish(undefined);
    };
  });
}
