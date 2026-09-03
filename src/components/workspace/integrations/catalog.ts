import type { IntegrationId } from "@/lib/types";

/**
 * Static catalogue of the integrations Cumulus plans to support.
 * Live sync is not built yet; each entry carries enough to explain what will
 * sync, remember a store URL, and point people at the CSV export that works today.
 */
export interface IntegrationDef {
  id: IntegrationId;
  name: string;
  /** Letter mark shown in the card avatar. */
  letter: string;
  /** Soft background and foreground for the letter mark. */
  mark: { bg: string; fg: string };
  /** Two-line description of what the connection will do. */
  description: string;
  /** What would sync once the connection is live. */
  syncs: string[];
  url: { label: string; placeholder: string; help: string };
  export: {
    /** Where the CSV export lives in that platform. */
    steps: string[];
    /** Header row of the platform's product export. */
    headers: string[];
    /** Which of those headers the Import wizard recognises on its own. */
    note: string;
  };
}

export const INTEGRATIONS: IntegrationDef[] = [
  {
    id: "shopify",
    name: "Shopify",
    letter: "S",
    mark: { bg: "#e6f4ec", fg: "#1f7a4d" },
    description: "Pull products and variants in as items keyed by SKU, keep stock levels aligned, and turn Shopify orders into sales orders that relieve inventory when they ship.",
    syncs: ["Products & SKUs", "Stock levels", "Orders"],
    url: { label: "Store URL", placeholder: "your-store.myshopify.com", help: "The .myshopify.com address from Shopify admin. Saved for later; nothing is contacted." },
    export: {
      steps: ["In Shopify admin open Products and click Export", "Choose All products and Plain CSV file", "Upload the file on the Import page"],
      headers: ["Handle", "Title", "Vendor", "Type", "Tags", "Variant SKU", "Variant Inventory Qty", "Variant Price", "Cost per item", "Variant Barcode"],
      note: "Recognised automatically: Variant SKU, Title, Variant Inventory Qty, Variant Price, Cost per item, Vendor, Type, Tags and Variant Barcode.",
    },
  },
  {
    id: "woocommerce",
    name: "WooCommerce",
    letter: "W",
    mark: { bg: "#f1e8f7", fg: "#7a3e9d" },
    description: "Import products by SKU, push on-hand counts back to your store so it never oversells, and bring WooCommerce orders in as sales orders.",
    syncs: ["Products & SKUs", "Stock levels", "Orders"],
    url: { label: "Site URL", placeholder: "https://shop.example.com", help: "Your WordPress site address. Saved for later; nothing is contacted." },
    export: {
      steps: ["In WordPress open Products and click Export", "Keep all columns selected and generate the CSV", "Upload the file on the Import page"],
      headers: ["SKU", "Name", "Stock", "Regular price", "Categories", "Tags", "Low stock amount", "Short description", "GTIN, UPC, EAN, or ISBN"],
      note: "Recognised automatically: SKU, Name, Stock, Regular price, Low stock amount, Categories, Tags, Short description and GTIN.",
    },
  },
  {
    id: "quickbooks",
    name: "QuickBooks",
    letter: "Q",
    mark: { bg: "#e8f1f8", fg: "#1f5f8b" },
    description: "Match items to Products and Services, keep purchase costs and sales prices aligned, and post inventory value and cost of goods sold to your books.",
    syncs: ["Products & SKUs", "Costs & prices", "Inventory value"],
    url: { label: "Company (realm) ID", placeholder: "1234567890", help: "Found under Settings → Account and settings → Billing & subscription. Saved for later; nothing is contacted." },
    export: {
      steps: ["In QuickBooks Online open Sales → Products and services", "Use the export icon above the list to download an Excel file, then save it as CSV", "Upload the file on the Import page"],
      headers: ["Product/Service Name", "SKU", "Type", "Sales description", "Sales price/rate", "Purchase cost", "Quantity on hand", "Reorder point"],
      note: "SKU, Quantity on hand, Purchase cost and Reorder point are recognised; map Product/Service Name to Name and Sales price/rate to Price in the wizard, or let the AI mapper suggest it.",
    },
  },
  {
    id: "square",
    name: "Square",
    letter: "□",
    mark: { bg: "#f3f3f4", fg: "#303030" },
    description: "Sync the Square item library and per-location counts, and record point-of-sale and online sales as orders that relieve stock.",
    syncs: ["Item library", "Stock by location", "Sales"],
    url: { label: "Location name", placeholder: "Main Street store", help: "The Square location this workspace should mirror. Saved for later; nothing is contacted." },
    export: {
      steps: ["In Square Dashboard open Items & orders → Items", "Choose Actions → Export library and download the CSV", "Upload the file on the Import page"],
      headers: ["Item Name", "SKU", "Description", "Category", "Price", "Current Quantity <Location>", "Stock Alert Count <Location>"],
      note: "SKU, Item Name, Description, Category and Price are recognised; map Current Quantity to Quantity and Stock Alert Count to Min qty in the wizard.",
    },
  },
];

export function integrationDef(id: string | null | undefined): IntegrationDef | undefined {
  return INTEGRATIONS.find((d) => d.id === id);
}
