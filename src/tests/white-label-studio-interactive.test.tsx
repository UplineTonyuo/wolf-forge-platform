/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/white-label", useRouter: () => ({ push: navigate }) }));
import { WhiteLabelBuilder } from "../components/white-label/white-label-builder";
import { WHITE_LABEL_COLOR_TEMPLATES, colorContrast, parseHexColor, previewForeground } from "../domain/white-label/colors";
import { SYNTHETIC_PREVIEW_STATE } from "../domain/white-label/preview";

function Builder() {
  const [state, update] = useState(SYNTHETIC_PREVIEW_STATE);
  return <WhiteLabelBuilder state={state} onStateChange={update} />;
}
beforeEach(() => { window.history.replaceState(null, "", "/white-label?tenant=isolated-test"); });
const live = () => within(screen.getByRole("region", { name: "Live preview" }));
// X/+ controls exist only in the preview sidebar's transient edit mode.
const editModules = () => { const edit = live().queryByRole("button", { name: "Edit modules" }); if (edit) fireEvent.click(edit); };
const moduleSwitch = (label: string) => { editModules(); return live().getByRole("switch", { name: `${label} module` }); };
const selectedModules = () => (editModules(), live().getAllByRole("switch")).filter((entry) => entry.getAttribute("aria-checked") === "true");
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("Sandboxed studio preview", () => {
  it("keeps the shared application canvas across simulated screens and device changes", () => {
    render(<Builder />);
    for (const label of ["Services", "Projects", "Tickets", "Reporting", "Invoices", "Forms"]) {
      fireEvent.click(live().getByRole("button", { name: `Open ${label} preview` }));
      expect(within(screen.getByTestId("preview-workspace")).getByTestId("preview-greeting")).toHaveTextContent(label);
      fireEvent.click(live().getAllByRole("button", { name: /^Open sample / })[0]!);
      expect(screen.getByTestId("preview-greeting")).toHaveTextContent(`${label} sample`);
    }
    fireEvent.click(screen.getByRole("button", { name: "Mobile" }));
    expect(screen.getByTestId("preview-greeting")).toHaveTextContent("Forms sample");
    expect(screen.getByTestId("preview-workspace")).toHaveTextContent("Client intake");
    expect(window.location.pathname + window.location.search).toBe("/white-label?tenant=isolated-test");
    expect(navigate).not.toHaveBeenCalled();
  });
  it("labels dashboard metrics, chart and activity as sample data and obeys module eligibility", () => {
    render(<Builder />);
    const workspace = within(screen.getByTestId("preview-workspace"));
    expect(workspace.getByText(/Sample data only, no live Tenant records/)).toBeInTheDocument();
    expect(workspace.getByRole("img", { name: /Illustrative revenue trend.*Sample data, no live records/ })).toBeInTheDocument();
    expect(within(workspace.getByRole("list", { name: "Sample metrics" })).getAllByRole("listitem")).toHaveLength(4);
    expect(workspace.getByRole("region", { name: "Sample recent activity" })).toHaveTextContent("New project created");
    fireEvent.click(workspace.getByRole("button", { name: /New project created/ }));
    expect(screen.getByTestId("preview-greeting")).toHaveTextContent("Projects");
    fireEvent.click(live().getByRole("button", { name: "Workspace overview" }));
    fireEvent.click(moduleSwitch("Projects"));
    fireEvent.click(moduleSwitch("Invoices"));
    const updated = within(screen.getByTestId("preview-workspace"));
    expect(updated.queryByRole("button", { name: /New project created|Payment received/ })).toBeNull();
    expect(updated.queryByRole("button", { name: /Explore (Projects|Invoices) preview/ })).toBeNull();
    expect(updated.getByRole("img", { name: /Illustrative activity trend/ })).toBeInTheDocument();
    expect(within(updated.getByRole("list", { name: "Sample metrics" })).getAllByRole("listitem")).toHaveLength(4);
    expect(navigate).not.toHaveBeenCalled();
  });
  it("mobile navigation opens inside the phone, closes on selection and returns focus on Escape", () => {
    render(<Builder />);
    fireEvent.click(live().getByRole("button", { name: "Open Dashboard preview" }));
    expect(screen.getByTestId("preview-greeting")).toHaveFocus();
    fireEvent.click(live().getByRole("button", { name: "Mobile" }));
    expect(live().queryByRole("button", { name: "Open Projects preview" })).toBeNull();
    fireEvent.click(live().getByRole("button", { name: "Open preview navigation" }));
    expect(live().getByRole("button", { name: "Close preview navigation" })).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(live().getByRole("button", { name: "Open Projects preview" }));
    expect(screen.getByTestId("preview-greeting")).toHaveTextContent("Projects");
    expect(screen.getByTestId("preview-greeting")).toHaveFocus();
    expect(live().getByRole("button", { name: "Open preview navigation" })).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(live().getByRole("button", { name: "Open preview navigation" }));
    fireEvent.click(live().getByRole("button", { name: "Open Projects preview" }));
    expect(screen.getByTestId("preview-greeting")).toHaveFocus();
    fireEvent.click(live().getByRole("button", { name: "Open preview navigation" }));
    fireEvent.keyDown(live().getByRole("button", { name: "Close preview navigation" }), { key: "Escape" });
    expect(live().getByRole("button", { name: "Open preview navigation" })).toHaveFocus();
    expect(screen.getByTestId("preview-greeting")).toHaveTextContent("Projects");
    expect(window.location.pathname + window.location.search).toBe("/white-label?tenant=isolated-test");
    expect(navigate).not.toHaveBeenCalled();
  });
  it("sidebar, cards and detail navigation remain inside the preview in both devices", () => {
    render(<Builder />);
    fireEvent.click(live().getByRole("button", { name: "Open Projects preview" }));
    expect(screen.getByTestId("preview-greeting")).toHaveTextContent("Projects");
    expect(screen.getByTestId("preview-greeting")).toHaveFocus();
    fireEvent.click(live().getByRole("button", { name: "Open sample Website Redesign" }));
    expect(screen.getByTestId("preview-greeting")).toHaveTextContent("Projects sample");
    fireEvent.click(live().getByRole("button", { name: "Mobile" }));
    expect(screen.getByTestId("preview-greeting")).toHaveTextContent("Projects sample");
    fireEvent.click(live().getByRole("button", { name: "Back to projects preview" }));
    fireEvent.click(live().getByRole("button", { name: "Workspace overview" }));
    fireEvent.click(live().getByRole("button", { name: /^Explore Tickets preview/ }));
    expect(screen.getByTestId("preview-greeting")).toHaveTextContent("Tickets");
    expect(window.location.pathname + window.location.search).toBe("/white-label?tenant=isolated-test");
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Workspace display name")).toHaveValue(SYNTHETIC_PREVIEW_STATE.displayName);
  });
  it("disabling an active module or its dependency removes its content and focus targets", () => {
    render(<Builder />);
    fireEvent.click(live().getByRole("button", { name: /^Explore Projects preview/ }));
    fireEvent.click(moduleSwitch("Projects"));
    expect(screen.getByTestId("preview-greeting")).toHaveTextContent("Welcome to");
    expect(live().getByRole("button", { name: "Open Projects preview" })).toBeDisabled();
    expect(live().queryByRole("button", { name: /^Explore Projects preview/ })).toBeNull();
    expect(document.querySelector('[data-module="projects"] button')).toBeDisabled();
  });
});

