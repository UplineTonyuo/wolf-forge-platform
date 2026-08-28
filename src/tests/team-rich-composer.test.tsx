// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  createEditor,
  type TextFormatType,
} from "lexical";
import { ListItemNode, ListNode } from "@lexical/list";
import { $createLinkNode, AutoLinkNode, LinkNode } from "@lexical/link";
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
} from "@lexical/markdown";
import { teamTransformers } from "../components/team/team-composer-format";
import { TeamFormattedMessage } from "../components/team/team-formatted-message";
import {
  normalizeTeamLinkTarget,
  stripTeamFormatting,
} from "../domain/team/formatting";

/**
 * The rich composer's contract with the rest of the platform.
 *
 * The employee edits rich text; what leaves the browser is the same constrained
 * Markdown subset every V2.1 message is already stored in. What matters, and
 * what is asserted here, is that the editor's serializer and the message
 * renderer agree — a drift between them would silently change how existing
 * messages appear — and that the vocabulary really is constrained.
 *
 * The editor is exercised headlessly, through the same node set and the same
 * transformer list the composer registers. Pointer and keyboard behaviour is a
 * contenteditable concern that jsdom cannot represent honestly, and is proven
 * instead in the rendered browser pass (scripts/qa-team-v22-rendered.ts).
 */

afterEach(cleanup);

/** The composer's editor, minus React: same nodes, same transformers. */
function roundTrip(markdown: string): string {
  const editor = createEditor({
    namespace: "team-composer-test",
    nodes: [ListNode, ListItemNode, LinkNode, AutoLinkNode],
    onError: (error) => {
      throw error;
    },
  });

  let serialized = "";
  editor.update(
    () => {
      $convertFromMarkdownString(markdown, teamTransformers);
    },
    { discrete: true },
  );
  editor.getEditorState().read(() => {
    serialized = $convertToMarkdownString(teamTransformers);
  });
  return serialized;
}

/** Mirrors selecting text, formatting it, then applying a link in the composer. */
function serializeLinkedText(formats: TextFormatType[]): string {
  const editor = createEditor({
    namespace: "team-composer-linked-text-test",
    nodes: [ListNode, ListItemNode, LinkNode, AutoLinkNode],
    onError: (error) => {
      throw error;
    },
  });

  editor.update(
    () => {
      const text = $createTextNode("Chatgpt");
      for (const format of formats) text.toggleFormat(format);
      const link = $createLinkNode(normalizeTeamLinkTarget("https://chatgpt.com")!);
      link.append(text);
      const paragraph = $createParagraphNode();
      paragraph.append(link);
      $getRoot().append(paragraph);
    },
    { discrete: true },
  );

  let serialized = "";
  editor.getEditorState().read(() => {
    serialized = $convertToMarkdownString(teamTransformers);
  });
  return serialized;
}

