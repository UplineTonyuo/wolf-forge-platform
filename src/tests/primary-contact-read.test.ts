import { expect, it, vi } from "vitest";
import { ContactRepository } from "../repositories/contact-repository";
import { ContactService } from "../services/contact-service";
import type { UserMutationClient } from "../repositories/types";
it("reads only the four primary contact fields through the narrow RPC", async () => {
  const fields = { name: "Synthetic Contact", email: "contact@example.invalid", phone: null, job_title: null };
  const rpc = vi.fn().mockResolvedValue({ data: [fields], error: null });
  const repository = new ContactRepository({ rpc } as unknown as UserMutationClient);
  const service = new ContactService({ repository });
  expect(await service.getPrimarySummary("10000000-0000-4000-8000-000000000001")).toEqual(fields);
  expect(rpc).toHaveBeenCalledWith("app_get_primary_contact_summary", { p_company_id: "10000000-0000-4000-8000-000000000001" });
});
it("preserves missing contacts and server denials instead of inventing contact values", async () => {
  const rpc = vi.fn().mockResolvedValueOnce({ data: [], error: null }).mockResolvedValue({ data: null, error: { code: "42501", message: "denied" } });
  const repository = new ContactRepository({ rpc } as unknown as UserMutationClient);
  expect(await repository.getPrimarySummary("10000000-0000-4000-8000-000000000001")).toBeNull();
  await expect(repository.getPrimarySummary("10000000-0000-4000-8000-000000000001")).rejects.toThrow();
});
