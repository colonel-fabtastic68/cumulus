import { Boxes, ClipboardList, Download, FileBarChart2, Hammer, Home, PackageCheck, Plug, RotateCcw, Settings, ShoppingCart, Sparkles, Truck, Users, type LucideIcon } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export const NAV: NavItem[] = [
  { href: "/home", label: "Home", icon: Home },
  { href: "/inventory", label: "Inventory", icon: Boxes },
  { href: "/receiving", label: "Receiving", icon: PackageCheck },
  { href: "/builds", label: "Builds", icon: Hammer },
  { href: "/orders", label: "Orders", icon: ShoppingCart },
  { href: "/rmas", label: "Returns", icon: RotateCcw },
  { href: "/suppliers", label: "Suppliers", icon: Truck },
  { href: "/reports", label: "Reports", icon: FileBarChart2 },
];

export const NAV_SECONDARY: NavItem[] = [
  { href: "/agents", label: "Nimbus", icon: Sparkles },
  { href: "/import", label: "Import", icon: Download },
  { href: "/integrations", label: "Integrations", icon: Plug },
  { href: "/team", label: "Team", icon: Users },
  { href: "/activity", label: "Activity", icon: ClipboardList },
  { href: "/settings", label: "Settings", icon: Settings },
];

/** Every sidebar destination, top to bottom, as shown in the sidebar. */
export const NAV_ORDER: readonly string[] = [...NAV, ...NAV_SECONDARY].map((n) => n.href);

/** Whether a sidebar entry is the one for this path (an item page counts as Inventory, etc.). */
export function isNavActive(href: string, pathname: string): boolean {
  return pathname === href || pathname.startsWith(href + "/");
}

/** The sidebar entry `step` rows below (1) or above (-1) the current page. Null at either end, or when the page is not in the sidebar. */
export function adjacentNavHref(pathname: string, step: 1 | -1): string | null {
  const idx = NAV_ORDER.findIndex((h) => isNavActive(h, pathname));
  if (idx < 0) return null;
  return NAV_ORDER[idx + step] ?? null;
}
