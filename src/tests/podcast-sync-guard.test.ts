import { beforeEach, describe, expect, it } from "vitest";
import {
  resetPodcastSyncGuardForTests,
  shouldTriggerPodcastSyncEffect,
} from "../lib/security/podcast-sync-guard";

beforeEach(() => {
  resetPodcastSyncGuardForTests();
});

describe("shouldTriggerPodcastSyncEffect", () => {
  it("triggers the effect for a fresh nonce", () => {
    expect(shouldTriggerPodcastSyncEffect("nonce-1", 1_000)).toBe(true);
  });

  it("does not trigger again for an exact nonce replay, even much later", () => {
    expect(shouldTriggerPodcastSyncEffect("nonce-1", 1_000)).toBe(true);
    expect(shouldTriggerPodcastSyncEffect("nonce-1", 1_000)).toBe(false);
    expect(shouldTriggerPodcastSyncEffect("nonce-1", 100_000)).toBe(false);
  });

  it("collapses a burst of distinct-nonce events arriving within the debounce window into one effect", () => {
    expect(shouldTriggerPodcastSyncEffect("burst-1", 1_000)).toBe(true);
    expect(shouldTriggerPodcastSyncEffect("burst-2", 1_100)).toBe(false);
    expect(shouldTriggerPodcastSyncEffect("burst-3", 1_400)).toBe(false);
  });

  it("triggers again once the minimum effect interval has passed", () => {
    expect(shouldTriggerPodcastSyncEffect("first", 1_000)).toBe(true);
    expect(shouldTriggerPodcastSyncEffect("second", 1_600)).toBe(true);
  });

  it("allows the same nonce to be reused once its replay window has fully expired", () => {
    expect(shouldTriggerPodcastSyncEffect("a", 1_000)).toBe(true);
    /* Still within the 5-minute nonce TTL — a genuine replay, refused. */
    expect(shouldTriggerPodcastSyncEffect("a", 200_000)).toBe(false);
    /* Past the TTL and past the minimum effect interval — treated as new. */
    expect(shouldTriggerPodcastSyncEffect("a", 310_000)).toBe(true);
  });
});
