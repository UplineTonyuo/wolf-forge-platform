import { summarizeServiceDescription } from "./service-summary";

/**
 * One-line card summaries for the client Store.
 *
 * The captured catalogue descriptions are long marketing copy — a prose hook
 * followed by an inclusion list. A Store card is a browsing surface, not a
 * miniature service page, so it must never behave like the first 165 characters
 * of that copy (which is what "If your website isn't ranking for the searches
 * your customers are making…" reads as on a card).
 *
 * So the card has its own, deliberately short, polished summary for every
 * service currently in the catalogue. These are authored once, live in this
 * module as plain data, and are deterministic — there is no runtime
 * summarization and no external LLM. The full captured description is never
 * touched: it continues to render on the detail page through `descriptionHtml`
 * (see `StoreServiceView`), and nothing here shortens or overwrites it.
 *
 * The catalogue is keyed by the service name because that is the only stable
 * handle a `ServiceRow` exposes to this projection (the SEO Sprints folder has
 * fixed ids; the imported folders do not, and ids are regenerated on a reset).
 * Names are matched case-insensitively. Only one of the two same-named press
 * release products in the catalogue is client-visible, so a name is unambiguous
 * inside the Store.
 *
 * A service that is *not* in the map falls back to the derived preview
 * (`summarizeServiceDescription`), so a service added to the catalogue later
 * still gets a sensible card line until a human writes its curated summary.
 */
