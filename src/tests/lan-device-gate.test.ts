import { describe, expect, it } from "vitest";
import { lanDeviceApproved } from "../lib/qa/lan-device-gate";

const DEV_LAN_ENV = {
  NODE_ENV: "development",
  VERCEL: undefined,
  LOCAL_QA_LAN_DEVICES: "192.168.1.95,192.168.1.23",
};

describe("lanDeviceApproved — applicability", () => {
  it.each([
    ["production env", { ...DEV_LAN_ENV, NODE_ENV: "production" }],
    ["on Vercel", { ...DEV_LAN_ENV, VERCEL: "1" }],
  ])("does not gate: %s", (_label, env) => {
    expect(lanDeviceApproved("203.0.113.9", env)).toBe(true);
  });

  it("never gates when no IP is available in a non-development environment", () => {
    expect(
      lanDeviceApproved(null, { ...DEV_LAN_ENV, NODE_ENV: "production" }),
    ).toBe(true);
  });
});

describe("lanDeviceApproved — loopback peer", () => {
  it.each(["127.0.0.1", "::1"])(
    "allows a loopback connection via %s whatever host it claims",
    (requestIp) => {
      expect(lanDeviceApproved(requestIp, DEV_LAN_ENV)).toBe(true);
    },
  );

  it("allows a loopback connection even without an allowlist (hosts-file QA aliases)", () => {
    expect(
      lanDeviceApproved("127.0.0.1", {
        NODE_ENV: "development",
        VERCEL: undefined,
        LOCAL_QA_LAN_DEVICES: undefined,
      }),
    ).toBe(true);
  });
});

describe("lanDeviceApproved — allowlist matching", () => {
  it("allows an exactly listed device IP", () => {
    expect(lanDeviceApproved("192.168.1.95", DEV_LAN_ENV)).toBe(true);
  });

  it("allows the first x-forwarded-for value when a chain is present", () => {
    expect(lanDeviceApproved("192.168.1.23, 10.0.0.1", DEV_LAN_ENV)).toBe(true);
  });

  it("allows a listed IP with surrounding whitespace trimmed", () => {
    expect(lanDeviceApproved(" 192.168.1.95 ", DEV_LAN_ENV)).toBe(true);
  });

  it("tolerates blank entries in the allowlist", () => {
    expect(
      lanDeviceApproved("192.168.1.23", {
        ...DEV_LAN_ENV,
        LOCAL_QA_LAN_DEVICES: " ,192.168.1.23, ",
      }),
    ).toBe(true);
  });
});

describe("lanDeviceApproved — fail closed", () => {
  it.each([
    ["unlisted IP", "203.0.113.9"],
    ["missing IP", null],
    ["blank IP", ""],
    ["whitespace-only IP", "   "],
    ["IP with port", "192.168.1.95:3000"],
    ["spoofed second-value chain entry", "203.0.113.9, 192.168.1.95"],
    ["malformed allowlist value matches nothing", "not-an-ip"],
  ])("denies: %s", (_label, requestIp) => {
    expect(lanDeviceApproved(requestIp, DEV_LAN_ENV)).toBe(false);
  });

  it("denies a non-loopback peer when no allowlist is configured even with a listed-looking IP", () => {
    for (const allowlist of [undefined, ""]) {
      expect(
        lanDeviceApproved("192.168.1.95", {
          NODE_ENV: "development",
          VERCEL: undefined,
          LOCAL_QA_LAN_DEVICES: allowlist,
        }),
      ).toBe(false);
    }
  });
});
