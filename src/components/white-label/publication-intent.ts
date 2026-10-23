import { publishWhiteLabelSchema, type PublishWhiteLabelInput } from "../../domain/white-label/publication";

const VERSION = 1;
const MAX_LENGTH = 4096;
const key = (actorId: string, tenantId: string) => `wf:publication-intent:v${VERSION}:${actorId}:${tenantId}`;

/** Recovery only. Every reconciliation and publication still reauthorizes on the server. */
export function readPublicationIntent(storage: Storage, actorId: string, tenantId: string): PublishWhiteLabelInput | null {
  const raw = storage.getItem(key(actorId, tenantId));
  if (raw === null) return null;
  if (raw.length > MAX_LENGTH) throw new Error("Publication recovery data is too large.");
  const value = JSON.parse(raw);
  if (!value || typeof value !== "object" || Object.keys(value).sort().join(",") !== "actorId,input,tenantId,version" ||
      value.version !== VERSION || value.actorId !== actorId || value.tenantId !== tenantId) throw new Error("Publication recovery scope is invalid.");
  const parsed = publishWhiteLabelSchema.safeParse(value.input);
  if (!parsed.success || parsed.data.tenantId !== tenantId ||
      Object.entries(parsed.data).some(([field, entry]) => value.input[field] !== entry)) throw new Error("Publication recovery input is invalid.");
  return parsed.data;
}

export function storePublicationIntent(storage: Storage, actorId: string, input: PublishWhiteLabelInput): void {
  const existing = readPublicationIntent(storage, actorId, input.tenantId);
  if (existing) throw new Error("An unresolved publication request already exists.");
  const parsed = publishWhiteLabelSchema.parse(input);
  const raw = JSON.stringify({ version: VERSION, actorId, tenantId: parsed.tenantId, input: parsed });
  if (raw.length > MAX_LENGTH) throw new Error("Publication recovery data is too large.");
  storage.setItem(key(actorId, parsed.tenantId), raw);
  if (storage.getItem(key(actorId, parsed.tenantId)) !== raw) throw new Error("Publication recovery was not saved.");
}

export function clearConfirmedPublicationIntent(storage: Storage, actorId: string, input: PublishWhiteLabelInput): void {
  const existing = readPublicationIntent(storage, actorId, input.tenantId);
  if (!existing || JSON.stringify(existing) !== JSON.stringify(publishWhiteLabelSchema.parse(input))) throw new Error("Publication recovery changed.");
  storage.removeItem(key(actorId, input.tenantId));
  if (storage.getItem(key(actorId, input.tenantId)) !== null) throw new Error("Publication recovery was not cleared.");
}
