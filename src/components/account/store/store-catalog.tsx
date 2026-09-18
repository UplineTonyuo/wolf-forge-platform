"use client";

import { ArrowRight, Check, ChevronDown, Search, X } from "lucide-react";
import type { CartItem } from "../../../domain/client-portal/cart";
import { AddToCartButton } from "../cart/add-to-cart-button";
import { StoreFolderIcon } from "./store-folder-icon";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  StoreCatalog,
  StoreFolderView,
  StoreServiceView,
} from "../../../domain/services/store-projections";
import styles from "./store-catalog.module.css";

/**
 * Browse-only. There is still no cart, no checkout and no order action: the
 * client portal has no project-creation surface, and the database refuses
 * client-initiated projects. Every call to action routes into the existing
 * detail page, which in turn routes into the existing support ticket flow.
 *
 * Category selection stayed on the same `?folder=` contract it always had, but
 * it now resolves in the browser against the catalogue the server already sent,
 * so switching is instant instead of a round trip. The URL is kept honest with
 * the native history API (supported by the App Router) so folder deep links
 * from the dashboard chips and from a service's back link keep working, and the
 * server still resolves `?folder=` on a cold load.
 *
 * Navigation is a compact control bar, not a rail: the current selection (with
 * its real count) and a single Explore/Change trigger, with search on its own
 * row underneath so the two no longer fight for horizontal space. The trigger
 * opens a responsive category deck in normal flow — every real category is a
 * tile there, so nothing is hidden behind a horizontal scroll.
 */

/**
 * The cart row for an investment, built from exactly what the card already
 * shows, so the two can never disagree about price or cadence.
 */
function toCartItem(service: StoreServiceView, categoryName: string | null): CartItem {
  return {
    id: service.id,
    name: service.name,
    priceLabel: service.recurringLabel ?? service.priceLabel,
    amount: service.amount,
    currency: service.currency,
    recurring: service.recurring,
    cadence: service.cadence,
    categoryName,
    summary: service.summary,
  };
}

/** Sentinel for the bucket of services whose folder is missing or archived. */
const ungroupedId = "__ungrouped";

/** Beyond this the stagger stops accruing, so a long list never crawls in. */
const maxStaggerIndex = 11;

type Category = {
  id: string | null;
  name: string;
  description: string | null;
  count: number;
};

type Section = {
  key: string;
  name: string;
  description: string | null;
  services: StoreServiceView[];
};

function servicesFor(catalog: StoreCatalog, folderId: string | null): StoreServiceView[] {
  if (folderId === ungroupedId) return catalog.ungrouped;
  if (folderId) return catalog.folders.find((folder) => folder.id === folderId)?.services ?? [];
  return [...catalog.folders.flatMap((folder) => folder.services), ...catalog.ungrouped];
}

function matches(service: StoreServiceView, needle: string): boolean {
  return (
    service.name.toLowerCase().includes(needle) || service.summary.toLowerCase().includes(needle)
  );
}

/**
 * Splits "$97 / month" so the cadence can sit quietly beside the amount.
 * Anything else — "$97 every 3 months", a plain one-time price — is left whole.
 */
function splitPrice(label: string): { amount: string; cadence: string | null } {
  const separator = label.indexOf(" / ");
  if (separator === -1) return { amount: label, cadence: null };
  return { amount: label.slice(0, separator), cadence: label.slice(separator + 1) };
}

function ServiceCard({
  service,
  index,
  categoryName,
}: {
  service: StoreServiceView;
  index: number;
  categoryName: string | null;
}) {
  const { amount, cadence } = splitPrice(service.recurringLabel ?? service.priceLabel);

  return (
    <li
      className={styles.card}
      style={{ "--i": Math.min(index, maxStaggerIndex) } as React.CSSProperties}
    >
      <article className={styles.cardLink}>
        <span className={styles.cardRule} aria-hidden={true} />

        <AddToCartButton
          className={styles.cardAdd}
          item={toCartItem(service, categoryName)}
        />

        {service.imageUrl ? (
          // Captured catalog artwork can use any validated HTTP(S) host, so it
          // stays direct-source while the existing CSS owns both dimensions.
          <span className={styles.cardArt}>
            <Image
              src={service.imageUrl}
              alt=""
              width={0}
              height={0}
              loading="lazy"
              decoding="auto"
              unoptimized
            />
          </span>
        ) : null}

        <span className={styles.cardTag} data-recurring={service.recurring}>
          {service.recurring ? "Recurring" : "One-time"}
        </span>

        <h3 className={styles.cardTitle}>
          <Link href={`/account/store/${service.id}`} title={service.name}>
            {service.name}
          </Link>
        </h3>
        {service.summary ? <span className={styles.cardSummary}>{service.summary}</span> : null}

        <span className={styles.cardFoot}>
          <span className={styles.cardPrice}>
            {amount}
            {cadence ? <em>{cadence}</em> : null}
          </span>
          <span className={styles.cta}>
            <span className={styles.ctaLabel} aria-hidden={true}>
              <span>View details</span>
            </span>
            <span className={styles.ctaDot}>
              <ArrowRight aria-hidden={true} />
            </span>
          </span>
        </span>
      </article>
    </li>
  );
}

