import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Internal note action visibility", () => {
  it("is hover/focus revealed on desktop and tap-visible on coarse pointers", () => {
    const css = readFileSync(new URL("../components/tickets/tickets.module.css", import.meta.url), "utf8");

    expect(css).toMatch(/\.internalNoteActionsTrigger\s*\{[^}]*opacity:\s*0;[^}]*pointer-events:\s*none;/s);
    expect(css).toMatch(/\.internalNoteItem:hover \.internalNoteActionsTrigger,\s*\.internalNoteItem:focus-within \.internalNoteActionsTrigger\s*\{[^}]*opacity:\s*1;[^}]*pointer-events:\s*auto;/s);
    expect(css).toMatch(/@media \(hover: none\), \(pointer: coarse\)[\s\S]*\.internalNoteActionsTrigger\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px;[^}]*opacity:\s*1;[^}]*pointer-events:\s*auto;/);
  });
});
