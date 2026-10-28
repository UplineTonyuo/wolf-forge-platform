import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { FormService } from "../services/form-service";
import { OrderSubmittedForms } from "../components/projects/order-submitted-forms";
import { answer, companyId, orderId, response } from "./fixtures/order-response";

vi.mock("../components/projects/order-response", () => ({ OrderResponse: ({ detail, latest }: { detail: ReturnType<typeof response>; latest?: boolean }) => <div data-submission={detail.submission.id} data-latest={latest !== false}>{detail.values.map((field) => <span key={field.stable_field_key}>{field.label}</span>)}</div> }));

describe("exact Order submission history", () => {
  it("shows the latest per form, retains each historical ID, sorts frozen fields and drops foreign records and credentials", async () => {
    const old = response("old");
    const latest = response("latest", [answer("second", "text", 2), answer("password", "password", 1), answer("first", "text", 0)]);
    latest.submission.revision_number = 2; latest.submission.submitted_at = "2026-10-28T11:00:00Z";
    const second = response("second"); second.submission.form_id = "second-form";
    const foreignOrder = response("foreign-order"); foreignOrder.submission.order_id = "other";
    const foreignCompany = response("foreign-company"); foreignCompany.submission.company_id = "other";
    const rows = [old, second, latest, foreignOrder, foreignCompany];
    const forms = { listSubmissions: vi.fn().mockResolvedValue(rows.map((detail) => detail.submission)), getSubmission: vi.fn((id) => Promise.resolve(rows.find((row) => row.submission.id === id))) };
    const html = renderToStaticMarkup(await OrderSubmittedForms({ forms: forms as unknown as FormService, orderId, companyId }));
    expect(forms.listSubmissions).toHaveBeenCalledWith(undefined, orderId);
    expect(forms.getSubmission).toHaveBeenCalledTimes(3);
    expect(html).toContain('data-submission="latest" data-latest="true"');
    expect(html).toContain('data-submission="old" data-latest="false"');
    expect(html).toContain('data-submission="second" data-latest="true"');
    expect(html).not.toMatch(/foreign|Frozen label 1/);
    expect(html.indexOf("Frozen label 0")).toBeLessThan(html.indexOf("Frozen label 2"));
  });
  it("fails closed if a fresh detail changes scope", async () => {
    const detail = response();
    const forms = { listSubmissions: vi.fn().mockResolvedValue([detail.submission]), getSubmission: vi.fn().mockResolvedValue({ ...detail, submission: { ...detail.submission, company_id: "other" } }) };
    const html = renderToStaticMarkup(await OrderSubmittedForms({ forms: forms as unknown as FormService, orderId, companyId }));
    expect(html).toContain('role="alert"'); expect(html).not.toContain("Synthetic answer");
  });
  it("uses authorized assignment titles and preserves readable submissions when metadata is denied", async () => {
    const detail = response(); detail.submission.form_assignment_id = "assignment";
    const forms = { listSubmissions: vi.fn().mockResolvedValue([detail.submission]), getSubmission: vi.fn().mockResolvedValue(detail), getAssignmentHistory: vi.fn().mockResolvedValue({ order_id: orderId, company_id: companyId, form_id: detail.submission.form_id, title: "Synthetic intake" }) };
    expect(renderToStaticMarkup(await OrderSubmittedForms({ forms: forms as unknown as FormService, orderId, companyId }))).toContain("Synthetic intake");
    forms.getAssignmentHistory.mockRejectedValue(new Error("denied"));
    expect(renderToStaticMarkup(await OrderSubmittedForms({ forms: forms as unknown as FormService, orderId, companyId }))).toContain("Submitted form 1");
  });
  it("distinguishes no submissions from denied reads", async () => {
    const forms = { listSubmissions: vi.fn().mockResolvedValue([]) };
    expect(renderToStaticMarkup(await OrderSubmittedForms({ forms: forms as unknown as FormService, orderId, companyId }))).toContain("No form has been submitted");
    forms.listSubmissions.mockRejectedValue(new Error("denied"));
    expect(renderToStaticMarkup(await OrderSubmittedForms({ forms: forms as unknown as FormService, orderId, companyId }))).toContain('role="alert"');
  });
});
