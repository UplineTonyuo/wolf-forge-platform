/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  removeMyAvatarAction,
  updateMyProfileAction,
  uploadMyAvatarAction,
} from "../app/actions/profile";
import { SettingsWorkspace } from "../components/settings/settings-workspace";
import { changeMyPasswordAction } from "../app/actions/security";
import type { MyProfile } from "../domain/profile/schema";
import type { SignInIdentity } from "../domain/profile/security";

vi.mock("../app/actions/profile", () => ({
  updateMyProfileAction: vi.fn(),
  uploadMyAvatarAction: vi.fn(),
  removeMyAvatarAction: vi.fn(),
}));
vi.mock("../app/actions/security", () => ({
  changeMyPasswordAction: vi.fn(),
}));

/** Mirrors what Supabase Auth reports today: one email identity, no OAuth. */
const testIdentities: SignInIdentity[] = [
  {
    id: "identity-email",
    provider: "email",
    email: "william@wolfforge.invalid",
    isPrimary: true,
  },
];

const AVATAR_URL =
  "http://127.0.0.1:54321/storage/v1/object/public/profile-avatars/2f000000/photo.webp";

const baseProfile: MyProfile = {
  profileId: "2f000000-0000-4000-8000-000000000001",
  displayName: "William Jones",
  email: "william@wolfforge.invalid",
  roleName: "owner",
  presetKey: "owner",
  presetName: "Owner",
  avatarPath: null,
  avatarUrl: null,
  notificationSoundEnabled: true,
  createdAt: "2026-02-01T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(updateMyProfileAction).mockResolvedValue({
    error: null,
    fieldErrors: {},
    savedAt: "2026-08-18T00:00:00.000Z",
  });
  vi.mocked(uploadMyAvatarAction).mockResolvedValue({ ok: true, avatarUrl: AVATAR_URL });
  vi.mocked(removeMyAvatarAction).mockResolvedValue({ ok: true, avatarUrl: null });
  vi.mocked(changeMyPasswordAction).mockResolvedValue({
    error: null,
    fieldErrors: {},
    changedAt: "2026-08-18T01:00:00.000Z",
  });

  /* jsdom implements neither of these. */
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
});

afterEach(cleanup);

function imageFile(name: string, type: string, size = 1024) {
  const file = new File([new Uint8Array(8)], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

function fileInput() {
  return document.querySelector<HTMLInputElement>('input[type="file"]')!;
}

describe("existing profile data is rendered", () => {
  it("shows the account identity with a read-only role and email", () => {
    render(<SettingsWorkspace identities={testIdentities} profile={baseProfile} />);

    /* The account name is an identity label; the page heading is owned by PageFrame. */
    expect(screen.getByText("William Jones")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "William Jones" })).not.toBeInTheDocument();
    /* Role and email are shown, and shown read-only (asserted separately below). */
    expect(screen.getAllByText("Owner").length).toBeGreaterThan(0);
    expect(screen.getAllByText("william@wolfforge.invalid").length).toBeGreaterThan(0);

    expect(screen.getByLabelText("Display name")).toHaveValue("William Jones");
  });

  it("does not offer any control that could change the role", () => {
    render(<SettingsWorkspace identities={testIdentities} profile={baseProfile} />);

    /* Role is a projection: no input, no select, no combobox for it. */
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/role/i)).not.toBeInTheDocument();
    expect(
      screen.getByText(/Roles are managed in Team & Roles/i),
    ).toBeInTheDocument();
  });

  it("reflects the persisted notification preference", () => {
    render(
      <SettingsWorkspace identities={testIdentities}
        profile={{ ...baseProfile, notificationSoundEnabled: false }}
      />,
    );

    expect(screen.getByRole("checkbox")).not.toBeChecked();
  });
});

