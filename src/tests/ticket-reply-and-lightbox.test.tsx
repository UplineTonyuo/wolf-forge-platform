/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TicketConversation } from "../components/tickets/ticket-conversation";
import type { TicketDetailMessage } from "../domain/tickets/schema";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("../app/actions/tickets", () => ({
  toggleTicketMessageReactionAction: vi.fn(),
  forwardTicketMessageToTeamAction: vi.fn(),
}));

afterEach(cleanup);

const baseMessage: TicketDetailMessage = {
  id: "80000000-0000-4000-8000-000000000001",
  ticket_id: "80000000-0000-4000-8000-000000000010",
  author_profile_id: "80000000-0000-4000-8000-000000000020",
  author_name: "QA Order Client",
  author_avatar_url: null,
  author_type: "client",
  message_kind: "reply",
  visibility: "client",
  body: "Hello",
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

const imageOnlyOwnMessage: TicketDetailMessage = {
  ...baseMessage,
  author_type: "internal",
  body: "",
  attachments: [imageAttachment],
};

const imageOnlyExternalMessage: TicketDetailMessage = {
  ...baseMessage,
  author_type: "client",
  body: "",
  attachments: [imageAttachment],
};

function openMenu(name = "Message actions") {
  fireEvent.click(screen.getByRole("button", { name }));
}

describe("Quoted email history", () => {
  it.each([true, false])("folds the quoted tail in the shared conversation (orderChat=%s)", (orderChat) => {
    const message = {
      ...baseMessage,
      body: [
        "Thanks for the update!",
        "",
        "On Tue, Sep 15, 2026 at 4:18 AM, Support <support@example.test> wrote:",
        "",
        "> The work is ready.",
        ">",
        "> > An earlier reply.",
      ].join("\r\n"),
    };
    render(<TicketConversation messages={[message]} orderChat={orderChat} />);

    expect(screen.getByText("Thanks for the update!")).toBeVisible();
    const toggle = screen.getByRole("button", { name: "Show more quoted email history" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/The work is ready/)).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Show less quoted email history" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/The work is ready/)).toBeVisible();
    expect(screen.getByText(/An earlier reply/)).toBeVisible();

    fireEvent.click(toggle);
    expect(screen.queryByText(/The work is ready/)).not.toBeInTheDocument();
  });

  it.each([
    "Here is the line to review:\n\n> An ordinary quotation.",
    "On Tue we reviewed what the team wrote:\n\n> Notes from the review.",
    "See my answer below.\n\nOn Tue, Sep 15, 2026, Support wrote:\n> Any updates?\nYes, the work is ready.",
    "On Tue, Sep 15, 2026, Support wrote:\n> This message is the entire body.",
  ])("leaves an ordinary or inline quote visible", (body) => {
    const { container } = render(<TicketConversation messages={[{ ...baseMessage, body }]} orderChat />);
    expect(container).toHaveTextContent(body.split("\n").at(-1)!);
    expect(screen.queryByRole("button", { name: /show more/i })).not.toBeInTheDocument();
  });
});

describe("Reply availability", () => {
  it("1. own image-only message exposes Reply", () => {
    const onReply = vi.fn();
    render(<TicketConversation messages={[imageOnlyOwnMessage]} orderChat onReply={onReply} />);
    openMenu();
    expect(screen.getByRole("menuitem", { name: /reply/i })).toBeInTheDocument();
  });

  it("2. external image-only message exposes Reply", () => {
    const onReply = vi.fn();
    render(<TicketConversation messages={[imageOnlyExternalMessage]} orderChat onReply={onReply} />);
    openMenu();
    expect(screen.getByRole("menuitem", { name: /reply/i })).toBeInTheDocument();
  });

  it("3. text-only Reply behavior is unchanged", () => {
    const onReply = vi.fn();
    render(<TicketConversation messages={[baseMessage]} orderChat onReply={onReply} />);
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /reply/i }));
    expect(onReply).toHaveBeenCalledWith(expect.objectContaining({ messageId: baseMessage.id, body: "Hello" }));
  });

  it("4. text+image Reply works", () => {
    const onReply = vi.fn();
    const message = { ...baseMessage, body: "Here you go", attachments: [imageAttachment] };
    render(<TicketConversation messages={[message]} orderChat onReply={onReply} />);
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /reply/i }));
    expect(onReply).toHaveBeenCalledWith(expect.objectContaining({ messageId: message.id }));
  });

  it("11. reply to an image-only message uses the canonical Reply path with a truthful preview", () => {
    const onReply = vi.fn();
    render(<TicketConversation messages={[imageOnlyOwnMessage]} orderChat onReply={onReply} />);
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /reply/i }));
    expect(onReply).toHaveBeenCalledTimes(1);
    const target = onReply.mock.calls[0]![0];
    expect(target.messageId).toBe(imageOnlyOwnMessage.id);
    expect(target.replyPreview).toBe("Image");
    expect(target.replyPreview).not.toContain("photo.jpg");
    expect(target.replyPreview).not.toContain("image/jpeg");
  });

  it("12. non-image attachment behavior is unchanged (still a plain download link, still exposes Reply)", () => {
    const onReply = vi.fn();
    const message = { ...baseMessage, body: "", author_type: "internal" as const, attachments: [pdfAttachment] };
    render(<TicketConversation messages={[message]} orderChat onReply={onReply} />);
    const link = screen.getByRole("link", { name: /invoice\.pdf/i });
    expect(link).toHaveAttribute("href", `/api/ticket-attachments/${pdfAttachment.id}`);
    expect(link).toHaveAttribute("target", "_blank");
    openMenu();
    expect(screen.getByRole("menuitem", { name: /reply/i })).toBeInTheDocument();
  });
});

