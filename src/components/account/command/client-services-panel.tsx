"use client";

import { ArrowLeft, ArrowRight, LibraryBig, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { StoreFolderIcon } from "../store/store-folder-icon";
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
 * Categories and services are the real, RLS-scoped catalog the layout already
 * loads. Choosing one hands off to the existing detail route.
 */

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
          <strong>Explore Wolf Forge Services</strong>
          <span>Jump straight into a category.</span>
        </div>
      </header>

      <div className="chooser-search">
        <Search aria-hidden={true} />
        <input
          type="search"
          value={query}
          placeholder="Search services..."
          aria-label="Search services"
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {searching ? (
        <div className="chooser-panel" key="search">
          {results.length === 0 ? (
            <p className="chooser-empty">
              No services match â€œ{query.trim()}â€. Try a shorter word.
            </p>
          ) : (
            <>
              <p className="chooser-caption" role="status">
                {results.length} {results.length === 1 ? "service" : "services"} found
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
            <p className="chooser-empty">No services are available to your account yet.</p>
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
                      <StoreFolderIcon name={folder.name} />
                    </span>
                    <span className="chooser-category-copy">
                      <strong>{folder.name}</strong>
                      <span>
                        {folder.serviceCount}{" "}
                        {folder.serviceCount === 1 ? "service" : "services"}
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
      <HeaderPanelTrigger panel="services" label="Explore services">
        <LibraryBig aria-hidden={true} />
      </HeaderPanelTrigger>

      <HeaderPanel panel="services" label="Explore Wolf Forge Services" width="wide">
        {/*
         * Mounted only while open, so its query and category reset each time
         * the panel opens without an effect watching the open flag.
         */}
        {open ? <ChooserBody catalog={catalog} onChoose={choose} /> : null}
      </HeaderPanel>
    </HeaderPanelAnchor>
  );
}
