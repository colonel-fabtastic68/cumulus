import { ArrowLeftRight, Boxes, ClipboardList, Download, FileBarChart2, FileText, Hammer, Home, MessageSquare, PackageCheck, Plug, RotateCcw, Settings, ShoppingCart, Sparkles, TrendingUp, Truck, Upload, Users, type LucideIcon } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Sub-pages shown indented under the entry while it is active. */
  children?: NavItem[];
}

export const NAV: NavItem[] = [
  { href: "/home", label: "Home", icon: Home },
  { href: "/inventory", label: "Inventory", icon: Boxes },
  { href: "/receiving", label: "Receiving", icon: PackageCheck },
  { href: "/transfers", label: "Transfers", icon: ArrowLeftRight },
  { href: "/builds", label: "Builds", icon: Hammer },
  { href: "/orders", label: "Orders", icon: ShoppingCart },
  { href: "/rmas", label: "Returns", icon: RotateCcw },
  { href: "/suppliers", label: "Suppliers", icon: Truck },
  { href: "/reports", label: "Reports", icon: FileBarChart2 },
];

export const NAV_SECONDARY: NavItem[] = [
  {
    href: "/nimbus",
    label: "Nimbus",
    icon: Sparkles,
    children: [
      { href: "/nimbus", label: "Chat", icon: MessageSquare },
      { href: "/nimbus/quotes", label: "Quotes", icon: FileText },
      { href: "/nimbus/projections", label: "Projections", icon: TrendingUp },
    ],
  },
  { href: "/import", label: "Import", icon: Download },
  { href: "/exports", label: "Exports", icon: Upload },
  { href: "/integrations", label: "Integrations", icon: Plug },
  { href: "/team", label: "Team", icon: Users },
  { href: "/activity", label: "Activity", icon: ClipboardList },
  { href: "/settings", label: "Settings", icon: Settings },
];

/** Every sidebar destination, top to bottom, as shown in the sidebar (children follow their parent). */
export const NAV_ORDER: readonly string[] = [...NAV, ...NAV_SECONDARY].flatMap((n) => (n.children ? n.children.map((c) => c.href) : [n.href]));

/** Whether a sidebar entry is the one for this path (an item page counts as Inventory, etc.). */
export function isNavActive(href: string, pathname: string): boolean {
  return pathname === href || pathname.startsWith(href + "/");
}

/** A child entry is active only for its own path, so "Chat" at /nimbus does not light up on /nimbus/quotes. */
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
