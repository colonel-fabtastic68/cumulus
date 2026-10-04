import type { IntegrationId, IntegrationSettings } from "@/lib/types";

/**
 * Catalog of connections. Channels (Factor 40) and carriers (Factor 41) are
 * live: credentials go to the server, which verifies them with the platform
 * and keeps them in a subcollection browsers cannot read. The rest are on the
 * roadmap and fall back to CSV import.
 */
export type IntegrationKind = "channel" | "carrier" | "accounting" | "pos" | "roadmap";

export interface CredentialField {
  key: string;
  label: string;
  placeholder?: string;
  help?: string;
  /** Secrets are never echoed back; config fields show on the card once connected. */
  secret?: boolean;
  optional?: boolean;
  /** A fixed set of values rendered as a select instead of a text field. */
  choices?: Array<{ value: string; label: string }>;
  default?: string;
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
  description: string;
  fields: CredentialField[];
  settings?: SettingDef[];
  /** Connects by sending the browser to the platform's consent screen instead of pasting credentials. */
  oauth?: boolean;
  /** Live connections are proven with real stores; the rest connect but are still being finished. */
  stage?: "live" | "in_progress";
  setup: { steps: string[]; docsUrl?: string };
  /** CSV fallback for product data. */
  export?: { steps: string[]; headers: string[]; note: string };
}

