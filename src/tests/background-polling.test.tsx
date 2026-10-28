/** @vitest-environment jsdom */
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FormsVisibilityBoundary } from "../components/forms/forms-visibility-boundary";
import { CouponAccessBoundary } from "../components/coupons/coupon-access-boundary";
import { FinancialVisibilityBoundary } from "../components/invoices/financial-visibility-boundary";
import { SubscriptionHistoryBoundary } from "../components/subscriptions/subscription-history-boundary";
import { FormRenderer } from "../components/forms/form-renderer";
import type { FormPublishedSchema } from "../domain/forms/schema";

const m = vi.hoisted(() => ({ forms: vi.fn(), coupons: vi.fn(), financial: vi.fn(), subscriptions: vi.fn(), availability: vi.fn(), router: { refresh: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => m.router }));
vi.mock("../app/actions/forms-visibility", () => ({ loadFormsVisibility: m.forms }));
vi.mock("../app/actions/coupons", () => ({ loadCouponAccessAction: m.coupons }));
vi.mock("../app/actions/financial-visibility", () => ({ loadFinancialVisibilityAction: m.financial }));
vi.mock("../app/actions/subscriptions", () => ({ loadSubscriptionVisibilityAction: m.subscriptions }));
vi.mock("../app/actions/forms", () => ({ loadFormCollectionAvailability: m.availability, submitAssignedFormAction: vi.fn(), submitPublicFormAction: vi.fn() }));
vi.mock("../app/actions/intake-drafts", () => ({ loadIntakeDraft: vi.fn().mockResolvedValue({ ok: true, draft: null }), saveIntakeDraft: vi.fn() }));

const schema: FormPublishedSchema = {
  form_id: "aaaaaaaa-0000-4000-8000-000000000001", canonical_key: "test",
  form_version_id: "aaaaaaaa-0000-4000-8000-000000000002", fields: [], rules: [],
  title: "Test form", form_type: "contact", version_number: 1, type_config: {},
  schema_hash: null, information_html: null, visibility: "public",
};
const cases = [
  { name: "Forms", read: m.forms, view: () => <FormsVisibilityBoundary scope="internal" signature="same">Form history</FormsVisibilityBoundary> },
  { name: "Coupons", read: m.coupons, view: () => <CouponAccessBoundary>Coupons</CouponAccessBoundary> },
  { name: "Financial", read: m.financial, view: () => <FinancialVisibilityBoundary scope="client" signature="same">Invoices</FinancialVisibilityBoundary> },
  { name: "Subscriptions", read: m.subscriptions, view: () => <SubscriptionHistoryBoundary ids={["a"]} audience="client">History</SubscriptionHistoryBoundary> },
  { name: "Public form", read: m.availability, view: () => <FormRenderer schema={schema} mode="public" /> },
  { name: "Assigned form", read: m.availability, view: () => <FormRenderer schema={schema} mode="assigned" assignmentId="assignment" /> },
];
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  m.forms.mockResolvedValue({ ok: true, signature: "same" });
  m.coupons.mockResolvedValue({ ok: true, allowed: true });
  m.financial.mockResolvedValue({ ok: true, signature: "same" });
  m.subscriptions.mockResolvedValue({ ok: true, ids: ["a"] });
  m.availability.mockResolvedValue(true);
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

it.each(cases)("$name checks on mount/return, waits five minutes, and stops after unmount", async ({ read, view }) => {
  const mounted = render(view());
  await act(() => vi.advanceTimersByTimeAsync(0));
  expect(read).toHaveBeenCalledTimes(1);
  await act(() => vi.advanceTimersByTimeAsync(299_999));
  expect(read).toHaveBeenCalledTimes(1);
  await act(() => vi.advanceTimersByTimeAsync(1));
  expect(read).toHaveBeenCalledTimes(2);
  Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(600_000);
  });
  expect(read).toHaveBeenCalledTimes(2);
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
  expect(read).toHaveBeenCalledTimes(3);
  await act(async () => { window.dispatchEvent(new Event("focus")); });
  expect(read).toHaveBeenCalledTimes(4);
  mounted.unmount();
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(600_000);
  });
  expect(read).toHaveBeenCalledTimes(4);
});

it.each(cases)("$name skips an initially hidden tab", async ({ read, view }) => {
  Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
  render(view());
  await act(() => vi.advanceTimersByTimeAsync(600_000));
  expect(read).not.toHaveBeenCalled();
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
  expect(read).toHaveBeenCalledTimes(1);
});
