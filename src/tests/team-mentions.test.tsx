// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { normalizeTeamLinkTarget, stripTeamFormatting } from "../domain/team/formatting";
import { TeamFormattedMessage } from "../components/team/team-formatted-message";
afterEach(cleanup);
describe("group mention rendering", () => {
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
