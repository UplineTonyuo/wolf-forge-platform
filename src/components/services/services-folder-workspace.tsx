"use client";

import {
  Anchor,
  ArrowRight,
  Award,
  BadgeCheck,
  BarChart3,
  Blocks,
  BookOpen,
  Bot,
  Boxes,
  Braces,
  BrainCircuit,
  Building2,
  Castle,
  ChartLine,
  CircleCheckBig,
  ClipboardList,
  Cloud,
  CloudCog,
  Code2,
  Compass,
  Contact,
  Crosshair,
  FileCode2,
  FileCog,
  FileSignature,
  FileText,
  Filter,
  Flame,
  FolderOpen,
  Gauge,
  Gem,
  Gift,
  GitBranch,
  Globe,
  GraduationCap,
  Headphones,
  Infinity as InfinityIcon,
  Key,
  Landmark,
  Layers,
  LayoutTemplate,
  Link2,
  Link as LinkIcon,
  Magnet,
  Map,
  MapPin,
  MapPinned,
  Megaphone,
  Mic,
  MonitorSmartphone,
  MousePointerClick,
  Navigation,
  Network,
  Newspaper,
  NotebookPen,
  Package,
  Palette,
  PanelsTopLeft,
  PenLine,
  Pencil,
  Percent,
  PlayCircle,
  Plus,
  Podcast,
  Radar,
  Radio,
  RefreshCw,
  Repeat,
  Rocket,
  Rss,
  ScanSearch,
  Search,
  Server,
  Settings2,
  Share2,
  Shield,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  Signal,
  Sliders,
  Sparkles,
  Star,
  Store,
  Swords,
  Target,
  ThumbsUp,
  TrendingUp,
  UserPlus,
  UserRound,
  Users,
  Video,
  Waypoints,
  Workflow,
  Wrench,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type AnimationEvent,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type TransitionEvent,
  type WheelEvent,
} from "react";
import {
  circularFolderDeskOffset,
  folderDeskDragDirection,
  folderDeskRenderable,
  wrapFolderDeskIndex,
} from "./services-folder-workspace-model";
import folderVisuals from "./services-folder-carousel.module.css";
import styles from "./services-folder-workspace.module.css";
import { serviceListSummaries } from "./service-list-summaries";

export type FolderDeskItem = {
  id: string;
  name: string;
  description: string | null;
  serviceCount: number;
  system?: boolean;
};

export type FolderDeskService = {
  id: string;
  name: string;
  folderId: string;
  priceLabel: string;
  createdLabel: string;
  summary: string;
  descriptionHtml: string;
  recurring: boolean;
  isActive: boolean;
  isPublic: boolean;
};

type PanelPhase =
  | "closed"
  | "opening"
  | "open"
  | "packing";

type DragState = {
  pointerId: number;
  startY: number;
  lastY: number;
  lastAt: number;
  velocityY: number;
};

type SlotVisual = {
  x: string;
  y: string;
  scale: number;
  rotate: string;
  opacity: number;
  zIndex: number;
};

const CLICK_SUPPRESS_DISTANCE = 7;

const SERVICE_SNIPPET_FALLBACK =
  "Service details available.";

/*
 * Frontend-only, deterministic name -> icon mapping.
 * Nothing here touches the service data model or Supabase: the
 * icon is derived from the normalized service name at render time.
 *
 * Each rule carries a primary icon plus ordered alternates. The
 * first rule that matches wins, and the allocator below hands out
 * the first alternate not already used by an earlier row in the
 * same folder, so families like the five press-release tiers each
 * get their own glyph instead of repeating one icon.
 *
 * Order runs specific -> generic; earlier rules win outright.
 */
