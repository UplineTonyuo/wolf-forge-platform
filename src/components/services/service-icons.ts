import {
  Anchor,
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
  FolderOpen,
  FileSignature,
  FileText,
  Filter,
  Flame,
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
  Map as MapIcon,
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
  Percent,
  PlayCircle,
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
  Zap,
  type LucideIcon,
} from "lucide-react";

export type CanonicalServiceIconInput = {
  id: string;
  name: string;
  folderId: string | null;
};

/**
 * Canonical Service icon vocabulary shared by the Services workspace and all
 * Service pickers. Rules are preserved from the approved Services experience;
 * callers supply catalogue order and never maintain their own icon map.
 */
export const SERVICE_ICON_RULES: Array<{
  keywords: string[];
  icons: LucideIcon[];
}> = [
  { keywords: ["lead generation"], icons: [Workflow, Network, Waypoints] },
  { keywords: ["lead gen"], icons: [Magnet, UserPlus, Filter] },
  { keywords: ["maps sprint"], icons: [MapPin, MapIcon, Navigation] },
  { keywords: ["seo sprint"], icons: [TrendingUp, ChartLine, Rocket] },
  { keywords: ["ai visibility", "aio"], icons: [Sparkles, BrainCircuit, Bot] },
  { keywords: ["website sprint"], icons: [PanelsTopLeft, MonitorSmartphone, LayoutTemplate] },
  { keywords: ["conversion"], icons: [MousePointerClick, Target, Percent] },
  { keywords: ["competitor"], icons: [Swords, Crosshair, Radar] },
  { keywords: ["franchise"], icons: [Boxes, Building2, Store] },
  { keywords: ["social"], icons: [UserRound, Users, Contact] },
  { keywords: ["entity loop", "infinite"], icons: [InfinityIcon, Repeat, RefreshCw] },
  { keywords: ["fortress"], icons: [ShieldCheck, Castle, Shield] },
  { keywords: ["edu"], icons: [GraduationCap, BookOpen, Award] },
  { keywords: ["foundation", "authority"], icons: [Landmark, Shield, Award] },
  { keywords: ["press release"], icons: [Newspaper, Megaphone, Rss, Radio, Globe, Signal] },
  { keywords: ["guest post"], icons: [PenLine, NotebookPen, FileSignature] },
  { keywords: ["pbn"], icons: [Network, Share2, GitBranch] },
  { keywords: ["citation"], icons: [MapPinned, MapPin, Navigation] },
  { keywords: ["cloud"], icons: [Cloud, CloudCog, Server] },
  { keywords: ["podcast"], icons: [Podcast, Mic, Headphones] },
  { keywords: ["youtube", "video"], icons: [Video, PlayCircle, Mic] },
  { keywords: ["syndication", "network"], icons: [Share2, Network, Waypoints] },
  { keywords: ["stack"], icons: [Layers, Blocks, Boxes, Server] },
  { keywords: ["review"], icons: [Star, ThumbsUp, Award] },
  { keywords: ["verification", "verified"], icons: [BadgeCheck, CircleCheckBig, ShieldCheck] },
  { keywords: ["gmb", "gbp", "google business", "google my business"], icons: [Store, MapPinned, Building2] },
  { keywords: ["maps", "google map"], icons: [MapIcon, MapPin, Navigation] },
  { keywords: ["local"], icons: [MapPin, MapPinned, Compass] },
  { keywords: ["keyword"], icons: [Search, ScanSearch, Key] },
  { keywords: ["schema"], icons: [Braces, Code2, FileCode2] },
  { keywords: ["technical", "onpage", "on-page"], icons: [Wrench, Settings2, FileCog] },
  { keywords: ["speed", "website optimization"], icons: [Gauge, Zap, Sliders, Rocket] },
  { keywords: ["woocommerce", "ecommerce", "e-commerce"], icons: [ShoppingCart, ShoppingBag, Store] },
  {
    keywords: ["web build", "web design", "website design", "web deal", "page web"],
    icons: [LayoutTemplate, PanelsTopLeft, MonitorSmartphone, Palette, Globe, Blocks],
  },
  { keywords: ["blueprint"], icons: [ClipboardList, FileText, Compass, Award, Gem] },
  { keywords: ["backlink", "link building", "links"], icons: [LinkIcon, Link2, Anchor, Waypoints] },
  { keywords: ["package"], icons: [Package, Boxes, Gift] },
  { keywords: ["system"], icons: [Workflow, Network, Boxes] },
  { keywords: ["seo"], icons: [TrendingUp, ChartLine, BarChart3, Search] },
  { keywords: ["website", "web"], icons: [Globe, PanelsTopLeft, MonitorSmartphone] },
];

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
  return name.toLowerCase().replace(/\s+/g, " ").trim();
}

