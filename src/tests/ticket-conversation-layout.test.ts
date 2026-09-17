import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The Ticket conversation stylesheet, as a contract.
 *
 * These are the two layout rules that were wrong and are easy to reintroduce,
 * because both look reasonable in isolation and only misbehave at a specific
 * viewport with a specific message. A computed-style test in jsdom cannot see
 * any of it -- the CSS modules are not applied there -- so the rules
 * themselves are asserted, the same way the Podcast SEO responsive contract
 * asserts its own.
 */
const css = readFileSync(resolve(import.meta.dirname, "../components/tickets/tickets.module.css"), "utf8");

/**
 * The declaration block of a rule, matched on a selector that STARTS a line so
 * a selector appearing inside another rule's list cannot shadow it.
 */
function blockFor(selector: string): string {
  const marker = `
${selector} {`;
  const index = css.indexOf(marker);
  if (index < 0) throw new Error(`Missing CSS selector: ${selector}`);
  const open = index + marker.length - 1;
  const close = css.indexOf("}", open);
  if (close < 0) throw new Error(`Unterminated block: ${selector}`);
  return css.slice(open + 1, close);
}

describe("Ticket conversation identity layout", () => {
  it("un-reverses the sender row for a client viewer's other party", () => {
    /*
     * `[data-side="internal"] .messageSender` is row-reversed so a STAFF
     * viewer's own name sits at their right edge. For a client viewer those
     * rows are the other party on the left, and the reversal pushed the name
     * to the far side of the metadata column -- away from the avatar, with the
     * timestamp and bubble left behind next to it.
     */
    const block = blockFor('.orderChat[data-client-view="true"] [data-side="internal"] .messageSender');
    expect(block).toMatch(/flex-direction:\s*row\s*;/);
    expect(block).not.toMatch(/row-reverse/);
  });

  it("keeps the client viewer's own messages free of a reversed sender row", () => {
    /* Own messages render no sender line at all, so nothing may reintroduce
       one for the client side. */
    const block = blockFor('.orderChat[data-client-view="true"] .thread > li[data-side="client"] .messageStack');
    expect(block).toMatch(/align-items:\s*flex-end\s*;/);
  });
});

describe("Ticket message-action menu anchoring", () => {
  it("makes the actions layer cover the message, so the menu anchors to it", () => {
    /*
     * The menu's containing block is this layer. When the layer was a narrow
     * strip parked beside the bubble, the menu inherited that offset and
     * opened one trigger-width away from the message: under the avatar for a
     * left-side message, and past the right edge of a 390px viewport for a
     * right-aligned one.
     */
    const block = blockFor(".orderMessageActions");
    expect(block).toMatch(/inset:\s*0\s*;/);
    expect(block).not.toMatch(/left:\s*100%/);
  });

  it("keeps pointer events on the trigger and the open menu, not on the layer", () => {
    /* The layer covers the message, so it must not swallow the outside tap
       that dismisses the menu. */
    const block = blockFor(".orderMessageActions");
    expect(block).toMatch(/pointer-events:\s*none\s*;/);
    expect(css).toContain(".orderMessageActions[data-open] > button");
    expect(css).toContain(".orderMessageActions[data-open] .orderMessageMenu { pointer-events: auto; }");
  });

  it("anchors the menu on which side the bubble sits, not on who wrote it", () => {
    /*
     * Which side a bubble sits on depends on WHO is looking, so keying the
     * anchor on `data-side` (the author) put the menu on the wrong edge for
     * half the viewers. `data-own` is the alignment fact.
     */
    const base = blockFor(".orderMessageMenu");
    expect(base).toMatch(/left:\s*0\s*;/);
    expect(base).toMatch(/right:\s*auto\s*;/);

    const own = blockFor('.orderChat .thread > li[data-own="true"] .orderMessageMenu');
    expect(own).toMatch(/right:\s*0\s*;/);
    expect(own).toMatch(/left:\s*auto\s*;/);

    /* The author-keyed anchor must be gone. */
    expect(css).not.toContain('.orderChat [data-side="internal"] .orderMessageMenu');
  });

  it("can open upward, for a message with no room beneath it", () => {
    const block = blockFor('.orderMessageMenu[data-placement="above"]');
    expect(block).toMatch(/top:\s*auto\s*;/);
    expect(block).toMatch(/bottom:\s*calc\(100%\s*\+\s*8px\)\s*;/);
  });
});