const SERVICE_ICON_RULES: Array<{
  keywords: string[];
  icons: LucideIcon[];
}> = [
  // --- SEO Sprints ---------------------------------------
  {
    keywords: ["lead generation"],
    icons: [Workflow, Network, Waypoints],
  },
  {
    keywords: ["lead gen"],
    icons: [Magnet, UserPlus, Filter],
  },
  {
    keywords: ["maps sprint"],
    icons: [MapPin, Map, Navigation],
  },
  {
    keywords: ["seo sprint"],
    icons: [TrendingUp, ChartLine, Rocket],
  },
  {
    keywords: ["ai visibility", "aio"],
    icons: [Sparkles, BrainCircuit, Bot],
  },
  {
    keywords: ["website sprint"],
    icons: [
      PanelsTopLeft,
      MonitorSmartphone,
      LayoutTemplate,
    ],
  },
  {
    keywords: ["conversion"],
    icons: [MousePointerClick, Target, Percent],
  },
  {
    keywords: ["competitor"],
    icons: [Swords, Crosshair, Radar],
  },
  {
    keywords: ["franchise"],
    icons: [Boxes, Building2, Store],
  },

  // --- Authority / link building -------------------------
  {
    keywords: ["social"],
    icons: [UserRound, Users, Contact],
  },
  {
    keywords: ["entity loop", "infinite"],
    icons: [InfinityIcon, Repeat, RefreshCw],
  },
  {
    keywords: ["fortress"],
    icons: [ShieldCheck, Castle, Shield],
  },
  {
    keywords: ["edu"],
    icons: [GraduationCap, BookOpen, Award],
  },
  {
    keywords: ["foundation", "authority"],
    icons: [Landmark, Shield, Award],
  },
  {
    keywords: ["press release"],
    icons: [
      Newspaper,
      Megaphone,
      Rss,
      Radio,
      Globe,
      Signal,
    ],
  },
  {
    keywords: ["guest post"],
    icons: [PenLine, NotebookPen, FileSignature],
  },
  {
    keywords: ["pbn"],
    icons: [Network, Share2, GitBranch],
  },
  {
    keywords: ["citation"],
    icons: [MapPinned, MapPin, Navigation],
  },
  {
    keywords: ["cloud"],
    icons: [Cloud, CloudCog, Server],
  },
  {
    keywords: ["podcast"],
    icons: [Podcast, Mic, Headphones],
  },
  {
    keywords: ["youtube", "video"],
    icons: [Video, PlayCircle, Mic],
  },
  {
    keywords: ["syndication", "network"],
    icons: [Share2, Network, Waypoints],
  },
  {
    keywords: ["stack"],
    icons: [Layers, Blocks, Boxes, Server],
  },

  // --- Google Business Profile / local -------------------
  {
    keywords: ["review"],
    icons: [Star, ThumbsUp, Award],
  },
  {
    keywords: ["verification", "verified"],
    icons: [BadgeCheck, CircleCheckBig, ShieldCheck],
  },
  {
    keywords: [
      "gmb",
      "gbp",
      "google business",
      "google my business",
    ],
    icons: [Store, MapPinned, Building2],
  },
  {
    keywords: ["maps", "google map"],
    icons: [Map, MapPin, Navigation],
  },
  {
    keywords: ["local"],
    icons: [MapPin, MapPinned, Compass],
  },

  // --- On-page / technical / web -------------------------
  {
    keywords: ["keyword"],
    icons: [Search, ScanSearch, Key],
  },
  {
    keywords: ["schema"],
    icons: [Braces, Code2, FileCode2],
  },
  {
    keywords: ["technical", "onpage", "on-page"],
    icons: [Wrench, Settings2, FileCog],
  },
  {
    keywords: ["speed", "website optimization"],
    icons: [Gauge, Zap, Sliders, Rocket],
  },
  {
    keywords: [
      "woocommerce",
      "ecommerce",
      "e-commerce",
    ],
    icons: [ShoppingCart, ShoppingBag, Store],
  },
  {
    keywords: [
      "web build",
      "web design",
      "website design",
      "web deal",
      "page web",
    ],
    icons: [
      LayoutTemplate,
      PanelsTopLeft,
      MonitorSmartphone,
      Palette,
      Globe,
      Blocks,
    ],
  },
  {
    keywords: ["blueprint"],
    icons: [
      ClipboardList,
      FileText,
      Compass,
      Award,
      Gem,
    ],
  },

  // --- Generic families ----------------------------------
  {
    keywords: ["backlink", "link building", "links"],
    icons: [LinkIcon, Link2, Anchor, Waypoints],
  },
  {
    keywords: ["package"],
    icons: [Package, Boxes, Gift],
  },
  {
    keywords: ["system"],
    icons: [Workflow, Network, Boxes],
  },
  {
    keywords: ["seo"],
    icons: [TrendingUp, ChartLine, BarChart3, Search],
  },
  {
    keywords: ["website", "web"],
    icons: [Globe, PanelsTopLeft, MonitorSmartphone],
  },
];

