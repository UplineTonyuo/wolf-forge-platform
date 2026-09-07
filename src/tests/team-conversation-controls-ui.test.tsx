/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import type {
  TeamConversationAdminView,
  TeamConversationCapabilitiesView,
  TeamConversationDetailView,
  TeamMemberView,
} from "../domain/team/projections";
import { TeamConversationControls } from "../components/team/team-conversation-controls";

afterEach(cleanup);

const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const ADMIN_ID = "22222222-2222-4222-8222-222222222222";
const MEMBER_ID = "33333333-3333-4333-8333-333333333333";

function member(profileId: string, name: string): TeamMemberView {
  return { profileId, name, email: null, avatarUrl: null, initials: name.slice(0, 2).toUpperCase() };
}

function admin(overrides: Partial<TeamConversationAdminView> = {}): TeamConversationAdminView {
  return {
    ...member(ADMIN_ID, "Dana Admin"),
    canManageMembers: true,
    canManageAdmins: false,
    canManageSlowMode: false,
    canRenameConversation: false,
    canManageTaskPolicy: false,
    ...overrides,
  };
}

function capabilities(
  overrides: Partial<TeamConversationCapabilitiesView> = {},
): TeamConversationCapabilitiesView {
  return {
    isOwner: false,
    canCreateTask: true,
    canManageMembers: false,
    canManageAdmins: false,
    canManageSlowMode: false,
    canRenameConversation: false,
    canManageTaskPolicy: false,
    ...overrides,
  };
}

function detail(
  overrides: Partial<TeamConversationDetailView> = {},
): TeamConversationDetailView {
  return {
    conversationId: "44444444-4444-4444-8444-444444444444",
    kind: "group",
    title: "V26 Pod",
    name: "V26 Pod",
    members: [member(OWNER_ID, "Owner One"), admin(), member(MEMBER_ID, "Regular Member")],
    typingMembers: [],
    otherMember: null,
    messages: [],
    groups: [],
    tasks: [],
    tasksBySourceMessage: new Map(),
    tasksById: new Map(),
    ownerProfileId: OWNER_ID,
    admins: [admin()],
    capabilities: capabilities(),
    slowModeSeconds: null,
    slowModeScope: "members_and_admins",
    taskCreationPolicy: "everyone",
    myNextAllowedSendAt: null,
    ...overrides,
  };
}

