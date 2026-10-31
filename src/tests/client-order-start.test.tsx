// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientOrderStart } from "../components/account/projects/client-order-start";
import type { ClientOrderStartState } from "../domain/orders/client-start";
const mocks = vi.hoisted(() => ({ start: vi.fn(), refresh: vi.fn(), push: vi.fn() }));
vi.mock("../app/actions/client-order-start", () => ({ requestClientOrderStart: mocks.start }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh, push: mocks.push }) }));
const state: ClientOrderStartState = {
  order_id: "10000000-0000-4000-8000-000000000001", status: "pending", requested: false, started: false, available: true,
  forms: [{ id: "20000000-0000-4000-8000-000000000001", title: "Service intake", completed: false, available: true }],
};
beforeEach(() => { vi.clearAllMocks(); });
afterEach(cleanup);
describe("client-controlled order start", () => {
  it("does not add controls to legacy or unrelated purchases", () => {
    const view=render(<ClientOrderStart initial={null} />);
    expect(view.container.textContent).toBe(""); expect(mocks.start).not.toHaveBeenCalled();
  });
  it("offers Start order before the required form but never requests a start on render", () => {
    render(<ClientOrderStart initial={state} />);
    expect(screen.getByRole("button", { name: "Start order" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Complete intake form/ }).getAttribute("href")).toBe(`/account/onboarding/${state.forms[0]!.id}`);
    expect(screen.getByRole("link", { name: "Do this later" }).getAttribute("href")).toBe("/account/projects");
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it("saves explicit start intent before navigating to the first still-required form", async () => {
    mocks.start.mockResolvedValue({ ok: true, state: { ...state, requested: true } });
    render(<ClientOrderStart initial={state} />);
    fireEvent.click(screen.getByRole("button", { name: "Start order" }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith(`/account/onboarding/${state.forms[0]!.id}`));
    expect(mocks.start).toHaveBeenCalledExactlyOnceWith(state.order_id);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it("does not navigate on an uncertain or rejected start request", async () => {
    mocks.start.mockResolvedValue({ ok: false, error: "Cannot confirm the order" });
    render(<ClientOrderStart initial={state} />);
    fireEvent.click(screen.getByRole("button", { name: "Start order" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Cannot confirm/);
    expect(mocks.push).not.toHaveBeenCalled();
  });
  it("keeps all incomplete requirements and skips completed forms", () => {
    render(<ClientOrderStart initial={{ ...state, forms: [
      { ...state.forms[0]!, completed: true },
      { ...state.forms[0]!, id: "20000000-0000-4000-8000-000000000002", title: "Second intake" },
    ] }} />);
    expect(screen.getAllByRole("link", { name: /Complete intake form/ })).toHaveLength(1);
    expect(screen.getByRole("link", { name: /Complete intake form/ }).getAttribute("href")).toMatch(/000000000002$/);
    expect(screen.getByRole("button", { name: "Start order" })).toBeTruthy();
  });
  it("does not claim an order started when the server rejects it", async () => {
    mocks.start.mockResolvedValue({ ok: false, error: "Order unavailable" });
    render(<ClientOrderStart initial={{ ...state, forms: state.forms.map((form) => ({ ...form, completed: true })) }} />);
    fireEvent.click(screen.getByRole("button", { name: "Start order" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Order unavailable");
    expect(screen.queryByRole("link", { name: /Complete form/ })).toBeNull();
  });
  it("starts an order immediately if the form was completed before the explicit request", async () => {
    mocks.start.mockResolvedValue({ ok: true, state: { ...state, status: "working", requested: true, started: true, available: false } });
    render(<ClientOrderStart initial={{ ...state, forms: state.forms.map((form) => ({ ...form, completed: true })) }} />);
    fireEvent.click(screen.getByRole("button", { name: "Start order" }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce());
    expect(screen.queryByText("Your order is in progress")).toBeNull();
  });
  it("retains unavailable required forms rather than silently skipping them", () => {
    render(<ClientOrderStart initial={{ ...state, requested: true, forms: state.forms.map((form) => ({ ...form, available: false })) }} />);
    expect(screen.getByText(/Form unavailable/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Start order" })).toBeNull();
  });
  it("does not treat a missing requirements response as permission to start", () => {
    render(<ClientOrderStart initial={{ ...state, forms: [] }} />);
    expect(screen.queryByRole("button", { name: "Start order" })).toBeNull();
    expect(screen.getByRole("alert").textContent).toMatch(/could not be loaded/);
  });
  it("uses refreshed server evidence when the required forms become complete", () => {
    const view = render(<ClientOrderStart initial={state} />);
    expect(screen.getByRole("button", { name: "Start order" })).toBeTruthy();
    view.rerender(<ClientOrderStart initial={{ ...state, forms: state.forms.map((form) => ({ ...form, completed: true })) }} />);
    expect(screen.getByRole("button", { name: "Start order" })).toBeTruthy();
  });
  it("does not label an already completed order as currently in progress", () => {
    render(<ClientOrderStart initial={{ ...state, status: "complete", requested: true, started: true, available: false }} />);
    expect(screen.queryByText("Your order was started")).toBeNull();
    expect(screen.queryByText("Your order is in progress")).toBeNull();
    expect(screen.queryByRole("button", { name: "Start order" })).toBeNull();
  });
  it("lets a saved start request reconcile without requesting another form submission", () => {
    render(<ClientOrderStart initial={{ ...state, requested: true, forms: state.forms.map((form) => ({ ...form, completed: true })) }} />);
    expect(screen.getByRole("button", { name: "Check start status" })).toBeTruthy();
    expect(screen.getByText(/no further form submission/)).toBeTruthy();
  });
});
