import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(import.meta.dirname, "../app/globals.css"), "utf8");

function blockAfter(source: string, marker: string): string {
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) throw new Error(`Missing CSS marker: ${marker}`);

  const openingBrace = source.indexOf("{", markerIndex + marker.length);
  if (openingBrace < 0) throw new Error(`Missing opening brace after: ${marker}`);

  let depth = 1;
  for (let index = openingBrace + 1; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(openingBrace + 1, index);
  }

  throw new Error(`Unclosed CSS block after: ${marker}`);
}

describe("Podcast SEO responsive worklist contract", () => {
  it("shows the desktop table and hides the duplicate mobile list above the mobile breakpoint", () => {
    const baseCss = css.slice(0, css.indexOf("@media (max-width: 767px)"));
    const table = blockAfter(baseCss, ".dept-table-wrap");
    const hiddenLists = blockAfter(baseCss, ".mobile-record-list, .account-mobile, .dept-mobile-list");

    expect(table).toMatch(/display:\s*block/u);
    expect(table).not.toMatch(/display:\s*none/u);
    expect(hiddenLists).toMatch(/display:\s*none/u);
  });

  it("hides the table and exposes the readable mobile list at the established 767px shell breakpoint", () => {
    const mobileCss = blockAfter(css, "@media (max-width: 767px)");
    const table = blockAfter(mobileCss, ".dept-table-wrap");
    const list = blockAfter(mobileCss, ".dept-mobile-list");
    const row = blockAfter(mobileCss, ".dept-mobile-row");

    expect(table).toMatch(/display:\s*none/u);
    expect(list).toMatch(/display:\s*grid/u);
    expect(list).toMatch(/width:\s*100%/u);
    expect(list).toMatch(/overflow:\s*hidden/u);
    expect(row).toMatch(/width:\s*100%/u);
    expect(row).toMatch(/min-width:\s*0/u);
  });

  it("keeps mobile search and filter controls within the narrow layout", () => {
    const mobileCss = blockAfter(css, "@media (max-width: 767px)");
    const toolbar = blockAfter(mobileCss, ".dept-toolbar");
    const search = blockAfter(mobileCss, ".dept-search");
    const controls = blockAfter(
      mobileCss,
      ".dept-search input,\n  .dept-toolbar-select,\n  .dept-toolbar-select button",
    );

    expect(toolbar).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\)/u);
    expect(search).toMatch(/grid-template-columns:\s*auto minmax\(0, 1fr\)/u);
    expect(controls).toMatch(/width:\s*100%/u);
    expect(controls).toMatch(/min-width:\s*0/u);
  });
});