describe("Image lightbox", () => {
  it("5. clicking an image does not perform normal anchor navigation", () => {
    render(<TicketConversation messages={[imageOnlyOwnMessage]} orderChat />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /photo\.jpg/i })).toBeInTheDocument();
  });

  it("6. image click opens the lightbox", () => {
    render(<TicketConversation messages={[imageOnlyOwnMessage]} orderChat />);
    fireEvent.click(screen.getByRole("button", { name: /photo\.jpg/i }));
    expect(screen.getByRole("dialog", { name: /photo\.jpg/i })).toBeInTheDocument();
  });

  it("7. close button closes the lightbox", () => {
    render(<TicketConversation messages={[imageOnlyOwnMessage]} orderChat />);
    fireEvent.click(screen.getByRole("button", { name: /photo\.jpg/i }));
    fireEvent.click(screen.getByRole("button", { name: "Close image" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("8. Escape closes the lightbox", () => {
    render(<TicketConversation messages={[imageOnlyOwnMessage]} orderChat />);
    fireEvent.click(screen.getByRole("button", { name: /photo\.jpg/i }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("9. clicking the backdrop closes the lightbox", () => {
    const { container } = render(<TicketConversation messages={[imageOnlyOwnMessage]} orderChat />);
    fireEvent.click(screen.getByRole("button", { name: /photo\.jpg/i }));
    const backdrop = container.ownerDocument.querySelector('[role="dialog"]')!.parentElement!;
    fireEvent.click(backdrop);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("10. clicking the image inside the lightbox does not close it", () => {
    render(<TicketConversation messages={[imageOnlyOwnMessage]} orderChat />);
    fireEvent.click(screen.getByRole("button", { name: /photo\.jpg/i }));
    const dialog = screen.getByRole("dialog", { name: /photo\.jpg/i });
    fireEvent.click(dialog);
    expect(screen.getByRole("dialog", { name: /photo\.jpg/i })).toBeInTheDocument();
  });

  it("never exposes the raw attachment endpoint or MIME/byte metadata for images", () => {
    render(<TicketConversation messages={[imageOnlyOwnMessage]} orderChat />);
    expect(screen.queryByText(/image\/jpeg/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/1,000 bytes/i)).not.toBeInTheDocument();
  });
});
