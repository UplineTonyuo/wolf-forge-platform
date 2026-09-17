/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type {
  FormEvent,
} from "react";
import {
  TicketRichTextEditor,
} from "../components/tickets/ticket-rich-text-editor";

afterEach(cleanup);

let execCommand: ReturnType<typeof vi.fn>;
let queryCommandState: ReturnType<typeof vi.fn>;
let queryCommandValue: ReturnType<typeof vi.fn>;

beforeEach(() => {
  execCommand = vi.fn().mockReturnValue(true);
  queryCommandState = vi.fn().mockReturnValue(false);
  queryCommandValue = vi.fn().mockReturnValue("");

  document.execCommand = execCommand as unknown as typeof document.execCommand;
  document.queryCommandState =
    queryCommandState as unknown as typeof document.queryCommandState;
  document.queryCommandValue =
    queryCommandValue as unknown as typeof document.queryCommandValue;
});

/** Points window.getSelection() at the editor so refreshActiveFormats treats it as focused. */
function mockSelectionWithin(editor: HTMLElement) {
  const range = document.createRange();
  range.selectNodeContents(editor);

  vi.spyOn(window, "getSelection").mockReturnValue({
    rangeCount: 1,
    anchorNode: editor,
    getRangeAt: () => range,
    removeAllRanges: vi.fn(),
    addRange: vi.fn(),
  } as unknown as Selection);
}

function setup() {
  const onChange = vi.fn();
  render(<TicketRichTextEditor onChange={onChange} />);
  const editor = screen.getByRole("textbox", { name: "Write a reply" });
  mockSelectionWithin(editor);
  return { editor, onChange };
}

describe("Ticket composer rich-text toolbar", () => {
  it("Bold click runs the bold command and does not lose selection", () => {
    const { editor } = setup();
    const button = screen.getByRole("button", { name: "Bold" });

    const notPrevented = fireEvent.mouseDown(button);
    expect(notPrevented).toBe(false); // mousedown was preventDefault()'d, keeping the selection alive

    fireEvent.click(button);

    expect(execCommand).toHaveBeenCalledWith("bold", false, undefined);
    expect(document.activeElement).toBe(editor);
  });

  it("Italic click runs the italic command and does not lose selection", () => {
    setup();
    const button = screen.getByRole("button", { name: "Italic" });

    expect(fireEvent.mouseDown(button)).toBe(false);
    fireEvent.click(button);

    expect(execCommand).toHaveBeenCalledWith("italic", false, undefined);
  });

  it("H1 click toggles heading on, then off", () => {
    setup();
    const button = screen.getByRole("button", { name: "Heading" });

    queryCommandValue.mockReturnValue("p");
    fireEvent.click(button);
    expect(execCommand).toHaveBeenLastCalledWith("formatBlock", false, "h1");

    queryCommandValue.mockReturnValue("h1");
    fireEvent.focus(screen.getByRole("textbox", { name: "Write a reply" }));
    expect(button).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(button);
    expect(execCommand).toHaveBeenLastCalledWith("formatBlock", false, "p");
  });

  it("Bulleted list click runs insertUnorderedList", () => {
    setup();
    const button = screen.getByRole("button", { name: "Bulleted list" });

    expect(fireEvent.mouseDown(button)).toBe(false);
    fireEvent.click(button);

    expect(execCommand).toHaveBeenCalledWith(
      "insertUnorderedList",
      false,
      undefined,
    );
  });

  it("Numbered list click runs insertOrderedList", () => {
    setup();
    const button = screen.getByRole("button", { name: "Numbered list" });

    expect(fireEvent.mouseDown(button)).toBe(false);
    fireEvent.click(button);

    expect(execCommand).toHaveBeenCalledWith(
      "insertOrderedList",
      false,
      undefined,
    );
  });

  it("Undo click runs the undo command", () => {
    setup();
    const button = screen.getByRole("button", { name: "Undo" });

    fireEvent.click(button);

    expect(execCommand).toHaveBeenCalledWith("undo", false, undefined);
  });

  it("Redo click runs the redo command", () => {
    setup();
    const button = screen.getByRole("button", { name: "Redo" });

    fireEvent.click(button);

    expect(execCommand).toHaveBeenCalledWith("redo", false, undefined);
  });

  it("aria-pressed reflects real queryCommandState reads, never fake tracked state", () => {
    const { editor } = setup();

    queryCommandState.mockImplementation(
      (command: string) => command === "bold",
    );

    fireEvent.focus(editor);

    expect(
      screen.getByRole("button", { name: "Bold" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: "Italic" }),
    ).toHaveAttribute("aria-pressed", "false");

    fireEvent.blur(editor);

    expect(
      screen.getByRole("button", { name: "Bold" }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("Ctrl+K opens the link popover", () => {
    const { editor } = setup();

    expect(
      screen.queryByRole("dialog", { name: "Add link" }),
    ).not.toBeInTheDocument();

    fireEvent.keyDown(editor, { key: "k", ctrlKey: true });

    expect(
      screen.getByRole("dialog", { name: "Add link" }),
    ).toBeInTheDocument();
  });

  it("native keyboard shortcuts (Ctrl+B / Ctrl+I) are not intercepted", () => {
    const { editor } = setup();

    const boldNotPrevented = fireEvent.keyDown(editor, {
      key: "b",
      ctrlKey: true,
    });
    const italicNotPrevented = fireEvent.keyDown(editor, {
      key: "i",
      ctrlKey: true,
    });

    // Only Ctrl+K is handled/prevented by this component; Ctrl+B / Ctrl+I
    // must reach the browser's own contentEditable shortcut handling.
    expect(boldNotPrevented).toBe(true);
    expect(italicNotPrevented).toBe(true);
  });

  it("toolbar buttons are all type=\"button\" and never submit the composer form", () => {
    const onSubmit = vi.fn((event: FormEvent) => event.preventDefault());
    const onChange = vi.fn();

    render(
      <form onSubmit={onSubmit}>
        <TicketRichTextEditor onChange={onChange} />
      </form>,
    );

    const buttons = screen.getAllByRole("button");

    for (const button of buttons) {
      expect(button).toHaveAttribute("type", "button");
      fireEvent.click(button);
    }

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("pasting an image attaches it via onPasteFile instead of inserting text", () => {
    const onChange = vi.fn();
    const onPasteFile = vi.fn();
    render(<TicketRichTextEditor onChange={onChange} onPasteFile={onPasteFile} />);
    const editor = screen.getByRole("textbox", { name: "Write a reply" });
    mockSelectionWithin(editor);

    const file = new File(["fake-bytes"], "screenshot.png", { type: "image/png" });
    fireEvent.paste(editor, {
      clipboardData: {
        items: [{ kind: "file", type: "image/png", getAsFile: () => file }],
        getData: () => "",
      },
    });

    expect(onPasteFile).toHaveBeenCalledWith(file);
    expect(execCommand).not.toHaveBeenCalledWith("insertText", false, expect.anything());
  });

  it("pasting plain text still inserts text when onPasteFile is set but clipboard has no image", () => {
    const onChange = vi.fn();
    const onPasteFile = vi.fn();
    render(<TicketRichTextEditor onChange={onChange} onPasteFile={onPasteFile} />);
    const editor = screen.getByRole("textbox", { name: "Write a reply" });
    mockSelectionWithin(editor);

    fireEvent.paste(editor, {
      clipboardData: {
        items: [],
        getData: () => "pasted text",
      },
    });

    expect(onPasteFile).not.toHaveBeenCalled();
    expect(execCommand).toHaveBeenCalledWith("insertText", false, "pasted text");
  });
});
