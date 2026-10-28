import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import manifest from "../../data/intake-forms/20261028/manifest.json";
import reviewed147 from "../../data/intake-forms/20261028/drafts/intake-147.json";
import { loadReviewedIntakeTemplates } from "../lib/forms/reviewed-intake-templates";

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return { ...original, readFile: vi.fn(original.readFile) };
});
beforeEach(() => { vi.mocked(readFile).mockClear(); });
const services = manifest.templates.flatMap((entry) => entry.services).map((id) => ({ id }));

describe("reviewed intake template catalogue", () => {
  it("exposes small metadata for all 37 matching templates and only the complete selected definition", async () => {
    const result = await loadReviewedIntakeTemplates(services, "intake-147.json");
    expect(result.options).toHaveLength(37);
    expect(result.options.every((option) => !Object.hasOwn(option, "definition"))).toBe(true);
    expect(result.selected).toMatchObject({ file: "intake-147.json", canonical_key: reviewed147.canonical_key, definition: { fields: reviewed147.definition.fields, service_links: reviewed147.definition.service_links } });
    expect(result.selected?.definition.service_links).toHaveLength(6);
    expect(result.selected).not.toHaveProperty("request_id");
  });

  it("only offers templates whose complete service mapping exists in the current catalogue", async () => {
    const matching = reviewed147.definition.service_links.map((link) => ({ id: link.service_id }));
    expect((await loadReviewedIntakeTemplates(matching, "intake-147.json")).selected?.file).toBe("intake-147.json");
    const missingOne = await loadReviewedIntakeTemplates(matching.slice(1), "intake-147.json");
    expect(missingOne.options).toEqual([]);
    expect(missingOne.selected).toBeNull();
  });

  it("never uses an unlisted query filename as a filesystem path", async () => {
    const result = await loadReviewedIntakeTemplates([], "../manifest.json");
    expect(result.selected).toBeNull();
    expect(result.options).toEqual([]);
    expect(vi.mocked(readFile).mock.calls.map(([path]) => String(path))).toEqual([join(process.cwd(), "data/intake-forms/20261028/manifest.json")]);
  });

  it("rejects a changed template before exposing its definition", async () => {
    vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify(manifest)).mockResolvedValueOnce(Buffer.from("{}"));
    await expect(loadReviewedIntakeTemplates(services, "intake-147.json")).rejects.toThrow("integrity check failed");
  });
});