/**
 * The catalogue's highest-tier engagement, shown once on the unfiltered view.
 * "Flagship" is read straight off the price the card already displays, so it is
 * an ordering of real data rather than an editorial claim about the service.
 */
function Spotlight({ service, categoryName }: { service: StoreServiceView; categoryName: string | null }) {
  const { amount, cadence } = splitPrice(service.recurringLabel ?? service.priceLabel);

  return (
    <article className={styles.spotlight}>
      <div className={styles.spotlightCopy}>
        <span className={styles.spotlightTag}>Flagship</span>
        <h2>
          <Link href={`/account/store/${service.id}`}>{service.name}</Link>
        </h2>
        {service.summary ? <p>{service.summary}</p> : null}
        <div className={styles.spotlightMeta}>
          <span>{categoryName ?? "Wolf Forge catalogue"}</span>
          <span aria-hidden={true} />
          <span>{service.recurring ? "Recurring engagement" : "One-time engagement"}</span>
        </div>
      </div>

      <div className={styles.spotlightAside}>
        <span className={styles.spotlightPrice}>
          {amount}
          {cadence ? <em>{cadence}</em> : null}
        </span>
        <div className={styles.spotlightActions}>
          <span className={styles.spotlightAddSlot}>
            <AddToCartButton size="lg" item={toCartItem(service, categoryName)} />
          </span>
          <Link className={styles.spotlightCta} href={`/account/store/${service.id}`}>
            Explore this investment
            <ArrowRight aria-hidden={true} />
          </Link>
        </div>
      </div>
    </article>
  );
}

