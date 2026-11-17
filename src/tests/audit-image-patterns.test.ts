import { expect, it } from "vitest";
import nextConfig from "../../next.config";

it("keeps extglobs out of Next.js image patterns", () => {
  // GHSA-fc5q-39xc-vjpf: keep extglobs out of the config that feeds Next's vendored picomatch.
  const images = nextConfig.images;
  const patterns = [...(images?.remotePatterns ?? []), ...(images?.localPatterns ?? [])];

  for (const pattern of patterns) {
    const values = pattern instanceof URL ? [pattern.href] : Object.values(pattern);
    expect(values.some(value => typeof value === "string" && /[+*@?!]\(/.test(value))).toBe(false);
  }
});