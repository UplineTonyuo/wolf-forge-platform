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
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("Sandboxed studio preview", () => {
  it("sidebar, cards and detail navigation remain inside the preview in both devices", () => {
    render(<Builder />);
    fireEvent.click(screen.getByRole("button", { name: "Open Projects preview" }));
    expect(screen.getByTestId("preview-greeting")).toHaveTextContent("Projects");
    expect(screen.getByTestId("preview-greeting")).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: /Sample item/ }));
    expect(screen.getByTestId("preview-greeting")).toHaveTextContent("Projects sample");
    fireEvent.click(screen.getByRole("button", { name: "Mobile" }));
    expect(screen.getByTestId("preview-greeting")).toHaveTextContent("Projects sample");
    fireEvent.click(screen.getByRole("button", { name: "Back to projects preview" }));
    fireEvent.click(screen.getByRole("button", { name: "Workspace overview" }));
    fireEvent.click(screen.getByRole("button", { name: "Explore Tickets preview" }));
    expect(screen.getByTestId("preview-greeting")).toHaveTextContent("Tickets");
    expect(window.location.pathname + window.location.search).toBe("/white-label?tenant=isolated-test");
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Workspace display name")).toHaveValue(SYNTHETIC_PREVIEW_STATE.displayName);
  });
  it("disabling an active module or its dependency removes its content and focus targets", () => {
    render(<Builder />);
    fireEvent.click(screen.getByRole("button", { name: "Explore Projects preview" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Services" }));
    expect(screen.getByTestId("preview-greeting")).toHaveTextContent("Welcome to");
    expect(screen.queryByRole("button", { name: "Open Projects preview" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Explore Projects preview" })).toBeNull();
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
    expect(screen.getAllByRole("checkbox").filter((entry) => (entry as HTMLInputElement).checked)).toHaveLength(6);
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
