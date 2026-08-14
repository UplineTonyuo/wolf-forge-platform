import { describe, expect, it } from "vitest";
import { sanitizeServiceDescription } from "../lib/service-description-html";

describe("service description HTML", () => {
  it("keeps supported catalog formatting while removing executable markup", () => {
    const result = sanitizeServiceDescription(
      '<h2>MAPS OPTIMIZATION SYSTEM</h2><div><strong>We found it.</strong><br><a href="https://example.com">Details</a></div><script>alert(1)</script><a href="javascript:alert(1)">Unsafe</a>',
    );

    expect(result).toContain("<h2>MAPS OPTIMIZATION SYSTEM</h2>");
    expect(result).toContain("<strong>We found it.</strong><br />");
    expect(result).toContain('href="https://example.com"');
    expect(result).toContain('rel="noopener noreferrer"');
    expect(result).not.toContain("<script");
    expect(result).not.toContain("javascript:");
  });

  it("does not change the authoritative source string", () => {
    const source = '<h2>Heading</h2><div>Legacy&nbsp;copy ✨</div>';

    sanitizeServiceDescription(source);

    expect(source).toBe('<h2>Heading</h2><div>Legacy&nbsp;copy ✨</div>');
  });
});
