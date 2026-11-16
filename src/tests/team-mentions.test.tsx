// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditor, $getRoot, $createParagraphNode, $createTextNode } from "lexical";
import { TeamMentionPlugin } from "../components/team/team-mention-plugin";

const context = vi.hoisted(() => ({ editor: null as unknown }));
vi.mock("@lexical/react/LexicalComposerContext", () => ({ useLexicalComposerContext: () => [context.editor] }));
import { normalizeTeamLinkTarget, stripTeamFormatting } from "../domain/team/formatting";
import { TeamFormattedMessage } from "../components/team/team-formatted-message";
afterEach(cleanup);
describe("group mention rendering", () => {
  it("renders member images and initials, and a group glyph without an image for everyone", async () => {
    const editor = createEditor({ namespace: "mentions", onError: (error) => { throw error; } });
    context.editor = editor;
    const scroll = vi.fn();
    Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: scroll });
    render(<TeamMentionPlugin members={[
      { profileId: "a", name: "Alex", initials: "AL", avatarUrl: "/alex.png", email: null },
      { profileId: "b", name: "Blair", initials: "BL", avatarUrl: null, email: null },
    ]} />);
    await act(async () => { editor.update(() => {
      const text = $createTextNode("@");
      $getRoot().append($createParagraphNode().append(text));
      text.selectEnd();
    }, { discrete: true }); });
    expect(screen.getByRole("button", { name: "Mention Alex" }).querySelector("img")?.getAttribute("src")).toBe("/alex.png");
    expect(screen.getByRole("button", { name: "Mention Blair" }).textContent).toContain("BL");
    const everyone = screen.getByRole("button", { name: "Mention everyone" });
    expect(everyone.querySelector("img")).toBeNull();
    expect(everyone.querySelector("svg")).not.toBeNull();
    expect(scroll).toHaveBeenCalledWith({ block: "nearest" });
  });
  it("renders a stable identity as a mention, never an external link", () => {
    const body = "Hello [@Studio staff](mention:53fd4f26-34a0-4965-97b8-87e876a3fd1d)";
    render(<TeamFormattedMessage body={body} />);
    expect(screen.getByText("@Studio staff").tagName).toBe("SPAN");
    expect(screen.queryByRole("link")).toBeNull();
    expect(stripTeamFormatting(body)).toBe("Hello @Studio staff");
  });
  it("permits only a UUID or everyone as an internal mention target", () => {
    expect(normalizeTeamLinkTarget("mention:everyone")).toBe("mention:everyone");
    expect(normalizeTeamLinkTarget("mention:javascript:alert(1)")).toBeNull();
    expect(normalizeTeamLinkTarget("mention:not-a-member-id")).toBeNull();
  });
});
