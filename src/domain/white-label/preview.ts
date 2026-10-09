import type { NavigationItemId } from "../../components/shell/nav-registry";

/*
 * White Label builder, Phase 1: an unsaved, local-only preview. Nothing here
 * is persisted or read by any authorization path; the server-side module
 * gate (app_require_module_access / permission_modules) stays authoritative.
 */

export type WhiteLabelModule = {
  id: NavigationItemId;
  label: string;
  description: string;
  /** Modules whose records this one cannot exist without (NOT NULL FKs). */
  requires: NavigationItemId[];
};

/*
 * Configurable Tenant CRM modules. Excluded on purpose:
 * - dashboard, clients, team, team_supervision, settings: the workspace core
 *   (every operational record references a Company; Team and Settings run the
 *   workspace itself).
 * - todo (Operations): Wolf Forge-only (D-285), never a White Label module.
 */
export const WHITE_LABEL_MODULES: WhiteLabelModule[] = [
  { id: "services", label: "Services", description: "Catalogue of what the Tenant sells.", requires: [] },
  { id: "projects", label: "Projects", description: "Client delivery work. Every Project is for a Service.", requires: ["services"] },
  { id: "tickets", label: "Tickets", description: "Client support requests and conversations.", requires: [] },
  { id: "reporting", label: "Reporting", description: "Client reports sent from the workspace.", requires: [] },
  { id: "invoices", label: "Invoices", description: "Billing documents and payments.", requires: [] },
  { id: "subscriptions", label: "Subscriptions", description: "Recurring Service plans. Every Subscription is for a Service.", requires: ["services"] },
  { id: "coupons", label: "Coupons", description: "Discounts that apply to Services.", requires: ["services"] },
  { id: "investment_intent", label: "Investment Intent", description: "Client buying interest in Services.", requires: ["services"] },
  { id: "forms", label: "Forms", description: "Public, intake and onboarding Forms.", requires: [] },
];

const CORE_MODULES: NavigationItemId[] = ["dashboard", "clients", "team", "team_supervision", "settings"];

export type WhiteLabelPreviewState = {
  displayName: string;
  primaryColor: string;
  accentColor: string;
  modules: Record<string, boolean>;
};

export const SYNTHETIC_PREVIEW_STATE: WhiteLabelPreviewState = {
  displayName: "Northwind Studio",
  primaryColor: "#000d51",
  accentColor: "#a8832e",
  modules: Object.fromEntries(WHITE_LABEL_MODULES.map((entry) => [entry.id, true])),
};

/** A module is available only when it is selected and everything it requires is. */
export function moduleAvailable(modules: Record<string, boolean>, id: string): boolean {
  const entry = WHITE_LABEL_MODULES.find((candidate) => candidate.id === id);
  if (!entry || modules[id] !== true) return false;
  return entry.requires.every((required) => moduleAvailable(modules, required));
}

/** The module map the real shell navigation (navigationForModules) consumes. */
export function previewNavigationModules(modules: Record<string, boolean>): Record<string, boolean> {
  const result: Record<string, boolean> = Object.fromEntries(CORE_MODULES.map((id) => [id, true]));
  for (const entry of WHITE_LABEL_MODULES) result[entry.id] = moduleAvailable(modules, entry.id);
  result.todo = false;
  return result;
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function normalizeHexColor(value: string, fallback: string): string {
  return HEX_COLOR.test(value) ? value.toLowerCase() : fallback;
}

/** WCAG relative-luminance contrast against white, for the brand-on-white warning. */
export function contrastWithWhite(hex: string): number {
  const channel = (offset: number) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  return 1.05 / (luminance + 0.05);
}