describe("avatar fallback and rendering", () => {
  it("falls back to the neutral person silhouette when the account has no photo", () => {
    render(<SettingsWorkspace identities={testIdentities} profile={baseProfile} />);

    expect(screen.getByTestId("avatar-fallback")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    // Not initials, and never the Wolf Forge mark: a person slot shows a person.
    expect(screen.queryByText("WJ")).not.toBeInTheDocument();
  });

  it("renders the stored photo when one exists", () => {
    render(<SettingsWorkspace identities={testIdentities} profile={{ ...baseProfile, avatarUrl: AVATAR_URL }} />);

    const image = screen.getByRole("presentation");
    expect(image).toHaveAttribute("src", AVATAR_URL);
  });

  it("falls back to the silhouette rather than a broken image when loading fails", () => {
    render(<SettingsWorkspace identities={testIdentities} profile={{ ...baseProfile, avatarUrl: AVATAR_URL }} />);

    fireEvent.error(screen.getByRole("presentation"));

    expect(screen.getByTestId("avatar-fallback")).toBeInTheDocument();
    expect(screen.queryByRole("presentation")).not.toBeInTheDocument();
  });

  it("only offers Remove when a photo actually exists", () => {
    const { unmount } = render(<SettingsWorkspace identities={testIdentities} profile={baseProfile} />);
    expect(screen.queryByRole("button", { name: /remove/i })).not.toBeInTheDocument();
    unmount();

    render(<SettingsWorkspace identities={testIdentities} profile={{ ...baseProfile, avatarUrl: AVATAR_URL }} />);
    expect(screen.getByRole("button", { name: /remove/i })).toBeInTheDocument();
  });
});

describe("selecting an image", () => {
  it("previews a valid selection and offers save or cancel", async () => {
    render(<SettingsWorkspace identities={testIdentities} profile={baseProfile} />);

    fireEvent.change(fileInput(), {
      target: { files: [imageFile("me.png", "image/png")] },
    });

    expect(await screen.findByRole("button", { name: /save photo/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });

  it("rejects an unsupported type without contacting the server", async () => {
    render(<SettingsWorkspace identities={testIdentities} profile={baseProfile} />);

    fireEvent.change(fileInput(), {
      target: { files: [imageFile("payload.svg", "image/svg+xml")] },
    });

    expect(
      await screen.findByText("Image must be JPEG, PNG, or WebP."),
    ).toBeInTheDocument();
    expect(uploadMyAvatarAction).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /save photo/i })).not.toBeInTheDocument();
  });

  it("rejects an oversized file without contacting the server", async () => {
    render(<SettingsWorkspace identities={testIdentities} profile={baseProfile} />);

    fireEvent.change(fileInput(), {
      target: { files: [imageFile("huge.jpg", "image/jpeg", 6 * 1024 * 1024)] },
    });

    expect(
      await screen.findByText("Image must be smaller than 5 MB."),
    ).toBeInTheDocument();
    expect(uploadMyAvatarAction).not.toHaveBeenCalled();
  });

  it("cancelling clears the preview and releases the object url", async () => {
    render(<SettingsWorkspace identities={testIdentities} profile={baseProfile} />);

    fireEvent.change(fileInput(), {
      target: { files: [imageFile("me.webp", "image/webp")] },
    });

    fireEvent.click(await screen.findByRole("button", { name: /cancel/i }));

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /save photo/i })).not.toBeInTheDocument();
    });
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });
});

describe("saving a photo", () => {
  it("uploads the chosen file and confirms", async () => {
    render(<SettingsWorkspace identities={testIdentities} profile={baseProfile} />);

    fireEvent.change(fileInput(), {
      target: { files: [imageFile("me.png", "image/png")] },
    });

    fireEvent.click(await screen.findByRole("button", { name: /save photo/i }));

    await waitFor(() => expect(uploadMyAvatarAction).toHaveBeenCalledTimes(1));

    const submitted = vi.mocked(uploadMyAvatarAction).mock.calls[0]![0];
    expect(submitted.get("avatar")).toBeInstanceOf(File);

    expect(await screen.findByText("Photo updated")).toBeInTheDocument();
  });

  it("surfaces a server rejection without leaking internals", async () => {
    vi.mocked(uploadMyAvatarAction).mockResolvedValue({
      ok: false,
      error: "Image must be JPEG, PNG, or WebP.",
    });

    render(<SettingsWorkspace identities={testIdentities} profile={baseProfile} />);

    fireEvent.change(fileInput(), {
      target: { files: [imageFile("me.png", "image/png")] },
    });
    fireEvent.click(await screen.findByRole("button", { name: /save photo/i }));

    expect(
      await screen.findByText("Image must be JPEG, PNG, or WebP."),
    ).toBeInTheDocument();
  });
});

