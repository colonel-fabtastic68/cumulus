import { NAV, NAV_SECONDARY, navWithFeatures, type NavItem } from "@/components/shell/nav";
import { FEATURES, type FeatureId } from "@/lib/features";

/**
 * Strato's map of the app, and the on-screen guide it can run (feature `stratoGuide`).
 *
 * A control Strato should be able to point at carries a `data-guide` id:
 *   nav:<path>          a sidebar entry (Sidebar.tsx adds one to every entry)
 *   page:primary        the page's main button; page:secondary the other header buttons (Page.tsx)
 *   tab:<id>            a tab (Tabs in the UI kit)
 *   search / filters    the search box and the status filter above a list (SearchField, Segmented)
 *   settings:<section>  a Settings section (settings/page.tsx)
 *   order:ship, order:pick-list, order:print, order:email, order:cancel   buttons in an order dialog
 *   topbar:strato       the Strato button in the top bar
 * The showOnScreen tool (src/lib/agent/tools.ts) names these ids; GuideProvider finds the
 * element, scrolls to it and lights it up with a note, one step at a time.
 */

export interface GuideStep {
  /** A data-guide id, e.g. "nav:/orders" or "page:primary". */
  target: string;
  /** One sentence: what this is and what to do. */
  text: string;
  /** Path to open first, for targets that exist on one page only. */
  page?: string;
}

export interface GuideRequest {
  title?: string;
  steps: GuideStep[];
}

export interface GuideResult {
  ok: boolean;
  summary: string;
  /** Targets that were not on screen when their step was shown. */
  missing?: string[];
}

export type NavFlags = Parameters<typeof navWithFeatures>[1];

/** What each page is for, in one line, keyed by path. Only pages in this workspace's sidebar are described. */
export const PAGE_NOTES: Record<string, string> = {
  "/home": "the dashboard: stock alerts, open orders and what needs attention today",
  "/inventory": "every part and assembly; New item; click a row for the item page, whose tabs are Overview, Images, Locations, Cross-references, BOM, Where used, Stock history, Batches, Pricing, plus Variants and Production when those features are on",
  "/inventory/counts": "cycle counts: count sheets, variances and approval",
  "/receiving": "goods in without a purchase order (New receipt); purchase orders are received from Orders › Purchase orders",
  "/transfers": "moving stock between locations",
  "/builds": "bills of materials: each assembly, what it can build, Build; parts are added on the item page's BOM tab",
  "/builds/work-orders": "work orders: planned production runs; New work order, release, steps, complete",
  "/serials": "serial numbers: one record per unit, with its history",
  "/orders": "sales orders: New order; Ship on the row; the order dialog has Print / PDF, Pick list, Email and Cancel",
  "/orders/purchase": "purchase orders: New purchase order; Receive on the row; Mark as sent",
  "/orders/replenishment": "what to buy, from the forecast (on hand + on order − open orders); turns rows into purchase orders",
  "/orders/connectors": "order intake channels: inboxes, a phone line and a text line",
  "/rmas": "returns (RMAs): New return, inspect, resolve",
  "/suppliers": "suppliers and their lead times; New supplier",
  "/customers": "customers; New customer; export",
  "/jobs": "jobs: the sales orders, purchase orders and work orders of one project, with crew and budget",
  "/reports": "reports in tabs: low stock, valuation, consumption, seasonality, dead stock, backorders, KPIs",
  "/strato": "Strato as a full page",
  "/strato/quotes": "quotes drafted with Strato",
  "/strato/projections": "demand projections per item",
  "/import": "import: a spreadsheet of items and stock, a store, or a website, reviewed before anything is saved",
  "/exports": "export any collection to CSV or Excel",
  "/exports/labels": "labels and barcodes: QR or barcode sheets for items, locations and batches",
  "/documents": "files: label sheets, printed documents, templates",
  "/integrations": "connections to Shopify, WooCommerce, Shippo, EasyPost, QuickBooks, Square and Clover",
  "/team": "members and roles; Invite teammate",
  "/team/calendar": "the team calendar",
  "/activity": "everything that changed, and who changed it",
  "/settings": "settings sections: company, inventory-policy, catalog, locations, shipping, quoting, strato, billing, labs (switch unreleased features on for this workspace), time-machine, data (clear or export the workspace), about",
};

/**
 * What a feature adds to a page once it is on, appended to that page's note. Without this Strato
 * would send people the long way round (typing in a supplier's PDF by hand) while the shortcut sits
 * one click away.
 */
