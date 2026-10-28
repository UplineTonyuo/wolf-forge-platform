// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SubmissionDetail } from "../components/forms/submission-detail";
import { answer, response } from "./fixtures/order-response";

const mocks = vi.hoisted(() => ({ correct: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("../app/actions/forms", () => ({ correctFormSubmissionAction: mocks.correct }));
vi.mock("../app/actions/intake-drafts", () => ({ loadIntakeFollowUp: async () => "not_required" }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
describe("shared submission answer compatibility", () => {
  it("renders read-only saved answers/signatures and hides credentials", () => {
    const detail = response(undefined, [answer(false, "checkbox"), answer({ name: "Historical signer", consent: true }, "signature", 1), answer("credential", "password", 2)]);
    render(<SubmissionDetail detail={detail} canCorrect={false} />);
    expect(screen.getByText("No")).toBeVisible(); expect(screen.getByText("Historical signer")).toBeVisible();
    expect(screen.queryByText("credential")).toBeNull(); expect(screen.queryByRole("button", { name: "Correct submission" })).toBeNull();
  });
  it("preserves the existing append-only correction payload with the shared read-only renderer", async () => {
    const detail = response(); mocks.correct.mockResolvedValue({ ok: true, data: { id: "corrected" } });
    render(<SubmissionDetail detail={detail} canCorrect />); fireEvent.click(screen.getByRole("button", { name: "Correct submission" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Frozen label 0" }), { target: { value: "Corrected synthetic answer" } });
    fireEvent.click(screen.getByRole("button", { name: "Save correction" }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/forms/submissions/corrected?corrected=1"));
    expect(mocks.correct).toHaveBeenCalledWith(detail.submission.id, { request_id: expect.any(String), values: [{ field_key: "field-0", value: "Corrected synthetic answer" }] });
  });
});
