// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DrawnSignature, SignatureDrawing } from "../components/forms/drawn-signature";
import { drawnSignatureSchema, readSignatureStrokes, type SignatureStrokes } from "../lib/forms/signature";
import type { Json } from "../lib/supabase/database.types";

const drawing: SignatureStrokes = [[[10, 20], [50, 60]]];
class TestPointerEvent extends MouseEvent {
  pointerId: number;
  constructor(type: string, init: PointerEventInit) { super(type, init); this.pointerId = init.pointerId ?? 1; }
}
beforeEach(() => { vi.stubGlobal("PointerEvent", TestPointerEvent); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function Controlled({ initial, disabled = false }: { initial?: Json; disabled?: boolean }) {
  const [value, setValue] = useState<Json | undefined>(initial);
  return <><DrawnSignature id="signature" label="Client Signature" value={value} required disabled={disabled} onChange={setValue} /><output data-testid="signature-value">{JSON.stringify(value)}</output></>;
}
function pad() {
  const element = screen.getByRole("img", { name: "Client Signature drawing area" });
  Object.defineProperties(element, {
    getBoundingClientRect: { value: () => ({ left: 0, top: 0, width: 500, height: 200 }) },
    setPointerCapture: { value: vi.fn() }, hasPointerCapture: { value: () => false },
  });
  return element;
}
function draw(element: HTMLElement, pointerId = 1) {
  fireEvent.pointerDown(element, { pointerId, button: 0, clientX: 10, clientY: 20 });
  fireEvent.pointerMove(element, { pointerId, clientX: 80, clientY: 90 });
  fireEvent.pointerUp(element, { pointerId });
}

describe("bounded signature drawings", () => {
  it("accepts numeric ink and rejects blank, executable, malformed or oversized drawings", () => {
    expect(readSignatureStrokes(drawing)).toEqual(drawing);
    for (const invalid of [null, [], "<svg onload=alert(1)>", [[[1, 1]]], [[[1, 1], [1, 1]]], [[[0, 0], [1001, 0]]], [[[0, 0], [1, -1]]], [[[0, 0], [1.5, 1]]], [[[0, 0], [NaN, 1]]], Array.from({ length: 33 }, () => drawing[0]), [Array.from({ length: 769 }, () => [1, 1])]]) {
      expect(drawnSignatureSchema.safeParse(invalid).success).toBe(false);
    }
  });
  it("caps total points across strokes, not just each stroke", () => {
    expect(readSignatureStrokes(Array.from({ length: 32 }, () => Array.from({ length: 25 }, (_, i) => [i, i])))).toBeNull();
  });
  it("draws, confirms consent, then clears the signature without losing the full name", () => {
    render(<Controlled />);
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Synthetic signer" } });
    const element = pad(); draw(element);
    const consent = screen.getByRole("checkbox");
    expect((consent as HTMLInputElement).disabled).toBe(false);
    fireEvent.click(consent);
    expect(screen.getByText("Signature captured. Confirm your consent below.").textContent).toContain("captured");
    expect(screen.getByTestId("signature-value").textContent).toContain('"consent":true');
    fireEvent.click(screen.getByRole("button", { name: "Clear signature" }));
    expect(screen.getByTestId("signature-value").textContent).toBe('{"name":"Synthetic signer","consent":false,"drawing":[]}');
    expect(element.querySelector("polyline")).toBeNull();
  });
  it("requires renewed consent whenever the signer edits their name or drawing", () => {
    render(<Controlled initial={{ name: "Signer", consent: true, drawing }} />);
    const element = pad(); draw(element);
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Changed signer" } });
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
  });
  it("ignores secondary pointers and discards cancelled strokes", () => {
    render(<Controlled initial={{ name: "Signer", consent: true, drawing }} />);
    const element = pad();
    fireEvent.pointerDown(element, { pointerId: 1, button: 0, clientX: 10, clientY: 20 });
    fireEvent.pointerMove(element, { pointerId: 2, clientX: 80, clientY: 90 });
    fireEvent.pointerCancel(element, { pointerId: 1 });
    expect(element.querySelectorAll("polyline")).toHaveLength(1);
    expect(screen.getByTestId("signature-value").textContent).toContain('"drawing":[[[10,20],[50,60]]]');
  });
  it("does not treat a tap as a drawn signature or permit drawing in read-only mode", () => {
    const view = render(<Controlled />); const element = pad();
    fireEvent.pointerDown(element, { pointerId: 1, button: 0, clientX: 10, clientY: 20 });
    fireEvent.pointerUp(element, { pointerId: 1 });
    expect(element.querySelector("polyline")).toBeNull();
    view.rerender(<Controlled disabled />); draw(element);
    expect(element.querySelector("polyline")).toBeNull();
  });
  it("shows restored ink and renders numeric vector shapes without embedding supplied SVG markup", () => {
    render(<SignatureDrawing strokes={drawing} label="Saved signature" />);
    expect(screen.getByRole("img", { name: "Saved signature" }).querySelector("polyline")?.getAttribute("points")).toBe("10,20 50,60");
  });
});
