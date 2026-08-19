/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";
import {
  TicketConversation,
} from "../components/tickets/ticket-conversation";
import type {
  TicketDetailMessage,
} from "../domain/tickets/schema";

afterEach(cleanup);

const baseMessage:
  TicketDetailMessage = {
    id: "70000000-0000-4000-8000-000000000001",
    ticket_id:
      "70000000-0000-4000-8000-000000000010",
    author_profile_id:
      "70000000-0000-4000-8000-000000000020",
    author_name:
      "Client Person",
    author_avatar_url:
      null,
    author_type:
      "client",
    message_kind:
      "reply",
    visibility:
      "client",
    body:
      "Hello",
    created_at:
      "2026-08-15T10:00:00Z",
    attachments: [],
  };

describe(
  "Ticket conversation polish",
  () => {
    it(
      "uses the Wolf Forge fallback when an author has no avatar",
      () => {
        render(
          <TicketConversation
            messages={[
              baseMessage,
            ]}
            clientView
          />,
        );

        expect(
          screen.getByTestId(
            "ticket-avatar-fallback",
          ),
        ).toBeInTheDocument();
      },
    );

    it(
      "uses a real author avatar and safely falls back if it breaks",
      () => {
        render(
          <TicketConversation
            messages={[
              {
                ...baseMessage,
                author_avatar_url:
                  "https://example.com/avatar.jpg",
              },
            ]}
            clientView
          />,
        );

        const image =
          screen.getByTestId(
            "ticket-avatar-image",
          );

        expect(image).toHaveAttribute(
          "src",
          "https://example.com/avatar.jpg",
        );

        fireEvent.error(image);

        expect(
          screen.getByTestId(
            "ticket-avatar-fallback",
          ),
        ).toBeInTheDocument();
      },
    );

    it(
      "renders constrained rich text without unsafe link execution",
      () => {
        render(
          <TicketConversation
            messages={[
              {
                ...baseMessage,
                body:
                  "# Update\n**Bold** _Italic_ [Safe](https://example.com)\n[Unsafe](javascript:alert(1))",
              },
            ]}
            clientView
          />,
        );

        expect(
          screen.getByRole(
            "heading",
            {
              name: "Update",
            },
          ),
        ).toBeInTheDocument();

        expect(
          screen.getByText(
            "Bold",
          ).tagName,
        ).toBe("STRONG");

        expect(
          screen.getByText(
            "Italic",
          ).tagName,
        ).toBe("EM");

        expect(
          screen.getByRole(
            "link",
            {
              name: "Safe",
            },
          ),
        ).toHaveAttribute(
          "href",
          "https://example.com",
        );

        expect(
          screen.queryByRole(
            "link",
            {
              name: "Unsafe",
            },
          ),
        ).not.toBeInTheDocument();
      },
    );

    it(
      "keeps internal notes out of client view and keeps chronological order",
      () => {
        const later = {
          ...baseMessage,
          id:
            "70000000-0000-4000-8000-000000000002",
          body:
            "Later client message",
          created_at:
            "2026-08-15T12:00:00Z",
        };

        const note = {
          ...baseMessage,
          id:
            "70000000-0000-4000-8000-000000000003",
          author_type:
            "internal" as const,
          message_kind:
            "internal_note" as const,
          visibility:
            "internal" as const,
          body:
            "Private staff note",
          created_at:
            "2026-08-15T11:00:00Z",
        };

        render(
          <TicketConversation
            messages={[
              later,
              note,
              {
                ...baseMessage,
                body:
                  "Earlier client message",
              },
            ]}
            clientView
          />,
        );

        expect(
          screen.queryByText(
            "Private staff note",
          ),
        ).not.toBeInTheDocument();

        const items =
          screen.getAllByRole(
            "listitem",
          );

        expect(items[0]).toHaveTextContent(
          "Earlier client message",
        );

        expect(items[1]).toHaveTextContent(
          "Later client message",
        );
      },
    );
  },
);