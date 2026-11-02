/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServicesFolderWorkspace } from "../components/services/services-folder-workspace";
import { RouteTransitionProvider } from "../components/shell/route-transition";
import { NextLinkRouter, interceptNextLinkNavigation } from "./fixtures/next-link-router";

vi.mock("next/link", async () => (await import("./fixtures/next-link-router")).appLinkModule);
const service = { id: "synthetic", name: "Test service", folderId: "test", priceLabel: "$1", createdLabel: "Test date", summary: "", descriptionHtml: "", recurring: false, isActive: true, isPublic: false };
let restore: () => void;
beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  restore = interceptNextLinkNavigation(() => {}); // Keep the source tree mounted while the destination is unresolved.
});
afterEach(() => { cleanup(); restore(); vi.unstubAllGlobals(); });

function RetainedRoute() {
  const [destination, setDestination] = useState<string | null>(null);
  return <NextLinkRouter><RouteTransitionProvider begin={url => setDestination(url.pathname)}>
    {destination ? <p role="status">Loading {destination}</p> : null}
    <div hidden={destination !== null}>
      <ServicesFolderWorkspace folders={[{ id: "test", name: "Test folder", description: null, serviceCount: 1 }]} services={[service]} initialFolderId="test" />
    </div>
  </RouteTransitionProvider></NextLinkRouter>;
}

describe("Service detail modal navigation", () => {
  it.each(["Edit service", "Create project"])("closes the portal and releases scrolling before %s resolves", async label => {
    render(<RetainedRoute />);
    fireEvent.click(screen.getByRole("button", { name: /Test service/ }));
    expect(screen.getByRole("dialog", { name: "Test service" })).toBeVisible();
    expect(document.body.style.overflow).toBe("hidden");
    await act(async () => { fireEvent.click(screen.getByRole("link", { name: label })); });
    expect(screen.getByRole("status")).toBeVisible();
    expect(screen.queryByRole("dialog", { name: "Test service" })).toBeNull();
    expect(document.body.style.overflow).toBe("");
  });
  it("keeps the dialog open for a modified new-tab click", async () => {
    render(<RetainedRoute />);
    fireEvent.click(screen.getByRole("button", { name: /Test service/ }));
    await act(async () => { fireEvent.click(screen.getByRole("link", { name: "Edit service" }), { ctrlKey: true }); });
    expect(screen.getByRole("dialog", { name: "Test service" })).toBeVisible();
    expect(screen.queryByRole("status")).toBeNull();
    expect(document.body.style.overflow).toBe("hidden");
  });
});
