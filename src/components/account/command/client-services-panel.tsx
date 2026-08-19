"use client";

import { ArrowLeft, ArrowRight, Compass, LibraryBig, Link2, MapPin, Monitor, Newspaper, Package, Search, ShoppingBag, Wrench, Zap } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  filterChooserServices,
  servicesInFolder,
  type ChooserService,
  type ServiceChooserCatalog,
} from "../../../domain/client-portal/service-chooser";
import { useServiceChooser } from "../services/service-chooser-context";
import { HeaderPanel, HeaderPanelAnchor, HeaderPanelTrigger } from "./header-panel";
import { useHeaderPanels } from "./header-panels";

/**
 * The quick catalogue explorer.
 *
 * It used to sit on the cart icon, which was wrong once the rail gained a Store
 * entry and the cart became a real cart: one icon cannot mean both "browse" and
 * "what I have chosen". It kept its panel and behaviour and moved to its own
 * trigger, so nothing was lost — this is still the fastest way to jump straight
 * into a category from any page.
 *
 * Categories and investments are the real, RLS-scoped catalog the layout already
 * loads. Choosing one hands off to the existing detail route.
 */

function FolderIcon({ name }: { name: string }) {
  const key = name.trim().toLowerCase();

  if (key.includes("sprint")) return <Zap />;
  if (key.includes("gbp") || key.includes("google business")) return <MapPin />;
  if (key.includes("local")) return <Compass />;
  if (key.includes("ecommerce") || key.includes("e-commerce")) return <ShoppingBag />;
  if (key.includes("onpage") || key.includes("technical")) return <Wrench />;
  if (key.includes("website") || key.includes("web design")) return <Monitor />;
  if (key.includes("press")) return <Newspaper />;
  if (key.includes("backlink") || key.includes("link building")) return <Link2 />;

  return <Package />;
}
function ServiceRow({
  service,
  onChoose,
}: {
  service: ChooserService;
  onChoose: (service: ChooserService) => void;
}) {
  return (
    <li>
      <button type="button" className="chooser-row" onClick={() => onChoose(service)}>
        <span className="chooser-row-main">
          <strong>{service.name}</strong>
          <span>
            {service.folderName ? `${service.folderName} Â· ` : ""}
            {service.recurringLabel ?? service.priceLabel}
          </span>
        </span>
        <ArrowRight aria-hidden={true} />
      </button>
    </li>
  );
}

function ChooserBody({
  catalog,
  onChoose,
}: {
  catalog: ServiceChooserCatalog;
  onChoose: (service: ChooserService) => void;
}) {
  const [query, setQuery] = useState("");
  const [folderId, setFolderId] = useState<string | null>(null);

  const searching = query.trim().length > 0;

  const results = useMemo(() => {
    if (searching) return filterChooserServices(catalog.services, query);
    if (folderId) return servicesInFolder(catalog.services, folderId);
    return [];
  }, [catalog.services, searching, query, folderId]);

  const activeFolder = folderId
    ? catalog.folders.find((folder) => folder.id === folderId) ?? null
    : null;

  return (
    <div className="chooser">
      <header className="portal-header-panel-head">
        <div>
          <strong>Explore Wolf Forge Investments</strong>
          <span>Jump straight into a category.</span>
        </div>
      </header>

      <div className="chooser-search">
        <Search aria-hidden={true} />
        <input
          type="search"
          value={query}
          placeholder="Search investments..."
          aria-label="Search investments"
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {searching ? (
        <div className="chooser-panel" key="search">
          {results.length === 0 ? (
            <p className="chooser-empty">
              No investments match â€œ{query.trim()}â€. Try a shorter word.
            </p>
          ) : (
            <>
              <p className="chooser-caption" role="status">
                {results.length} {results.length === 1 ? "investment" : "investments"} found
              </p>
              <ul className="chooser-list">
                {results.map((service) => (
                  <ServiceRow key={service.id} service={service} onChoose={onChoose} />
                ))}
              </ul>
            </>
          )}
        </div>
      ) : activeFolder ? (
        <div className="chooser-panel" key={activeFolder.id}>
          <button type="button" className="chooser-back" onClick={() => setFolderId(null)}>
            <ArrowLeft aria-hidden={true} />
            All categories
          </button>

          <p className="chooser-caption">{activeFolder.name}</p>

          <ul className="chooser-list">
            {results.map((service) => (
              <ServiceRow key={service.id} service={service} onChoose={onChoose} />
            ))}
          </ul>
        </div>
      ) : (
        <div className="chooser-panel" key="categories">
          <p className="chooser-caption">Categories</p>

          {catalog.folders.length === 0 ? (
            <p className="chooser-empty">No investments are available to your account yet.</p>
          ) : (
            <ul className="chooser-grid">
              {catalog.folders.map((folder) => (
                <li key={folder.id}>
                  <button
                    type="button"
                    className="chooser-category"
                    onClick={() => setFolderId(folder.id)}
                  >
                    <span className="chooser-category-mark" aria-hidden="true">
                      <FolderIcon name={folder.name} />
                    </span>
                    <span className="chooser-category-copy">
                      <strong>{folder.name}</strong>
                      <span>
                        {folder.serviceCount}{" "}
                        {folder.serviceCount === 1 ? "investment" : "investments"}
                      </span>
                    </span>
                    <ArrowRight aria-hidden={true} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export function ClientServicesPanel() {
  const chooser = useServiceChooser();
  const panels = useHeaderPanels();
  const router = useRouter();

  if (!chooser?.available) return null;

  const { catalog } = chooser;
  const open = panels?.isOpen("services") ?? false;

  const choose = (service: ChooserService) => {
    panels?.close();
    router.push(service.href);
  };

  return (
    <HeaderPanelAnchor>
      <HeaderPanelTrigger panel="services" label="Explore investments">
        <LibraryBig aria-hidden={true} />
      </HeaderPanelTrigger>

      <HeaderPanel panel="services" label="Explore Wolf Forge Investments" width="wide">
        {/*
         * Mounted only while open, so its query and category reset each time
         * the panel opens without an effect watching the open flag.
         */}
        {open ? <ChooserBody catalog={catalog} onChoose={choose} /> : null}
      </HeaderPanel>
    </HeaderPanelAnchor>
  );
}
