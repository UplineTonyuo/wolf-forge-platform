/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { OrderConversationDialog } from "../components/tickets/order-conversation-dialog";

afterEach(cleanup);

it("opens on demand, returns focus and preserves the composer across dismissal", async () => {
  render(<OrderConversationDialog><textarea aria-label="Reply" /></OrderConversationDialog>);
  const opener = screen.getByRole("button", { name: "Open message" });
  expect(screen.queryByRole("textbox")).toBeNull();
  opener.focus();
  fireEvent.click(opener);
  const dialog = screen.getByRole("dialog", { name: "Order conversation" });
  const reply = screen.getByRole("textbox");
  fireEvent.change(reply, { target: { value: "Unsent reply" } });
  fireEvent.keyDown(dialog, { key: "Escape" });
  expect(document.activeElement).toBe(opener);
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  fireEvent.click(opener);
  expect(screen.getByDisplayValue("Unsent reply")).toBe(reply);
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});