export function StoreCatalogView({
  catalog,
  activeFolderId = null,
}: {
  catalog: StoreCatalog;
  /** Resolved server-side from `?folder=`; an unknown id already fell back to null. */
  activeFolderId?: string | null;
}) {
  const [folderId, setFolderId] = useState<string | null>(activeFolderId);
  const [query, setQuery] = useState("");

  /** Whether the category deck is expanded. The toggle owns exactly this bit. */
  const [deckOpen, setDeckOpen] = useState(false);
  /*
   * Increments on every open so the deck's tile list remounts and replays its
   * staggered entrance. On close the list stays mounted (only the container
   * animates away), so the reverse is smooth rather than a snap.
   */
  const [deckGeneration, setDeckGeneration] = useState(0);
  const deckToggleRef = useRef<HTMLButtonElement | null>(null);

  const toggleDeck = useCallback(() => {
    if (deckOpen) {
      setDeckOpen(false);
    } else {
      setDeckGeneration((generation) => generation + 1);
      setDeckOpen(true);
    }
  }, [deckOpen]);

  // Escape closes the deck and hands focus back to its trigger.
  useEffect(() => {
    if (!deckOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDeckOpen(false);
        deckToggleRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [deckOpen]);

  const categories = useMemo<Category[]>(() => {
    const entries: Category[] = [
      {
        id: null,
        name: "All investments",
        description: null,
        count: catalog.serviceCount,
      },
      ...catalog.folders.map((folder) => ({
        id: folder.id,
        name: folder.name,
        description: folder.description,
        count: folder.services.length,
      })),
    ];

    if (catalog.ungrouped.length > 0) {
      entries.push({
        id: ungroupedId,
        name: "Other investments",
        description: null,
        count: catalog.ungrouped.length,
      });
    }

    return entries;
  }, [catalog]);

  const active = categories.find((entry) => entry.id === folderId) ?? categories[0]!;

  /*
   * Resolved per service rather than per section, so a search result — which is
   * flattened across every folder — still carries the right category into the
   * cart row.
   */
  const folderNameById = useMemo(
    () => new Map(catalog.folders.map((folder) => [folder.id, folder.name])),
    [catalog.folders],
  );
  const needle = query.trim().toLowerCase();
  const searching = needle.length > 0;

  const sections = useMemo<Section[]>(() => {
    const scoped = servicesFor(catalog, folderId);

    if (searching) {
      const results = scoped.filter((service) => matches(service, needle));
      return results.length > 0
        ? [{ key: "results", name: "Results", description: null, services: results }]
        : [];
    }

    // Unfiltered, the Store keeps its grouped shape so the catalogue's own
    // structure stays visible. A single category flattens to one grid.
    if (folderId === null) {
      const grouped: Section[] = catalog.folders.map((folder: StoreFolderView) => ({
        key: folder.id,
        name: folder.name,
        description: folder.description,
        services: folder.services,
      }));

      if (catalog.ungrouped.length > 0) {
        grouped.push({
          key: ungroupedId,
          name: "Other investments",
          description: null,
          services: catalog.ungrouped,
        });
      }

      return grouped;
    }

    return [{ key: active.id ?? "all", name: active.name, description: active.description, services: scoped }];
  }, [active, catalog, folderId, needle, searching]);

  const resultCount = useMemo(
    () => sections.reduce((total, section) => total + section.services.length, 0),
    [sections],
  );

  /**
   * The flagship only fronts the unfiltered view. Inside a single category it
   * would sit a few rows above its own duplicate, which reads as a mistake.
   */
  const spotlight = useMemo(() => {
    if (searching || folderId !== null || catalog.serviceCount < 4) return null;

    const all = servicesFor(catalog, null);
    const top = all.reduce<StoreServiceView | null>(
      (best, service) => (best === null || service.amount > best.amount ? service : best),
      null,
    );
    if (!top) return null;

    const categoryName = catalog.folders.find((folder) => folder.id === top.folderId)?.name ?? null;
    return { service: top, categoryName };
  }, [catalog, folderId, searching]);

  const selectCategory = useCallback((next: string | null) => {
    setFolderId(next);
    setQuery("");

    // Selection collapses the deck. Focus returns to the trigger, which now
    // reads "Change category" against the selection the client just made.
    setDeckOpen(false);
    deckToggleRef.current?.focus();

    // Keeps folder deep links shareable without re-rendering the route on the
    // server. Guarded because this also runs in jsdom and during hydration.
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (next === null || next === ungroupedId) url.searchParams.delete("folder");
    else url.searchParams.set("folder", next);
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  }, []);

  /*
   * Recomputing the live region synchronously with `query` made a screen reader
   * narrate a count for every character typed. Only the settled result is spoken.
   */
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setAnnouncement(
        searching
          ? `${resultCount} ${resultCount === 1 ? "investment matches" : "investments match"} ${query.trim()}.`
          : `Showing ${resultCount} ${resultCount === 1 ? "investment" : "investments"}.`,
      );
    }, 400);

    return () => window.clearTimeout(timer);
  }, [query, resultCount, searching]);

  const deckLabel = deckOpen
    ? "Close categories"
    : folderId === null
      ? "Explore all categories"
      : "Change category";
  const deckShortLabel = deckOpen ? "Close" : folderId === null ? "Categories" : "Change";

  const heading = folderId === null ? "Store" : active.name;
  const supporting =
    folderId === null
      ? "Every investment Wolf Forge offers, organised the way we deliver it. Browse now, add what fits, and talk to us when you are ready."
      : (active.description ??
        `${active.count} ${active.count === 1 ? "investment" : "investments"} in this category.`);

  if (catalog.serviceCount === 0) {
    return (
      <div className={styles.store}>
        <header className={styles.masthead}>
          <div className={styles.mastheadCopy}>
            <span className={styles.eyebrow}>Wolf Forge catalogue</span>
            <h1>Store</h1>
            <p>
              The Store is being prepared. Your Wolf Forge team can walk you through what is
              available in the meantime.
            </p>
          </div>
        </header>
      </div>
    );
  }

  return (
    <div className={styles.store}>
      <header className={styles.masthead}>
        {/* Keyed so the heading re-enters when the category changes. */}
        <div className={`${styles.mastheadCopy} ${styles.headSwap}`} key={folderId ?? "all"}>
          <span className={styles.eyebrow}>
            {folderId === null ? "Wolf Forge catalogue" : "Store"}
          </span>
          <h1>{heading}</h1>
          <p>{supporting}</p>
        </div>

        <dl className={styles.index}>
          <div>
            <dt>Investments</dt>
            <dd>{catalog.serviceCount}</dd>
          </div>
          <div>
            <dt>Categories</dt>
            <dd>{catalog.folders.length}</dd>
          </div>
        </dl>
      </header>

      <div className={styles.controls}>
        <div className={styles.controlRow}>
          <span
            className={styles.activeChip}
            aria-label={`${active.name}, ${active.count} ${active.count === 1 ? "investment" : "investments"}`}
          >
            <span className={styles.activeChipIcon} aria-hidden={true}>
              <StoreFolderIcon name={active.name} />
            </span>
            <span className={styles.activeChipName}>{active.name}</span>
            <span className={styles.activeChipCount}>{active.count}</span>
          </span>

          <button
            type="button"
            ref={deckToggleRef}
            className={styles.deckToggle}
            aria-expanded={deckOpen}
            aria-controls="store-category-deck"
            /*
             * The control is named by what it does at every width; only the
             * visible reading shortens on a phone, where "Explore all
             * categories" would push the row onto a second line.
             */
            aria-label={deckLabel}
            onClick={toggleDeck}
          >
            <span className={styles.deckToggleFull} aria-hidden={true}>
              {deckLabel}
            </span>
            <span className={styles.deckToggleShort} aria-hidden={true}>
              {deckShortLabel}
            </span>
            <ChevronDown aria-hidden={true} />
          </button>
        </div>

        <div className={styles.search}>
          <Search aria-hidden={true} />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search investments..."
            aria-label="Filter investments by name"
          />
          {query ? (
            <button
              type="button"
              className={styles.searchClear}
              onClick={() => setQuery("")}
              aria-label="Clear filter"
            >
              <X aria-hidden={true} />
            </button>
          ) : null}
        </div>
      </div>

      {/*
       * The category deck expands in normal flow below the sticky control bar.
       * Every real category is a tile here, so nothing is hidden behind a
       * horizontal scroll. The list is keyed by generation so its staggered
       * entrance replays on each open; the closed deck is inert so its tiles
       * leave both the tab order and the accessibility tree.
       */}
      <div id="store-category-deck" className={styles.deck} data-open={deckOpen}>
        <div className={styles.deckBody}>
          <div className={styles.deckInner} inert={!deckOpen}>
            {/*
             * Mobile-only picker header: on the phone-width list layout the
             * sticky chip + toggle row above would otherwise stay visible as a
             * second, competing "Close" while the deck is open. This is the
             * deck's own header instead — CSS shows it in place of that row
             * only at the mobile breakpoint while the deck is open.
             */}
            <div className={styles.deckMobileHeader}>
              <span>Categories</span>
              <button
                type="button"
                className={styles.deckMobileClose}
                onClick={toggleDeck}
                aria-label="Close categories"
              >
                <X aria-hidden={true} />
              </button>
            </div>
            <ul className={styles.deckGrid} aria-label="Store categories" key={deckGeneration}>
              {categories.map((category, index) => (
                <li key={category.id ?? "all"}>
                  <button
                    type="button"
                    className={styles.tile}
                    aria-pressed={category.id === folderId}
                    onClick={() => selectCategory(category.id)}
                    style={{ "--deck-i": Math.min(index, maxStaggerIndex) } as React.CSSProperties}
                  >
                    <span className={styles.tileMark} aria-hidden={true}>
                      <StoreFolderIcon name={category.name} />
                    </span>
                    <span className={styles.tileCopy}>
                      <strong>{category.name}</strong>
                      <span className={styles.tileCount}>
                        {category.count} {category.count === 1 ? "investment" : "investments"}
                      </span>
                    </span>
                    {category.id === folderId ? (
                      <Check className={styles.tileCheck} aria-hidden={true} />
                    ) : (
                      <ArrowRight className={styles.tileArrow} aria-hidden={true} />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {spotlight ? (
        <Spotlight service={spotlight.service} categoryName={spotlight.categoryName} />
      ) : null}

      <p className="sr-only" role="status">
        {announcement}
      </p>

      {sections.length === 0 ? (
        <div className={styles.empty}>
          <p>
            Nothing in <strong>{active.name}</strong> matches “{query.trim()}”. Try a shorter word,
            or widen the search to the whole catalogue.
          </p>
          <button type="button" className={styles.emptyAction} onClick={() => setQuery("")}>
            Clear filter
          </button>
        </div>
      ) : (
        // Keyed on the category so the stagger replays on a switch, but not on
        // every keystroke while filtering.
        <div className={styles.sections} key={folderId ?? "all"}>
          {sections.map((section, sectionIndex) => (
            <section className={styles.section} key={section.key} aria-labelledby={`store-section-${sectionIndex}`}>
              <header className={styles.sectionHead}>
                <h2 id={`store-section-${sectionIndex}`}>{section.name}</h2>
                <span className={styles.sectionCount}>
                  {section.services.length} {section.services.length === 1 ? "investment" : "investments"}
                </span>
              </header>

              {section.description ? <p className={styles.sectionNote}>{section.description}</p> : null}

              <ul className={styles.grid}>
                {section.services.map((service, index) => (
                  <ServiceCard
                    key={service.id}
                    service={service}
                    index={index}
                    categoryName={folderNameById.get(service.folderId ?? "") ?? null}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
