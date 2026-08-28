// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  normalizeTeamLinkTarget,
  stripTeamFormatting,
  unescapeTeamFormatting,
} from "../domain/team/formatting";
import { TeamFormattedMessage } from "../components/team/team-formatted-message";

describe("Team message formatting", () => {
  it.each([
    {
      name: "plain",
      body: "Chatgpt",
      selector: null,
    },
    {
      name: "bold",
      body: "**Chatgpt**",
      selector: "strong",
    },
    {
      name: "italic",
      body: "_Chatgpt_",
      selector: "em",
    },
    {
      name: "bold and italic",
      body: "**_Chatgpt_**",
      selector: "strong em",
    },
    {
      name: "link",
      body: "[Chatgpt](https://chatgpt.com)",
      selector: "a",
    },
    {
      name: "bold inside a link",
      body: "[**Chatgpt**](https://chatgpt.com)",
      selector: "a strong",
    },
    {
      name: "italic inside a link",
      body: "[_Chatgpt_](https://chatgpt.com)",
      selector: "a em",
    },
    {
      name: "bold and italic inside a link",
      body: "[**_Chatgpt_**](https://chatgpt.com)",
      selector: "a strong em",
    },
  ])("renders $name without exposing Markdown syntax", ({ body, selector }) => {
    const { container } = render(<TeamFormattedMessage body={body} />);
    expect(container.textContent).toBe("Chatgpt");
    if (selector) expect(container.querySelector(selector)?.textContent).toBe("Chatgpt");
  });

  it("accepts only explicit safe link schemes", () => {
    expect(normalizeTeamLinkTarget("https://wolf-forge.com/path")).toBe(
      "https://wolf-forge.com/path",
    );
    expect(normalizeTeamLinkTarget("mailto:hello@wolf-forge.com")).toBe(
      "mailto:hello@wolf-forge.com",
    );
    expect(normalizeTeamLinkTarget("javascript:alert(1)")).toBeNull();
    expect(normalizeTeamLinkTarget("data:text/html,unsafe")).toBeNull();
    expect(normalizeTeamLinkTarget("/relative/path")).toBeNull();
  });

  it("keeps plain-text previews and task titles free of formatting syntax", () => {
    expect(
      stripTeamFormatting("**Bold** and _italic_ [Wolf Forge](https://wolf-forge.com)\n- First"),
    ).toBe("Bold and italic Wolf Forge\nFirst");
  });

  it("keeps an escaped marker out of the plain-text projection", () => {
    /*
     * The composer stores a literal asterisk or underscore escaped. A preview,
     * a peek, a digest and a task title must show the character, not the
     * backslash that protects it — and must not lose it either.
     */
    expect(stripTeamFormatting("2\\*3 costs \\_less and 100% fine")).toBe(
      "2*3 costs _less and 100% fine",
    );
    expect(unescapeTeamFormatting("a \\~ b \\` c")).toBe("a ~ b ` c");
  });

  it("leaves a legacy body with no escapes untouched", () => {
    /* `\U` and `\A` are not escapes, so a Windows path survives verbatim. */
    expect(unescapeTeamFormatting("C:\\Users\\Anthony")).toBe("C:\\Users\\Anthony");
    expect(stripTeamFormatting("A legacy message")).toBe("A legacy message");
  });

  it("renders legacy plain text unchanged", () => {
    render(<TeamFormattedMessage body="A legacy message" />);
    expect(screen.getByText("A legacy message")).not.toBeNull();
  });

  it("renders the safe subset without raw HTML", () => {
    const { container } = render(
      <TeamFormattedMessage body={"**Bold** _italic_\n- Alpha\n- Beta"} />,
    );
    expect(screen.getByText("Bold").tagName).toBe("STRONG");
    expect(screen.getByText("italic").tagName).toBe("EM");
    expect(screen.getByText("Alpha").tagName).toBe("LI");
    expect(screen.getByText("Beta").tagName).toBe("LI");
    expect(container.querySelector("script")).toBeNull();
  });

  it("renders an escaped marker as the character, not as emphasis", () => {
    const { container } = render(
      <TeamFormattedMessage body={"2\\*3 costs \\_less and 100% fine"} />,
    );
    expect(container.querySelector("em")).toBeNull();
    expect(container.querySelector("strong")).toBeNull();
    expect(container.textContent).toBe("2*3 costs _less and 100% fine");
  });

  it("renders escaped stars as literal prose", () => {
    const { container } = render(<TeamFormattedMessage body={"2\\*3"} />);
    expect(container.textContent).toBe("2*3");
    expect(container.querySelector("strong, em")).toBeNull();
  });

  it("renders escaped underscores as literal prose", () => {
    const { container } = render(<TeamFormattedMessage body={"costs \\_less"} />);
    expect(container.textContent).toBe("costs _less");
    expect(container.querySelector("em")).toBeNull();
  });

  it("renders single-asterisk italic without breaking double-asterisk bold", () => {
    render(<TeamFormattedMessage body={"**Bold V21** and *italic V21* together"} />);
    expect(screen.getByText("Bold V21").tagName).toBe("STRONG");
    expect(screen.getByText("italic V21").tagName).toBe("EM");
  });

  it("uses safe attributes for external links and degrades unsafe links to text", () => {
    const { container, rerender } = render(
      <TeamFormattedMessage body="[Docs](https://wolf-forge.com/docs)" />,
    );
    const link = screen.getByRole("link", { name: "Docs" });
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");

    rerender(<TeamFormattedMessage body="[Unsafe](javascript:alert(1))" />);
    expect(screen.queryByRole("link", { name: "Unsafe" })).toBeNull();
    expect(container.textContent).toContain("Unsafe");
  });

  it("renders a formatted link inside a bulleted list", () => {
    const { container } = render(
      <TeamFormattedMessage body="- [**Bold link**](https://example.com)" />,
    );
    expect(container.querySelector("ul li a strong")?.textContent).toBe("Bold link");
    expect(container.textContent).toBe("Bold link");
  });

  it("renders a formatted link inside a numbered list", () => {
    const { container } = render(
      <TeamFormattedMessage body="1. [_Italic link_](https://example.com)" />,
    );
    expect(container.querySelector("ol li a em")?.textContent).toBe("Italic link");
    expect(container.textContent).toBe("Italic link");
  });
});
