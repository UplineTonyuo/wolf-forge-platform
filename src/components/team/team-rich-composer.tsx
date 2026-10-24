"use client";

import {
  Bold,
  Italic,
  Link2,
  List,
  ListOrdered,
  Redo2,
  Undo2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { $convertToMarkdownString } from "@lexical/markdown";
import {
  $isListNode,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  ListItemNode,
  ListNode,
  REMOVE_LIST_COMMAND,
} from "@lexical/list";
import { $isLinkNode, AutoLinkNode, LinkNode, TOGGLE_LINK_COMMAND } from "@lexical/link";
import { $getNearestNodeOfType, mergeRegister } from "@lexical/utils";
import {
  $createParagraphNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  CAN_REDO_COMMAND,
  CAN_UNDO_COMMAND,
  CLEAR_HISTORY_COMMAND,
  COMMAND_PRIORITY_LOW,
  FORMAT_TEXT_COMMAND,
  KEY_DOWN_COMMAND,
  KEY_ENTER_COMMAND,
  REDO_COMMAND,
  SELECTION_CHANGE_COMMAND,
  UNDO_COMMAND,
  type EditorState,
  type LexicalEditor,
} from "lexical";
import { normalizeTeamLinkTarget } from "../../domain/team/formatting";
import { teamTransformers } from "./team-composer-format";
import styles from "./team-messages.module.css";
import { TeamMentionPlugin } from "./team-mention-plugin";
import type { TeamMemberView } from "../../domain/team/projections";

/**
 * The Team composer, as rich text.
 *
 * Employees type into something that LOOKS like the message they are sending —
 * bold is bold, a link is a link, a list is a list — while what leaves the
 * browser is still the constrained Markdown subset every V2.1 message is stored
 * in. Nothing about persistence, rendering, previews, peeks, digests, search
 * projections or the SQL plain-text function changes, and no historical message
 * is rewritten.
 *
 * Why an editor library rather than a contentEditable of our own: correct
 * selection behaviour across "cursor collapsed", "selection spans two list
 * items", "undo after a list toggle" is the whole problem, and
 * `document.execCommand` — the only zero-dependency route — is deprecated,
 * emits different markup in every browser, and stops producing usable undo the
 * moment any mutation bypasses it, which inserting a link from our own popover
 * necessarily does.
 *
 * Why this is not a security regression: Lexical never renders supplied HTML.
 * It builds a node tree, and only the node types registered below exist —
 * paragraph, text, line break, list, list item and link. Pasted markup that
 * maps to nothing registered degrades to plain text. There is no
 * dangerouslySetInnerHTML here or in the message renderer, and a link is
 * accepted only if normalizeTeamLinkTarget() accepts its protocol.
 */


type ActiveFormats = {
  bold: boolean;
  italic: boolean;
  link: boolean;
  bullet: boolean;
  numbered: boolean;
};

const noFormats: ActiveFormats = {
  bold: false,
  italic: false,
  link: false,
  bullet: false,
  numbered: false,
};

/**
 * Markdown is the wire format, so the draft the parent counts, sends and
 * announces as "typing" is the same string the database will hold.
 */
function readMarkdown(editorState: EditorState): string {
  return editorState.read(() => $convertToMarkdownString(teamTransformers));
}

function isEmpty(editorState: EditorState): boolean {
  return editorState.read(() => $getRoot().getTextContent().trim() === "");
}

function ComposerToolbar({
  onLinkRequested,
  linkOpen,
}: {
  onLinkRequested: () => void;
  linkOpen: boolean;
}) {
  const [editor] = useLexicalComposerContext();
  const [formats, setFormats] = useState<ActiveFormats>(noFormats);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const readFormats = useCallback(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) {
      setFormats(noFormats);
      return;
    }

    const anchorNode = selection.anchor.getNode();
    const listNode =
      $getNearestNodeOfType<ListNode>(anchorNode, ListNode) ??
      (anchorNode.getParent() && $isListNode(anchorNode.getParent())
        ? (anchorNode.getParent() as ListNode)
        : null);
    const listType = listNode?.getListType() ?? null;
    const parent = anchorNode.getParent();

    setFormats({
      bold: selection.hasFormat("bold"),
      italic: selection.hasFormat("italic"),
      link: $isLinkNode(anchorNode) || $isLinkNode(parent),
      bullet: listType === "bullet",
      numbered: listType === "number",
    });
  }, []);

  useEffect(
    () =>
      mergeRegister(
        editor.registerUpdateListener(({ editorState }) => {
          editorState.read(readFormats);
        }),
        editor.registerCommand(
          SELECTION_CHANGE_COMMAND,
          () => {
            readFormats();
            return false;
          },
          COMMAND_PRIORITY_LOW,
        ),
        editor.registerCommand(
          CAN_UNDO_COMMAND,
          (payload) => {
            setCanUndo(payload);
            return false;
          },
          COMMAND_PRIORITY_LOW,
        ),
        editor.registerCommand(
          CAN_REDO_COMMAND,
          (payload) => {
            setCanRedo(payload);
            return false;
          },
          COMMAND_PRIORITY_LOW,
        ),
      ),
    [editor, readFormats],
  );

  const toggleList = useCallback(
    (kind: "bullet" | "numbered") => {
      const active = kind === "bullet" ? formats.bullet : formats.numbered;
      if (active) {
        editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
        return;
      }
      editor.dispatchCommand(
        kind === "bullet" ? INSERT_UNORDERED_LIST_COMMAND : INSERT_ORDERED_LIST_COMMAND,
        undefined,
      );
    },
    [editor, formats.bullet, formats.numbered],
  );

  /*
   * onMouseDown is prevented on every control so the caret never leaves the
   * editor: a toolbar button that steals focus would collapse the selection it
   * is about to format.
   */
  const hold = (event: { preventDefault: () => void }) => event.preventDefault();
  const pressed = (active: boolean) =>
    active ? { "aria-pressed": true as const, "data-active": "true" } : { "aria-pressed": false as const };

  return (
    <div className={styles.composerToolbar} role="toolbar" aria-label="Message formatting">
      <button
        type="button"
        onMouseDown={hold}
        onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "bold")}
        aria-label="Bold"
        title="Bold (Ctrl+B)"
        {...pressed(formats.bold)}
      >
        <Bold aria-hidden="true" />
      </button>
      <button
        type="button"
        onMouseDown={hold}
        onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "italic")}
        aria-label="Italic"
        title="Italic (Ctrl+I)"
        {...pressed(formats.italic)}
      >
        <Italic aria-hidden="true" />
      </button>
      <button
        type="button"
        onMouseDown={hold}
        onClick={onLinkRequested}
        aria-expanded={linkOpen}
        aria-label="Insert link"
        title="Link (Ctrl+K)"
        {...pressed(formats.link)}
      >
        <Link2 aria-hidden="true" />
      </button>
      <span className={styles.composerToolbarDivider} aria-hidden="true" />
      <button
        type="button"
        onMouseDown={hold}
        onClick={() => toggleList("bullet")}
        aria-label="Bulleted list"
        title="Bulleted list"
        {...pressed(formats.bullet)}
      >
        <List aria-hidden="true" />
      </button>
      <button
        type="button"
        onMouseDown={hold}
        onClick={() => toggleList("numbered")}
        aria-label="Numbered list"
        title="Numbered list"
        {...pressed(formats.numbered)}
      >
        <ListOrdered aria-hidden="true" />
      </button>
      <span className={styles.composerToolbarDivider} aria-hidden="true" />
      <button
        type="button"
        onMouseDown={hold}
        onClick={() => editor.dispatchCommand(UNDO_COMMAND, undefined)}
        disabled={!canUndo}
        aria-label="Undo"
        title="Undo (Ctrl+Z)"
      >
        <Undo2 aria-hidden="true" />
      </button>
      <button
        type="button"
        onMouseDown={hold}
        onClick={() => editor.dispatchCommand(REDO_COMMAND, undefined)}
        disabled={!canRedo}
        aria-label="Redo"
        title="Redo (Ctrl+Shift+Z)"
      >
        <Redo2 aria-hidden="true" />
      </button>
    </div>
  );
}

