/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
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
    expect(screen.getByLabelText("Remove Regular Member")).toBeInTheDocument();
    // The delegated admin is NOT removable from the Members list — the server
    // (app_remove_team_conversation_member) refuses this without manage_admins.
    expect(screen.queryByLabelText("Remove Dana Admin")).not.toBeInTheDocument();
    // The owner is never removable regardless of capability.
    expect(screen.queryByLabelText("Remove Owner One")).not.toBeInTheDocument();
  });

  it("shows the Members-list remove control for a delegated-admin target once the actor also holds manage_admins", () => {
    renderControls({
      detail: detail({ capabilities: capabilities({ canManageMembers: true, canManageAdmins: true }) }),
    });

    expect(screen.getByLabelText("Remove Regular Member")).toBeInTheDocument();
    expect(screen.getByLabelText("Remove Dana Admin")).toBeInTheDocument();
    expect(screen.queryByLabelText("Remove Owner One")).not.toBeInTheDocument();
  });

  it("shows the Members-list remove control for a delegated-admin target when the actor is the owner", () => {
    renderControls({
      detail: detail({ capabilities: capabilities({ isOwner: true, canManageMembers: true, canManageAdmins: true }) }),
    });

    expect(screen.getByLabelText("Remove Dana Admin")).toBeInTheDocument();
    expect(screen.queryByLabelText("Remove Owner One")).not.toBeInTheDocument();
  });
});