function renderControls(overrides: Partial<ComponentProps<typeof TeamConversationControls>> = {}) {
  const props: ComponentProps<typeof TeamConversationControls> = {
    open: true,
    detail: detail(),
    roster: [],
    onClose: vi.fn(),
    onRename: vi.fn().mockResolvedValue(null),
    onSetSlowMode: vi.fn().mockResolvedValue(null),
    onSetTaskCreationPolicy: vi.fn().mockResolvedValue(null),
    onGrantAdmin: vi.fn().mockResolvedValue(null),
    onRevokeAdmin: vi.fn().mockResolvedValue(null),
    onAddMember: vi.fn().mockResolvedValue(null),
    onRemoveMember: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
  render(<TeamConversationControls {...props} />);
  return props;
}

describe("TeamConversationControls — Remove Member affordance matches server authorization", () => {
  it("hides the Members-list remove control for a delegated-admin target when the actor only holds manage_members", () => {
    renderControls({
      detail: detail({ capabilities: capabilities({ canManageMembers: true, canManageAdmins: false }) }),
    });

    // Ordinary member stays removable.
    expect(screen.getByLabelText("Manage Regular Member")).toBeInTheDocument();
    // The delegated admin is NOT removable from the Members list — the server
    // (app_remove_team_conversation_member) refuses this without manage_admins.
    expect(screen.queryByLabelText("Manage Dana Admin")).not.toBeInTheDocument();
    // The owner is never removable regardless of capability.
    expect(screen.queryByLabelText("Manage Owner One")).not.toBeInTheDocument();
  });

  it("shows the Members-list remove control for a delegated-admin target once the actor also holds manage_admins", () => {
    renderControls({
      detail: detail({ capabilities: capabilities({ canManageMembers: true, canManageAdmins: true }) }),
    });

    expect(screen.getByLabelText("Manage Regular Member")).toBeInTheDocument();
    expect(screen.getByLabelText("Manage Dana Admin")).toBeInTheDocument();
    expect(screen.queryByLabelText("Manage Owner One")).not.toBeInTheDocument();
  });

  it("shows the Members-list remove control for a delegated-admin target when the actor is the owner", () => {
    renderControls({
      detail: detail({ capabilities: capabilities({ isOwner: true, canManageMembers: true, canManageAdmins: true }) }),
    });

    expect(screen.getByLabelText("Manage Dana Admin")).toBeInTheDocument();
    expect(screen.queryByLabelText("Manage Owner One")).not.toBeInTheDocument();
  });
});

describe("TeamConversationControls — integrated settings interactions", () => {
  it("keeps rename Save disabled until the group name is dirty", async () => {
    const onRename = vi.fn().mockResolvedValue(null);
    renderControls({
      detail: detail({ capabilities: capabilities({ canRenameConversation: true }) }),
      onRename,
    });

    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Group name"), { target: { value: "Launch Crew" } });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(onRename).toHaveBeenCalledWith("Launch Crew"));
    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });

  it("applies Slow Mode presets and scope immediately through the existing callback", async () => {
    const onSetSlowMode = vi.fn().mockResolvedValue(null);
    renderControls({
      detail: detail({
        slowModeSeconds: 60,
        slowModeScope: "members_only",
        capabilities: capabilities({ canManageSlowMode: true }),
      }),
      onSetSlowMode,
    });

    fireEvent.click(screen.getByRole("radio", { name: "5m" }));
    await waitFor(() => expect(onSetSlowMode).toHaveBeenCalledWith(300, "members_only"));
    fireEvent.click(screen.getByRole("button", { name: "Members + Admins" }));
    await waitFor(() => expect(onSetSlowMode).toHaveBeenCalledWith(60, "members_and_admins"));
    expect(screen.getByText("Owner is always exempt.")).toBeInTheDocument();
  });

  it("supports the existing custom Slow Mode range without inventing durations", async () => {
    const onSetSlowMode = vi.fn().mockResolvedValue(null);
    renderControls({
      detail: detail({ capabilities: capabilities({ canManageSlowMode: true }) }),
      onSetSlowMode,
    });

    fireEvent.click(screen.getByRole("radio", { name: "Custom" }));
    const set = screen.getByRole("button", { name: "Set" });
    expect(set).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Custom seconds"), { target: { value: "90" } });
    fireEvent.click(set);
    await waitFor(() => expect(onSetSlowMode).toHaveBeenCalledWith(90, "members_and_admins"));
  });

  it("renders descriptive task-policy rows and saves a selection immediately", async () => {
    const onSetTaskCreationPolicy = vi.fn().mockResolvedValue(null);
    renderControls({
      detail: detail({ capabilities: capabilities({ canManageTaskPolicy: true }) }),
      onSetTaskCreationPolicy,
    });

    expect(screen.getByText("Delegated admins and the owner can create tasks")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: /Owner only/ }));
    await waitFor(() => expect(onSetTaskCreationPolicy).toHaveBeenCalledWith("owner_only"));
  });

  it("reveals add-member controls only after the secondary action is used", () => {
    renderControls({
      detail: detail({ capabilities: capabilities({ canManageMembers: true }) }),
      roster: [member("55555555-5555-4555-8555-555555555555", "New Teammate")],
    });

    expect(screen.queryByLabelText("Teammate to add")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add member" }));
    expect(screen.getByLabelText("Teammate to add")).toBeInTheDocument();
  });

  it("opens delegated permissions as a secondary editor and limits grants to held capabilities", () => {
    renderControls({
      detail: detail({ capabilities: capabilities({ canManageAdmins: true }) }),
    });

    fireEvent.click(screen.getByLabelText("Manage Dana Admin"));
    expect(screen.getByRole("region", { name: "Permissions for Dana Admin" })).toBeInTheDocument();
    expect(screen.getByLabelText("Manage admins")).toBeInTheDocument();
    expect(screen.queryByLabelText("Manage members")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove admin access" })).toBeInTheDocument();
  });

  it("closes on Escape and exposes a labelled panel heading", () => {
    const onClose = vi.fn();
    renderControls({ onClose });

    expect(screen.getByRole("heading", { name: "Conversation settings" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