describe("Studio color templates and manual colors", () => {
  it.each(WHITE_LABEL_COLOR_TEMPLATES)("applies $name to both previews without changing identity or modules", (template) => {
    render(<Builder />);
    fireEvent.click(screen.getByRole("button", { name: /^Color template:/ }));
    fireEvent.click(screen.getByRole("option", { name: template.name }));
    expect(screen.getByLabelText("Primary color")).toHaveValue(template.primaryColor);
    expect(screen.getByLabelText("Accent color")).toHaveValue(template.accentColor);
    expect(selectedModules()).toHaveLength(6);
    expect(screen.getByTestId("preview-brand-name")).toHaveTextContent(SYNTHETIC_PREVIEW_STATE.displayName);
    fireEvent.click(screen.getByRole("button", { name: "Mobile" }));
    expect(screen.getByTestId("preview-frame").style.getPropertyValue("--preview-primary")).toBe(template.primaryColor);
    expect(screen.getByTestId("preview-frame").style.getPropertyValue("--preview-accent")).toBe(template.accentColor);
    for (const background of [template.primaryColor, template.accentColor]) expect(colorContrast(background, previewForeground(background))).toBeGreaterThanOrEqual(4.5);
  });
  it("retains incomplete hex text, updates only valid colors, and reset clears invalid text", () => {
    render(<Builder />);
    fireEvent.change(screen.getByLabelText("Primary color"), { target: { value: "#xx" } });
    expect(screen.getByLabelText("Primary color")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByTestId("preview-frame").style.getPropertyValue("--preview-primary")).toBe("#000d51");
    fireEvent.click(screen.getByRole("button", { name: /^Color template:/ }));
    fireEvent.click(screen.getByRole("option", { name: "Wolf Forge Default" }));
    expect(screen.getByLabelText("Primary color")).not.toHaveAttribute("aria-invalid");
    fireEvent.change(screen.getByLabelText("Primary color"), { target: { value: "AABBCC" } });
    expect(screen.getByLabelText("Primary color")).toHaveValue("#aabbcc");
    fireEvent.change(screen.getByLabelText("Accent color picker"), { target: { value: "#445566" } });
    expect(screen.getByLabelText("Accent color")).toHaveValue("#445566");
    expect(within(screen.getByRole("region", { name: "Color templates" })).getByRole("button", {name:"Color template: Custom colors"})).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reset to Wolf Forge Default" }));
    expect(screen.getByLabelText("Primary color")).toHaveValue("#000d51");
    expect(screen.getByLabelText("Accent color")).toHaveValue("#a8832e");
  });
  it("warns about indistinguishable brand colors and keeps preview text readable on light colors", () => {
    render(<Builder />);
    fireEvent.change(screen.getByLabelText("Primary color"), { target: { value: "#ffffff" } });
    fireEvent.change(screen.getByLabelText("Accent color"), { target: { value: "#ffffff" } });
    expect(screen.getByText(/Primary and accent colors are very similar/)).toBeInTheDocument();
    expect(colorContrast("#ffffff", screen.getByTestId("preview-frame").style.getPropertyValue("--preview-on-primary"))).toBeGreaterThanOrEqual(4.5);
  });
  it("rejects CSS, short hex, alpha and non-hex values without altering the save format", () => {
    for (const input of ["red", "#fff", "#abcdef00", "#000000;", "url(x)", ""]) expect(parseHexColor(input)).toBeNull();
    expect(parseHexColor("#ABCDEF")).toBe("#abcdef");
    expect(parseHexColor("abcdef")).toBe("#abcdef");
    expect(colorContrast("#000000", "#ffffff")).toBe(21);
  });
});