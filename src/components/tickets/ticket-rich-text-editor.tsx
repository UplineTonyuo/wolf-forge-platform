"use client";

import {
  Bold,
  Heading1,
  Italic,
  List,
  ListOrdered,
  Link2,
  Redo2,
  Undo2,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
} from "react";
import styles from "./tickets.module.css";

const emptyActiveFormats = {
  bold: false,
  italic: false,
  heading: false,
  bulletedList: false,
  numberedList: false,
};

const allowedProtocols =
  new Set([
    "http:",
    "https:",
    "mailto:",
    "tel:",
  ]);

function normalizeSafeHref(
  rawValue: string,
): string | null {
  const trimmed =
    rawValue.trim();

  if (!trimmed) {
    return null;
  }

  const candidate =
    /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;

  try {
    const parsed =
      new URL(candidate);

    if (
      !allowedProtocols.has(
        parsed.protocol,
      )
    ) {
      return null;
    }

    return candidate;
  } catch {
    return null;
  }
}

function serializeEditorNode(
  node: Node,
): string {
  if (
    node.nodeType ===
    Node.TEXT_NODE
  ) {
    return (
      node.textContent ?? ""
    );
  }

  if (
    !(node instanceof HTMLElement)
  ) {
    return "";
  }

  const tag =
    node.tagName.toLowerCase();

  const inner =
    Array.from(
      node.childNodes,
    )
      .map(serializeEditorNode)
      .join("");

  if (
    tag === "strong" ||
    tag === "b"
  ) {
    return inner
      ? `**${inner}**`
      : "";
  }

  if (
    tag === "em" ||
    tag === "i"
  ) {
    return inner
      ? `_${inner}_`
      : "";
  }

  if (tag === "a") {
    const safeHref =
      normalizeSafeHref(
        node.getAttribute(
          "href",
        ) ?? "",
      );

    return (
      safeHref &&
      inner
    )
      ? `[${inner}](${safeHref})`
      : inner;
  }

  if (
    tag === "h1" ||
    tag === "h2" ||
    tag === "h3"
  ) {
    const heading =
      inner.trim();

    return heading
      ? `# ${heading}\n`
      : "";
  }

  if (
    tag === "ul" ||
    tag === "ol"
  ) {
    const ordered =
      tag === "ol";

    return Array.from(
      node.children,
    )
      .map(
        (
          child,
          index,
        ) => {
          if (
            !(child instanceof HTMLElement) ||
            child.tagName.toLowerCase() !== "li"
          ) {
            return "";
          }

          const content =
            Array.from(
              child.childNodes,
            )
              .map(
                serializeEditorNode,
              )
              .join("")
              .replace(
                /\n+/g,
                " ",
              )
              .trim();

          if (!content) {
            return "";
          }

          const marker =
            ordered
              ? `${index + 1}.`
              : "-";

          return `${marker} ${content}\n`;
        },
      )
      .join("");
  }

  if (tag === "li") {
    return inner;
  }

  if (tag === "br") {
    return "\n";
  }

  if (
    tag === "div" ||
    tag === "p"
  ) {
    return `${inner}\n`;
  }

  // Unknown HTML is flattened to its safe textual/formatted children.
  // Scripts, styles and browser-inserted wrappers are never persisted.
  return inner;
}

function serializeEditor(
  editor: HTMLDivElement,
): string {
  return Array
    .from(editor.childNodes)
    .map(serializeEditorNode)
    .join("")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
}

