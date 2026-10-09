import { ArrowLeftRight, Beef, Boxes, CalendarDays, ClipboardList, ClipboardCheck, FolderOpen, ListChecks, Contact, Download, FileBarChart2, FileText, Hammer, Home, MessageSquare, PackageCheck, Package, Plug, Receipt, RefreshCw, Repeat, RotateCcw, Settings, ShoppingCart, Sparkles, Tags, TrendingUp, Truck, Upload, UserRound, Users, type LucideIcon } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Sub-pages shown indented under the entry while it is active. */
  children?: NavItem[];
}

export const NAV: NavItem[] = [
  { href: "/home", label: "Home", icon: Home },
  {
    href: "/inventory",
    label: "Inventory",
    icon: Boxes,
    children: [
      { href: "/inventory", label: "Items", icon: Boxes },
      { href: "/inventory/counts", label: "Cycle counts", icon: ListChecks },
    ],
  },
  { href: "/receiving", label: "Receiving", icon: PackageCheck },
  { href: "/transfers", label: "Transfers", icon: ArrowLeftRight },
  { href: "/builds", label: "BOM", icon: Hammer },
  {
    href: "/orders",
    label: "Orders",
    icon: ShoppingCart,
    children: [
      { href: "/orders", label: "Sales orders", icon: Receipt },
      { href: "/orders/purchase", label: "Purchase orders", icon: ClipboardCheck },
      { href: "/orders/replenishment", label: "Replenishment", icon: Repeat },
    ],
  },
  { href: "/rmas", label: "Returns", icon: RotateCcw },
  { href: "/suppliers", label: "Suppliers", icon: Truck },
  { href: "/customers", label: "Customers", icon: Contact },
  { href: "/reports", label: "Reports", icon: FileBarChart2 },
];

export const NAV_SECONDARY: NavItem[] = [
  {
    href: "/strato",
    label: "Strato",
    icon: Sparkles,
    children: [
      { href: "/strato", label: "Chat", icon: MessageSquare },
      { href: "/strato/quotes", label: "Quotes", icon: FileText },
      { href: "/strato/projections", label: "Projections", icon: TrendingUp },
    ],
  },
  { href: "/import", label: "Import", icon: Download },
  { href: "/exports", label: "Exports", icon: Upload },
  { href: "/documents", label: "Documents", icon: FolderOpen },
  { href: "/integrations", label: "Integrations", icon: Plug },
  {
    href: "/team",
    label: "Team",
    icon: Users,
    children: [
      { href: "/team", label: "Members", icon: UserRound },
      { href: "/team/calendar", label: "Calendar", icon: CalendarDays },
    ],
  },
  { href: "/activity", label: "Activity", icon: ClipboardList },
  { href: "/settings", label: "Settings", icon: Settings },
];

/** Every sidebar destination, top to bottom, as shown in the sidebar (children follow their parent). */
/** Ranch instances (src/lib/instances.ts, feature "ranch"): web packs, animals and the Square/store bridge. */
export const RANCH_NAV: NavItem = {
  href: "/ranch",
  label: "Ranch",
  icon: Beef,
  children: [
    { href: "/ranch", label: "Web packs", icon: Package },
    { href: "/ranch/animals", label: "Animals", icon: Tags },
    { href: "/ranch/bridge", label: "Square & store", icon: RefreshCw },
  ],
};

/** The main navigation with the ranch section after Inventory. */
export function navWithRanch(nav: NavItem[]): NavItem[] {
  const at = nav.findIndex((n) => n.href === "/inventory");
  return [...nav.slice(0, at + 1), RANCH_NAV, ...nav.slice(at + 1)];
}

export const NAV_ORDER: readonly string[] = [...NAV, ...NAV_SECONDARY].flatMap((n) => (n.children ? n.children.map((c) => c.href) : [n.href]));

/** Whether a sidebar entry is the one for this path (an item page counts as Inventory, etc.). */
export function isNavActive(href: string, pathname: string): boolean {
  return pathname === href || pathname.startsWith(href + "/");
}

/** A child entry is active only for its own path, so "Chat" at /strato does not light up on /strato/quotes. */
export function isChildNavActive(child: NavItem, siblings: NavItem[], pathname: string): boolean {
  if (!isNavActive(child.href, pathname)) return false;
  return !siblings.some((s) => s !== child && s.href.length > child.href.length && isNavActive(s.href, pathname));
}

/** The sidebar entry `step` rows below (1) or above (-1) the current page. Null at either end, or when the page is not in the sidebar. */
export function adjacentNavHref(pathname: string, step: 1 | -1): string | null {
  const idx = NAV_ORDER.findIndex((h) => isNavActive(h, pathname));
  if (idx < 0) return null;
  return NAV_ORDER[idx + step] ?? null;
}
