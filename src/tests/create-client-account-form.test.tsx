/**
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../app/actions/client-account-provisioning", () => ({
  provisionClientAccountAction: vi.fn(),
}));

const { CreateClientAccountForm } = await import("../components/accounts/create-client-account-form");

afterEach(cleanup);

describe("Add Client welcome email option", () => {
  it("defaults to the set-password email and asks for a password only when it is unticked", () => {
    const { container } = render(<CreateClientAccountForm welcomeEmailAvailable />);
    const option = screen.getByRole("checkbox", { name: /secure set-password link/i });

    expect(option).toBeChecked();
    expect(screen.getByText(/no password is emailed/i)).toBeInTheDocument();
    expect(container.querySelector('input[name="temporary_password"]')).toBeNull();

    fireEvent.click(option);
    expect(container.querySelector('input[name="temporary_password"]')).not.toBeNull();
  });

  it("is off, disabled and explained when this sender cannot email", () => {
    const { container } = render(<CreateClientAccountForm welcomeEmailAvailable={false} />);
    const option = screen.getByRole("checkbox", { name: /secure set-password link/i });

    expect(option).toBeDisabled();
    expect(option).not.toBeChecked();
    expect(screen.getByText(/needs a connected gmail account/i)).toBeInTheDocument();
    expect(container.querySelector('input[name="temporary_password"]')).not.toBeNull();
  });
});