function serviceNameHash(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function serviceIconCandidates(name: string): LucideIcon[] {
  const needle = normalizeServiceName(name);
  const candidates: LucideIcon[] = [];
  const rule = SERVICE_ICON_RULES.find((entry) =>
    entry.keywords.some((keyword) => needle.includes(keyword)),
  );

  if (rule) {
    for (const icon of rule.icons) {
      if (!candidates.includes(icon)) candidates.push(icon);
    }
  }

  const offset = serviceNameHash(needle) % SERVICE_ICON_FALLBACKS.length;
  for (let step = 0; step < SERVICE_ICON_FALLBACKS.length; step += 1) {
    const icon = SERVICE_ICON_FALLBACKS[(offset + step) % SERVICE_ICON_FALLBACKS.length];
    if (icon && !candidates.includes(icon)) candidates.push(icon);
  }

  return candidates;
}

/**
 * Allocate icons by stable Service id, independently within each canonical
 * folder. Pass Services in catalogue order so every consumer receives the
 * same icon even when its visible list is filtered.
 */
export function assignServiceIconsById(
  services: CanonicalServiceIconInput[],
): Map<string, LucideIcon> {
  const usedByFolder = new Map<string, Set<LucideIcon>>();
  const assigned = new Map<string, LucideIcon>();

  for (const service of services) {
    const folderKey = service.folderId ?? "";
    const used = usedByFolder.get(folderKey) ?? new Set<LucideIcon>();
    usedByFolder.set(folderKey, used);
    const candidates = serviceIconCandidates(service.name);
    const picked = candidates.find((icon) => !used.has(icon)) ?? candidates[0] ?? Sparkles;
    used.add(picked);
    assigned.set(service.id, picked);
  }

  return assigned;
}

/**
 * Folder icon vocabulary.
 *
 * `service_folders` has no icon column -- folders are created through the
 * Services UI with a name and nothing else -- so the icon is derived from the
 * folder's real name here rather than stored. Same shape and same family as
 * SERVICE_ICON_RULES above: ordered keyword rules, first match wins, so
 * "Local SEO" resolves to a location glyph instead of the generic SEO one.
 *
 * A folder that matches no rule lands on a fallback picked by a hash of its
 * name, so an unknown folder still gets a stable icon rather than a random one.
 */
export const FOLDER_ICON_RULES: Array<{
  keywords: string[];
  icon: LucideIcon;
}> = [
  { keywords: ["unfiled", "unsorted", "inbox", "no folder"], icon: FolderOpen },
  { keywords: ["sprint"], icon: TrendingUp },
  { keywords: ["backlink", "link building", "link"], icon: Link2 },
  { keywords: ["press release", "pr "], icon: Newspaper },
  { keywords: ["website design", "web design", "design", "web build"], icon: LayoutTemplate },
  { keywords: ["ecommerce", "e-commerce", "woocommerce", "shop"], icon: ShoppingBag },
  { keywords: ["gbp", "gmb", "google business"], icon: MapPinned },
  { keywords: ["local"], icon: Navigation },
  { keywords: ["technical", "onpage", "on-page", "on page"], icon: Code2 },
  { keywords: ["citation"], icon: MapPin },
  { keywords: ["content"], icon: FileText },
  { keywords: ["review"], icon: Star },
  { keywords: ["social"], icon: Users },
  { keywords: ["hosting", "server", "cloud"], icon: Server },
  { keywords: ["analytics", "reporting", "report"], icon: BarChart3 },
];

/** Where a folder whose name matches no rule lands. Stable, never random. */
const FOLDER_ICON_FALLBACKS: LucideIcon[] = [
  FolderOpen,
  Layers,
  Blocks,
  Boxes,
  Compass,
  Globe,
];

/** The icon for one service folder, chosen from its real name. */
export function folderIconFor(name: string): LucideIcon {
  const needle = normalizeServiceName(name);
  const rule = FOLDER_ICON_RULES.find((entry) =>
    entry.keywords.some((keyword) => needle.includes(keyword)),
  );

  if (rule) {
    return rule.icon;
  }

  return (
    FOLDER_ICON_FALLBACKS[serviceNameHash(needle) % FOLDER_ICON_FALLBACKS.length] ??
    FolderOpen
  );
}
