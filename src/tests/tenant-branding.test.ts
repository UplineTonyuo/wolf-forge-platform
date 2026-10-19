import { describe, expect, it } from "vitest";
import { tenantBranding } from "../components/shell/tenant-branding";
import { colorContrast } from "../domain/white-label/colors";
import { WHITE_LABEL_PUBLICATION_CONTRACT_VERSION, type RuntimeWhiteLabelConfiguration } from "../domain/white-label/publication";

const published: RuntimeWhiteLabelConfiguration = {
  kind: "published",
  configuration: {
    tenantId: "aaaaaaaa-0000-4000-8000-000000000001",
    publicationRevision: 2,
    sourceDraftRevision: 7,
    displayName: "Tenant A",
    primaryColor: "#173c32",
    accentColor: "#d2b777",
    moduleKeys: ["services"],
    publishedAt: "2026-10-13T12:00:00Z",
  },
};

function colors(primaryColor: string, accentColor: string): RuntimeWhiteLabelConfiguration {
  if (published.kind !== "published") throw new Error("Expected published fixture");
  return { kind: "published", configuration: { ...published.configuration, primaryColor, accentColor } };
}

describe("published tenant presentation contract", () => {
  it("imports the frozen version and leaves the snapshot unchanged", () => {
    const before = structuredClone(published);
    expect(WHITE_LABEL_PUBLICATION_CONTRACT_VERSION).toBe("1.0");
    const result = tenantBranding(published);
    expect(result).toMatchObject({ name: "Tenant A", tenantId: published.configuration.tenantId, revision: 2 });
    expect(result?.style).toMatchObject({ "--tenant-primary": "#173c32", "--tenant-accent": "#d2b777" });
    expect(published).toEqual(before);
  });

  it.each([
    { kind: "unpublished", tenantId: published.configuration.tenantId, publicationRevision: 0 },
    { kind: "legacy_modules", tenantId: published.configuration.tenantId, publicationRevision: 3, moduleKeys: ["services"] },
  ] as RuntimeWhiteLabelConfiguration[])("keeps defaults for $kind without reviving an earlier brand", (configuration) => {
    expect(tenantBranding(configuration)).toBeNull();
  });

  it.each([
    ["#ffffff", "#ffffee"], ["#000000", "#010101"], ["#757575", "#888888"], ["#173c32", "#d2b777"],
  ])("derives contrast without changing published %s / %s", (primary, accent) => {
    const style = tenantBranding(colors(primary, accent))?.style as Record<string, string>;
    expect(style["--tenant-primary"]).toBe(primary);
    expect(style["--tenant-accent"]).toBe(accent);
    expect(colorContrast(primary, style["--tenant-on-primary"]!)).toBeGreaterThanOrEqual(4.5);
    expect(colorContrast(accent, style["--tenant-on-accent"]!)).toBeGreaterThanOrEqual(4.5);
    expect(colorContrast(primary, style["--tenant-active-accent"]!)).toBeGreaterThanOrEqual(3);
    expect(colorContrast("#ffffff", style["--wf-navy"]!)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(["red", "#fff", "#ffffff;display:none", "url(https://example.com)"])("refuses CSS input %s instead of falling back", (primary) => {
    expect(() => tenantBranding(colors(primary, "#d2b777"))).toThrow();
  });

  it.each(["", " padded ", "A".repeat(61), "Bad\u0000name"])("refuses malformed stored name", (displayName) => {
    expect(() => tenantBranding({ kind: "published", configuration: { ...published.configuration, displayName } })).toThrow();
  });

  it("does not treat missing or unknown wire data as unpublished", () => {
    expect(() => tenantBranding(null as unknown as RuntimeWhiteLabelConfiguration)).toThrow();
    expect(() => tenantBranding({ kind: "draft" } as unknown as RuntimeWhiteLabelConfiguration)).toThrow();
  });

  it("uses the producer's Unicode name limit", () => {
    const displayName = "\u{1f43a}".repeat(60);
    expect(tenantBranding({ kind: "published", configuration: { ...published.configuration, displayName } })?.name).toBe(displayName);
  });

  it("refuses malformed compatibility states through the shared decoder", () => {
    expect(() => tenantBranding({ kind: "unpublished", tenantId: "not-a-tenant", publicationRevision: 0 })).toThrow();
    expect(() => tenantBranding({ kind: "legacy_modules", tenantId: published.configuration.tenantId, publicationRevision: 2, moduleKeys: [] })).toThrow();
  });
});
