import { sanitizeServiceDescription } from "../../lib/service-description-html";
import { summarizeServiceDescription } from "./service-summary";
import type { ServiceFolderRow, ServiceRow } from "../../lib/supabase/database-rows";

/**
 * Store is the client-facing presentation of the internal Services catalog. It
 * reads the same tables through the same repository; this module decides what a
 * client account is shown, and nothing here is a security boundary.
 *
 * The authority is RLS: services_authenticated_select_active restricts a client
 * session to is_active and is_public and not archived, and
 * service_folders_authenticated_select_active to non-archived folders. The
 * predicate below re-states that rule so a row handed in from an internal
 * session (a test, a future internal preview) cannot leak into a client view
 * model by accident.
 */
export function isClientVisibleService(service: ServiceRow): boolean {
  return service.is_active && service.is_public && service.archived_at === null;
}

/** Fields deliberately dropped: assigned_to_profile_id, deadline_*, require_client_profile. */
export type StoreServiceView = {
  id: string;
  name: string;
  folderId: string | null;
  priceLabel: string;
  /**
   * The number behind the displayed label, exposed only so the client can order
   * the catalogue (highest-tier first) without re-deriving it from a formatted
   * string. Recurring services report the recurring amount, matching what the
   * card actually shows. No new column is revealed: `price` is already public
   * through `priceLabel`.
   */
  amount: number;
  /** ISO code behind `priceLabel`, so a total can be formatted without it. */
  currency: string;
  recurring: boolean;
  /**
   * Billing rhythm, resolved from the same interval columns `recurringLabel`
   * reads. The cart needs it to keep one-time, monthly and annual money in
   * separate totals rather than adding them into one meaningless number.
   */
  cadence: StoreCadence;
  recurringLabel: string | null;
  imageUrl: string | null;
  /** Sanitized through the existing shared service-description boundary. */
  descriptionHtml: string;
  /**
   * Curated preview line for cards and the spotlight. Derived from the real
   * description, never the raw first 190 characters, so an inclusion-only
   * service reads as a sentence instead of a wall of check marks. The full
   * original stays in `descriptionHtml` for the detail page.
   */
  summary: string;
};

/** "other" covers weekly, quarterly and anything else the catalogue carries. */
export type StoreCadence = "one-time" | "monthly" | "annual" | "other";

export type StoreFolderView = {
  id: string;
  name: string;
  description: string | null;
  services: StoreServiceView[];
};

export type StoreCatalog = {
  folders: StoreFolderView[];
  /** Visible services whose folder is missing or archived. Never a nav entry. */
  ungrouped: StoreServiceView[];
  serviceCount: number;
};

