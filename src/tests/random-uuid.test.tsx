/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  render,
  waitFor,
} from "@testing-library/react";
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  randomUuid,
} from "../lib/random-uuid";
import {
  TeamPresenceProvider,
} from "../components/team/team-presence-provider";

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

vi.mock("../app/actions/team-messages", () => ({
  touchTeamPresenceAction: vi.fn(async () => ({ ok: true, data: [] })),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("randomUuid", () => {
  it("uses crypto.randomUUID when the browser exposes it (secure context)", () => {
    const spy = vi
      .spyOn(crypto, "randomUUID")
      .mockReturnValue("11111111-1111-4111-8111-111111111111");

    expect(randomUuid()).toBe("11111111-1111-4111-8111-111111111111");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("falls back to crypto.getRandomValues when randomUUID is unavailable (LAN HTTP)", () => {
    const original = crypto.randomUUID;
    // Simulate a non-secure context: randomUUID is gone, getRandomValues stays.
    Object.defineProperty(crypto, "randomUUID", {
      value: undefined,
      configurable: true,
    });

    try {
      const id = randomUuid();
      expect(UUID_V4_PATTERN.test(id)).toBe(true);
    } finally {
      Object.defineProperty(crypto, "randomUUID", {
        value: original,
        configurable: true,
      });
    }
  });

  it("the getRandomValues fallback produces distinct ids", () => {
    const original = crypto.randomUUID;
    Object.defineProperty(crypto, "randomUUID", {
      value: undefined,
      configurable: true,
    });

    try {
      const ids = new Set(Array.from({ length: 50 }, () => randomUuid()));
      expect(ids.size).toBe(50);
    } finally {
      Object.defineProperty(crypto, "randomUUID", {
        value: original,
        configurable: true,
      });
    }
  });

  it("throws rather than silently using weak randomness when getRandomValues is also unavailable", () => {
    const originalRandomUUID = crypto.randomUUID;
    const originalGetRandomValues = crypto.getRandomValues;
    Object.defineProperty(crypto, "randomUUID", {
      value: undefined,
      configurable: true,
    });
    Object.defineProperty(crypto, "getRandomValues", {
      value: undefined,
      configurable: true,
    });

    try {
      expect(() => randomUuid()).toThrow();
    } finally {
      Object.defineProperty(crypto, "randomUUID", {
        value: originalRandomUUID,
        configurable: true,
      });
      Object.defineProperty(crypto, "getRandomValues", {
        value: originalGetRandomValues,
        configurable: true,
      });
    }
  });
});

describe("TeamPresenceProvider initialization", () => {
  it("still initializes and heartbeats with a valid-shaped connection id when randomUUID is unavailable", async () => {
    const original = crypto.randomUUID;
    Object.defineProperty(crypto, "randomUUID", {
      value: undefined,
      configurable: true,
    });

    const { touchTeamPresenceAction } = await import("../app/actions/team-messages");

    try {
      render(
        <TeamPresenceProvider enabled>
          <p>content</p>
        </TeamPresenceProvider>,
      );

      await waitFor(() => expect(touchTeamPresenceAction).toHaveBeenCalled());
      const [connectionId] = vi.mocked(touchTeamPresenceAction).mock.calls[0]!;
      expect(UUID_V4_PATTERN.test(connectionId)).toBe(true);
    } finally {
      Object.defineProperty(crypto, "randomUUID", {
        value: original,
        configurable: true,
      });
    }
  });
});
