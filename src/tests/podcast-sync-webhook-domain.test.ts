import { describe, expect, it } from "vitest";
import {
  PODCAST_SYNC_EVENT_TYPE,
  isPodcastSyncTimestampFresh,
  isPodcastWorkflowTabName,
  isRecognizedPodcastSyncEventType,
  podcastSyncWebhookShapeSchema,
} from "../domain/operations/podcast-sync-webhook";

describe("podcastSyncWebhookShapeSchema", () => {
  const valid = { eventType: PODCAST_SYNC_EVENT_TYPE, timestamp: Date.now(), nonce: "a-valid-nonce-1" };

  it("accepts a well-formed payload", () => {
    expect(podcastSyncWebhookShapeSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects a payload missing a required field", () => {
    const withoutNonce: Record<string, unknown> = { ...valid };
    delete withoutNonce.nonce;
    expect(podcastSyncWebhookShapeSchema.safeParse(withoutNonce).success).toBe(false);
  });

  it("rejects a non-numeric timestamp", () => {
    expect(
      podcastSyncWebhookShapeSchema.safeParse({ ...valid, timestamp: "not-a-number" }).success,
    ).toBe(false);
  });

  it("rejects a nonce that is too short to be a meaningful dedupe token", () => {
    expect(podcastSyncWebhookShapeSchema.safeParse({ ...valid, nonce: "x" }).success).toBe(false);
  });

  it("rejects an entirely malformed payload (array, string, null)", () => {
    expect(podcastSyncWebhookShapeSchema.safeParse([1, 2, 3]).success).toBe(false);
    expect(podcastSyncWebhookShapeSchema.safeParse("not an object").success).toBe(false);
    expect(podcastSyncWebhookShapeSchema.safeParse(null).success).toBe(false);
  });

  it("never has a field for client names, emails, credentials, or sheet contents", () => {
    const shape = Object.keys(podcastSyncWebhookShapeSchema.shape);
    expect(shape.sort()).toEqual(["eventType", "nonce", "timestamp"]);
  });
});

describe("isRecognizedPodcastSyncEventType", () => {
  it("recognizes the one supported event type", () => {
    expect(isRecognizedPodcastSyncEventType("podcast_seo_changed")).toBe(true);
  });

  it("rejects an irrelevant or unrecognized event type", () => {
    expect(isRecognizedPodcastSyncEventType("podcast_seo_deleted")).toBe(false);
    expect(isRecognizedPodcastSyncEventType("team_conversation_changed")).toBe(false);
    expect(isRecognizedPodcastSyncEventType("")).toBe(false);
  });
});

describe("isPodcastSyncTimestampFresh", () => {
  const now = 1_800_000_000_000;

  it("accepts a timestamp from right now", () => {
    expect(isPodcastSyncTimestampFresh(now, now)).toBe(true);
  });

  it("accepts a timestamp just under the 5-minute staleness ceiling", () => {
    expect(isPodcastSyncTimestampFresh(now - 4 * 60 * 1000, now)).toBe(true);
  });

  it("rejects a timestamp older than 5 minutes", () => {
    expect(isPodcastSyncTimestampFresh(now - 6 * 60 * 1000, now)).toBe(false);
  });

  it("accepts a small amount of forward clock skew", () => {
    expect(isPodcastSyncTimestampFresh(now + 10_000, now)).toBe(true);
  });

  it("rejects a timestamp far in the future", () => {
    expect(isPodcastSyncTimestampFresh(now + 60_000, now)).toBe(false);
  });
});

describe("isPodcastWorkflowTabName", () => {
  it("matches tabs meant for this workflow", () => {
    expect(isPodcastWorkflowTabName("PODCAST AUGUST 2026")).toBe(true);
    expect(isPodcastWorkflowTabName("podcast department (may)")).toBe(true);
  });

  it("does not match an unrelated department tab", () => {
    expect(isPodcastWorkflowTabName("CLIENT ONBOARDING")).toBe(false);
    expect(isPodcastWorkflowTabName("Ad Copy Requests")).toBe(false);
  });
});