/**
 * Enter sends and Shift+Enter breaks the line, matching the plain composer this
 * replaces. Registered as a Lexical command rather than a DOM handler so it
 * runs before the editor's own newline insertion.
 */
function SubmitPlugin({ onSubmit }: { onSubmit: () => boolean }) {
  const [editor] = useLexicalComposerContext();

  useEffect(
    () =>
      editor.registerCommand(
        KEY_ENTER_COMMAND,
        (event) => {
          if (!event || event.shiftKey) return false;
          if (!onSubmit()) return false;
          event.preventDefault();
          return true;
        },
        COMMAND_PRIORITY_LOW,
      ),
    [editor, onSubmit],
  );

  return null;
}

/**
 * The three shortcuts the toolbar advertises.
 *
 * Registered as a Lexical command rather than as a React onKeyDown on the
 * editable div. Ctrl+B and Ctrl+I are also native contenteditable editing
 * commands, so the browser emits its own `beforeinput` for them; handling the
 * keystroke here — inside the editor's own dispatch, ahead of that — is what
 * makes the shortcut and the toolbar button do exactly the same thing once.
 */
function ShortcutsPlugin({ onLinkRequested }: { onLinkRequested: () => void }) {
  const [editor] = useLexicalComposerContext();

  useEffect(
    () =>
      editor.registerCommand(
        KEY_DOWN_COMMAND,
        (event) => {
          if (!event.ctrlKey && !event.metaKey) return false;
          const key = event.key.toLocaleLowerCase();
          if (key === "k") {
            event.preventDefault();
            onLinkRequested();
            return true;
          }
          if (key !== "b" && key !== "i") return false;
          event.preventDefault();
          editor.dispatchCommand(FORMAT_TEXT_COMMAND, key === "b" ? "bold" : "italic");
          return true;
        },
        COMMAND_PRIORITY_LOW,
      ),
    [editor, onLinkRequested],
  );

  return null;
}