export function TicketRichTextEditor({
  disabled = false,
  label = "Write a reply",
  placeholder = "Write a reply...",
  initialValue = "",
  onChange,
  onPasteFile,
}: {
  disabled?: boolean;
  label?: string;
  /** Ghost text while the editor is empty. */
  placeholder?: string;
  /**
   * Content to open with. Written to the DOM once on mount because this editor
   * is uncontrolled by design; the owner keeps its own copy of the same string,
   * so nothing is emitted back and no render loop is possible. Used by the New
   * message composer to open on the draft the cart handed it.
   */
  initialValue?: string;
  onChange: (
    value: string,
  ) => void;
  /** Fired when the clipboard paste contains an image (e.g. a screenshot).
   * When set, an image paste attaches the file instead of being inserted as
   * text — normal text paste is unaffected. */
  onPasteFile?: (file: File) => void;
}) {
  const editorRef =
    useRef<HTMLDivElement>(null);

  const seededRef = useRef(false);

  useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;

    const editor = editorRef.current;
    if (!editor || initialValue.length === 0) return;

    /* Text, never HTML: the seed is plain text and must not be parsed as markup. */
    editor.textContent = initialValue;
  }, [initialValue]);

  const savedLinkRangeRef =
    useRef<Range | null>(null);

  const [
    activeFormats,
    setActiveFormats,
  ] = useState(emptyActiveFormats);

  /**
   * Reads the real editor/selection state via the same execCommand family the
   * toolbar already mutates through — never a separately tracked flag that
   * could drift from what is actually applied at the caret.
   */
  const refreshActiveFormats =
    useCallback(() => {
      const editor = editorRef.current;
      const selection = window.getSelection();

      const withinEditor =
        !!editor &&
        !!selection &&
        selection.rangeCount > 0 &&
        editor.contains(
          selection.anchorNode,
        );

      if (!withinEditor) {
        setActiveFormats(
          emptyActiveFormats,
        );

        return;
      }

      setActiveFormats({
        bold: document.queryCommandState("bold"),
        italic: document.queryCommandState("italic"),
        heading:
          document
            .queryCommandValue("formatBlock")
            .toLowerCase() === "h1",
        bulletedList: document.queryCommandState("insertUnorderedList"),
        numberedList: document.queryCommandState("insertOrderedList"),
      });
    }, []);

  useEffect(() => {
    document.addEventListener(
      "selectionchange",
      refreshActiveFormats,
    );

    return () =>
      document.removeEventListener(
        "selectionchange",
        refreshActiveFormats,
      );
  }, [refreshActiveFormats]);

  const [
    linkOpen,
    setLinkOpen,
  ] =
    useState(false);

  const [
    linkUrl,
    setLinkUrl,
  ] =
    useState("https://");

  function syncValue() {
    const editor =
      editorRef.current;

    if (!editor) {
      return;
    }

    const next =
      serializeEditor(editor);

    if (
      next.length >
      50_000
    ) {
      document.execCommand(
        "undo",
      );

      requestAnimationFrame(
        syncValue,
      );

      return;
    }

    onChange(next);
  }

  function runCommand(
    command: string,
    value?: string,
  ) {
    if (disabled) {
      return;
    }

    const editor =
      editorRef.current;

    if (!editor) {
      return;
    }

    editor.focus();

    document.execCommand(
      command,
      false,
      value,
    );

    refreshActiveFormats();

    requestAnimationFrame(
      syncValue,
    );
  }

  function saveSelection() {
    const editor =
      editorRef.current;

    const selection =
      window.getSelection();

    if (
      !editor ||
      !selection ||
      selection.rangeCount === 0
    ) {
      savedLinkRangeRef.current =
        null;

      return;
    }

    const range =
      selection.getRangeAt(0);

    if (
      !editor.contains(
        range.commonAncestorContainer,
      )
    ) {
      savedLinkRangeRef.current =
        null;

      return;
    }

    savedLinkRangeRef.current =
      range.cloneRange();
  }

  function openLink() {
    if (disabled) {
      return;
    }

    saveSelection();
    setLinkUrl("https://");
    setLinkOpen(true);
  }

  function closeLink() {
    setLinkOpen(false);
    setLinkUrl("https://");
    savedLinkRangeRef.current =
      null;
  }

  function applyLink() {
    const editor =
      editorRef.current;

    const safeHref =
      normalizeSafeHref(
        linkUrl,
      );

    if (
      !editor ||
      !safeHref
    ) {
      return;
    }

    editor.focus();

    const selection =
      window.getSelection();

    const saved =
      savedLinkRangeRef.current;

    if (
      selection &&
      saved
    ) {
      selection.removeAllRanges();
      selection.addRange(saved);
    }

    const range =
      selection?.rangeCount
        ? selection.getRangeAt(0)
        : null;

    if (
      range &&
      range.collapsed
    ) {
      const anchor =
        document.createElement(
          "a",
        );

      anchor.href =
        safeHref;

      anchor.textContent =
        safeHref;

      range.insertNode(anchor);
      range.setStartAfter(anchor);
      range.collapse(true);

      selection?.removeAllRanges();
      selection?.addRange(range);
    }
    else {
      document.execCommand(
        "createLink",
        false,
        safeHref,
      );
    }

    closeLink();

    requestAnimationFrame(
      syncValue,
    );
  }

  function insertPlainText(
    value: string,
  ) {
    document.execCommand(
      "insertText",
      false,
      value,
    );

    requestAnimationFrame(
      syncValue,
    );
  }

  function handlePaste(
    event:
      ClipboardEvent<HTMLDivElement>,
  ) {
    if (!disabled && onPasteFile) {
      const imageItem = Array.from(event.clipboardData.items ?? []).find(
        (item) => item.kind === "file" && item.type.startsWith("image/"),
      );
      const imageFile = imageItem?.getAsFile();

      if (imageFile) {
        event.preventDefault();
        onPasteFile(imageFile);
        return;
      }
    }

    event.preventDefault();

    insertPlainText(
      event.clipboardData.getData(
        "text/plain",
      ),
    );
  }

  function handleDrop(
    event:
      DragEvent<HTMLDivElement>,
  ) {
    event.preventDefault();

    insertPlainText(
      event.dataTransfer.getData(
        "text/plain",
      ),
    );
  }

  return (
    <div
      className={
        styles.ticketRichEditor
      }
      data-disabled={
        disabled || undefined
      }
    >
      <div
        className={
          styles.ticketRichToolbar
        }
        aria-label="Reply formatting"
      >
        <button
          type="button"
          aria-label="Bold"
          title="Bold (Ctrl+B)"
          disabled={disabled}
          aria-pressed={activeFormats.bold}
          onMouseDown={(event) =>
            event.preventDefault()
          }
          onClick={() =>
            runCommand("bold")
          }
        >
          <Bold aria-hidden="true" />
        </button>

        <button
          type="button"
          aria-label="Italic"
          title="Italic (Ctrl+I)"
          disabled={disabled}
          aria-pressed={activeFormats.italic}
          onMouseDown={(event) =>
            event.preventDefault()
          }
          onClick={() =>
            runCommand(
              "italic",
            )
          }
        >
          <Italic aria-hidden="true" />
        </button>

        <div
          className={
            styles.ticketRichLinkControl
          }
        >
          <button
            type="button"
            aria-label="Add link"
            title="Add link (Ctrl+K)"
            disabled={disabled}
            aria-expanded={linkOpen}
            onMouseDown={(event) =>
              event.preventDefault()
            }
            onClick={openLink}
          >
            <Link2 aria-hidden="true" />
          </button>

          {linkOpen ? (
            <div
              className={
                styles.ticketRichLinkPopover
              }
              role="dialog"
              aria-label="Add link"
            >
              <label>
                <span>Link URL</span>
                <input
                  autoFocus
                  value={linkUrl}
                  placeholder="https://"
                  onChange={(event) =>
                    setLinkUrl(
                      event.currentTarget.value,
                    )
                  }
                  onKeyDown={(event) => {
                    if (
                      event.key ===
                      "Enter"
                    ) {
                      event.preventDefault();
                      applyLink();
                    }

                    if (
                      event.key ===
                      "Escape"
                    ) {
                      event.preventDefault();
                      closeLink();
                    }
                  }}
                />
              </label>

              <div
                className={
                  styles.ticketRichLinkActions
                }
              >
                <button
                  type="button"
                  onClick={closeLink}
                >
                  Cancel
                </button>

                <button
                  type="button"
                  data-primary="true"
                  onClick={applyLink}
                >
                  Add link
                </button>
              </div>
            </div>
          ) : null}
        </div>

        <button
          type="button"
          aria-label="Heading"
          title="Heading"
          disabled={disabled}
          aria-pressed={activeFormats.heading}
          onMouseDown={(event) =>
            event.preventDefault()
          }
          onClick={() => {
            // Read live DOM state rather than the (async-updated) React
            // state: a fast double click must not race a stale toggle.
            const isHeading =
              document
                .queryCommandValue("formatBlock")
                .toLowerCase() === "h1";

            runCommand(
              "formatBlock",
              isHeading ? "p" : "h1",
            );
          }}
        >
          <Heading1 aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="Bulleted list"
          title="Bulleted list"
          disabled={disabled}
          aria-pressed={activeFormats.bulletedList}
          onMouseDown={(event) =>
            event.preventDefault()
          }
          onClick={() =>
            runCommand(
              "insertUnorderedList",
            )
          }
        >
          <List aria-hidden="true" />
        </button>

        <button
          type="button"
          aria-label="Numbered list"
          title="Numbered list"
          disabled={disabled}
          aria-pressed={activeFormats.numberedList}
          onMouseDown={(event) =>
            event.preventDefault()
          }
          onClick={() =>
            runCommand(
              "insertOrderedList",
            )
          }
        >
          <ListOrdered aria-hidden="true" />
        </button>

        <div className={styles.ticketRichHistoryGroup}>
          <button
            type="button"
            aria-label="Undo"
            title="Undo (Ctrl+Z)"
            disabled={disabled}
            onMouseDown={(event) =>
              event.preventDefault()
            }
            onClick={() =>
              runCommand("undo")
            }
          >
            <Undo2 aria-hidden="true" />
          </button>

          <button
            type="button"
            aria-label="Redo"
            title="Redo (Ctrl+Y)"
            disabled={disabled}
            onMouseDown={(event) =>
              event.preventDefault()
            }
            onClick={() =>
              runCommand("redo")
            }
          >
            <Redo2 aria-hidden="true" />
          </button>
        </div>
      </div>

      <div
        ref={editorRef}
        className={
          styles.ticketRichComposer
        }
        role="textbox"
        aria-label={label}
        aria-multiline="true"
        aria-disabled={
          disabled || undefined
        }
        contentEditable={!disabled}
        suppressContentEditableWarning
        data-placeholder={placeholder}
        onInput={syncValue}
        onFocus={refreshActiveFormats}
        onBlur={() => {
          syncValue();
          setActiveFormats(emptyActiveFormats);
        }}
        onKeyUp={refreshActiveFormats}
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
            event.preventDefault();
            openLink();
            return;
          }

          // Same canonical submit path as clicking Send — requestSubmit()
          // fires the form's real onSubmit, which still guards busy/empty.
          if (event.key === "Enter" && event.ctrlKey && event.shiftKey) {
            event.preventDefault();
            editorRef.current?.closest("form")?.requestSubmit();
          }
        }}
        onPaste={handlePaste}
        onDrop={handleDrop}
      />
    </div>
  );
}