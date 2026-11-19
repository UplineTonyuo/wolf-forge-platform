/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LoginForm } from "../components/forms/login-form";
import { finishPasswordRecovery, requestRecoveryCode } from "../app/actions/password-recovery";

vi.mock("../app/actions/auth", () => ({ signInAction: vi.fn() }));
vi.mock("../app/actions/password-recovery", () => ({
  requestRecoveryCode: vi.fn(), finishPasswordRecovery: vi.fn(),
}));
afterEach(cleanup);

it("carries the login email through recovery and returns to sign-in after a reset", async () => {
  vi.mocked(requestRecoveryCode).mockResolvedValue({ ok: true, message: "Check your inbox." });
  vi.mocked(finishPasswordRecovery).mockResolvedValue({ ok: true, message: "Password reset." });
  render(<LoginForm />);
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "person@example.test" } });
  fireEvent.click(screen.getByRole("button", { name: "Forgot password?" }));
  expect(screen.getByLabelText("Registered SPP email")).toHaveValue("person@example.test");
  fireEvent.click(screen.getByRole("button", { name: "Send verification code" }));
  fireEvent.change(await screen.findByLabelText(/Verification code for/), { target: { value: "012345" } });
  fireEvent.change(screen.getByLabelText("New password"), { target: { value: "new-password" } });
  fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "new-password" } });
  fireEvent.click(screen.getByRole("button", { name: "Reset password" }));
  expect(await screen.findByText("Password reset.")).toBeVisible();
  expect(vi.mocked(finishPasswordRecovery).mock.calls[0]?.[0].get("code")).toBe("012345");
  fireEvent.click(screen.getByRole("button", { name: "Back to sign in" }));
  expect(screen.getByRole("button", { name: "Sign in" })).toBeVisible();
});
