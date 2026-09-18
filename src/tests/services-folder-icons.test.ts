import {
  Code2,
  FolderOpen,
  LayoutTemplate,
  Link2,
  MapPinned,
  Navigation,
  Newspaper,
  ShoppingBag,
  TrendingUp,
} from "lucide-react";
import { describe, expect, it } from "vitest";
import { folderIconFor } from "../components/services/service-icons";

/** The real folders in the workspace, in catalogue order. */
const realFolders = [
  "SEO Sprints",
  "GBP Only SEO",
  "Local SEO",
  "Ecommerce SEO",
  "Onpage & Technical SEO",
  "Website Design",
  "Press Releases",
  "Backlink Service",
  "Unfiled",
];

describe("service folder icons", () => {
  it("gives every real folder the semantic icon its name calls for", () => {
    expect(folderIconFor("SEO Sprints")).toBe(TrendingUp);
    expect(folderIconFor("GBP Only SEO")).toBe(MapPinned);
    expect(folderIconFor("Local SEO")).toBe(Navigation);
    expect(folderIconFor("Ecommerce SEO")).toBe(ShoppingBag);
    expect(folderIconFor("Onpage & Technical SEO")).toBe(Code2);
    expect(folderIconFor("Website Design")).toBe(LayoutTemplate);
    expect(folderIconFor("Press Releases")).toBe(Newspaper);
    expect(folderIconFor("Backlink Service")).toBe(Link2);
    expect(folderIconFor("Unfiled")).toBe(FolderOpen);
  });

  it("keeps all nine distinct, so the list stays scannable", () => {
    const icons = realFolders.map((name) => folderIconFor(name));

    expect(new Set(icons).size).toBe(realFolders.length);
  });

  it("prefers the more specific rule over the generic SEO one", () => {
    /* "Local SEO", "GBP Only SEO" and "Ecommerce SEO" all contain "seo". */
    expect(folderIconFor("Local SEO")).not.toBe(folderIconFor("SEO Sprints"));
    expect(folderIconFor("GBP Only SEO")).not.toBe(folderIconFor("SEO Sprints"));
    expect(folderIconFor("Ecommerce SEO")).not.toBe(folderIconFor("SEO Sprints"));
  });

  it("matches case-insensitively and ignores surrounding whitespace", () => {
    expect(folderIconFor("  gbp only seo  ")).toBe(MapPinned);
  });

  it("falls back deterministically, never randomly, for an unknown folder", () => {
    const first = folderIconFor("Q3 Workshop Notes");
    const second = folderIconFor("Q3 Workshop Notes");

    expect(first).toBe(second);
    expect(folderIconFor("")).toBeTruthy();
  });
});
