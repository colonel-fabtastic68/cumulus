/**
 * Feature flags: how unreleased work ships without being seen.
 *
 * Everything new is built on the `dev` branch (https://dev.cumulusos.com) and
 * registered here. A feature's status decides where it shows:
 *
 * - planned   the data model and logic exist, nothing is on screen yet;
 * - preview   on in staging and local development, off in production;
 * - beta      as preview, and a production workspace can switch it on in Settings → Labs;
 * - released  on everywhere (delete the flag and its checks in the next cleanup).
 *
 * So `dev` can be merged into `main` at any time: unfinished features travel
 * to production switched off. Releasing one is a one-word change to its status.
 *
 * Two overrides sit on top:
 * - a workspace's own choice (settings.features), made in Settings → Labs;
 * - CUMULUS_FEATURES on the server ("workOrders,jobs" or "*"), which forces
 *   features on for a whole deployment, e.g. a pilot customer's instance.
 */

export type ReleaseStage = "production" | "staging" | "development";

export type FeatureStatus = "planned" | "preview" | "beta" | "released";

export type FeatureArea = "Catalog" | "Orders" | "Purchasing" | "Production" | "Inventory" | "Reports" | "Printing and labels" | "Accounting" | "Data" | "Team and security";

export interface FeatureDef {
  label: string;
  /** One line for Settings → Labs: what turning it on changes. */
  description: string;
  status: FeatureStatus;
  area: FeatureArea;
  /** Line numbers in the 2026-10-28 feature notes this answers. */
  notes: number[];
}

