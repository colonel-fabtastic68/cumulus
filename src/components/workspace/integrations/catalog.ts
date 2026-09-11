import type { IntegrationId, IntegrationSettings } from "@/lib/types";

/**
 * Catalogue of connections. Channels (Factor 40) and carriers (Factor 41) are
 * live: credentials go to the server, which verifies them with the platform
 * and keeps them in a subcollection browsers cannot read. The rest are on the
 * roadmap and fall back to CSV import.
 */
export type IntegrationKind = "channel" | "carrier" | "roadmap";

export interface CredentialField {
  key: string;
  label: string;
  placeholder?: string;
  help?: string;
  /** Secrets are never echoed back; config fields show on the card once connected. */
  secret?: boolean;
  optional?: boolean;
}

export interface SettingDef {
  key: keyof IntegrationSettings;
  label: string;
  help: string;
  default: boolean;
}

export interface IntegrationDef {
  id: IntegrationId;
  name: string;
  kind: IntegrationKind;
  /** Letter mark shown in the card avatar. */
  letter: string;
  mark: { bg: string; fg: string };
  description: string;
  /** What the connection syncs or does. */
  syncs: string[];
  fields: CredentialField[];
  settings?: SettingDef[];
  setup: { steps: string[]; docsUrl?: string };
  /** CSV fallback for product data. */
  export?: { steps: string[]; headers: string[]; note: string };
}

