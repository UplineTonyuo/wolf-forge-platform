/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  setMemberPresetAction,
  setReportSendAnytimeAction,
} from "../app/actions/member-account-provisioning";
import { TeamRolesPanel } from "../components/settings/team-roles-panel";
import type {
  InternalMember,
  PermissionPresetGrant,
  PermissionPresetOverview,
} from "../domain/permissions/schema";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("../app/actions/member-account-provisioning", () => ({
  setMemberPresetAction: vi.fn(),
  setReportSendAnytimeAction: vi.fn(),
  provisionInternalMemberAction: vi.fn(),
}));

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = vi.fn(function close(this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(setMemberPresetAction).mockResolvedValue({ ok: true });
  vi.mocked(setReportSendAnytimeAction).mockResolvedValue({ ok: true });
});

afterEach(cleanup);

const members: InternalMember[] = [
  {
    profile_id: "50000000-0000-4000-8000-000000000001",
    display_name: "Wolf Owner",
    email: "owner@wolfforge.invalid",
    preset_key: "owner",
    preset_name: "Owner",
    sort_order: 10,
    override_count: 0,
    is_self: false,
    created_at: "2026-08-01T00:00:00Z",
    avatar_url: "http://127.0.0.1:54321/storage/v1/object/public/profile-avatars/50000000-0000-4000-8000-000000000001/photo.webp",
    report_send_anytime: true,
  },
  {
    profile_id: "50000000-0000-4000-8000-000000000002",
    display_name: "Signed In Admin",
    email: "admin@wolfforge.invalid",
    preset_key: "admin",
    preset_name: "Administrator",
    sort_order: 20,
    override_count: 0,
    is_self: true,
    created_at: "2026-08-02T00:00:00Z",
    avatar_url: null,
    report_send_anytime: false,
  },
  {
    profile_id: "50000000-0000-4000-8000-000000000003",
    display_name: "Casey Field",
    email: "casey@wolfforge.invalid",
    preset_key: "staff",
    preset_name: "Staff",
    sort_order: 40,
    override_count: 1,
    is_self: false,
    created_at: "2026-08-03T00:00:00Z",
    avatar_url: null,
    report_send_anytime: false,
  },
];

const presets: PermissionPresetOverview[] = [
  { preset_key: "owner", preset_name: "Owner", account_class: "internal", sort_order: 10, member_count: 1, granted_permission_count: 42, total_permission_count: 42 },
  { preset_key: "admin", preset_name: "Administrator", account_class: "internal", sort_order: 20, member_count: 1, granted_permission_count: 42, total_permission_count: 42 },
  { preset_key: "manager", preset_name: "Manager", account_class: "internal", sort_order: 30, member_count: 0, granted_permission_count: 17, total_permission_count: 42 },
  { preset_key: "staff", preset_name: "Staff", account_class: "internal", sort_order: 40, member_count: 1, granted_permission_count: 8, total_permission_count: 42 },
  { preset_key: "client", preset_name: "Client", account_class: "client", sort_order: 50, member_count: 4, granted_permission_count: 7, total_permission_count: 42 },
];

const grants: PermissionPresetGrant[] = [
  { preset_key: "manager", permission_key: "projects.view", category: "projects", label: "View projects", description: "", allowed: true },
  { preset_key: "manager", permission_key: "projects.archive", category: "projects", label: "Archive projects", description: "", allowed: false },
  { preset_key: "manager", permission_key: "users.manage_permissions", category: "users", label: "Manage permissions", description: "", allowed: false },
  { preset_key: "staff", permission_key: "projects.view", category: "projects", label: "View projects", description: "", allowed: true },
];

function renderPanel(overrides: Partial<Parameters<typeof TeamRolesPanel>[0]> = {}) {
  return render(
    <TeamRolesPanel
      members={members}
      presets={presets}
      grants={grants}
      canAddMembers
      canManagePermissions
      {...overrides}
    />,
  );
}

