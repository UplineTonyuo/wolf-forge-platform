import { beforeEach, expect, it, vi } from "vitest";
import { NotFoundError, PermissionDeniedError } from "../lib/errors/application-error";

const mocks = vi.hoisted(() => ({ get: vi.fn(), notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND_TEST"); }) }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound, forbidden: vi.fn() }));
vi.mock("../components/invoices/invoice-detail-actions", () => ({ InvoiceDetailActions: vi.fn() }));
vi.mock("../components/invoices/invoice-form", () => ({ InvoiceForm: vi.fn() }));
vi.mock("../components/invoices/financial-visibility-boundary", () => ({ FinancialVisibilityBoundary: vi.fn() }));
vi.mock("../lib/supabase/next-server", () => ({ getInternalContext: async () => ({
  user: { invoices: { manage: true } },
  services: {
    invoices: { get: mocks.get, list: async () => [], workEnabled: async () => true },
    companies: { listActive: async () => [] },
    catalog: { listActive: async () => [], listFolders: async () => [] },
  },
}) }));
const { default: detail } = await import("../app/(internal)/invoices/[invoiceId]/page");
const { default: edit } = await import("../app/(internal)/invoices/[invoiceId]/edit/page");
beforeEach(() => vi.clearAllMocks());
it.each([new PermissionDeniedError(), new NotFoundError("Invoice")])("renders neutral not-found for inaccessible internal detail (%s)", async (error) => {
  mocks.get.mockRejectedValue(error);
  await expect(detail({ params: Promise.resolve({ invoiceId: "target" }), searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_NOT_FOUND_TEST");
  expect(mocks.notFound).toHaveBeenCalledOnce();
});
it.each([new PermissionDeniedError(), new NotFoundError("Invoice")])("renders neutral not-found for inaccessible edit target (%s)", async (error) => {
  mocks.get.mockRejectedValue(error);
  await expect(edit({ params: Promise.resolve({ invoiceId: "target" }) })).rejects.toThrow("NEXT_NOT_FOUND_TEST");
  expect(mocks.notFound).toHaveBeenCalledOnce();
});