export const INTEGRATIONS: IntegrationDef[] = [
  {
    id: "shopify",
    name: "Shopify",
    kind: "channel",
    letter: "S",
    mark: { bg: "#e6f4ec", fg: "#1f7a4d" },
    description: "Products and variants come in as items keyed by SKU, paid orders become sales orders, and on-hand counts go back to the store so it never oversells.",
    syncs: ["Products & SKUs", "Orders in", "Stock out", "Webhooks"],
    fields: [
      { key: "shop", label: "Store address", placeholder: "your-store.myshopify.com", help: "The .myshopify.com address from Shopify admin." },
      { key: "accessToken", label: "Admin API access token", placeholder: "shpat_…", secret: true, help: "From the custom app you create in Shopify admin (steps below)." },
      { key: "apiSecret", label: "API secret key", secret: true, optional: true, help: "Optional. Lets Cumulus verify the signature on every webhook Shopify sends." },
    ],
    settings: [
      { key: "syncProducts", label: "Pull products in", help: "Create or update items by SKU on every sync.", default: true },
      { key: "syncOrders", label: "Pull open orders in", help: "Unshipped, paid orders become sales orders here.", default: true },
      { key: "pushStock", label: "Push stock levels out", help: "After stock changes here, set the available quantity in Shopify.", default: false },
      { key: "pushProducts", label: "Push new items to Shopify automatically", help: "An item added here appears in Shopify a few seconds later, and anything still missing is created on every sync. Products already in Shopify are matched by SKU, never duplicated.", default: false },
      { key: "publishProducts", label: "Publish pushed items right away", help: "Off: new products arrive as drafts for you to check first. On: they go live with the price and stock from Cumulus.", default: false },
      { key: "pushDetails", label: "Push item changes to Shopify", help: "Name, price, description, weight and barcode follow edits made here; deactivated items are archived in Shopify.", default: true },
      { key: "removeFromStoreOnDelete", label: "Archive the product when an item is deleted here", help: "Deleting a linked item archives its Shopify product a moment later (orders and history stay intact).", default: true },
      { key: "deactivateOnStoreDelete", label: "Deactivate items whose product is deleted in Shopify", help: "Off keeps the item and just unlinks it. Either way, a product deleted in the store is never recreated by a push.", default: false },
      { key: "takeStockOnFirstSync", label: "Take Shopify's quantities on the first sync", help: "Only for a fresh workspace: opening counts come from the store.", default: false },
      { key: "acceptStockFromChannel", label: "Accept stock changes from Shopify", help: "Inventory edits in Shopify are recorded as counts here. Off keeps Cumulus as the source of truth.", default: false },
    ],
    setup: {
      steps: [
        "In Shopify admin open Settings → Apps and sales channels → Develop apps, and create an app called Cumulus",
        "Under Configure Admin API scopes tick read_products, read_inventory, write_inventory, read_orders, read_locations",
        "Install the app, then reveal the Admin API access token once and paste it here",
        "Optional: copy the API secret key from the same page so webhooks are signature-checked",
      ],
      docsUrl: "https://help.shopify.com/en/manual/apps/app-types/custom-apps",
    },
    export: {
      steps: ["In Shopify admin open Products and click Export", "Choose All products and Plain CSV file", "Upload the file on the Import page"],
      headers: ["Handle", "Title", "Vendor", "Type", "Tags", "Variant SKU", "Variant Inventory Qty", "Variant Price", "Cost per item", "Variant Barcode"],
      note: "Recognised automatically: Variant SKU, Title, Variant Inventory Qty, Variant Price, Cost per item, Vendor, Type, Tags and Variant Barcode.",
    },
  },
  {
    id: "woocommerce",
    name: "WooCommerce",
    kind: "channel",
    letter: "W",
    mark: { bg: "#f1e8f7", fg: "#7a3e9d" },
    description: "Products and variations come in by SKU, processing orders become sales orders, and stock quantities are pushed back so the shop stays in step.",
    syncs: ["Products & SKUs", "Orders in", "Stock out", "Webhooks"],
    fields: [
      { key: "siteUrl", label: "Site URL", placeholder: "https://shop.example.com", help: "Your WordPress site, over https." },
      { key: "consumerKey", label: "Consumer key", placeholder: "ck_…", secret: true },
      { key: "consumerSecret", label: "Consumer secret", placeholder: "cs_…", secret: true },
    ],
    settings: [
      { key: "syncProducts", label: "Pull products in", help: "Create or update items by SKU on every sync.", default: true },
      { key: "syncOrders", label: "Pull open orders in", help: "Orders in Processing or On hold become sales orders here.", default: true },
      { key: "pushStock", label: "Push stock levels out", help: "After stock changes here, set the stock quantity in WooCommerce.", default: false },
      { key: "pushProducts", label: "Push new items to WooCommerce automatically", help: "An item added here appears in WooCommerce a few seconds later, and anything still missing is created on every sync. Products already in the store are matched by SKU, never duplicated.", default: false },
      { key: "publishProducts", label: "Publish pushed items right away", help: "Off: new products arrive as drafts for you to check first. On: they go live with the price and stock from Cumulus.", default: false },
      { key: "pushDetails", label: "Push item changes to WooCommerce", help: "Name, price, description, weight and barcode follow edits made here; deactivated items become drafts in the store.", default: true },
      { key: "removeFromStoreOnDelete", label: "Trash the product when an item is deleted here", help: "Deleting a linked item moves its WooCommerce product to the trash a moment later (restorable there).", default: true },
      { key: "deactivateOnStoreDelete", label: "Deactivate items whose product is deleted in WooCommerce", help: "Off keeps the item and just unlinks it. Either way, a product deleted in the store is never recreated by a push.", default: false },
      { key: "takeStockOnFirstSync", label: "Take WooCommerce's quantities on the first sync", help: "Only for a fresh workspace: opening counts come from the shop.", default: false },
      { key: "acceptStockFromChannel", label: "Accept stock changes from WooCommerce", help: "Stock edits in WooCommerce are recorded as counts here.", default: false },
    ],
    setup: {
      steps: ["In WordPress open WooCommerce → Settings → Advanced → REST API and click Add key", "Give it Read/Write permissions and generate it", "Copy the consumer key and secret here; they are shown only once"],
      docsUrl: "https://woocommerce.com/document/woocommerce-rest-api/",
    },
    export: {
      steps: ["In WordPress open Products and click Export", "Keep all columns selected and generate the CSV", "Upload the file on the Import page"],
      headers: ["SKU", "Name", "Stock", "Regular price", "Categories", "Tags", "Low stock amount", "Short description", "GTIN, UPC, EAN, or ISBN"],
      note: "Recognised automatically: SKU, Name, Stock, Regular price, Low stock amount, Categories, Tags, Short description and GTIN.",
    },
  },
  {
    id: "shippo",
    name: "Shippo",
    kind: "carrier",
    letter: "Sh",
    mark: { bg: "#e8f0fb", fg: "#1f4f9c" },
    description: "One API key for USPS, UPS, FedEx, DHL and the other carriers on your Shippo account: compare rates when shipping an order, buy the label, and track it to the door.",
    syncs: ["Rate shopping", "Labels", "Tracking"],
    fields: [{ key: "token", label: "API token", placeholder: "shippo_live_… or shippo_test_…", secret: true, help: "A test token buys sample labels and costs nothing; switch to the live token when ready." }],
    setup: { steps: ["In Shippo open Settings → API and generate a token", "Add your carrier accounts under Settings → Carriers (USPS comes built in)", "Paste the token here, then set a ship-from address under Settings → Shipping and scanning"], docsUrl: "https://docs.goshippo.com/docs/guides_general/authentication/" },
  },
  {
    id: "easypost",
    name: "EasyPost",
    kind: "carrier",
    letter: "E",
    mark: { bg: "#e9f3f9", fg: "#0b5c8a" },
    description: "Rate-shop and buy labels across the carriers on your EasyPost account, with tracking updates pushed back to each shipment.",
    syncs: ["Rate shopping", "Labels", "Tracking"],
    fields: [{ key: "token", label: "API key", placeholder: "EZAK… (production) or EZTK… (test)", secret: true, help: "Test keys buy sample labels for free." }],
    setup: { steps: ["In the EasyPost dashboard open Account Settings → API Keys", "Copy the production key (or the test key to try it out)", "Paste it here, then set a ship-from address under Settings → Shipping and scanning"], docsUrl: "https://docs.easypost.com/docs/api-keys" },
  },
  {
    id: "quickbooks",
    name: "QuickBooks",
    kind: "roadmap",
    letter: "Q",
    mark: { bg: "#e8f1f8", fg: "#1f5f8b" },
    description: "Match items to Products and Services, keep purchase costs and sales prices aligned, and post inventory value and cost of goods sold to your books.",
    syncs: ["Products & SKUs", "Costs & prices", "Inventory value"],
    fields: [{ key: "realmId", label: "Company (realm) ID", placeholder: "1234567890", help: "Found under Settings → Account and settings → Billing & subscription. Saved for later; nothing is contacted." }],
    setup: { steps: [] },
    export: {
      steps: ["In QuickBooks Online open Sales → Products and services", "Use the export icon above the list to download an Excel file, then save it as CSV", "Upload the file on the Import page"],
      headers: ["Product/Service Name", "SKU", "Type", "Sales description", "Sales price/rate", "Purchase cost", "Quantity on hand", "Reorder point"],
      note: "SKU, Quantity on hand, Purchase cost and Reorder point are recognised; map Product/Service Name to Name and Sales price/rate to Price in the wizard, or let the AI mapper suggest it.",
    },
  },
  {
    id: "square",
    name: "Square",
    kind: "roadmap",
    letter: "□",
    mark: { bg: "#f3f3f4", fg: "#303030" },
    description: "Sync the Square item library and per-location counts, and record point-of-sale and online sales as orders that relieve stock.",
    syncs: ["Item library", "Stock by location", "Sales"],
    fields: [{ key: "location", label: "Location name", placeholder: "Main Street store", help: "The Square location this workspace should mirror. Saved for later; nothing is contacted." }],
    setup: { steps: [] },
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

export function defaultSettings(def: IntegrationDef): IntegrationSettings {
  const out: IntegrationSettings = {};
  for (const s of def.settings ?? []) (out as Record<string, boolean>)[s.key] = s.default;
  return out;
}