/*
 * Rotated per service name so unmatched services never collapse
 * onto a single shared fallback glyph.
 */
const SERVICE_ICON_FALLBACKS: LucideIcon[] = [
  Sparkles,
  Gem,
  Award,
  Compass,
  Flame,
  Rocket,
  Target,
  Boxes,
  Star,
  Zap,
  Package,
  BadgeCheck,
];

function normalizeServiceName(name: string) {
  return name
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function serviceNameHash(value: string) {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash =
      (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash;
}

function serviceIconCandidates(
  name: string,
): LucideIcon[] {
  const needle = normalizeServiceName(name);
  const candidates: LucideIcon[] = [];

  const rule = SERVICE_ICON_RULES.find((entry) =>
    entry.keywords.some((keyword) =>
      needle.includes(keyword),
    ),
  );

  if (rule) {
    for (const icon of rule.icons) {
      if (!candidates.includes(icon)) {
        candidates.push(icon);
      }
    }
  }

  const offset =
    serviceNameHash(needle) %
    SERVICE_ICON_FALLBACKS.length;

  for (
    let step = 0;
    step < SERVICE_ICON_FALLBACKS.length;
    step += 1
  ) {
    const icon =
      SERVICE_ICON_FALLBACKS[
        (offset + step) %
          SERVICE_ICON_FALLBACKS.length
      ];

    if (icon && !candidates.includes(icon)) {
      candidates.push(icon);
    }
  }

  return candidates;
}

function assignServiceIcons(
  list: FolderDeskService[],
): LucideIcon[] {
  const used = new Set<LucideIcon>();

  return list.map((service) => {
    const candidates = serviceIconCandidates(
      service.name,
    );

    const picked =
      candidates.find(
        (icon) => !used.has(icon),
      ) ??
      candidates[0] ??
      Sparkles;

    used.add(picked);

    return picked;
  });
}

function serviceSnippet(
  service: FolderDeskService,
) {
  const curated =
    serviceListSummaries[service.id];

  if (curated) {
    return curated;
  }

  /*
   * New services that are not yet in the curated catalog should not dump
   * their full marketing copy into the list. Keep the row quiet until a
   * proper one-sentence summary is curated for that service.
   */
  return SERVICE_SNIPPET_FALLBACK;
}

function countLabel(count: number) {
  return `${count} ${count === 1 ? "service" : "services"}`;
}

function slotVisual(offset: number): SlotVisual {
  if (offset === 0) {
    return {
      x: "7%",
      y: "0%",
      scale: 1,
      rotate: "0deg",
      opacity: 1,
      zIndex: 30,
    };
  }

  if (offset === 1) {
    return {
      x: "-12%",
      y: "-72%",
      scale: 0.88,
      rotate: "-3deg",
      opacity: 0.48,
      zIndex: 11,
    };
  }

  if (offset === -1) {
    return {
      x: "-8%",
      y: "76%",
      scale: 0.86,
      rotate: "3.4deg",
      opacity: 0.40,
      zIndex: 9,
    };
  }

  if (offset >= 2) {
    return {
      x: "-23%",
      y: "-138%",
      scale: 0.76,
      rotate: "-6deg",
      opacity: 0,
      zIndex: 2,
    };
  }

  return {
    x: "-21%",
    y: "145%",
    scale: 0.74,
    rotate: "6deg",
    opacity: 0,
    zIndex: 2,
  };
}

function FolderArtwork({
  folder,
  center,
  opened,
  panelBusy,
  onToggleOpen,
}: {
  folder: FolderDeskItem;
  center: boolean;
  opened: boolean;
  panelBusy: boolean;
  onToggleOpen: () => void;
}) {
  const longName = folder.name.length > 24;

  return (
    <span className={folderVisuals.folderObject}>
      <span
        className={folderVisuals.folderBack}
        aria-hidden="true"
      />

      <span className={folderVisuals.folderTab}>
        <span className={folderVisuals.tabLabel}>
          {folder.system
            ? "SYSTEM FOLDER"
            : "SERVICE FOLDER"}
        </span>
      </span>

      <span className={folderVisuals.folderFront}>
        <span className={folderVisuals.paperLabel}>
          <span
            className={[
              folderVisuals.folderName,
              longName
                ? folderVisuals.longName
                : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {folder.name}
          </span>

          {folder.description ? (
            <span className={folderVisuals.description}>
              {folder.description}
            </span>
          ) : null}
        </span>

        <span className={folderVisuals.folderMeta}>
          <span className={folderVisuals.count}>
            {countLabel(folder.serviceCount)}
          </span>

          {center ? (
            <button
              type="button"
              className={styles.openFolderButton}
              onPointerDown={(event) => {
                event.stopPropagation();
              }}
              onClick={(event) => {
                event.stopPropagation();
                onToggleOpen();
              }}
              disabled={panelBusy}
              aria-expanded={opened}
            >
              {opened ? (
                <Package aria-hidden="true" />
              ) : (
                <FolderOpen aria-hidden="true" />
              )}

              <span>
                {opened
                  ? "Pack services"
                  : "Open services"}
              </span>

              <ArrowRight aria-hidden="true" />
            </button>
          ) : (
            <span className={styles.deckHint}>
              {folder.serviceCount === 1
                ? "1 service"
                : `${folder.serviceCount} services`}
            </span>
          )}
        </span>
      </span>
    </span>
  );
}

function ServiceDetailModal({
  service,
  closing,
  onClose,
  onClosed,
}: {
  service: FolderDeskService;
  closing: boolean;
  onClose: () => void;
  onClosed: () => void;
}) {
  return (
    <div
      className={[
        styles.modalLayer,
        closing ? styles.modalClosing : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <button
        type="button"
        className={styles.modalBackdrop}
        aria-label={`Close ${service.name}`}
        onClick={onClose}
      />

      <section
        className={styles.serviceDialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="service-desk-dialog-title"
        onAnimationEnd={(event) => {
          if (
            closing &&
            event.target === event.currentTarget
          ) {
            onClosed();
          }
        }}
      >
        <header className={styles.dialogHeader}>
          <div>
            <span>Service details</span>
            <h2 id="service-desk-dialog-title">
              {service.name}
            </h2>
          </div>

          <button
            type="button"
            className={styles.dialogClose}
            onClick={onClose}
            aria-label={`Close ${service.name}`}
          >
            <X aria-hidden="true" />
          </button>
        </header>

        <div className={styles.dialogFacts}>
          <div>
            <span>Price</span>
            <strong>{service.priceLabel}</strong>
          </div>

          <div>
            <span>Created</span>
            <strong>{service.createdLabel}</strong>
          </div>

          <div>
            <span>Billing</span>
            <strong>
              {service.recurring
                ? "Recurring"
                : "One-time"}
            </strong>
          </div>
        </div>

        <div className={styles.dialogFlags}>
          <span>
            {service.isActive
              ? "Active"
              : "Inactive"}
          </span>

          <span>
            {service.isPublic
              ? "Public"
              : "Internal"}
          </span>
        </div>

        <div className={styles.dialogDescription}>
          {service.descriptionHtml ? (
            <div
              dangerouslySetInnerHTML={{
                __html: service.descriptionHtml,
              }}
            />
          ) : (
            <p>
              No service description has been added yet.
            </p>
          )}
        </div>

        <footer className={styles.dialogFooter}>
          <Link
            className={styles.dialogCreateProject}
            href={`/orders/new?serviceId=${encodeURIComponent(
              service.id,
            )}`}
          >
            Create project
          </Link>
          <Link
            href={`/services/${service.id}`}
            className={styles.dialogEdit}
          >
            <Pencil aria-hidden="true" />
            Edit service
          </Link>
        </footer>
      </section>
    </div>
  );
}

export function ServicesFolderWorkspace({
  folders,
  services,
  initialFolderId,
}: {
  folders: FolderDeskItem[];
  services: FolderDeskService[];
  initialFolderId: string | null;
}) {
  const requestedIndex = initialFolderId
    ? folders.findIndex(
        (folder) =>
          folder.id === initialFolderId,
      )
    : -1;

  const [activeIndex, setActiveIndex] =
    useState(
      requestedIndex >= 0
        ? requestedIndex
        : 0,
    );

  const [
    moveDirection,
    setMoveDirection,
  ] = useState<-1 | 1 | null>(null);

  const [
    pendingDirection,
    setPendingDirection,
  ] = useState<-1 | 1 | null>(null);

  const [
    panelPhase,
    setPanelPhase,
  ] = useState<PanelPhase>("closed");

  const [filter, setFilter] =
    useState("");

  const [
    selectedService,
    setSelectedService,
  ] = useState<FolderDeskService | null>(
    null,
  );

  const [
    modalClosing,
    setModalClosing,
  ] = useState(false);

  const [dragging, setDragging] =
    useState(false);

  const [dragY, setDragY] =
    useState(0);

  const viewportRef =
    useRef<HTMLDivElement>(null);

  const dragRef =
    useRef<DragState | null>(null);

  const maxMovedRef = useRef(0);

  const suppressClickRef =
    useRef(false);

  const suppressTimerRef =
    useRef<number | null>(null);

  const activeFolder =
    folders[activeIndex] ?? null;

  const opened =
    panelPhase === "opening" ||
    panelPhase === "open";

  const panelBusy =
    panelPhase === "opening" ||
    panelPhase === "packing" ||
    moveDirection !== null;

  const activeServices = useMemo(() => {
    if (!activeFolder) return [];

    const needle =
      filter.trim().toLowerCase();

    return services.filter((service) => {
      if (
        service.folderId !==
        activeFolder.id
      ) {
        return false;
      }

      if (!needle) return true;

      return (
        service.name
          .toLowerCase()
          .includes(needle) ||
        service.summary
          .toLowerCase()
          .includes(needle)
      );
    });
  }, [
    activeFolder,
    filter,
    services,
  ]);

  /*
   * Icons are allocated across the visible list so two rows in the
   * same folder do not land on the same glyph.
   */
  const serviceIcons = useMemo(
    () => assignServiceIcons(activeServices),
    [activeServices],
  );

  useEffect(() => {
    if (!selectedService) return;

    const previousOverflow =
      document.body.style.overflow;

    document.body.style.overflow =
      "hidden";

    function handleEscape(
      event: globalThis.KeyboardEvent,
    ) {
      if (event.key === "Escape") {
        setModalClosing(true);
      }
    }

    window.addEventListener(
      "keydown",
      handleEscape,
    );

    return () => {
      document.body.style.overflow =
        previousOverflow;

      window.removeEventListener(
        "keydown",
        handleEscape,
      );
    };
  }, [selectedService]);

  useEffect(() => {
    return () => {
      if (
        suppressTimerRef.current !== null
      ) {
        window.clearTimeout(
          suppressTimerRef.current,
        );
      }
    };
  }, []);

  function beginMove(
    direction: -1 | 1,
  ) {
    if (
      folders.length <= 1 ||
      moveDirection !== null
    ) {
      return;
    }

    setFilter("");
    setMoveDirection(direction);
  }

  function requestMove(
    direction: -1 | 1,
  ) {
    if (moveDirection !== null) {
      return;
    }

    if (panelPhase !== "closed") {
      setPanelPhase("closed");
      setPendingDirection(null);
    }

    beginMove(direction);
  }

  function finishDeckMove() {
    if (moveDirection === null) {
      return;
    }

    setActiveIndex((current) =>
      wrapFolderDeskIndex(
        current + moveDirection,
        folders.length,
      ),
    );

    setMoveDirection(null);
    setPendingDirection(null);
    setPanelPhase("closed");
    setFilter("");
  }

  function toggleFolderContents() {
    if (!activeFolder || moveDirection !== null) {
      return;
    }

    setFilter("");

    setPanelPhase((current) =>
      current === "open" ? "closed" : "open",
    );
  }

  function finishPanelAnimation(
    event: AnimationEvent<HTMLDivElement>,
  ) {
    if (
      event.target !== event.currentTarget
    ) {
      return;
    }

    if (panelPhase === "opening") {
      setPanelPhase("open");
      return;
    }

    if (panelPhase === "packing") {
      setPanelPhase("closed");

      if (pendingDirection !== null) {
        const direction =
          pendingDirection;

        setPendingDirection(null);
        beginMove(direction);
      }
    }
  }

  function handleWheel(
    event: WheelEvent<HTMLDivElement>,
  ) {
    if (
      folders.length <= 1 ||
      panelBusy
    ) {
      return;
    }

    const delta =
      Math.abs(event.deltaY) >=
      Math.abs(event.deltaX)
        ? event.deltaY
        : event.deltaX;

    if (Math.abs(delta) < 8) {
      return;
    }

    event.preventDefault();

    /*
     * Physical desk direction:
     * wheel UP / forward => upper NEXT folder enters center.
     * wheel DOWN / backward => lower PREVIOUS folder enters center.
     */
    requestMove(
      delta < 0 ? 1 : -1,
    );
  }

  function handleKeyboard(
    event: KeyboardEvent<HTMLDivElement>,
  ) {
    if (panelBusy) return;

    if (
      event.key === "ArrowUp" ||
      event.key === "PageUp"
    ) {
      event.preventDefault();
      requestMove(1);
      return;
    }

    if (
      event.key === "ArrowDown" ||
      event.key === "PageDown"
    ) {
      event.preventDefault();
      requestMove(-1);
    }
  }

  function handlePointerDown(
    event: PointerEvent<HTMLDivElement>,
  ) {
    if (
      folders.length <= 1 ||
      event.button !== 0 ||
      panelBusy
    ) {
      return;
    }

    const now = performance.now();

    dragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      lastY: event.clientY,
      lastAt: now,
      velocityY: 0,
    };

    maxMovedRef.current = 0;
    suppressClickRef.current = false;

    setDragging(true);

    event.currentTarget.setPointerCapture(
      event.pointerId,
    );
  }

  function handlePointerMove(
    event: PointerEvent<HTMLDivElement>,
  ) {
    const state = dragRef.current;

    if (
      !state ||
      state.pointerId !==
        event.pointerId
    ) {
      return;
    }

    const now = performance.now();

    const elapsed = Math.max(
      1,
      now - state.lastAt,
    );

    const frameDistance =
      event.clientY - state.lastY;

    const totalDistance =
      event.clientY - state.startY;

    state.velocityY =
      frameDistance / elapsed;

    state.lastY = event.clientY;
    state.lastAt = now;

    maxMovedRef.current = Math.max(
      maxMovedRef.current,
      Math.abs(totalDistance),
    );

    setDragY(totalDistance);
  }

  function finishPointer(
    event: PointerEvent<HTMLDivElement>,
  ) {
    const state = dragRef.current;

    if (
      !state ||
      state.pointerId !==
        event.pointerId
    ) {
      return;
    }

    const direction =
      folderDeskDragDirection(
        dragY,
        state.velocityY,
        viewportRef.current
          ?.clientHeight ?? 480,
      );

    const shouldSuppress =
      maxMovedRef.current >=
      CLICK_SUPPRESS_DISTANCE;

    suppressClickRef.current =
      shouldSuppress;

    if (
      suppressTimerRef.current !== null
    ) {
      window.clearTimeout(
        suppressTimerRef.current,
      );
    }

    if (shouldSuppress) {
      suppressTimerRef.current =
        window.setTimeout(() => {
          suppressClickRef.current =
            false;

          suppressTimerRef.current =
            null;
        }, 140);
    }

    dragRef.current = null;
    setDragging(false);
    setDragY(0);

    if (
      event.currentTarget.hasPointerCapture(
        event.pointerId,
      )
    ) {
      event.currentTarget.releasePointerCapture(
        event.pointerId,
      );
    }

    if (direction !== 0) {
      requestMove(direction);
    }
  }

  function cancelPointer(
    event: PointerEvent<HTMLDivElement>,
  ) {
    const state = dragRef.current;

    if (
      !state ||
      state.pointerId !==
        event.pointerId
    ) {
      return;
    }

    dragRef.current = null;
    maxMovedRef.current = 0;
    suppressClickRef.current = false;

    setDragging(false);
    setDragY(0);

    if (
      event.currentTarget.hasPointerCapture(
        event.pointerId,
      )
    ) {
      event.currentTarget.releasePointerCapture(
        event.pointerId,
      );
    }
  }

  if (!activeFolder) {
    return (
      <div className={styles.noFolders}>
        Create a service folder to begin organizing the catalog.
      </div>
    );
  }

  return (
    <>
      <div className={styles.workspace}>
        <section
          className={styles.deckColumn}
          aria-label="Service folders"
        >
          

          <div
            ref={viewportRef}
            className={[
              styles.deckViewport,
              dragging
                ? styles.dragging
                : "",
            ]
              .filter(Boolean)
              .join(" ")}
            tabIndex={0}
            role="region"
            aria-roledescription="vertical folder carousel"
            aria-label="Service folders"
            onWheel={handleWheel}
            onKeyDown={handleKeyboard}
            onPointerDown={
              handlePointerDown
            }
            onPointerMove={
              handlePointerMove
            }
            onPointerUp={finishPointer}
            onPointerCancel={
              cancelPointer
            }
          >
            {folders.map(
              (folder, index) => {
                const baseOffset =
                  circularFolderDeskOffset(
                    index,
                    activeIndex,
                    folders.length,
                  );

                const direction =
                  moveDirection ?? 0;

                if (
                  !folderDeskRenderable(
                    baseOffset,
                    direction,
                  )
                ) {
                  return null;
                }

                const targetOffset =
                  baseOffset - direction;

                const visual =
                  slotVisual(
                    targetOffset,
                  );

                const isCenter =
                  baseOffset === 0 &&
                  moveDirection === null;

                const outgoing =
                  baseOffset === 0 &&
                  moveDirection !== null;

                const incoming =
                  moveDirection !== null &&
                  baseOffset ===
                    moveDirection;

                const dragInfluence =
                  moveDirection === null
                    ? Math.max(
                        -44,
                        Math.min(
                          44,
                          dragY * 0.17,
                        ),
                      )
                    : 0;

                const style = {
                  "--desk-x": visual.x,
                  "--desk-y": visual.y,
                  "--desk-scale":
                    String(visual.scale),
                  "--desk-rotate":
                    visual.rotate,
                  "--desk-opacity":
                    String(visual.opacity),
                  "--desk-z":
                    String(visual.zIndex),
                  "--desk-drag":
                    `${dragInfluence}px`,
                } as CSSProperties;

                return (
                  <div
                    key={folder.id}
                    className={[
                      styles.folderSlot,
                      isCenter
                        ? folderVisuals.centerFolder
                        : folderVisuals.sideFolder,
                      outgoing
                        ? styles.outgoingFolder
                        : "",
                      incoming
                        ? styles.incomingFolder
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    style={style}
                    onTransitionEnd={(
                      event: TransitionEvent<HTMLDivElement>,
                    ) => {
                      if (
                        outgoing &&
                        event.target ===
                          event.currentTarget &&
                        event.propertyName ===
                          "transform"
                      ) {
                        finishDeckMove();
                      }
                    }}
                    aria-hidden={
                      Math.abs(
                        targetOffset,
                      ) > 1
                    }
                  >
                    <FolderArtwork
                      folder={folder}
                      center={isCenter}
                      opened={opened}
                      panelBusy={panelBusy}
                      onToggleOpen={
                        toggleFolderContents
                      }
                    />

                    {!isCenter &&
                    Math.abs(baseOffset) ===
                      1 &&
                    moveDirection === null ? (
                      <button
                        type="button"
                        className={
                          styles.sideFolderHit
                        }
                        onClick={() => {
                          if (
                            suppressClickRef.current
                          ) {
                            suppressClickRef.current =
                              false;
                            return;
                          }

                          requestMove(
                            baseOffset > 0
                              ? 1
                              : -1,
                          );
                        }}
                        aria-label={
                          baseOffset > 0
                            ? `Bring next folder ${folder.name} down into the center`
                            : `Bring previous folder ${folder.name} up into the center`
                        }
                      />
                    ) : null}
                  </div>
                );
              },
            )}
          </div>
        </section>

        <section
          className={styles.contentsColumn}
          aria-label="Service folder contents"
        >
          <header className={styles.servicePanelHeader}>
            <h2>{activeFolder.name}</h2>

            <div className={styles.panelActions}>
              <span className={styles.panelCount}>
                {countLabel(activeFolder.serviceCount)}
              </span>

              <Link
                className={styles.newServiceLink}
                href={`/services/new?folder=${encodeURIComponent(
                  activeFolder.id,
                )}`}
              >
                <Plus size={14} aria-hidden="true" />
                New Service
              </Link>
            </div>
          </header>
          

          {panelPhase === "closed" ? (
            <div className={styles.closedContents} aria-hidden="true" />
          ) : (
            <div
              className={[
                styles.contentsBody,
                panelPhase === "opening"
                  ? styles.contentsOpening
                  : "",
                panelPhase === "packing"
                  ? styles.contentsPacking
                  : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onAnimationEnd={
                finishPanelAnimation
              }
            >
              <label className={styles.serviceFilter}>
                <Search aria-hidden="true" />
                <input
                  value={filter}
                  onChange={(event) =>
                    setFilter(
                      event.currentTarget
                        .value,
                    )
                  }
                  placeholder="Filter services in this folder"
                  aria-label="Filter services in this folder"
                />
              </label>

              {activeServices.length === 0 ? (
                <div className={styles.emptyContents}>
                  <strong>
                    {filter
                      ? "No matching services."
                      : "No services in this folder yet."}
                  </strong>

                  <p>
                    {filter
                      ? "Try a different service name."
                      : "Create the first service for this folder when it is ready."}
                  </p>

                  {!filter ? (
                    <Link
                      className={styles.emptyNewService}
                      href={`/services/new?folder=${encodeURIComponent(
                        activeFolder.id,
                      )}`}
                    >
                      <Plus size={14} aria-hidden="true" />
                      New Service
                    </Link>
                  ) : null}
                </div>
              ) : (
                <ul className={styles.serviceList}>
                  {activeServices.map(
                    (service, index) => {
                    const ServiceIcon =
                      serviceIcons[index] ??
                      Sparkles;

                    return (
                      <li
                        key={service.id}
                        style={
                          {
                            "--service-index":
                              String(
                                Math.min(
                                  index,
                                  12,
                                ),
                              ),
                          } as CSSProperties
                        }
                      >
                        <button
                          type="button"
                          className={
                            styles.serviceRow
                          }
                          onClick={() => {
                            setModalClosing(
                              false,
                            );

                            setSelectedService(
                              service,
                            );
                          }}
                        >
                          <span
                            className={
                              styles.serviceIcon
                            }
                            aria-hidden="true"
                          >
                            <ServiceIcon />
                          </span>

                          <span
                            className={
                              styles.serviceCopy
                            }
                          >
                            <strong>
                              {
                                service.name
                              }
                            </strong>

                            <small>
                              {serviceSnippet(
                                service,
                              )}
                            </small>
                          </span>

                          <span
                            className={
                              styles.servicePrice
                            }
                          >
                            {
                              service.priceLabel
                            }
                          </span>
                        </button>
                      </li>
                    );
                    },
                  )}
                </ul>
              )}
            </div>
          )}
        </section>
      </div>

      {selectedService ? (
        <ServiceDetailModal
          service={selectedService}
          closing={modalClosing}
          onClose={() => setModalClosing(true)}
          onClosed={() => {
            setSelectedService(null);
            setModalClosing(false);
          }}
        />
      ) : null}
    </>
  );
}