export const FEATURES = {
  partNumbers: {
    label: "Part numbers instead of SKUs",
    description: "Call the item code “Part number” (or your own word) across lists, forms, prints and exports.",
    status: "released",
    area: "Catalog",
    notes: [45],
  },
  mapPricing: {
    label: "MAP pricing",
    description: "A minimum advertised price on each item, a MAP column in Inventory, and a warning when a price goes under it.",
    status: "released",
    area: "Catalog",
    notes: [56],
  },
  unitConversions: {
    label: "Unit conversions",
    description: "Buy by the case, stock by the each, sell by the foot: per-item conversions plus standard volume, length and weight units.",
    status: "preview",
    area: "Catalog",
    notes: [57],
  },
  variants: {
    label: "Item variants",
    description: "One parent item with options (size, color); variants share the parent's details without a hand-made SKU for every combination.",
    status: "preview",
    area: "Catalog",
    notes: [66],
  },
  categoryTools: {
    label: "Rename and merge categories",
    description: "Rename a category everywhere, or fold one into another, from Settings → Catalog.",
    status: "released",
    area: "Catalog",
    notes: [70],
  },
  overstock: {
    label: "Overstock flags",
    description: "Flag items sitting above their max: an Over chip, an Overstock view in Inventory and the excess value.",
    status: "released",
    area: "Inventory",
    notes: [53],
  },
  onOrderColumn: {
    label: "On order column",
    description: "Units already on open purchase orders, next to on hand in the Inventory list.",
    status: "released",
    area: "Inventory",
    notes: [71],
  },
  inventoryPageFixes: {
    label: "Inventory list remembers where you were",
    description: "Search, filters, sort, page and rows per page stay put when you open an item and come back; a location lists every item that lives there, not only those with stock; Updated sorts newest first.",
    status: "released",
    area: "Inventory",
    notes: [],
  },
  resetFilters: {
    label: "Reset filters",
    description: "One button that clears every filter on a list.",
    status: "released",
    area: "Inventory",
    notes: [69],
  },
  fastLineEntry: {
    label: "Keyboard line entry",
    description: "On order forms: type a part number, Enter, type a quantity, Enter, and the next line opens. No Add line button.",
    status: "released",
    area: "Orders",
    notes: [46],
  },
  largeOrderForms: {
    label: "Full-size order forms",
    description: "Sales and purchase order forms open at nearly full window width, with room for long lines.",
    status: "released",
    area: "Orders",
    notes: [49],
  },
  lineLocations: {
    label: "Location per order line",
    description: "Each sales order line pulls from the item's default location and can be switched to another one; shipping relieves that location.",
    status: "released",
    area: "Orders",
    notes: [50],
  },
  pickLists: {
    label: "Pick lists",
    description: "A pick sheet for a sales order or a BOM, sorted by location and bin, with a tick box per line.",
    status: "released",
    area: "Printing and labels",
    notes: [48, 60],
  },
  printDocuments: {
    label: "Print orders and BOMs",
    description: "Print or save as PDF: sales orders, purchase orders, and BOMs broken out to parts with bin locations.",
    status: "released",
    area: "Printing and labels",
    notes: [60],
  },
  documentEmail: {
    label: "Email purchase and sales orders",
    description: "Send a purchase order to the supplier or an order confirmation to the customer from the order itself.",
    status: "released",
    area: "Orders",
    notes: [58],
  },
  connectors: {
    label: "Order connectors",
    description: "Connect email inboxes, a phone line and a text line under Orders → Connectors. What comes in is read into order lines for a person or Strato to act on.",
    status: "preview",
    area: "Orders",
    notes: [],
  },
  poUpload: {
    label: "Upload a purchase order",
    description: "New purchase order offers Upload a document beside Enter manually: Strato reads a PDF, photo or spreadsheet into an order you check against the document before it is added.",
    status: "beta",
    area: "Purchasing",
    notes: [],
  },
  modularBoms: {
    label: "Modular BOMs",
    description: "Mark BOM lines as a choice (pick one of a group) or optional, and decide them when the assembly is built.",
    status: "released",
    area: "Production",
    notes: [44],
  },
  workOrders: {
    label: "Work orders",
    description: "Plan, release and complete production runs, with work in progress and a production schedule.",
    status: "released",
    area: "Production",
    notes: [51],
  },
  assembliesWithoutBom: {
    label: "Assemblies without parts on the BOM page",
    description: "List every assembly on the BOM page, including ones with no parts yet, marked No parts yet with a button to add them.",
    status: "released",
    area: "Production",
    notes: [],
  },
  newAssembly: {
    label: "New assembly on the BOM page",
    description: "A New assembly button on the BOM page: name the assembly, then go straight to its BOM tab to list the parts it is built from.",
    status: "beta",
    area: "Production",
    notes: [],
  },
  serials: {
    label: "Serial numbers",
    description: "Give each unit of an assembly its own serial number when its work order is released, with a record page showing its history, what went into it, where it is and who bought it.",
    status: "beta",
    area: "Production",
    notes: [],
  },
  workOrderSteps: {
    label: "Work order steps",
    description: "A list of steps on each work order (cut, weld, paint, assemble, check), copied from the item's standard steps, so the run shows which step it is on and since when.",
    status: "released",
    area: "Production",
    notes: [],
  },
  jobs: {
    label: "Jobs and projects",
    description: "Group orders, purchases, work and stock issued under a job, with the people assigned and the running cost.",
    status: "released",
    area: "Production",
    notes: [65],
  },
  seasonalityFilters: {
    label: "Seasonality by part or category",
    description: "Narrow the Seasonality report to chosen part numbers or categories.",
    status: "released",
    area: "Reports",
    notes: [55],
  },
  customerExport: {
    label: "Customer export",
    description: "Export the customer list to CSV from the Customers page.",
    status: "released",
    area: "Reports",
    notes: [62],
  },
  labelFields: {
    label: "More label fields",
    description: "Put location, bin, vendor part number and fitment on labels, with UPC or QR codes.",
    status: "released",
    area: "Printing and labels",
    notes: [67],
  },
  receiptLabels: {
    label: "Labels from a purchase order or receipt",
    description: "Print a label for every unit or line on a purchase order or a delivery, straight from the document.",
    status: "released",
    area: "Printing and labels",
    notes: [72],
  },
  savedCodes: {
    label: "Saved barcodes",
    description: "Labels & barcodes opens on the codes made for each item. Make new ones step by step, then print, export, share, edit or delete them; pick lists print each part's saved code.",
    status: "beta",
    area: "Printing and labels",
    notes: [],
  },
  periodLocks: {
    label: "Period close",
    description: "Close a month or quarter: stock movements dated inside it are refused until an owner or admin reopens it.",
    status: "released",
    area: "Data",
    notes: [59],
  },
  importEditing: {
    label: "Edit rows and parts lists on import",
    description: "On the item import's review step: click a row to change it, mark several rows as assemblies at once, and give each assembly its parts list before anything is saved.",
    status: "released",
    area: "Data",
    notes: [],
  },
  stratoGuide: {
    label: "Strato shows you around",
    description: "Ask Strato where something is or how to do it: it answers with the path and lights up the sidebar entry, button, tab or setting on screen, step by step, and it knows which screen you are on.",
    status: "beta",
    area: "Data",
    notes: [],
  },
  twoStep: {
    label: "Two-step sign-in by email",
    description: "Each person can ask for a 6-digit code by email on every new sign-in, in Account. A stolen password alone no longer opens the workspace.",
    status: "preview",
    area: "Team and security",
    notes: [],
  },
  recaptcha: {
    label: "reCAPTCHA on sign-in and public forms",
    description: "Google reCAPTCHA checks sign-in, sign-up and password reset (through Firebase), and the waitlist, demo, contact and newsletter forms, so scripts cannot flood them.",
    status: "preview",
    area: "Team and security",
    notes: [],
  },
  recordRestore: {
    label: "Restore a single record",
    description: "Bring one item, order or customer back from a Time Machine snapshot without rolling back the whole workspace.",
    status: "planned",
    area: "Data",
    notes: [59],
  },
  quickbooksDesktop: {
    label: "QuickBooks Desktop",
    description: "Export invoices, bills and items as an IIF file that QuickBooks Desktop imports.",
    status: "preview",
    area: "Accounting",
    notes: [43, 64],
  },
  freight: {
    label: "LTL and freight",
    description: "Quote and book freight for orders too big for parcel carriers.",
    status: "planned",
    area: "Orders",
    notes: [42],
  },
} as const satisfies Record<string, FeatureDef>;