/** Hands the editor instance up so the parent can drive focus and links. */
function EditorHandlePlugin({ onReady }: { onReady: (editor: LexicalEditor) => void }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => onReady(editor), [editor, onReady]);
  return null;
}

/**
 * Empties the composer after a send, without remounting it.
 *
 * Remounting would also work and would be shorter, but it drops the caret out
 * of the box between two messages — the one place in a chat client where
 * someone is most likely to keep typing. The undo stack is dropped explicitly
 * instead, so Ctrl+Z after a send cannot restore text the recipient can
 * already see.
 */
function ClearOnSendPlugin({ signal }: { signal: number }) {
  const [editor] = useLexicalComposerContext();
  const seenRef = useRef(signal);

  useEffect(() => {
    if (seenRef.current === signal) return;
    seenRef.current = signal;

    editor.update(
      () => {
        const root = $getRoot();
        root.clear();
        root.append($createParagraphNode());
        root.selectEnd();

        /*
         * The next message starts plain. Lexical keeps the pending format on a
         * collapsed selection, which is right while someone is composing — the
         * word after a bold word stays bold — and wrong across a send, where it
         * would silently make the following message bold with nothing on screen
         * to say so.
         */
        const selection = $getSelection();
        if ($isRangeSelection(selection)) selection.setFormat(0);
      },
      { onUpdate: () => editor.dispatchCommand(CLEAR_HISTORY_COMMAND, undefined) },
    );
    editor.focus();
  }, [editor, signal]);

  return null;
}

export type TeamRichComposerProps = {
  mentionMembers?: TeamMemberView[];
  placeholder: string;
  ariaLabel: string;
  /** Markdown, so the parent counts and sends exactly what will be stored. */
  onChange: (markdown: string) => void;
  onSubmit: (markdown: string) => void;
  canSubmit: boolean;
  /** A new thread: remount, so the draft and its history both start empty. */
  resetKey: string;
  /** Incremented on every completed send: clear in place, keeping the caret. */
  clearSignal: number;
};

