/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { ClientMessages } from "../components/account/messages/client-messages";

const state = vi.hoisted(() => ({ loads: 0, finish: () => {}, create: vi.fn() }));
vi.mock("../components/tickets/ticket-rich-text-editor", async () => {
  state.loads += 1;
  await new Promise<void>((resolve) => { state.finish = resolve; });
  return { TicketRichTextEditor: ({ label, initialValue, onChange }: { label: string; initialValue: string; onChange: (value: string) => void }) =>
    <textarea aria-label={label} defaultValue={initialValue} onChange={(event) => onChange(event.target.value)} /> };
});
vi.mock("../components/shell/route-transition", () => ({ RouteTransitionLink: ({ children, href }: { children: ReactNode; href: string }) => <a href={href}>{children}</a> }));
vi.mock("../components/account/cart/cart-store", () => ({ useCart: () => [] }));
vi.mock("../app/actions/tickets", () => ({ createClientTicketAction: state.create }));
afterEach(cleanup);

it("defers the closed editor, keeps the list usable, and preserves a draft across load, failure and reopening", async () => {
  state.create.mockResolvedValue({ ok: false, error: "Synthetic retry error" });
  render(<ClientMessages summaries={[]} />);
  expect(state.loads).toBe(0);
  expect(screen.getByRole("heading", { name: "Tickets" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "New message" }));
  fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Synthetic draft" } });
  expect(screen.getByRole("status")).toHaveTextContent("Loading message editor");
  expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
  await waitFor(() => expect(state.loads).toBe(1));
  await act(async () => { state.finish(); });
  const editor = await screen.findByRole("textbox", { name: "Write a message" });
  fireEvent.change(editor, { target: { value: "Keep this message" } });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Synthetic retry error");
  expect(state.create).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ subject: "Synthetic draft", message: "Keep this message" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Send message" })).toBeEnabled());
  fireEvent.keyDown(document, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "New message" }));
  expect(screen.getByLabelText("Subject")).toHaveValue("Synthetic draft");
  expect(await screen.findByRole("textbox", { name: "Write a message" })).toHaveValue("Keep this message");
  expect(state.loads).toBe(1);
});
