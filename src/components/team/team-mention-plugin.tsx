"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $createLinkNode } from "@lexical/link";
import { $createTextNode, $getNodeByKey, $getSelection, $isRangeSelection, $isTextNode,
  COMMAND_PRIORITY_HIGH, KEY_DOWN_COMMAND } from "lexical";
import type { TeamMemberView } from "../../domain/team/projections";
import styles from "./team-messages.module.css";

type Match = { key: string; offset: number; length: number; query: string };
type Choice = { id: string; name: string };

export function TeamMentionPlugin({ members }: { members: TeamMemberView[] }) {
  const [editor] = useLexicalComposerContext();
  const [match, setMatch] = useState<Match | null>(null);
  const [selected, setSelected] = useState(0);
  const dismissed = useRef<string | null>(null);
  const choices: Choice[] = useMemo(() => [
    { id: "everyone", name: "everyone" },
    ...members.map((member) => ({ id: member.profileId, name: member.name })),
  ].filter((member) => member.name.toLocaleLowerCase().includes(match?.query.toLocaleLowerCase() ?? "")).slice(0, 8), [members, match?.query]);

  useEffect(() => editor.registerUpdateListener(({ editorState }) => editorState.read(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection) || !selection.isCollapsed()) { setMatch(null); return; }
    const node = selection.anchor.getNode();
    if (!$isTextNode(node) || node.getParent()?.getType() === "link") { setMatch(null); return; }
    const before = node.getTextContent().slice(0, selection.anchor.offset);
    if (before !== dismissed.current) dismissed.current = null;
    const found = /(?:^|\s)@([^\s@]{0,40})$/.exec(before);
    if (!found || before === dismissed.current) { setMatch(null); return; }
    const query = found[1]!;
    setSelected(0);
    setMatch({ key: node.getKey(), offset: selection.anchor.offset - query.length - 1, length: query.length + 1, query });
  })), [editor]);

  const choose = useCallback((choice: Choice) => {
    if (!match) return;
    editor.update(() => {
      const node = $getNodeByKey(match.key);
      if (!$isTextNode(node)) return;
      node.select(match.offset, match.offset + match.length);
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return;
      const link = $createLinkNode(`mention:${choice.id}`).append($createTextNode(`@${choice.name}`));
      selection.insertNodes([link, $createTextNode(" ")]);
    });
    setMatch(null);
    editor.focus();
  }, [editor, match]);

  useEffect(() => editor.registerCommand(KEY_DOWN_COMMAND, (event) => {
    if (!match || !choices.length) return false;
    if (event.key === "Escape") {
      event.preventDefault(); event.stopPropagation();
      dismissed.current = editor.getEditorState().read(() => {
        const node = $getNodeByKey(match.key);
        return node?.getTextContent().slice(0, match.offset + match.length) ?? null;
      });
      setMatch(null); return true;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setSelected((index) => (index + (event.key === "ArrowDown" ? 1 : choices.length - 1)) % choices.length);
      return true;
    }
    if (event.key === "Enter" && !event.isComposing) {
      event.preventDefault(); choose(choices[Math.min(selected, choices.length - 1)]!); return true;
    }
    return false;
  }, COMMAND_PRIORITY_HIGH), [editor, match, choices, selected, choose]);

  if (!match) return null;
  return <div className={styles.mentionPicker} aria-label="Mention a group member">
    <span>Notify someone in this group</span>
    {choices.length ? choices.map((choice, index) => <button key={choice.id} type="button"
      className={index === selected ? styles.mentionSelected : undefined}
      aria-label={`Mention ${choice.name}`} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(choice)}>
      <strong>@{choice.name}</strong>{choice.id === "everyone" ? <small>All active members</small> : null}
    </button>) : <p>No group members match.</p>}
  </div>;
}
