import { describe, expect, it } from "vitest";
import {
  DEFAULT_ACCOUNT_NEXT_PATH,
  DEFAULT_NEXT_PATH,
  isAccountPath,
  safeAccountNextPath,
  safeNextPath,
} from "../domain/auth/safe-next-path";

describe("post-login redirect target validation", () => {
  it("keeps ordinary internal routes intact", () => {
    for (const target of ["/dashboard", "/reporting", "/clients", "/orders", "/invoices/abc", "/account"]) {
      expect(safeNextPath(target)).toBe(target);
    }
  });

  it("keeps pathname, query and hash together", () => {
    expect(safeNextPath("/reporting?range=30d&client=abc#summary")).toBe(
      "/reporting?range=30d&client=abc#summary",
    );
    expect(safeNextPath("/clients?status=lead")).toBe("/clients?status=lead");
    expect(safeNextPath("/orders#top")).toBe("/orders#top");
  });

  it("rejects the confirmed M-05 backslash bypass", () => {
    // Resolves to https://evil.example/ under standard URL parsing.
    expect(safeNextPath("/\\evil.example")).toBe(DEFAULT_NEXT_PATH);
    expect(safeNextPath("/\\\\evil.example")).toBe(DEFAULT_NEXT_PATH);
    expect(safeNextPath("/\\/evil.example")).toBe(DEFAULT_NEXT_PATH);
    expect(safeNextPath("\\/evil.example")).toBe(DEFAULT_NEXT_PATH);
    expect(safeNextPath("/dashboard\\@evil.example")).toBe(DEFAULT_NEXT_PATH);
  });

  it("rejects protocol-relative and dot-segment escapes", () => {
    expect(safeNextPath("//evil.example")).toBe(DEFAULT_NEXT_PATH);
    expect(safeNextPath("///evil.example")).toBe(DEFAULT_NEXT_PATH);
    // Normalizes to //evil.example, which a browser reads as protocol-relative.
    expect(safeNextPath("/..//evil.example")).toBe(DEFAULT_NEXT_PATH);
    expect(safeNextPath("/../..//evil.example")).toBe(DEFAULT_NEXT_PATH);
  });

  it("rejects absolute and scheme-like targets", () => {
    for (const target of [
      "https://evil.example",
      "http://evil.example/dashboard",
      "//evil.example/dashboard",
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "mailto:someone@evil.example",
      "https://app.invalid/dashboard",
    ]) {
      expect(safeNextPath(target)).toBe(DEFAULT_NEXT_PATH);
    }
  });

  it("rejects control characters that the URL parser would strip", () => {
    // Built from code points rather than escapes so the literals cannot be
    // silently normalised by an editor or a formatter.
    const control = (code: number) => `/${String.fromCharCode(code)}/evil.example`;
    for (const code of [0x00, 0x09, 0x0a, 0x0d, 0x1f, 0x7f, 0x85, 0x9f]) {
      expect(safeNextPath(control(code))).toBe(DEFAULT_NEXT_PATH);
    }
  });

  it("rejects non-string, empty and oversized input", () => {
    expect(safeNextPath(null)).toBe(DEFAULT_NEXT_PATH);
    expect(safeNextPath(undefined)).toBe(DEFAULT_NEXT_PATH);
    expect(safeNextPath(42)).toBe(DEFAULT_NEXT_PATH);
    expect(safeNextPath({ toString: () => "/dashboard" })).toBe(DEFAULT_NEXT_PATH);
    expect(safeNextPath("")).toBe(DEFAULT_NEXT_PATH);
    expect(safeNextPath(`/${"a".repeat(4000)}`)).toBe(DEFAULT_NEXT_PATH);
  });

  it("rejects relative targets that are not root-relative", () => {
    expect(safeNextPath("dashboard")).toBe(DEFAULT_NEXT_PATH);
    expect(safeNextPath("./dashboard")).toBe(DEFAULT_NEXT_PATH);
    expect(safeNextPath("../dashboard")).toBe(DEFAULT_NEXT_PATH);
  });

  it("treats a percent-encoded backslash as an ordinary path character", () => {
    expect(safeNextPath("/%5Cevil.example")).toBe("/%5Cevil.example");
  });

  it("honours the caller's fallback", () => {
    expect(safeNextPath("https://evil.example", "/account")).toBe("/account");
  });
});

describe("client portal redirect targets", () => {
  it("keeps portal routes inside the portal", () => {
    expect(safeAccountNextPath("/account")).toBe("/account");
    expect(safeAccountNextPath("/account/invoices/abc")).toBe("/account/invoices/abc");
    expect(safeAccountNextPath("/account/messages?compose=1&from=cart")).toBe(
      "/account/messages?compose=1&from=cart",
    );
  });

  it("sends every other valid local target to the portal root", () => {
    expect(safeAccountNextPath("/dashboard")).toBe(DEFAULT_ACCOUNT_NEXT_PATH);
    expect(safeAccountNextPath("/clients")).toBe(DEFAULT_ACCOUNT_NEXT_PATH);
  });

  it("sends malicious targets to the portal root rather than off-origin", () => {
    for (const target of ["/\\evil.example", "//evil.example", "https://evil.example", "/..//evil.example"]) {
      expect(safeAccountNextPath(target)).toBe(DEFAULT_ACCOUNT_NEXT_PATH);
    }
  });

  it("does not let a lookalike prefix pass as a portal route", () => {
    expect(isAccountPath("/accountsomething")).toBe(false);
    expect(safeAccountNextPath("/accountsomething")).toBe(DEFAULT_ACCOUNT_NEXT_PATH);
    expect(isAccountPath("/account")).toBe(true);
    expect(isAccountPath("/account/projects")).toBe(true);
    expect(isAccountPath("/account?tab=billing")).toBe(true);
  });
});