export type FeatureId = keyof typeof FEATURES;

export const FEATURE_IDS = Object.keys(FEATURES) as FeatureId[];

export function isFeatureId(value: string): value is FeatureId {
  return Object.prototype.hasOwnProperty.call(FEATURES, value);
}

export function featureDef(id: FeatureId): FeatureDef {
  return FEATURES[id];
}

/** The status as the general type: the registry's own literals would make comparisons with statuses not in use yet a type error. */
export function featureStatus(id: FeatureId): FeatureStatus {
  return FEATURES[id].status;
}

export interface FeatureContext {
  stage: ReleaseStage;
  /** Features forced on for the deployment (CUMULUS_FEATURES); "*" means all of them. */
  forced?: readonly string[];
  /** The workspace's own switches from Settings → Labs. */
  overrides?: Record<string, boolean>;
}

/** Whether a workspace may switch this feature on or off itself in the given stage. */
export function featureSwitchable(id: FeatureId, stage: ReleaseStage): boolean {
  const status = featureStatus(id);
  if (status === "planned" || status === "released") return false;
  return stage !== "production" || status === "beta";
}

/** Where a feature stands before the workspace's own choice is applied. */
export function featureDefault(id: FeatureId, ctx: Pick<FeatureContext, "stage" | "forced">): boolean {
  const status = featureStatus(id);
  if (status === "released") return true;
  if (status === "planned") return false;
  if (ctx.forced?.includes("*") || ctx.forced?.includes(id)) return true;
  // Beta features wait for a production workspace to opt in.
  return ctx.stage !== "production";
}

export function featureEnabled(id: FeatureId, ctx: FeatureContext): boolean {
  const status = featureStatus(id);
  if (status === "released") return true;
  if (status === "planned") return false;
  const choice = ctx.overrides?.[id];
  if (choice !== undefined && featureSwitchable(id, ctx.stage)) return choice;
  return featureDefault(id, ctx);
}

/** Server-side: the stage this deployment runs as. CUMULUS_STAGE overrides what Vercel reports. */
export function releaseStageFromEnv(env: Record<string, string | undefined>): ReleaseStage {
  const forced = env.CUMULUS_STAGE?.trim().toLowerCase();
  if (forced === "production" || forced === "staging" || forced === "development") return forced;
  if (env.VERCEL_ENV === "preview") return "staging";
  if (env.VERCEL_ENV === "production") return "production";
  return env.NODE_ENV === "development" ? "development" : "production";
}

/** Server-side: features forced on for the deployment, from CUMULUS_FEATURES. */
export function forcedFeaturesFromEnv(env: Record<string, string | undefined>): string[] {
  return (env.CUMULUS_FEATURES ?? "")
    .split(",")
    .map((s) => s.trim().replace(/^["']+|["']+$/g, ""))
    .filter((s) => s === "*" || isFeatureId(s));
}

/** Server-side check for API routes that belong to a feature. Workspace overrides are passed in when the route has loaded settings. */
export function serverFeatureEnabled(id: FeatureId, overrides?: Record<string, boolean>): boolean {
  return featureEnabled(id, { stage: releaseStageFromEnv(process.env), forced: forcedFeaturesFromEnv(process.env), overrides });
}
