/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FolderDeskService } from "../components/services/services-folder-workspace";

const { ServicesFolderWorkspace } = await import(
  "../components/services/services-folder-workspace"
);

const folders = [
  { id: "f1", name: "SEO Sprints", description: null, serviceCount: 1 },
  { id: "f2", name: "GBP Only SEO", description: null, serviceCount: 2 },
  { id: "f3", name: "Unfiled", description: null, serviceCount: 0 },
];

function service(
  id: string,
  name: string,
  folderId: string,
  price: number,
): FolderDeskService {
  return {
    id,
    name,
    folderId,
    priceLabel: `${price}`,
    createdLabel: "Sep 16, 2026",
    summary: `${name} summary`,
    descriptionHtml: "",
    recurring: false,
    isActive: true,
    isPublic: true,
  };
}

const services = [
  service("s1", "MAPS SPRINT", "f1", 97),
  service("s2", "GMB Optimization", "f2", 297),
  service("s3", "GMB Verification", "f2", 350),
];

function rowNames() {
  return Array.from(document.querySelectorAll("button[class*='serviceRow'] strong")).map(
    (el) => el.textContent?.trim(),
  );
}

beforeEach(() => {
  /* The deck is not rendered below 768px, which is where the switcher lives. */
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Services folder switcher", () => {
  it("presents the current folder as a disclosure control, not a heading", () => {
    render(<ServicesFolderWorkspace folders={folders} services={services} initialFolderId={null} />);

    const trigger = screen.getByRole("button", { name: /^Select service folder/ });

    expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.textContent).toContain("SEO Sprints");
    expect(trigger.textContent).toContain("1 service");
  });

  it("keeps New Service a sibling link so it cannot open the picker", () => {
    render(<ServicesFolderWorkspace folders={folders} services={services} initialFolderId={null} />);

    const newService = screen.getByRole("link", { name: /New Service/ });

    expect(newService.getAttribute("href")).toBe("/services/new?folder=f1");
  });

  it("offers every real folder with its count and marks the current one", () => {
    render(<ServicesFolderWorkspace folders={folders} services={services} initialFolderId={null} />);
    fireEvent.click(screen.getByRole("button", { name: /^Select service folder/ }));

    const dialog = screen.getByRole("dialog", { name: "Select folder" });

    for (const folder of folders) {
      expect(within(dialog).getByRole("button", { name: new RegExp(folder.name) })).toBeTruthy();
    }

    expect(within(dialog).getByRole("button", { name: /SEO Sprints/ }).getAttribute("aria-pressed")).toBe("true");
    expect(within(dialog).getByRole("button", { name: /GBP Only SEO/ }).textContent).toContain("2");
    expect(within(dialog).getByRole("button", { name: /Unfiled/ }).textContent).toContain("0");
  });

  it("switches the active folder and the service list, then closes", () => {
    render(<ServicesFolderWorkspace folders={folders} services={services} initialFolderId={null} />);
    expect(rowNames()).toEqual(["MAPS SPRINT"]);

    fireEvent.click(screen.getByRole("button", { name: /^Select service folder/ }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Select folder" })).getByRole("button", { name: /GBP Only SEO/ }));

    expect(rowNames()).toEqual(["GMB Optimization", "GMB Verification"]);
    expect(screen.getByRole("button", { name: /^Select service folder/ }).textContent).toContain("GBP Only SEO");
    expect(screen.getByRole("button", { name: /^Select service folder/ }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("link", { name: /New Service/ }).getAttribute("href")).toBe("/services/new?folder=f2");
  });

  it("opens on the folder the route asked for", () => {
    render(<ServicesFolderWorkspace folders={folders} services={services} initialFolderId="f2" />);

    expect(screen.getByRole("button", { name: /^Select service folder/ }).textContent).toContain("GBP Only SEO");
    expect(rowNames()).toEqual(["GMB Optimization", "GMB Verification"]);
  });
});

describe("Services folder icon and selected state", () => {
  it("puts the active folder's own icon in the collapsed trigger", () => {
    render(<ServicesFolderWorkspace folders={folders} services={services} initialFolderId={null} />);

    const trigger = screen.getByRole("button", { name: /^Select service folder/ });
    const icons = trigger.querySelectorAll("svg");

    /* One glyph in the icon slot, plus the chevron. */
    expect(icons.length).toBe(2);
    expect(trigger.querySelector("[class*='folderSelectorIcon']")).toBeTruthy();
  });

  it("gives picker rows different icons and changes the trigger's on switch", () => {
    render(<ServicesFolderWorkspace folders={folders} services={services} initialFolderId={null} />);

    const pathOf = (el: Element) =>
      Array.from(el.querySelectorAll("path")).map((p) => p.getAttribute("d")).join("|");

    const before = pathOf(screen.getByRole("button", { name: /^Select service folder/ }));

    fireEvent.click(screen.getByRole("button", { name: /^Select service folder/ }));
    const dialog = screen.getByRole("dialog", { name: "Select folder" });
    const rowPaths = Array.from(dialog.querySelectorAll("[role='group'] button")).map(pathOf);

    expect(rowPaths[0]).not.toBe(rowPaths[1]);
    expect(new Set(rowPaths).size).toBe(3);

    fireEvent.click(within(dialog).getByRole("button", { name: /GBP Only SEO/ }));

    const after = pathOf(screen.getByRole("button", { name: /^Select service folder/ }));
    expect(after).not.toBe(before);
  });

  it("marks the selected row with the navy tint rather than the gold accent", () => {
    render(<ServicesFolderWorkspace folders={folders} services={services} initialFolderId={null} />);
    fireEvent.click(screen.getByRole("button", { name: /^Select service folder/ }));

    const dialog = screen.getByRole("dialog", { name: "Select folder" });
    const selected = within(dialog).getByRole("button", { name: /SEO Sprints/ });

    expect(selected.getAttribute("aria-pressed")).toBe("true");
    expect(selected.className).toMatch(/optionRowSelectedNavy/);
    expect(selected.className).not.toMatch(/optionRowSelected__/);
  });
});