describe("Team directory", () => {
  it("renders the members the backend returned, not a fixture list", () => {
    renderPanel();

    expect(screen.getByText("Wolf Owner")).toBeInTheDocument();
    expect(screen.getByText("casey@wolfforge.invalid")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Staff" })).toBeInTheDocument();

    // The retired preview fixtures must not survive anywhere on the screen.
    expect(screen.queryByText("William Jones")).not.toBeInTheDocument();
    expect(screen.queryByText(/preview-only/iu)).not.toBeInTheDocument();
  });

  it("counts members and owners from the backend read models", () => {
    renderPanel();

    expect(screen.getByText("Members").previousSibling).toHaveTextContent("3");
    expect(screen.getByText("Roles").previousSibling).toHaveTextContent("5");

    // "Owner" also names a role pill and a role map row, so pin the summary label.
    const ownerLabel = screen.getAllByText("Owner").find((node) => node.tagName === "SPAN");
    expect(ownerLabel?.previousSibling).toHaveTextContent("1");
  });

  it("links Add user at the real member provisioning route", () => {
    renderPanel();

    expect(screen.getByRole("link", { name: /add user/iu })).toHaveAttribute(
      "href",
      "/accounts/member/new",
    );
  });

  it("hides Add user without the provisioning capabilities", () => {
    renderPanel({ canAddMembers: false });

    expect(screen.queryByRole("link", { name: /add user/iu })).not.toBeInTheDocument();
  });

  it("shows real permission counts on the role map", () => {
    renderPanel();

    expect(screen.getByText(/17 of 42 permissions/u)).toBeInTheDocument();
    expect(screen.getByText(/8 of 42 permissions/u)).toBeInTheDocument();
  });
});

describe("Role change protection", () => {
  it("blocks the owner, the signed-in account, and an unauthorized caller", () => {
    renderPanel();

    expect(screen.getByRole("button", { name: "Change role for Wolf Owner" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Change role for Signed In Admin" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Change role for Casey Field" })).toBeEnabled();

    cleanup();
    renderPanel({ canManagePermissions: false });
    expect(screen.getByRole("button", { name: "Change role for Casey Field" })).toBeDisabled();
  });

  it("confirms before sending the change and never offers Owner", async () => {
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Change role for Casey Field" }));

    const dialog = screen.getByRole("dialog", { name: "Change role" });
    expect(within(dialog).queryByRole("button", { name: /^Owner/u })).not.toBeInTheDocument();

    // Nothing is sent until the change is confirmed.
    expect(setMemberPresetAction).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: /Manager/u }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Change role" }));

    await waitFor(() => {
      expect(setMemberPresetAction).toHaveBeenCalledWith({
        profileId: "50000000-0000-4000-8000-000000000003",
        presetKey: "manager",
      });
    });

    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("surfaces a rejection from the database boundary instead of claiming success", async () => {
    vi.mocked(setMemberPresetAction).mockResolvedValue({
      ok: false,
      error: "You do not have permission to perform this operation.",
    });

    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Change role for Casey Field" }));
    const dialog = screen.getByRole("dialog", { name: "Change role" });
    fireEvent.click(within(dialog).getByRole("button", { name: /Manager/u }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Change role" }));

    expect(
      await screen.findByText("You do not have permission to perform this operation."),
    ).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("Roles and permissions tab", () => {
  it("renders real preset grants with no editing affordance", () => {
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: /roles & permissions/iu }));

    expect(screen.getByText("View projects")).toBeInTheDocument();
    expect(screen.getByText("Archive projects")).toBeInTheDocument();

    // Preset grants are system-managed: no toggles and nothing to save.
    expect(screen.queryByRole("button", { name: "Save role" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "View projects" })).not.toBeInTheDocument();
    expect(screen.getByText(/system-managed/iu)).toBeInTheDocument();
  });

  it("does not offer custom preset authoring that the backend cannot honour", () => {
    renderPanel();

    expect(screen.queryByRole("button", { name: /create custom role/iu })).not.toBeInTheDocument();
  });
});
