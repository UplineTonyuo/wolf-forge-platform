import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import manifest from "../app/manifest";

describe("Wolf Forge installation manifest", () => {
  it("launches through role routing within the same origin and scope", () => {
    expect(manifest()).toMatchObject({ id: "/", start_url: "/launch", scope: "/", display: "standalone" });
  });

  it("ships actual square PNG icons with correct dimensions", () => {
    for (const icon of manifest().icons!) {
      const file = readFileSync(new URL(`../../public${icon.src}`, import.meta.url));
      expect(file.subarray(1, 4).toString()).toBe("PNG");
      expect(`${file.readUInt32BE(16)}x${file.readUInt32BE(20)}`).toBe(icon.sizes);
    }
    const apple = readFileSync(new URL("../../public/branding/apple-touch-icon.png", import.meta.url));
    expect(apple.readUInt32BE(16)).toBe(180);
    expect(apple.readUInt32BE(20)).toBe(180);
  });
});
