/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TeamSlowModeControl } from "../components/team/team-slow-mode-control";

afterEach(cleanup);

/**
 * Team Communication V2.6 UX polish — the Slow Mode quick-access control.
 *
 * Authorization (whether this component renders at all for the current
 * actor) is the CALLER's job — `TeamConversationPane` only mounts this when
 * `detail.capabilities.canManageSlowMode` is true, matching the same
 * server-derived capability every other governance control in this codebase
 * gates on. This file exercises the control's own interaction model in
 * isolation, on the assumption that it is only ever mounted for an
 * authorized actor — the same boundary `team-search-reactions-ui.test.tsx`
 * draws around `TeamConversationPane`-only concerns.
 */

function openMenu() {
  fireEvent.click(screen.getByRole("button", { name: "Slow Mode" }));
}

describe("TeamSlowModeControl — off state", () => {
  it("offers exactly 30 seconds / 1 minute / 5 minutes / Custom, and activates immediately", async () => {
    const onSetSlowMode = vi.fn().mockResolvedValue(null);
    render(
      <TeamSlowModeControl
        active={false}
        seconds={null}
        scope="members_and_admins"
        onSetSlowMode={onSetSlowMode}
      />,
    );

    openMenu();
    expect(screen.getByRole("menuitem", { name: "30 seconds" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "1 minute" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "5 minutes" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Custom…" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("menuitem", { name: "1 minute" }));
    await waitFor(() => expect(onSetSlowMode).toHaveBeenCalledWith(60, "members_and_admins"));
  });

  it("Custom accepts only a valid integer within range before Set is enabled", async () => {
    const onSetSlowMode = vi.fn().mockResolvedValue(null);
    render(
      <TeamSlowModeControl
        active={false}
        seconds={null}
        scope="members_only"
        onSetSlowMode={onSetSlowMode}
      />,
    );

    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Custom…" }));
    const input = screen.getByLabelText("Custom Slow Mode seconds");
    const setButton = screen.getByRole("button", { name: "Set" });
    expect(setButton).toBeDisabled();

    fireEvent.change(input, { target: { value: "0" } });
    expect(setButton).toBeDisabled();

    fireEvent.change(input, { target: { value: "90" } });
    expect(setButton).toBeEnabled();
    fireEvent.click(setButton);
    await waitFor(() => expect(onSetSlowMode).toHaveBeenCalledWith(90, "members_only"));
  });
});

describe("TeamSlowModeControl — on state", () => {
  it("shows Modify and Stop, never the direct preset list", () => {
    render(
      <TeamSlowModeControl
        active
        seconds={30}
        scope="members_and_admins"
        onSetSlowMode={vi.fn().mockResolvedValue(null)}
      />,
    );

    openMenu();
    expect(screen.getByRole("menuitem", { name: "Modify" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Stop" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "1 minute" })).not.toBeInTheDocument();
  });

  it("Modify reopens the duration picker and applies the new choice immediately", async () => {
    const onSetSlowMode = vi.fn().mockResolvedValue(null);
    render(
      <TeamSlowModeControl
        active
        seconds={30}
        scope="members_and_admins"
        onSetSlowMode={onSetSlowMode}
      />,
    );

    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Modify" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "5 minutes" }));
    await waitFor(() => expect(onSetSlowMode).toHaveBeenCalledWith(300, "members_and_admins"));
  });

  it("Stop turns Slow Mode off, preserving the current scope", async () => {
    const onSetSlowMode = vi.fn().mockResolvedValue(null);
    render(
      <TeamSlowModeControl
        active
        seconds={300}
        scope="members_only"
        onSetSlowMode={onSetSlowMode}
      />,
    );

    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Stop" }));
    await waitFor(() => expect(onSetSlowMode).toHaveBeenCalledWith(null, "members_only"));
  });

  it("keeps the menu open and shows the error when the mutation is refused", async () => {
    const onSetSlowMode = vi.fn().mockResolvedValue("You do not have permission to perform this operation.");
    render(
      <TeamSlowModeControl
        active
        seconds={30}
        scope="members_and_admins"
        onSetSlowMode={onSetSlowMode}
      />,
    );

    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Stop" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You do not have permission to perform this operation.",
    );
    expect(screen.getByRole("menuitem", { name: "Stop" })).toBeInTheDocument();
  });
});
