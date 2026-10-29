import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..", "..");

function readSource(relativePath: string) {
  return readFileSync(resolve(root, relativePath), "utf8");
}

/**
 * KI-059: the unread-notification signal must not live inside the collapsible
 * utility rail. Hidden utilities use opacity:0 / pointer-events:none, so
 * a child-only CSS exemption cannot keep the badge visible at rest.
 */
describe("workspace notification badge visibility (KI-059)", () => {
  it("keeps the notification trigger outside .workspace-command-shortcuts", () => {
    const source = readSource(
      "src/components/shell/workspace-command-bar.tsx",
    );

    const shortcutsBlocks = [
      ...source.matchAll(
        /className="workspace-command-shortcuts(?: [^"]*)?">([\s\S]*?)<\/div>/g,
      ),
    ].map((match) => match[1] ?? "");

    expect(shortcutsBlocks.length).toBeGreaterThanOrEqual(1);
    for (const block of shortcutsBlocks) {
      expect(block).not.toContain("workspace-notification-trigger");
      expect(block).not.toContain("workspace-notification-badge");
    }

    expect(source).toContain('className="workspace-command-bar"');
    expect(source).toContain("workspace-notification-trigger");
    expect(source).toContain("workspace-notification-badge");
  });

  it("reveals secondary rails from the command bar, not from a nested bell", () => {
    const css = readSource("src/app/globals.css");
    const stability = css.slice(
      css.indexOf("/* WF COMMAND BAR SHORTCUT STABILITY START */"),
      css.indexOf("/* WF COMMAND BAR SHORTCUT STABILITY END */"),
    );

    expect(stability).toContain(
      ".workspace-command-bar:has(.workspace-notification-trigger.is-open) .workspace-command-shortcuts",
    );
    expect(stability).not.toContain(
      ".workspace-command-shortcuts:has(.workspace-notification-trigger.is-open)",
    );
    expect(stability).toContain(
      ".workspace-command-bar > .workspace-notification-trigger",
    );
    expect(stability).toMatch(
      /\.workspace-command-shortcuts\s*\{[\s\S]*?max-width:\s*200px;/,
    );
    expect(stability).not.toMatch(/max-width:\s*0;/);
    expect(stability).not.toMatch(/max-width\s+\d+ms/);
  });
});