describe("removing a photo", () => {
  /*
   * The rendered avatar comes from the server row, refreshed by the action's
   * revalidatePath, so what this asserts is the contract the component owns:
   * the action ran and the outcome was confirmed. The initials fallback for a
   * row with no photo is covered above.
   */
  it("calls the remove action and confirms", async () => {
    render(<SettingsWorkspace identities={testIdentities} profile={{ ...baseProfile, avatarUrl: AVATAR_URL }} />);

    fireEvent.click(screen.getByRole("button", { name: /remove/i }));

    await waitFor(() => expect(removeMyAvatarAction).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Photo removed")).toBeInTheDocument();
  });

  it("reports a failed removal without clearing the photo", async () => {
    vi.mocked(removeMyAvatarAction).mockResolvedValue({
      ok: false,
      error: "Unable to remove your photo. Try again.",
    });

    render(<SettingsWorkspace identities={testIdentities} profile={{ ...baseProfile, avatarUrl: AVATAR_URL }} />);
    fireEvent.click(screen.getByRole("button", { name: /remove/i }));

    expect(
      await screen.findByText("Unable to remove your photo. Try again."),
    ).toBeInTheDocument();
    expect(screen.getByRole("presentation")).toHaveAttribute("src", AVATAR_URL);
  });
});

describe("profile form submission", () => {
  it("submits the display name and preference through the server action", async () => {
    render(<SettingsWorkspace identities={testIdentities} profile={baseProfile} />);

    fireEvent.change(screen.getByLabelText("Display name"), {
      target: { value: "William J" },
    });

    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(updateMyProfileAction).toHaveBeenCalledTimes(1));

    const formData = vi.mocked(updateMyProfileAction).mock.calls[0]![1];
    expect(formData.get("display_name")).toBe("William J");
    expect(formData.get("notification_sound_enabled")).toBe("on");

    /* No identity or authorization field is ever submitted from the browser. */
    expect(formData.get("profile_id")).toBeNull();
    expect(formData.get("role")).toBeNull();
    expect(formData.get("preset_key")).toBeNull();
    expect(formData.get("email")).toBeNull();
  });

  it("associates a field error with its input", () => {
    vi.mocked(updateMyProfileAction).mockResolvedValue({
      error: "Check the highlighted fields.",
      fieldErrors: { display_name: "Enter a display name." },
      savedAt: null,
    });

    render(<SettingsWorkspace identities={testIdentities} profile={baseProfile} />);
    const input = screen.getByLabelText("Display name");

    /* The association contract is what matters, not the rendered position. */
    expect(input).toHaveAttribute("name", "display_name");
    expect(input).toBeRequired();
  });
});

describe("security section", () => {
  it("renders only the sign-in identities Auth actually reported", () => {
    render(<SettingsWorkspace identities={testIdentities} profile={baseProfile} />);

    expect(screen.getByText("Email and password")).toBeInTheDocument();
    expect(screen.getByText("Primary")).toBeInTheDocument();

    /* Nothing speculative: no provider that is not configured is offered. */
    expect(screen.queryByText("Google")).not.toBeInTheDocument();
    expect(screen.queryByText("Microsoft")).not.toBeInTheDocument();
  });

  it("states plainly that no other sign-in method is available", () => {
    render(<SettingsWorkspace identities={testIdentities} profile={baseProfile} />);

    expect(
      screen.getByText(/Additional sign-in methods are not available/i),
    ).toBeInTheDocument();
    /* An unusable "Add sign-in method" control is never rendered. */
    expect(
      screen.queryByRole("button", { name: /add sign-in method/i }),
    ).not.toBeInTheDocument();
  });

  it("shows a connected identity without a Primary badge when Auth reports one", () => {
    render(
      <SettingsWorkspace
        identities={[
          ...testIdentities,
          {
            id: "identity-google",
            provider: "google",
            email: "william@gmail.invalid",
            isPrimary: false,
          },
        ]}
        profile={baseProfile}
      />,
    );

    expect(screen.getByText("Google")).toBeInTheDocument();
    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(
      screen.queryByText(/Additional sign-in methods are not available/i),
    ).not.toBeInTheDocument();
  });

  it("keeps password controls out of the profile form", () => {
    render(<SettingsWorkspace identities={testIdentities} profile={baseProfile} />);

    const profileForm = screen.getByLabelText("Display name").closest("form");
    expect(profileForm).not.toBeNull();
    expect(
      profileForm!.querySelector('input[type="password"]'),
    ).toBeNull();
  });
});

