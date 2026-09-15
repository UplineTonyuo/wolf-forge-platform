import "server-only";

import { createHash } from "node:crypto";
import { DatabaseError, ValidationError } from "../lib/errors/application-error";
import type { TrustedServerClient } from "../lib/supabase/trusted-server-client";

export const TICKET_ATTACHMENT_BUCKET = "ticket-attachments";

export class TicketAttachmentStorageRepository {
  constructor(private readonly client: TrustedServerClient) {}

  checksum(bytes: Uint8Array): string {
    return createHash("sha256").update(bytes).digest("hex");
  }

  async storeOrConfirm(path: string, bytes: Uint8Array, mimeType: string, checksum: string): Promise<boolean> {
    const bucket = this.client.storage.from(TICKET_ATTACHMENT_BUCKET);
    const existing = await bucket.download(path);
    if (existing.data) {
      const existingBytes = new Uint8Array(await existing.data.arrayBuffer());
      if (this.checksum(existingBytes) !== checksum) throw new ValidationError("This draft file changed. Remove it and add it again.");
      return false;
    }

    const upload = await bucket.upload(path, bytes, { contentType: mimeType, upsert: false });
    if (upload.error) throw new DatabaseError(upload.error);
    return true;
  }

  async remove(path: string): Promise<void> {
    await this.client.storage.from(TICKET_ATTACHMENT_BUCKET).remove([path]);
  }

  async signedUrl(path: string): Promise<string> {
    const result = await this.client.storage.from(TICKET_ATTACHMENT_BUCKET).createSignedUrl(path, 60);
    if (result.error || !result.data) throw new DatabaseError(result.error);
    return result.data.signedUrl;
  }
}
