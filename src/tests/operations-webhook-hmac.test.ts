import { describe, expect, it } from "vitest";
import {
  operationsWebhookSignatureMatches,
  signOperationsWebhookPayload,
} from "../lib/security/operations-webhook-hmac";

const SECRET = "a".repeat(48);
const OTHER_SECRET = "b".repeat(48);
const BODY = JSON.stringify({ eventType: "podcast_seo_changed", timestamp: 1_800_000_000_000, nonce: "n1" });

describe("operations webhook HMAC", () => {
  it("accepts a signature computed with the correct secret over the exact body", () => {
    const signature = signOperationsWebhookPayload(BODY, SECRET);
    expect(operationsWebhookSignatureMatches(BODY, SECRET, signature)).toBe(true);
  });

  it("rejects a signature computed with the wrong secret", () => {
    const signature = signOperationsWebhookPayload(BODY, OTHER_SECRET);
    expect(operationsWebhookSignatureMatches(BODY, SECRET, signature)).toBe(false);
  });

  it("rejects a signature computed over a different body (tampered payload)", () => {
    const signature = signOperationsWebhookPayload(BODY, SECRET);
    const tampered = BODY.replace("n1", "n2");
    expect(operationsWebhookSignatureMatches(tampered, SECRET, signature)).toBe(false);
  });

  it("rejects a missing signature", () => {
    expect(operationsWebhookSignatureMatches(BODY, SECRET, null)).toBe(false);
  });

  it("rejects a signature that isn't hex-SHA256-shaped, without ever reaching a length-mismatched comparison", () => {
    expect(operationsWebhookSignatureMatches(BODY, SECRET, "not-hex")).toBe(false);
    expect(operationsWebhookSignatureMatches(BODY, SECRET, "")).toBe(false);
    expect(operationsWebhookSignatureMatches(BODY, SECRET, "ab")).toBe(false);
  });

  it("is deterministic for the same body and secret", () => {
    expect(signOperationsWebhookPayload(BODY, SECRET)).toBe(signOperationsWebhookPayload(BODY, SECRET));
  });
});
