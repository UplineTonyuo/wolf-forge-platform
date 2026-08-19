/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import {
  cleanup,
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
import {
  TicketRichTextEditor,
} from "../components/tickets/ticket-rich-text-editor";
import type {
  TicketDetailMessage,
} from "../domain/tickets/schema";

afterEach(cleanup);

const message:
  TicketDetailMessage = {
    id:
      "81000000-0000-4000-8000-000000000001",
    ticket_id:
      "81000000-0000-4000-8000-000000000002",
    author_profile_id:
      "81000000-0000-4000-8000-000000000003",
    author_name:
      "Wolf Forge Demo",
    author_avatar_url:
      null,
    author_type:
      "internal",
    message_kind:
      "reply",
    visibility:
      "client",
    body:
      "- Bullet one\n- Bullet two\n1. Number one\n2. Number two",
    created_at:
      "2026-08-15T15:02:00Z",
    attachments: [],
  };

describe(
  "Ticket list formatting",
  () => {
    it(
      "offers bullet and numbered list tools",
      () => {
        render(
          <TicketRichTextEditor
            onChange={() =>
              undefined
            }
          />,
        );

        expect(
          screen.getByRole(
            "button",
            {
              name:
                "Bulleted list",
            },
          ),
        ).toBeInTheDocument();

        expect(
          screen.getByRole(
            "button",
            {
              name:
                "Numbered list",
            },
          ),
        ).toBeInTheDocument();
      },
    );

    it(
      "renders stored bullet and numbered lists",
      () => {
        const {
          container,
        } = render(
          <TicketConversation
            messages={[
              message,
            ]}
          />,
        );

        expect(
          container.querySelectorAll(
            "ul li",
          ),
        ).toHaveLength(2);

        expect(
          container.querySelectorAll(
            "ol ol > li",
          ),
        ).toHaveLength(2);

        expect(
          screen.getByText(
            "Bullet one",
          ),
        ).toBeInTheDocument();

        expect(
          screen.getByText(
            "Number two",
          ),
        ).toBeInTheDocument();
      },
    );
  },
);