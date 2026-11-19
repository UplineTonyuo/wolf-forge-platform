// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import OrderHistoryPage from "../app/(internal)/orders/[orderId]/history/page";

const listTimeline = vi.hoisted(() => vi.fn());
vi.mock("../lib/supabase/next-server", () => ({
  getInternalContext: async () => ({ services: {
    activity: { listTimeline }, catalog: { listAssignees: async () => [{ id: "staff", displayName: "Current staff" }] },
  } }),
}));
describe("order activity provenance", () => {
  it("orders imported ties by numeric source ID and keeps native actor attribution and position", async () => {
    const event = { entity_type: "order", created_at: "2021-01-06T00:00:00Z", actor_profile_id: "staff" };
    const source = { source: "spp", source_actor_label: "Archived actor", source_actor_id: "42", source_time_precision: "minute" };
    listTimeline.mockResolvedValue([
      { ...event, id: "a", action: "order.spp_history", summary: "Earlier source event", metadata: { ...source, source_event_id: "9" } },
      { ...event, id: "b", action: "order.assigned", summary: "Native event", metadata: source },
      { ...event, id: "c", action: "order.spp_history", summary: "Later source event", metadata: { ...source, source_event_id: "11" } },
    ]);
    const html = renderToStaticMarkup(await OrderHistoryPage({ params: Promise.resolve({ orderId: "order" }) }));
    const doc = new DOMParser().parseFromString(html, "text/html");
    expect([...doc.querySelectorAll("li p")].map((p) => p.textContent)).toEqual([
      "Archived actor Later source event", "Current staff Native event", "Archived actor Earlier source event",
    ]);
  });
});