export const INTEGRATIONS: IntegrationDef[] = [
  {
    id: "shopify",
    name: "Shopify",
    kind: "channel",
    stage: "live",
    oauth: true,
    description: "cumulusOS is the source of truth for the store: items, categories, prices, stock and status are pushed to Shopify; paid orders and products new to the store come in. Edits made in Shopify are overwritten.",
    fields: [
      { key: "shop", label: "Store address", placeholder: "your-store.myshopify.com", help: "The .myshopify.com address from Shopify admin." },
      { key: "accessToken", label: "Admin API access token", placeholder: "shpat_…", secret: true, help: "From the custom app you create in Shopify admin (steps below)." },
      { key: "apiSecret", label: "API secret key", secret: true, optional: true, help: "Optional. Lets cumulusOS verify the signature on every webhook Shopify sends." },
    ],
    setup: {
      steps: ["Enter your store's .myshopify.com address and press Connect to Shopify", "Sign in to the store and approve the access cumulusOS asks for (products, inventory, orders, locations)", "You come straight back here, connected, with webhooks registered"],
      docsUrl: "https://help.shopify.com/en/manual/apps",
    },
    export: {
      steps: ["In Shopify admin open Products and click Export", "Choose All products and Plain CSV file", "Upload the file on the Import page"],
      headers: ["Handle", "Title", "Vendor", "Type", "Tags", "Variant SKU", "Variant Inventory Qty", "Variant Price", "Cost per item", "Variant Barcode"],
      note: "Recognized automatically: Variant SKU, Title, Variant Inventory Qty, Variant Price, Cost per item, Vendor, Type, Tags and Variant Barcode.",
    },
  },
  {
    id: "woocommerce",
    name: "WooCommerce",
    kind: "channel",
    stage: "live",
    description: "cumulusOS is the source of truth for the store: items, categories, prices, stock and status are pushed to WooCommerce; processing orders and products new to the store come in. Edits made in WooCommerce are overwritten.",
    fields: [
      { key: "siteUrl", label: "Site URL", placeholder: "https://shop.example.com", help: "Your WordPress site, over https." },
      { key: "consumerKey", label: "Consumer key", placeholder: "ck_…", secret: true },
      { key: "consumerSecret", label: "Consumer secret", placeholder: "cs_…", secret: true },
    ],
    setup: {
      steps: ["In WordPress open WooCommerce → Settings → Advanced → REST API and click Add key", "Give it Read/Write permissions and generate it", "Copy the consumer key and secret here; they are shown only once"],
      docsUrl: "https://woocommerce.com/document/woocommerce-rest-api/",
    },
    export: {
      steps: ["In WordPress open Products and click Export", "Keep all columns selected and generate the CSV", "Upload the file on the Import page"],
      headers: ["SKU", "Name", "Stock", "Regular price", "Categories", "Tags", "Low stock amount", "Short description", "GTIN, UPC, EAN, or ISBN"],
      note: "Recognized automatically: SKU, Name, Stock, Regular price, Low stock amount, Categories, Tags, Short description and GTIN.",
    },
  },
  {
    id: "shippo",
    name: "Shippo",
    oauth: true,
    kind: "carrier",
    stage: "in_progress",
    description: "One API key for USPS, UPS, FedEx, DHL and the other carriers on your Shippo account: compare rates when shipping an order, buy the label, and track it to the door.",
    fields: [{ key: "token", label: "API token", placeholder: "shippo_live_… or shippo_test_…", secret: true, help: "A test token buys sample labels and costs nothing; switch to the live token when ready." }],
    setup: { steps: ["Press Connect to Shippo and sign in to your Shippo account (or create one there)", "Approve the access; you come straight back here, connected", "Add your carrier accounts in Shippo under Settings → Carriers (USPS comes built in), and set a ship-from address under Settings → Shipping and scanning"], docsUrl: "https://docs.goshippo.com/guides/authentication" },
  },
  {
    id: "easypost",
    name: "EasyPost",
    kind: "carrier",
    stage: "in_progress",
    description: "Rate-shop and buy labels across the carriers on your EasyPost account, with tracking updates pushed back to each shipment.",
    fields: [{ key: "token", label: "API key", placeholder: "EZAK… (production) or EZTK… (test)", secret: true, help: "Test keys buy sample labels for free." }],
    setup: { steps: ["In the EasyPost dashboard open Account Settings → API Keys", "Copy the production key (or the test key to try it out)", "Paste it here, then set a ship-from address under Settings → Shipping and scanning"], docsUrl: "https://docs.easypost.com/docs/api-keys" },
  },
  {
    id: "quickbooks",
    name: "QuickBooks Online",
    kind: "accounting",
    stage: "in_progress",
    oauth: true,
    description: "Products and Services come in as items by SKU with their sales price, purchase cost and reorder point, and each item remembers its QuickBooks id so costs and books line up.",
    fields: [],
    settings: [
      { key: "syncProducts", label: "Pull Products and Services in", help: "Create or update items on every sync and in the nightly pass, matched by SKU (or by name when QuickBooks has no SKU).", default: true },
      { key: "takeStockOnFirstSync", label: "Take QuickBooks quantities for new items", help: "Inventory items that do not exist here yet arrive with their QuickBooks quantity on hand as the opening count. Existing counts are never changed by a pull.", default: false },
    ],
    setup: {
      steps: ["Press Connect to QuickBooks and sign in to Intuit", "Pick the company to connect and approve access", "You come straight back here, connected; press Sync now to pull Products and Services in"],
      docsUrl: "https://quickbooks.intuit.com/learn-support/en-us/help-article/manage-inventory/add-product-service-items-quickbooks-online/L4Gqgk3PW_US_en_US",
    },
    export: {
      steps: ["In QuickBooks Online open Sales → Products and services", "Use the export icon above the list to download an Excel file, then save it as CSV", "Upload the file on the Import page"],
      headers: ["Product/Service Name", "SKU", "Type", "Sales description", "Sales price/rate", "Purchase cost", "Quantity on hand", "Reorder point"],
      note: "SKU, Quantity on hand, Purchase cost and Reorder point are recognized; map Product/Service Name to Name and Sales price/rate to Price in the wizard, or let the AI mapper suggest it.",
    },
  },
  {
    id: "square",
    name: "Square",
    kind: "pos",
    stage: "in_progress",
    oauth: true,
    description: "The Square item library comes in as items by SKU with prices and categories, and in-stock counts across your locations can seed opening quantities.",
    fields: [
      { key: "accessToken", label: "Access token", placeholder: "EAAA…", secret: true, help: "From the Credentials page of an application you create in the Square Developer Console (steps below). It only ever reaches the server." },
      { key: "environment", label: "Environment", choices: [{ value: "production", label: "Production" }, { value: "sandbox", label: "Sandbox (testing)" }], default: "production", help: "Match the toggle at the top of the application page when you copied the token." },
    ],
    settings: [
      { key: "syncProducts", label: "Pull the item library in", help: "Create or update items by SKU on every sync and in the nightly pass.", default: true },
      { key: "takeStockOnFirstSync", label: "Take Square counts for new items", help: "Items that do not exist here yet arrive with Square's in-stock count as the opening quantity. Existing counts are never changed by a pull.", default: false },
    ],
    setup: {
      steps: [
        "Press Connect to Square, sign in to your Square account and approve the access cumulusOS asks for (items, inventory, orders, locations); you come straight back here, connected",
        "Or use your own application: at developer.squareup.com/apps create an application (name it cumulusOS), set the toggle at the top to Production, open Credentials and copy the access token",
        "Paste the token here with the matching environment and press Connect; it never expires, and you can revoke it from that same Credentials page at any time",
        "Press Sync now to pull the item library in",
      ],
      docsUrl: "https://developer.squareup.com/docs/devtools/developer-dashboard",
    },
    export: {
      steps: ["In Square Dashboard open Items & orders → Items", "Choose Actions → Export library and download the CSV", "Upload the file on the Import page"],
      headers: ["Item Name", "SKU", "Description", "Category", "Price", "Current Quantity <Location>", "Stock Alert Count <Location>"],
      note: "SKU, Item Name, Description, Category and Price are recognized; map Current Quantity to Quantity and Stock Alert Count to Min qty in the wizard.",
    },
  },
  {
    id: "clover",
    name: "Clover",
    kind: "pos",
    stage: "in_progress",
    oauth: true,
    description: "The Clover inventory comes in as items by SKU with prices, costs, product codes and categories, and the stock counts on your Clover devices can seed opening quantities.",
    fields: [
      { key: "accessToken", label: "API token", placeholder: "Paste the token from Settings → API tokens", secret: true, help: "Created in the Clover web dashboard under Settings → API tokens (steps below). It only ever reaches the server." },
      { key: "merchantId", label: "Merchant ID", placeholder: "XKDC2E3WD0VS1", help: "Under Account & Setup → Business Information in the Clover dashboard, or the 13 characters after /m/ in its address bar." },
      {
        key: "place",
        label: "Environment",
        choices: [
          { value: "na", label: "Production (North America)" },
          { value: "eu", label: "Production (Europe)" },
          { value: "la", label: "Production (Latin America)" },
          { value: "sandbox", label: "Sandbox (testing)" },
        ],
        default: "na",
        help: "Where the merchant account lives. Sandbox is for test merchants from the Clover developer dashboard.",
      },
    ],
    settings: [
      { key: "syncProducts", label: "Pull the inventory in", help: "Create or update items by SKU on every sync and in the nightly pass. Items hidden from the register arrive inactive.", default: true },
      { key: "takeStockOnFirstSync", label: "Take Clover counts for new items", help: "Items that do not exist here yet arrive with Clover's stock count as the opening quantity. Existing counts are never changed by a pull.", default: false },
    ],
    setup: {
      steps: [
        "Press Connect to Clover, sign in to your Clover account and approve the access cumulusOS asks for (merchant and inventory); you come straight back here, connected",
        "Or use an API token: in the Clover web dashboard open Settings → API tokens, press Create new token, name it cumulusOS and give it Read permission on Merchant and Inventory",
        "Paste the token here with your merchant id and environment and press Connect; delete the token from that same page at any time to cut access",
        "Press Sync now to pull the inventory in",
      ],
      docsUrl: "https://docs.clover.com/dev/docs/gdp-create-merchant-specific-api-token",
    },
    export: {
      steps: ["In the Clover web dashboard open Inventory → Items", "Choose Export and download the spreadsheet; save it as CSV if it comes as an Excel file", "Upload the file on the Import page"],
      headers: ["Name", "Price", "Price Type", "Cost", "Product Code", "SKU", "Quantity", "Hidden", "Labels"],
      note: "SKU, Name, Price, Cost, Quantity and Labels are recognized; map Product Code to Barcode in the wizard, or let the AI mapper suggest it.",
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
