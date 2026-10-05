/**
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../app/actions/clients", () => ({
  createCompanyAction: vi.fn(),
}));

const { CreateCompanyForm } = await import("../components/forms/create-company-form");

afterEach(cleanup);

describe("CreateCompanyForm", () => {
  it("renders the minimal company-only form with accessible constraints", () => {
    const { container } = render(<CreateCompanyForm />);
    const name = screen.getByRole("textbox", { name: "Company name" });

    expect(name).toBeRequired();
    expect(name).toHaveAttribute("maxlength", "200");
    expect(name).toHaveAttribute("autocomplete", "organization");
    expect(screen.getByRole("button", { name: "Create company" })).toBeEnabled();
    expect(screen.getByRole("link", { name: "Cancel" })).toHaveAttribute("href", "/clients");
    expect(container.querySelector('input[name="request_id"]')).toHaveValue();
    expect(container.querySelector('input[type="email"]')).toBeNull();
    expect(container.querySelector('input[name="first_name"]')).toBeNull();
    expect(container.querySelector('input[name="temporary_password"]')).toBeNull();
  });
});
