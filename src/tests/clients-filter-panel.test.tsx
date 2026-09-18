/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
let params = new URLSearchParams();

vi.mock("next/navigation", () => ({
  usePathname: () => "/clients",
  useRouter: () => ({ push }),
  useSearchParams: () => params,
}));

const { ClientsFilterPanel } = await import("../components/clients/clients-filter-panel");

function stubViewport(matches: boolean) {
  vi.stubGlobal("matchMedia", () => ({
    matches,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

function openPanel(status: string) {
  const view = render(<ClientsFilterPanel initialQuery="" initialStatus={status} />);
  fireEvent.click(screen.getByRole("button", { name: /^Filter/ }));
  return { view, dialog: screen.getByRole("dialog", { name: "Filter clients" }) };
}

function openType(dialog: HTMLElement) {
  fireEvent.click(within(dialog).getByRole("button", { name: /Type/ }));
}

beforeEach(() => {
  push.mockReset();
  params = new URLSearchParams();
  stubViewport(false);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Clients filter Type", () => {
  it("shows the current canonical status as Type when the panel opens", () => {
    const { dialog } = openPanel("client_team");

    expect(within(dialog).getByRole("button", { name: /Type/ }).textContent).toContain("Client Team");
  });

  it("defaults Type to All when no status is active", () => {
    const { dialog } = openPanel("");

    expect(within(dialog).getByRole("button", { name: /Type/ }).textContent).toContain("All");
  });

  it("offers the full canonical vocabulary including Client Team", () => {
    const { dialog } = openPanel("");
    openType(dialog);

    for (const label of ["All", "Contact", "Lead", "Client", "Client Team"]) {
      expect(within(dialog).getByRole("button", { name: label })).toBeTruthy();
    }
  });

  it("writes the selected type to the existing `status` param on Apply", () => {
    const { dialog } = openPanel("");
    openType(dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "Client Team" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply filter" }));

    expect(push).toHaveBeenCalledWith("/clients?status=client_team");
  });

  it("removes the status param when All is applied", () => {
    const { dialog } = openPanel("lead");
    openType(dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "All" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply filter" }));

    expect(push).toHaveBeenCalledWith("/clients");
  });

  it("keeps the search param intact while changing the type", () => {
    params = new URLSearchParams("q=acme");
    const { dialog } = openPanel("lead");
    openType(dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "Client" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply filter" }));

    const target = push.mock.calls.at(-1)?.[0] as string;
    expect(new URLSearchParams(target.split("?")[1]).get("q")).toBe("acme");
    expect(new URLSearchParams(target.split("?")[1]).get("status")).toBe("client");
  });

  it("follows the URL when it changes underneath the panel", () => {
    const { view, dialog } = openPanel("lead");
    expect(within(dialog).getByRole("button", { name: /Type/ }).textContent).toContain("Lead");

    params = new URLSearchParams("status=contact");
    view.rerender(<ClientsFilterPanel initialQuery="" initialStatus="contact" />);

    expect(within(dialog).getByRole("button", { name: /Type/ }).textContent).toContain("Contact");
  });

  it("restores All on reset", () => {
    const { dialog } = openPanel("client");
    fireEvent.click(within(dialog).getByRole("button", { name: "Reset" }));

    expect(within(dialog).getByRole("button", { name: /Type/ }).textContent).toContain("All");
  });
});

describe("Clients filter sheet containment", () => {
  it("leaves the panel inside the toolbar above the sheet breakpoint", () => {
    const { view, dialog } = openPanel("");

    expect(view.container.contains(dialog)).toBe(true);
    expect(document.body.contains(dialog)).toBe(true);
  });

  it("portals the panel out of the route subtree at the sheet breakpoint", () => {
    stubViewport(true);
    const { view, dialog } = openPanel("");

    /*
     * .workspace-route-stage carries a transform, so a fixed-position sheet
     * left inside it anchors to the route stage instead of the viewport and
     * renders off the top of the screen. Asserting it is outside the rendered
     * root is what proves the portal is doing its job.
     */
    expect(view.container.contains(dialog)).toBe(false);
    expect(dialog.parentElement).toBe(document.body);
  });

  it("keeps the panel open while its own controls are clicked", () => {
    stubViewport(true);
    const { dialog } = openPanel("");
    openType(dialog);

    fireEvent.mouseDown(within(dialog).getByRole("button", { name: "Lead" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Lead" }));

    expect(screen.getByRole("dialog", { name: "Filter clients" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: /Type/ }).textContent).toContain("Lead");
  });
});