export function formatStoreAmount(amount: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * Billing interval units, in both spellings the catalogue actually contains.
 *
 * services_recurring_interval_unit_valid permits 'D', 'W', 'M' and 'Y', and the
 * imported Wayfront catalogue stores exactly those. Only the long names were
 * recognised here, so the one real recurring service in the catalogue was
 * priced as "$97 recurring" rather than "$97 / month" and its money landed in
 * the cart's "Other recurring" bucket instead of "Monthly recurring". Both
 * spellings resolve now; the long names are kept because existing view models
 * and fixtures use them.
 */
const intervalUnitLabels: Record<string, string> = {
  d: "day",
  w: "week",
  m: "month",
  y: "year",
  day: "day",
  week: "week",
  month: "month",
  year: "year",
};

/** Normalises either spelling to the long unit name, or null when unrecognised. */
function intervalUnitName(unit: string | null): string | null {
  return intervalUnitLabels[(unit ?? "month").toLowerCase()] ?? null;
}

/**
 * The pricing columns a price label is derived from.
 *
 * Structural rather than `ServiceRow` so the internal Investment Intent read
 * model -- which returns these same columns flattened out of an RPC rather than
 * a whole service row -- prices an investment through exactly this code. Two
 * implementations of "what does this cost" would eventually disagree, and the
 * one place that must never disagree is a number shown to a client and the same
 * number shown to the person about to call them about it.
 */
export type StorePricingFields = Pick<
  ServiceRow,
  | "price"
  | "currency"
  | "recurring"
  | "recurring_price"
  | "recurring_interval_length"
  | "recurring_interval_unit"
>;

export function storeRecurringLabel(service: StorePricingFields): string | null {
  if (!service.recurring) return null;

  const amount = service.recurring_price ?? service.price;
  const price = formatStoreAmount(amount, service.currency);
  const length = service.recurring_interval_length ?? 1;
  const unit = intervalUnitName(service.recurring_interval_unit);

  if (!unit) return `${price} recurring`;
  return length === 1 ? `${price} / ${unit}` : `${price} every ${length} ${unit}s`;
}

export function storeCadence(service: StorePricingFields): StoreCadence {
  if (!service.recurring) return "one-time";

  const unit = intervalUnitName(service.recurring_interval_unit);
  const length = service.recurring_interval_length ?? 1;

  if (unit === "month" && length === 1) return "monthly";
  if (unit === "year" && length === 1) return "annual";
  // A twelve-month plan is an annual one however the catalogue spelled it.
  if (unit === "month" && length === 12) return "annual";
  return "other";
}

export function toStoreServiceView(service: ServiceRow): StoreServiceView {
  return {
    id: service.id,
    name: service.name,
    folderId: service.folder_id,
    priceLabel: formatStoreAmount(service.price, service.currency),
    amount: service.recurring ? service.recurring_price ?? service.price : service.price,
    currency: service.currency,
    recurring: service.recurring,
    cadence: storeCadence(service),
    recurringLabel: storeRecurringLabel(service),
    imageUrl: service.image_url,
    descriptionHtml: sanitizeServiceDescription(service.description),
    summary: summarizeServiceDescription(service.description),
  };
}

/**
 * Franchise in a Box is William's engagement, so every primary call to action
 * that shows it names him rather than "your team". Matched on the captured
 * service name because that is the only stable handle the catalogue gives us —
 * the row carries no owner column, and inventing one would be a schema change
 * for a copy rule.
 */
export function isFranchiseInABoxService(name: string): boolean {
  return name.toLowerCase().includes("franchise in a box");
}

/** The contact label for a primary CTA showing this service. */
export function storeContactLabel(name: string): string {
  return isFranchiseInABoxService(name) ? "Talk to William" : "Talk to your team";
}

/**
 * Groups the client-visible catalog. A folder that resolves to zero visible
 * services is dropped entirely, so an unlaunched category name never appears in
 * the portal even though service_folders has no is_public column of its own.
 */
export function composeStoreCatalog(
  folders: ServiceFolderRow[],
  services: ServiceRow[],
): StoreCatalog {
  const visible = services.filter(isClientVisibleService);
  const byFolder = new Map<string, StoreServiceView[]>();
  const ungrouped: StoreServiceView[] = [];
  const folderIds = new Set(folders.filter((folder) => folder.archived_at === null).map((folder) => folder.id));

  for (const service of visible) {
    const view = toStoreServiceView(service);
    if (!view.folderId || !folderIds.has(view.folderId)) {
      ungrouped.push(view);
      continue;
    }

    const existing = byFolder.get(view.folderId);
    if (existing) existing.push(view);
    else byFolder.set(view.folderId, [view]);
  }

  const grouped = folders
    .filter((folder) => folder.archived_at === null && (byFolder.get(folder.id)?.length ?? 0) > 0)
    .map((folder) => ({
      id: folder.id,
      name: folder.name,
      description: folder.description,
      services: byFolder.get(folder.id) ?? [],
    }));

  return { folders: grouped, ungrouped, serviceCount: visible.length };
}

/** Sidebar entries. Derived from the same catalog the page renders, never a literal list. */
export type StoreFolderLink = {
  id: string;
  name: string;
  serviceCount: number;
};

export function toStoreFolderLinks(catalog: StoreCatalog): StoreFolderLink[] {
  return catalog.folders.map((folder) => ({
    id: folder.id,
    name: folder.name,
    serviceCount: folder.services.length,
  }));
}

/**
 * Resolves the requested folder id against the catalog the caller may actually
 * see. An unknown or non-visible id falls back to the whole Store rather than
 * erroring, so a stale link never becomes an existence oracle.
 */
export function selectStoreFolder(
  catalog: StoreCatalog,
  folderId: string | null | undefined,
): StoreFolderView | null {
  if (!folderId) return null;
  return catalog.folders.find((folder) => folder.id === folderId) ?? null;
}
