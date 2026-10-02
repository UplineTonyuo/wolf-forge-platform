import { describe, expect, it } from "vitest";
import { storeCardSummary } from "../domain/services/store-card-summaries";
import { summarizeServiceDescription } from "../domain/services/service-summary";
import { toStoreServiceView } from "../domain/services/store-projections";
import type { ServiceRow } from "../lib/supabase/database-rows";

/**
 * Store card summaries.
 *
 * The captured catalogue descriptions are long marketing copy, and a card used
 * to read as the first ~165 characters of that copy ("If your website isn't
 * ranking for the searches your customers are making…"). The Store now carries
 * a curated one-line summary per catalogue service while the full description
 * stays on the detail page. These tests prove the card uses the short source,
 * never the full description, and that the fallback is safe for a service that
 * has no curated line yet.
 */

/** A realistic captured SEO SPRINT description: prose hook + inclusion list. */
const seoSprintDescription = `<div>🚨 <strong>YOUR COMPETITORS ARE RANKING. WHY AREN'T YOU?</strong></div><div>If your website isn't ranking for the searches your customers are making, there's a reason.</div><div>The Wolf Forge SEO Sprint identifies the biggest opportunities holding your website back.</div><div>We'll analyze:</div><div>✅ Website SEO</div><div>✅ Keyword gaps</div><div>✅ Priority fixes</div>`;

function serviceRow(overrides: Partial<ServiceRow> & { id: string; name: string }): ServiceRow {
  return {
    archived_at: null,
    assigned_to_profile_id: null,
    created_at: "2026-08-01T00:00:00.000Z",
    currency: "USD",
    deadline_amount: null,
    deadline_unit: null,
    description: null,
    folder_id: null,
    group_quantities: false,
    image_url: null,
    is_active: true,
    is_public: true,
    price: 97,
    recurring: false,
    recurring_action: null,
    recurring_interval_length: null,
    recurring_interval_unit: null,
    recurring_price: null,
    require_client_profile: false,
    subscription_eligible: false,
    sort_order: 0,
    updated_at: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("storeCardSummary — curated source wins over the full description", () => {
  it("returns the short curated line for a real catalogue service", () => {
    expect(storeCardSummary("SEO SPRINT", seoSprintDescription)).toBe(
      "Audits technical, on-page, keyword, content, linking, and competitor gaps to identify the SEO fixes that matter most.",
    );
    expect(storeCardSummary("MAPS SPRINT", seoSprintDescription)).toBe(
      "Audits your Google Business Profile, local rankings, keywords, competitors, and priorities to improve Maps visibility.",
    );
  });

  it("never lets the full description or its prose lead onto the card", () => {
    const summary = storeCardSummary("SEO SPRINT", seoSprintDescription);

    expect(summary).not.toContain("YOUR COMPETITORS ARE RANKING");
    expect(summary).not.toContain("ranking for the searches");
    expect(summary).not.toContain("identifies the biggest opportunities");
    expect(summary).not.toContain("Keyword gaps");
    // A card line stays short even when the source description is long.
    expect(summary.length).toBeLessThanOrEqual(160);
  });

  it("returns a plain one-sentence line, never HTML or a bullet list", () => {
    const summary = storeCardSummary("SEO SPRINT", seoSprintDescription);

    expect(summary).not.toMatch(/<[^>]+>/);
    expect(summary).not.toMatch(/[✅✔•·▪]/u);
    expect(summary.trim().endsWith(".")).toBe(true);
  });
});

describe("storeCardSummary — fallback is safe without a curated line", () => {
  it("falls back to the derived preview for a service not in the catalogue map", () => {
    const description = "<div>We fix websites so they rank higher in search results.</div>";

    expect(storeCardSummary("Some Future Service", description)).toBe(
      summarizeServiceDescription(description),
    );
  });

  it("returns an empty line when there is no curated summary and nothing usable to derive", () => {
    expect(storeCardSummary("Some Future Service", null)).toBe("");
    expect(storeCardSummary("Some Future Service", "")).toBe("");
  });
});

describe("Store projection — card summary and full detail stay separate", () => {
  it("keeps the complete description for the detail page while the card gets the short summary", () => {
    const view = toStoreServiceView(
      serviceRow({ id: "seo-sprint", name: "SEO SPRINT", description: seoSprintDescription }),
    );

    // The detail page still receives the whole sanitized description.
    expect(view.descriptionHtml).toContain("YOUR COMPETITORS ARE RANKING");
    expect(view.descriptionHtml).toContain("Keyword gaps");
    expect(view.descriptionHtml).toContain("ranking for the searches");

    // The card uses the curated line, never a slice of the full description.
    expect(view.summary).toBe(
      "Audits technical, on-page, keyword, content, linking, and competitor gaps to identify the SEO fixes that matter most.",
    );
    expect(view.summary).not.toContain("competitors are ranking");
    expect(view.summary).not.toContain("Keyword gaps");
  });

  it("covers every public catalogue service with a curated summary", () => {
    const publicServiceNames = [
      "MAPS SPRINT", "SEO SPRINT", "AI VISIBILITY SPRINT", "WEBSITE SPRINT",
      "LEAD GEN SPRINT", "CONVERSION SPRINT", "COMPETITOR SPRINT", "LEAD GENERATION SYSTEM",
      "Conversion Optimization System", "Competitive Domination Blueprint",
      "GMB Optimization", "GMB/GBP Management", "Google Business Profile Reviews ( 10 Reviews)",
      "GMB Verification",
      "Starter SEO", "Foundational SEO (20 Targeted Keywords)", "SEO Success Blueprint",
      "Franchise in a Box System",
      "E-Commerce SEO Package",
      "AIO System", "Keyword Research", "On-page SEO", "Wordpress Speed Optimization Services",
      "Technical SEO Fixes", "Website Optimization", "Advanced Schema Markup (1 Page Only)",
      "Standard 20 Page Web Build", "Advanced 20 Page Web Build", "Premium 20 Page Web Build",
      "WEB DESIGN PRODUCT WOOCOMMERCE",
      "Basic Press Release Distribution Service - Guaranteed 150 Links",
      "Standard Press Release Distribution Service - Guaranteed 350 Links",
      "Premium Press Release Distribution Service - Guaranteed 450 Links",
      "Yahoo Package Press Release Distribution Service - Guaranteed 450 Links",
      "Business Insider + Yahoo Package Press Release Distribution Service - Guaranteed 450 Links",
      "50 Branded Foundation Authority Backlinks", "Social Profile Foundational Links",
      "100+ Local Citations", "Google Gstack Advanced", "Cloud Stack", "Infinite Entity Loop",
      "SEO Fortress", "Multi Tier Syndication Network", "Google Maps Booster", "YouTube Stack",
      "Podcast Stack", "Press Release Stack", "140 EDU Backlinks", "Starter Backlink SEO Package",
      "Basic SEO Backlink Package", "Guest Post Niche relevant", "PBN Niche relevant",
      "Tiered Guest Post Link Building (250 Guest Posts)",
    ];

    // A curated line resolves even when the description is empty, so a missing
    // entry is unmistakable: it would fall back to an empty derived summary.
    for (const name of publicServiceNames) {
      expect(storeCardSummary(name, null), name).not.toBe("");
    }
  });
});