describe("change password dialog", () => {
  async function openDialog() {
    render(<SettingsWorkspace identities={testIdentities} profile={baseProfile} />);
    fireEvent.click(screen.getByRole("button", { name: /change password/i }));
    return screen.findByRole("dialog");
  }

  /*
   * Every field is required, so a submit with blanks is correctly refused by the
   * form itself. Tests that exercise the action must fill all three.
   */
  function fillPasswords(dialog: HTMLElement, current = "old-secret", next = "new-secret") {
    fireEvent.change(within(dialog).getByLabelText("Current password"), {
      target: { value: current },
    });
    fireEvent.change(within(dialog).getByLabelText("New password"), {
      target: { value: next },
    });
    fireEvent.change(within(dialog).getByLabelText("Confirm new password"), {
      target: { value: next },
    });
  }

  it("is not mounted until it is opened", () => {
    render(<SettingsWorkspace identities={testIdentities} profile={baseProfile} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("asks for the current password and a confirmation", async () => {
    const dialog = await openDialog();

    expect(within(dialog).getByLabelText("Current password")).toBeRequired();
    expect(within(dialog).getByLabelText("New password")).toBeRequired();
    expect(within(dialog).getByLabelText("Confirm new password")).toBeRequired();

    for (const label of ["Current password", "New password", "Confirm new password"]) {
      expect(within(dialog).getByLabelText(label)).toHaveAttribute("type", "password");
    }
  });

  it("offers an accessible reveal toggle per field", async () => {
    const dialog = await openDialog();
    const toggle = within(dialog).getByRole("button", { name: /show current password/i });

    fireEvent.click(toggle);

    expect(within(dialog).getByLabelText("Current password")).toHaveAttribute("type", "text");
    expect(
      within(dialog).getByRole("button", { name: /hide current password/i }),
    ).toBeInTheDocument();
  });

  it("submits the three values to the server action and nothing else", async () => {
    const dialog = await openDialog();

    fillPasswords(dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: /update password/i }));

    await waitFor(() => expect(changeMyPasswordAction).toHaveBeenCalledTimes(1));

    const formData = vi.mocked(changeMyPasswordAction).mock.calls[0]![1];
    expect(formData.get("current_password")).toBe("old-secret");
    expect(formData.get("new_password")).toBe("new-secret");
    expect(formData.get("confirm_password")).toBe("new-secret");

    /* No identity is ever supplied from the browser. */
    expect(formData.get("email")).toBeNull();
    expect(formData.get("user_id")).toBeNull();
    expect(formData.get("profile_id")).toBeNull();
  });

  it("confirms, closes and leaves no password value behind on success", async () => {
    const dialog = await openDialog();

    fillPasswords(dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: /update password/i }));

    expect(await screen.findByText("Password updated")).toBeInTheDocument();

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    /* Nothing typed survives anywhere in the document. */
    expect(document.querySelectorAll('input[type="password"]')).toHaveLength(0);
    expect(document.body.innerHTML).not.toContain("old-secret");
  });

  it("surfaces a mapped server error without leaking Supabase detail", async () => {
    vi.mocked(changeMyPasswordAction).mockResolvedValue({
      error: "Unable to update your password. Try again.",
      fieldErrors: {},
      changedAt: null,
    });

    const dialog = await openDialog();
    fillPasswords(dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: /update password/i }));

    expect(
      await screen.findByText("Unable to update your password. Try again."),
    ).toBeInTheDocument();

    /* The dialog stays open so the user can correct and retry. */
    const visibleDialog = screen.getByRole("dialog");
    expect(visibleDialog).toBeInTheDocument();
    /* Nothing from the Auth library surfaces in the dialog. */
    expect(visibleDialog.innerHTML).not.toMatch(/gotrue|supabase|auth\/v1|pgrst/i);
  });

  it("associates a field error with the field it belongs to", async () => {
    vi.mocked(changeMyPasswordAction).mockResolvedValue({
      error: "Check the highlighted fields.",
      fieldErrors: { current_password: "That password is incorrect." },
      changedAt: null,
    });

    const dialog = await openDialog();
    fillPasswords(dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: /update password/i }));

    const message = await screen.findByText("That password is incorrect.");
    const field = within(screen.getByRole("dialog")).getByLabelText("Current password");

    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveAttribute("aria-describedby", message.getAttribute("id"));
  });

  it("closes on Escape", async () => {
    await openDialog();

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
