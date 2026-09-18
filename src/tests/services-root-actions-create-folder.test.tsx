/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ServicesRootActions } from "../components/services/services-root-actions";
import * as actions from "../app/actions/services";

vi.mock("../app/actions/services", () => ({ createServiceFolderAction: vi.fn() }));

beforeAll(() => {
  Object.defineProperty(globalThis, "crypto", { value: { randomUUID: vi.fn(() => "10000000-0000-4000-8000-000000000000") }, configurable: true });
});
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("ServicesRootActions create folder", () => {
  it("disables the submit button while the mutation is in flight, so a fast second click cannot double-submit", async () => {
    let resolveCreate!: (value: actions.CatalogFormState) => void;
    vi.mocked(actions.createServiceFolderAction).mockReturnValue(
      new Promise<actions.CatalogFormState>((resolve) => {
        resolveCreate = resolve;
      }),
    );

    render(<ServicesRootActions />);
    fireEvent.click(screen.getByRole("button", { name: "New Folder" }));
    fireEvent.change(screen.getByLabelText("Folder name"), { target: { value: "Ecommerce SEO" } });

    const submit = screen.getByRole("button", { name: "Create Folder" });
    expect(submit).toBeEnabled();

    fireEvent.click(submit);
    expect(submit).toBeDisabled();
    expect(submit).toHaveAttribute("aria-busy", "true");

    fireEvent.click(submit);
    await waitFor(() => expect(actions.createServiceFolderAction).toHaveBeenCalledTimes(1));

    resolveCreate({ error: null });
  });
});