const cardSummaries: Record<string, string> = {
  // --- SEO Sprints ------------------------------------------------------
  "MAPS SPRINT":
    "Audits your Google Business Profile, local rankings, keywords, competitors, and priorities to improve Maps visibility.",
  "SEO SPRINT":
    "Audits technical, on-page, keyword, content, linking, and competitor gaps to identify the SEO fixes that matter most.",
  "AI VISIBILITY SPRINT":
    "Audits your visibility across AI-driven search and answer engines, then maps the ChatGPT and Google AI opportunities to fix first.",
  "WEBSITE SPRINT":
    "Audits your homepage, mobile experience, speed, and conversion path to find what is stopping visitors from becoming leads.",
  "LEAD GEN SPRINT":
    "Audits your lead generation system — offer, landing pages, capture, and follow-up — to find where prospects drop out.",
  "CONVERSION SPRINT":
    "Audits your website, offers, and sales process to find the leaks between visitor, lead, and customer.",
  "COMPETITOR SPRINT":
    "Analyses your competitors' rankings, website strategy, content, and offers to show where they win and where you can attack.",
  "LEAD GENERATION SYSTEM":
    "Builds a complete lead capture and follow-up system — funnel, landing page, CRM, and appointments — to turn prospects into sales.",
  "CONVERSION OPTIMIZATION SYSTEM":
    "Identifies and optimizes the points between visitor, lead, appointment, and customer so more of your existing traffic converts.",
  "COMPETITIVE DOMINATION BLUEPRINT":
    "Turns your competitors' gaps into an actionable 90-day growth strategy for keywords, content, and local visibility.",

  // --- GBP Only SEO -----------------------------------------------------
  "GMB OPTIMIZATION":
    "Fixes the foundation of your Google Business Profile — categories, services, local keywords, and photos — so you outrank competitors.",
  "GMB/GBP MANAGEMENT":
    "Monthly Google Business Profile management — photos, posts, Q&As, and citations — to keep your local presence active and growing.",
  "GOOGLE BUSINESS PROFILE REVIEWS ( 10 REVIEWS)":
    "Adds ten positive reviews to your Google Business Profile to strengthen trust and local credibility.",
  "GMB VERIFICATION":
    "Verifies your Google Business Profile for any niche, with a 30-day replacement guarantee if the listing comes down.",

  // --- Local SEO ---------------------------------------------------------
  "STARTER SEO":
    "One-time Google Business Profile optimization plus ongoing maintenance, citations, and monthly content that builds local visibility.",
  "FOUNDATIONAL SEO (20 TARGETED KEYWORDS)":
    "Twenty targeted keywords with local citations, Google Business Profile management, branded press releases, and monthly content.",
  "SEO SUCCESS BLUEPRINT":
    "A complete local SEO plan — citations, Google Business Profile management, geo stacks, and four blogs and press releases monthly.",
  "FRANCHISE IN A BOX SYSTEM":
    "Builds the brand, website, and Google Business Profiles for a multi-location business, with territory-level SEO for each market.",

  // --- Ecommerce SEO -----------------------------------------------------
  "E-COMMERCE SEO PACKAGE":
    "A monthly content and authority plan for online stores — blogs, guest posts, press releases, and link stacks built for e-commerce.",

  // --- Onpage & Technical SEO --------------------------------------------
  "AIO SYSTEM":
    "Builds visibility across AI-driven search and answer engines with query mapping, entity optimization, and AI-optimized content.",
  "KEYWORD RESEARCH":
    "Researches up to 50 targeted keywords with search volume, competition, and intent analysis, delivered in a detailed report.",
  "ON-PAGE SEO":
    "Optimizes up to 40 pages for your target keywords — titles, headings, meta, internal links, and images — to match search intent.",
  "WORDPRESS SPEED OPTIMIZATION SERVICES":
    "Speeds up your WordPress site — Core Web Vitals, caching, image compression, and code minification — with a before-and-after report.",
  "TECHNICAL SEO FIXES":
    "Fixes your technical SEO foundation — titles, schema, internal linking, and priority issues — so your site is ready to compete.",
  "WEBSITE OPTIMIZATION":
    "Optimizes your homepage, CTAs, mobile experience, and service pages so more of your traffic becomes leads and customers.",
  "ADVANCED SCHEMA MARKUP (1 PAGE ONLY)":
    "Adds hand-coded JSON-LD schema to one page so your product or service appears more prominently in search results.",

  // --- Website Design ----------------------------------------------------
  "STANDARD 20 PAGE WEB BUILD":
    "A custom 20-page website built in WordPress with Elementor, styled around your brand and the sites you like.",
  "ADVANCED 20 PAGE WEB BUILD":
    "A custom 20-page WordPress build with a contact form, workflow automations, and four rounds of revisions.",
  "PREMIUM 20 PAGE WEB BUILD":
    "A custom 20-page WordPress build with a million words of content, workflow automations, and delivery in two weeks or less.",
  "WEB DESIGN PRODUCT WOOCOMMERCE":
    "A custom WooCommerce store with up to 20 pages and 100 products, including automations and four rounds of revisions.",

  // --- Press Releases ----------------------------------------------------
  "BASIC PRESS RELEASE DISTRIBUTION SERVICE - GUARANTEED 150 LINKS":
    "Distributes your 500-word press release to 150 news sites — financial and local — with guaranteed links.",
  "STANDARD PRESS RELEASE DISTRIBUTION SERVICE - GUARANTEED 350 LINKS":
    "Distributes your press release to 350 guaranteed placements, including Google News, Yahoo, Bing, and online newspapers.",
  "PREMIUM PRESS RELEASE DISTRIBUTION SERVICE - GUARANTEED 450 LINKS":
    "Distributes your 1,500-word press release to 450 placements, including TV, radio, and major financial news outlets.",
  "YAHOO PACKAGE PRESS RELEASE DISTRIBUTION SERVICE - GUARANTEED 450 LINKS":
    "Distributes your press release across the Yahoo network — Finance, Tech, News, and Crypto — for 450 guaranteed placements.",
  "BUSINESS INSIDER + YAHOO PACKAGE PRESS RELEASE DISTRIBUTION SERVICE - GUARANTEED 450 LINKS":
    "Distributes your press release to Business Insider, MarketWatch, and the Yahoo network for 450 guaranteed placements.",

  // --- Backlink Service --------------------------------------------------
  "50 BRANDED FOUNDATION AUTHORITY BACKLINKS":
    "Builds 50 branded backlinks on trusted publishing platforms like WordPress, Medium, and Blogger.",
  "SOCIAL PROFILE FOUNDATIONAL LINKS":
    "Creates and optimizes your profiles across Facebook, Instagram, LinkedIn, YouTube, and other leading social platforms.",
  "100+ LOCAL CITATIONS":
    "Builds 100 local citations across trusted directories like Yelp, Apple Maps, and the Better Business Bureau.",
  "GOOGLE GSTACK ADVANCED":
    "Builds an advanced Google asset stack — Maps, Knowledge Graph, Drive, and content — to strengthen your brand's authority.",
  "CLOUD STACK":
    "Hosts a branded website across a cloud stack of major providers to add authority signals to your online presence.",
  "INFINITE ENTITY LOOP":
    "Connects your G Site, Pearltrees, and Gstack assets into an entity loop that reinforces your brand identity online.",
  "SEO FORTRESS":
    "Builds a syndication network and Google Drive stack around your brand for a stronger, more authoritative footprint.",
  "MULTI TIER SYNDICATION NETWORK":
    "Creates hand-built, interlinked syndication networks with automated content to amplify your brand's authority.",
  "GOOGLE MAPS BOOSTER":
    "Places 7,200 local citations within a 30-mile radius, with geotagged photos and driving directions, to boost Maps rankings.",
  "YOUTUBE STACK":
    "Creates optimized videos from your blogs, with playlists, channel optimization, and embedding to strengthen your authority.",
  "PODCAST STACK":
    "Turns your blogs into optimized podcast episodes with transcripts, distribution, and embedding across platforms.",
  "PRESS RELEASE STACK":
    "Publishes four keyword-optimized press releases that deliver 600 backlinks to your site.",
  "140 EDU BACKLINKS":
    "Adds 140 backlinks from education (.edu) domains to raise your site's authority and search rankings.",
  "STARTER BACKLINK SEO PACKAGE":
    "A starter link package: 100 citations, a branded press release, and 50 branded Web 2.0 backlinks.",
  "BASIC SEO BACKLINK PACKAGE":
    "Builds authority with 100 citations, two branded press releases, 50 Web 2.0 assets, and five niche PBN links.",
  "GUEST POST NICHE RELEVANT":
    "Secures niche-relevant guest posts through manual outreach, with contextual in-content links from qualified sites.",
  "PBN NICHE RELEVANT":
    "Places a contextual link on a niche-relevant private blog network with optimized anchor text and a confirmation report.",
  "TIERED GUEST POST LINK BUILDING (250 GUEST POSTS)":
    "Builds 250 guest posts with high-quality tier-two backlinks through manual outreach to grow domain authority.",
};

function normalizeName(name: string): string {
  return name.trim().toUpperCase();
}

/**
 * The card summary for a Store service.
 *
 * A curated line wins when the catalogue has one for the service name;
 * otherwise the description is derived through the existing preview logic. The
 * returned value is plain text — never HTML, never the full description, and it
 * never ends in a natural "…" (the CSS line clamp is only a layout safety net).
 * Returns "" when there is nothing usable, so the card can omit the line.
 */
export function storeCardSummary(name: string, description: string | null | undefined): string {
  const curated = cardSummaries[normalizeName(name)];
  if (curated) return curated;
  return summarizeServiceDescription(description);
}
