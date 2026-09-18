import { describe, expect, it } from "vitest";
import { isBareImageMessage, replyPreviewText } from "../components/tickets/ticket-conversation";
import type { TicketDetailMessage } from "../domain/tickets/schema";

const baseMessage: TicketDetailMessage = {
  id: "70000000-0000-4000-8000-000000000001",
  ticket_id: "70000000-0000-4000-8000-000000000010",
  author_profile_id: "70000000-0000-4000-8000-000000000020",
  author_name: "Client Person",
  author_avatar_url: null,
  author_type: "client",
  message_kind: "reply",
  visibility: "client",
  body: "",
  created_at: "2026-08-15T10:00:00Z",
  attachments: [],
};

const imageAttachment = {
  id: "a1",
  original_name: "photo.jpg",
  mime_type: "image/jpeg",
  size_bytes: 1000,
  scan_status: "clean",
  created_at: "2026-08-15T10:00:00Z",
} as const;

const pdfAttachment = {
  ...imageAttachment,
  id: "a2",
  original_name: "invoice.pdf",
  mime_type: "application/pdf",
} as const;

describe("isBareImageMessage", () => {
  it("is true for an image-only message with no text", () => {
    expect(isBareImageMessage({ ...baseMessage, body: "", attachments: [imageAttachment] })).toBe(true);
  });

  it("is false when text is present alongside an image", () => {
    expect(isBareImageMessage({ ...baseMessage, body: "haha", attachments: [imageAttachment] })).toBe(false);
  });

  it("treats whitespace-only or the blank-body sentinel as no visible text", () => {
    expect(isBareImageMessage({ ...baseMessage, body: "   \n  ", attachments: [imageAttachment] })).toBe(true);
    expect(isBareImageMessage({ ...baseMessage, body: "￼", attachments: [imageAttachment] })).toBe(true);
  });

  it("is false for a non-image attachment even with no text", () => {
    expect(isBareImageMessage({ ...baseMessage, body: "", attachments: [pdfAttachment] })).toBe(false);
  });

  it("is false when any attachment is non-image, even alongside an image", () => {
    expect(isBareImageMessage({ ...baseMessage, body: "", attachments: [imageAttachment, pdfAttachment] })).toBe(false);
  });

  it("is false with no attachments regardless of text", () => {
    expect(isBareImageMessage({ ...baseMessage, body: "", attachments: [] })).toBe(false);
  });
});

describe("replyPreviewText", () => {
  it("returns the real text when there is visible text", () => {
    expect(replyPreviewText({ ...baseMessage, body: "Thanks!", attachments: [] })).toBe("Thanks!");
  });

  it("returns a truthful media label instead of the placeholder for an image-only message", () => {
    expect(replyPreviewText({ ...baseMessage, body: "￼", attachments: [imageAttachment] })).toBe("Image");
  });

  it("returns a truthful media label for a non-image attachment-only message", () => {
    expect(replyPreviewText({ ...baseMessage, body: "", attachments: [pdfAttachment] })).toBe("Attachment");
  });

  it("never exposes filename, MIME type, or byte size in the preview", () => {
    const preview = replyPreviewText({ ...baseMessage, body: "￼", attachments: [imageAttachment] });
    expect(preview).not.toContain("photo.jpg");
    expect(preview).not.toContain("image/jpeg");
  });
});
