/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IntegrationProviderCard } from "../components/settings/integration-provider-card";
import { SettingsNavigation, SETTINGS_NAV_ITEMS } from "../components/settings/settings-navigation";
import { toIntegrationConnectionViews } from "../domain/integrations/schema";

let pathname = "/settings/integrations";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
afterEach(cleanup);

describe("Settings navigation", () => {
  beforeEach(() => { pathname = "/settings/integrations"; });

  it("contains every foundation route and marks the current section accessibly", () => {
    render(<SettingsNavigation />);
    const navigation = screen.getByRole("navigation", { name: "Settings sections" });
    expect(SETTINGS_NAV_ITEMS.map(({ route }) => route)).toEqual([
      "/settings/general",
      "/settings/team",
      "/settings/billing",
      "/settings/integrations",
      "/settings/notifications",
      "/settings/security",
    ]);
    expect(within(navigation).getByRole("link", { name: "Integrations" })).toHaveAttribute("aria-current", "page");
  });
});

describe("Integration provider cards", () => {
  it.each(["Gmail", "Stripe", "PayPal"])("shows %s honestly disconnected without persisted metadata", (name) => {
    const connection = toIntegrationConnectionViews([]).find(({ provider }) => provider.name === name)!;
    render(<IntegrationProviderCard connection={connection} canManage />);
    expect(screen.getByRole("heading", { name })).toBeInTheDocument();
    expect(screen.getByText("Not connected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Connect/ })).toBeInTheDocument();
  });

  it("Connect opens configuration guidance but cannot manufacture Connected state", () => {
    const connection = toIntegrationConnectionViews([])[0]!;
    render(<IntegrationProviderCard connection={connection} canManage />);
    fireEvent.click(screen.getByRole("button", { name: /Connect/ }));
    expect(screen.getByRole("region", { name: "Gmail configuration" })).toBeInTheDocument();
    expect(screen.getByText(/does not create a connection record/i)).toBeInTheDocument();
    expect(screen.getByText("Not connected")).toBeInTheDocument();
    expect(screen.queryByText("Connected")).not.toBeInTheDocument();
  });

  it("shows Manage and the safe identity when a persisted row is connected", () => {
    const connection = toIntegrationConnectionViews([{
      id: "stripe-1",
      provider: "stripe",
      status: "connected",
      connected_account_id: "acct_server_only",
      connected_account_display: "Wolf Forge · Merchant 4242",
      connected_by_profile_id: "profile-1",
      connected_at: "2026-08-25T00:00:00.000Z",
      updated_at: "2026-08-25T00:00:00.000Z",
      last_synced_at: null,
      expires_at: null,
      granted_scopes: [],
    }]).find(({ provider }) => provider.id === "stripe")!;
    render(<IntegrationProviderCard connection={connection} canManage />);
    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(screen.getByText("Wolf Forge · Merchant 4242")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Manage/ })).toBeInTheDocument();
  });

  it("supports Disconnect only when a real backend action is supplied", () => {
    const connection = toIntegrationConnectionViews([{
      id: "gmail-1",
      provider: "gmail",
      status: "connected",
      connected_account_id: "acct_server_only",
      connected_account_display: "Merchant 4242",
      connected_by_profile_id: "profile-1",
      connected_at: "2026-08-25T00:00:00.000Z",
      updated_at: "2026-08-25T00:00:00.000Z",
      last_synced_at: null,
      expires_at: null,
      granted_scopes: [],
    }]).find(({ provider }) => provider.id === "gmail")!;

    render(<IntegrationProviderCard connection={connection} canManage actions={{
      configured: true,
      connectPath: "/settings/integrations/gmail/connect",
      verifyPath: "/settings/integrations/gmail/verify",
      disconnectPath: "/settings/integrations/gmail/disconnect",
    }} />);
    fireEvent.click(screen.getByRole("button", { name: /Manage/ }));
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeInTheDocument();
  });

  it("does not show administration actions without the persisted capability", () => {
    render(<IntegrationProviderCard connection={toIntegrationConnectionViews([])[0]!} canManage={false} />);
    expect(screen.getByText("View only")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Connect/ })).not.toBeInTheDocument();
  });
});
