import { describe, expect, it, vi } from "vitest";
import type { ClientReportDocument } from "../domain/reporting/schema";
import { ReportingRepository } from "../repositories/reporting-repository";
import type { UserMutationClient } from "../repositories/types";
import { ReportingService } from "../services/reporting-service";

const reportId = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

function document(): ClientReportDocument {
  return {
    report_id: reportId,
    company_id: "3f2504e0-4f89-41d3-9a0c-0305e82c3302",
    company_name: "Northgate Dental",
    report_lane: "seo_package",
    package_label: "Platinum SEO",
    title: "August 2026 SEO Report",
    status: "sent",
    sent_at: "2026-08-20T10:00:00.000Z",
    updated_at: "2026-08-20T10:00:00.000Z",
    reporting_period_month: "2026-08-01",
    is_read: false,
    sections: [
      {
        section_key: "one_time_setup",
        title: "One-time Setup",
        entries: [
          {
            label: "100 Citations",
            value: "Completed",
            url: null,
            one_time_item_key: "citations_100",
            one_time_completed: true,
          },
        ],
      },
    ],
  };
}

describe("client report detail service boundary", () => {
  it("validates the report id before the repository is called", () => {
    const getMine = vi.fn(async () => document());
    const service = new ReportingService({
      repository: { getMine } as unknown as ReportingRepository,
    });

    expect(() => service.getMine("not-a-uuid")).toThrowError(
      expect.objectContaining({ code: "VALIDATION_ERROR" }),
    );
    expect(getMine).not.toHaveBeenCalled();
  });

  it("passes only the validated report id through the service", async () => {
    const getMine = vi.fn(async () => document());
    const service = new ReportingService({
      repository: { getMine } as unknown as ReportingRepository,
    });

    await expect(service.getMine(reportId)).resolves.toMatchObject({ report_id: reportId });
    expect(getMine).toHaveBeenCalledWith(reportId);
    expect(getMine).toHaveBeenCalledTimes(1);
  });

  it("calls the caller-scoped RPC with no company parameter", async () => {
    const rpc = vi.fn(async (functionName: string, args: Record<string, unknown>) => {
      void functionName;
      void args;
      return { data: document(), error: null };
    });
    const repository = new ReportingRepository({ rpc } as unknown as UserMutationClient);

    await expect(repository.getMine(reportId)).resolves.toMatchObject({ report_id: reportId });
    expect(rpc).toHaveBeenCalledWith("app_get_my_client_report", {
      p_report_id: reportId,
    });
    expect(rpc.mock.calls[0]?.[1]).not.toHaveProperty("company_id");
    expect(rpc.mock.calls[0]?.[1]).not.toHaveProperty("p_company_id");
  });

  it("preserves the client-safe one-time presentation metadata", async () => {
    const rpc = vi.fn(async () => ({ data: document(), error: null }));
    const repository = new ReportingRepository({ rpc } as unknown as UserMutationClient);

    const result = await repository.getMine(reportId);

    expect(result.sections[0]?.entries[0]).toMatchObject({
      one_time_item_key: "citations_100",
      one_time_completed: true,
    });
  });
});

describe("internal report draft read boundary", () => {
  it("immediately reads a newly-created draft when the RPC strips null entry fields", async () => {
    const rpc = vi.fn(async () => ({
      data: {
        report_id: reportId,
        company_id: "3f2504e0-4f89-41d3-9a0c-0305e82c3302",
        company_name: "Northgate Dental",
        service_id: "5f000000-0000-4000-8000-000000000123",
        service_name: "Platinum SEO Success Blueprint (100 Targeted Keywords)",
        subscription_id: null,
        wizard_step_key: "technical_seo",
        completed_one_time_item_keys: [],
        report_lane: "seo_package",
        package_label: "Platinum SEO",
        title: "August 2026 SEO Report",
        status: "draft",
        sent_at: null,
        updated_at: "2026-08-20T10:00:00.000Z",
        reporting_period_month: "2026-08-01",
        sections: [
          {
            section_key: "technical_seo",
            title: "Technical SEO",
            entries: [
              { label: "Site Audit Before" },
              { label: "Site Audit After" },
            ],
          },
        ],
      },
      error: null,
    }));
    const repository = new ReportingRepository({ rpc } as unknown as UserMutationClient);
    const service = new ReportingService({ repository });

    const result = await service.getInternal(reportId);

    expect(rpc).toHaveBeenCalledWith("app_get_internal_report", {
      p_report_id: reportId,
    });
    expect(result).toMatchObject({
      report_id: reportId,
      wizard_step_key: "technical_seo",
      sections: [
        {
          section_key: "technical_seo",
          entries: [
            { label: "Site Audit Before", value: null, url: null },
            { label: "Site Audit After", value: null, url: null },
          ],
        },
      ],
    });
  });
});