export const FEATURE_NOTES: Array<{ feature: FeatureId; href: string; note: string }> = [
  { feature: "poUpload", href: "/orders/purchase", note: "New purchase order (page:primary) is a menu: Upload a document turns a supplier's PDF, photo of the pages or spreadsheet into an order that the user checks line by line before it is added; Enter manually is the form" },
  { feature: "newAssembly", href: "/builds", note: "New assembly (page:primary) names an assembly and opens its BOM tab to list the parts" },
  { feature: "livePresence", href: "/team", note: "who is online is live: a teammate shows the moment they open cumulusOS and drops off when they close it; the top bar names teammates on the same screen (topbar:presence), and the item and purchase order edit forms warn when someone else has the same record open" },
  { feature: "savedCodes", href: "/exports/labels", note: "opens on the saved barcode or QR code of each item; New codes (page:primary) makes them in four steps; ticked codes print, export or share; pick lists print each part's saved code" },
];

export interface AppFeatures {
  /** Every feature flag as it stands for this workspace. */
  on?: Partial<Record<FeatureId, boolean>>;
  /** Features that are off here and that this workspace can switch on in Settings › Labs. */
  labsOff?: FeatureId[];
}

/** On-screen targets besides nav:<path>, with what each one is. */
export const FIXED_TARGETS: Array<{ id: string; what: string }> = [
  { id: "page:primary", what: "the page's main button (New item, New order, New purchase order…)" },
  { id: "page:secondary", what: "the other buttons in the page header" },
  { id: "tab:<id>", what: "a tab, e.g. tab:bom, tab:production or tab:pricing on an item page" },
  { id: "search", what: "the search box above a list" },
  { id: "filters", what: "the status filter above a list" },
  { id: "settings:<section>", what: "a Settings section, e.g. settings:labs, settings:locations, settings:strato" },
  { id: "order:ship, order:pick-list, order:print, order:email, order:cancel", what: "buttons in an open order dialog (click the order's row on /orders first)" },
  { id: "topbar:strato", what: "the Strato button in the top bar" },
];

function navFor(flags: Partial<NavFlags>): NavItem[] {
  return navWithFeatures(NAV, { workOrders: !!flags.workOrders, jobs: !!flags.jobs, connectors: !!flags.connectors, serials: !!flags.serials });
}

/** The sidebar label for a path, "Group › Page" for a child entry, or null when the path is not in the sidebar. */
export function navLabelFor(pathname: string, flags: Partial<NavFlags> = {}): string | null {
  const hits: Array<{ href: string; label: string }> = [];
  const visit = (n: NavItem, parent?: NavItem) => {
    if (pathname === n.href || pathname.startsWith(`${n.href}/`)) {
      hits.push({ href: n.href, label: parent && parent.label !== n.label ? `${parent.label} › ${n.label}` : n.label });
    }
    n.children?.forEach((c) => visit(c, n));
  };
  [...navFor(flags), ...NAV_SECONDARY].forEach((n) => visit(n));
  // The longest matching path is the most specific entry; among equals the first (the group) wins.
  hits.sort((a, b) => b.href.length - a.href.length);
  return hits[0]?.label ?? null;
}

function entry(n: NavItem): string {
  return n.children?.length ? `${n.label}: ${n.children.map((c) => `${c.label} (${c.href})`).join(", ")}` : `${n.label} (${n.href})`;
}

/** The "Finding your way around" section of Strato's prompt, for the sidebar this workspace sees. */
export function describeApp(flags: Partial<NavFlags> = {}, features: AppFeatures = {}): string {
  const main = navFor(flags);
  const hrefs = new Set([...main, ...NAV_SECONDARY].flatMap((n) => [n.href, ...(n.children?.map((c) => c.href) ?? [])]));
  const extra = (href: string) => FEATURE_NOTES.filter((f) => f.href === href && features.on?.[f.feature]).map((f) => `; ${f.note}`).join("");
  const notes = Object.entries(PAGE_NOTES)
    .filter(([href]) => hrefs.has(href))
    .map(([href, what]) => [href, what + extra(href)] as const);
  const labs = (features.labsOff ?? []).map((id) => `${FEATURES[id].label} (${FEATURES[id].description})`);
  return [
    "## Finding your way around",
    `Sidebar, top to bottom: ${main.map(entry).join(" · ")}.`,
    `Below it: ${NAV_SECONDARY.map(entry).join(" · ")}.`,
    "What each page is for:",
    ...notes.map(([href, what]) => `- ${navLabelFor(href, flags) ?? href} (${href}): ${what}`),
    `On-screen targets for showOnScreen: nav:<path> for any sidebar entry above (nav:/orders/purchase); ${FIXED_TARGETS.map((t) => `${t.id} = ${t.what}`).join("; ")}.`,
    "A feature that is switched off shows nothing: Settings › Labs (settings:labs) turns features on for this workspace. On a phone the sidebar is behind the menu button.",
    ...(labs.length ? [`Switched off here, and the user can switch them on in Settings › Labs: ${labs.join(" · ")}. When one of these answers the question, say so and point at settings:labs.`] : []),
  ].join("\n");
}