export function TeamRichComposer({
  placeholder,
  ariaLabel,
  onChange,
  onSubmit,
  canSubmit,
  resetKey,
  clearSignal,
  mentionMembers,
}: TeamRichComposerProps) {
  const [linkTarget, setLinkTarget] = useState<string | null>(null);
  const [formatError, setFormatError] = useState<string | null>(null);
  const editorRef = useRef<LexicalEditor | null>(null);
  const markdownRef = useRef("");
  const emptyRef = useRef(true);
  const canSubmitRef = useRef(canSubmit);

  useEffect(() => {
    canSubmitRef.current = canSubmit;
  }, [canSubmit]);

  const onReady = useCallback((editor: LexicalEditor) => {
    editorRef.current = editor;
  }, []);

  const handleChange = useCallback(
    (editorState: EditorState) => {
      emptyRef.current = isEmpty(editorState);
      const markdown = emptyRef.current ? "" : readMarkdown(editorState);
      markdownRef.current = markdown;
      onChange(markdown);
    },
    [onChange],
  );

  const submit = useCallback(() => {
    if (!canSubmitRef.current || emptyRef.current) return false;
    onSubmit(markdownRef.current.trim());
    return true;
  }, [onSubmit]);

  const openLinkEditor = useCallback(() => {
    setFormatError(null);
    setLinkTarget("");
  }, []);

  const closeLinkEditor = useCallback(() => {
    setLinkTarget(null);
    editorRef.current?.focus();
  }, []);

  /*
   * Applied through TOGGLE_LINK_COMMAND on the selection the editor still
   * holds — the link field never took focus away from the caret, because the
   * editor keeps its selection while focus sits in a sibling input.
   */
  const applyLink = useCallback(() => {
    const target = normalizeTeamLinkTarget(linkTarget ?? "");
    if (!target) {
      setFormatError("Use an http, https, or mailto link.");
      return;
    }
    setFormatError(null);
    setLinkTarget(null);
    editorRef.current?.dispatchCommand(TOGGLE_LINK_COMMAND, target);
    editorRef.current?.focus();
  }, [linkTarget]);

  return (
    <LexicalComposer
      /*
       * A different thread is a different draft and a different history, so it
       * gets a different editor. Sending inside one thread does not: that is
       * cleared in place by ClearOnSendPlugin, which keeps the caret.
       */
      key={resetKey}
      initialConfig={{
        namespace: "team-composer",
        /* The entire vocabulary. An unregistered node type cannot exist here. */
        nodes: [ListNode, ListItemNode, LinkNode, AutoLinkNode],
        theme: {
          paragraph: styles.composerParagraph,
          text: {
            bold: styles.composerBold,
            italic: styles.composerItalic,
          },
          link: styles.composerLink,
          list: {
            ul: styles.composerBulletList,
            ol: styles.composerNumberedList,
            listitem: styles.composerListItem,
          },
        },
        /*
         * Rethrown, which is Lexical's own recommendation and the only option
         * this codebase allows: a console diagnostic in a production component
         * is a policy violation, and swallowing an editor error would leave a
         * composer that silently stops serializing what the writer sees. The
         * RichTextPlugin below is wrapped in LexicalErrorBoundary, so the
         * failure is contained to the composer rather than the drawer.
         */
        onError: (error: Error) => {
          throw error;
        },
      }}
    >
      <ComposerToolbar onLinkRequested={openLinkEditor} linkOpen={linkTarget !== null} />

      {linkTarget !== null ? (
        <div className={styles.composerLinkRow}>
          <input
            className={styles.composerLinkInput}
            value={linkTarget}
            autoFocus
            inputMode="url"
            placeholder="https://example.com"
            aria-label="Link address"
            onChange={(event) => setLinkTarget(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                applyLink();
              } else if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                closeLinkEditor();
              }
            }}
          />
          <button type="button" className={styles.composerLinkApply} onClick={applyLink}>
            Add link
          </button>
          <button
            type="button"
            className={styles.composerLinkCancel}
            onClick={closeLinkEditor}
            aria-label="Cancel link"
          >
            <X aria-hidden="true" />
          </button>
        </div>
      ) : null}

      <div className={styles.composerEditorWrap}>
        <RichTextPlugin
          contentEditable={
            <ContentEditable
              className={styles.composerInput}
              ariaLabel={ariaLabel}
            />
          }
          placeholder={
            <span className={styles.composerPlaceholder} aria-hidden="true">
              {placeholder}
            </span>
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
      </div>

      <HistoryPlugin />
      {mentionMembers ? <TeamMentionPlugin members={mentionMembers} /> : null}
      <ListPlugin />
      {/* Only a protocol normalizeTeamLinkTarget accepts survives. */}
      <LinkPlugin validateUrl={(url) => normalizeTeamLinkTarget(url) !== null} />
      <OnChangePlugin onChange={handleChange} ignoreSelectionChange />
      <ShortcutsPlugin onLinkRequested={openLinkEditor} />
      <SubmitPlugin onSubmit={submit} />
      <ClearOnSendPlugin signal={clearSignal} />
      <EditorHandlePlugin onReady={onReady} />

      {formatError ? (
        <span className={styles.composerFormatError} role="alert">
          {formatError}
        </span>
      ) : null}
    </LexicalComposer>
  );
}