describe("Team composer serialization", () => {
  it("serializes linked formatting in Lexical's canonical nested form", () => {
    expect(serializeLinkedText(["bold"])).toBe(
      "[**Chatgpt**](https://chatgpt.com/)",
    );
    expect(serializeLinkedText(["italic"])).toBe(
      "[_Chatgpt_](https://chatgpt.com/)",
    );
    expect(serializeLinkedText(["bold", "italic"])).toBe(
      "[**_Chatgpt_**](https://chatgpt.com/)",
    );
  });

  it("round-trips every format the toolbar offers", () => {
    expect(roundTrip("**Bold**")).toBe("**Bold**");
    expect(roundTrip("_italic_")).toBe("_italic_");
    expect(roundTrip("[Wolf Forge](https://wolf-forge.com)")).toBe(
      "[Wolf Forge](https://wolf-forge.com)",
    );
    expect(roundTrip("- Alpha\n- Beta")).toBe("- Alpha\n- Beta");
    expect(roundTrip("1. Alpha\n2. Beta")).toBe("1. Alpha\n2. Beta");
  });

  it("escapes a literal marker so prose is not mistaken for emphasis", () => {
    /*
     * The one deliberate change to the stored form. A lone `*` or `_` in
     * ordinary prose is written escaped, which is what makes the composer
     * honest: what the writer saw is what the reader gets. Every reader of a
     * stored body — the renderer, stripTeamFormatting, and
     * private.team_message_plain_text — undoes it.
     */
    expect(roundTrip("2*3 costs _less and 100% fine")).toBe(
      "2\\*3 costs \\_less and 100% fine",
    );
  });

  it("keeps a V2.1-era mixed message readable", () => {
    /*
     * The only difference from the V2.1 body is the blank line CommonMark
     * requires between a paragraph and the list that follows it. The renderer
     * treats each line on its own, so both list items still render as list
     * items, and a stored V2.1 body without the blank line renders identically
     * — nothing historical is rewritten.
     */
    const historical =
      "**Bold** and _italic_ [Wolf Forge](https://wolf-forge.com)\n- First\n- Second";
    const stored = roundTrip(historical);
    expect(stored).toBe(
      "**Bold** and _italic_ [Wolf Forge](https://wolf-forge.com)\n\n- First\n- Second",
    );

    for (const body of [historical, stored]) {
      cleanup();
      const { container } = render(<TeamFormattedMessage body={body} />);
      expect(container.querySelector("strong")?.textContent).toBe("Bold");
      expect(container.querySelector("em")?.textContent).toBe("italic");
      expect(container.querySelector("a")?.getAttribute("href")).toBe(
        "https://wolf-forge.com/",
      );
      expect(container.querySelectorAll("ul li")).toHaveLength(2);
    }
  });

  it("cannot produce a heading, a quote or a code block", () => {
    /*
     * The vocabulary is the transformer list, and the transformer list has no
     * heading, quote or code entry. A pasted `# Title` therefore comes back as
     * the literal characters rather than as a node the message renderer has no
     * way to draw.
     */
    expect(roundTrip("# Title")).toBe("# Title");
    expect(roundTrip("> quoted")).toBe("> quoted");
    expect(roundTrip("`code`")).toBe("\\`code\\`");
  });

  it("renders an escaped body back as the prose that was typed", () => {
    const stored = roundTrip("2*3 costs _less and 100% fine");
    const { container } = render(<TeamFormattedMessage body={stored} />);
    expect(container.querySelector("em")).toBeNull();
    expect(container.textContent).toBe("2*3 costs _less and 100% fine");
    expect(stripTeamFormatting(stored)).toBe("2*3 costs _less and 100% fine");
  });

  it("hands the message renderer markup it already knows how to draw", () => {
    const { container } = render(
      <TeamFormattedMessage body={roundTrip("**Bold** and _italic_")} />,
    );
    expect(container.querySelector("strong")?.textContent).toBe("Bold");
    expect(container.querySelector("em")?.textContent).toBe("italic");
    expect(container.querySelector("script")).toBeNull();
  });

  it("renders a serialized list as a real list", () => {
    const { container } = render(
      <TeamFormattedMessage body={roundTrip("- Alpha\n- Beta")} />,
    );
    expect(container.querySelectorAll("ul li")).toHaveLength(2);

    cleanup();
    const ordered = render(<TeamFormattedMessage body={roundTrip("1. Alpha\n2. Beta")} />);
    expect(ordered.container.querySelectorAll("ol li")).toHaveLength(2);
  });

  it("degrades an unsafe link target to plain text rather than rendering it", () => {
    const { container } = render(
      <TeamFormattedMessage body="[Click](javascript:alert(1))" />,
    );
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("Click");
  });

  it("keeps peeks, previews, digests and task titles plain", () => {
    expect(
      stripTeamFormatting(
        roundTrip("**Bold** and _italic_ [Wolf Forge](https://wolf-forge.com)\n- First"),
      ),
    ).toBe("Bold and italic Wolf Forge\nFirst");
  });
});
