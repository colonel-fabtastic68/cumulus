/**
 * Agent tool definitions shared by the server route (schemas only) and the
 * client (execution). Tools have no `execute` on the server: the workspace
 * data lives in the browser store, so every tool runs client-side.
 *
 * READ tools run automatically. WRITE tools are shown to the user as a
 * proposal card and only run after approval (unless agentAutoApprove).
 */
import { z } from "zod";
import { tool } from "ai";

const skuList = z.array(z.string()).describe("Item SKUs (case-insensitive)");

const itemFilter = z
  .object({
    query: z.string().optional().describe("Free text matched against SKU, name, description, category, tags"),
    category: z.string().optional(),
    type: z.enum(["part", "assembly", "kit"]).optional(),
    status: z.enum(["active", "inactive", "superseded"]).optional(),
    supplier: z.string().optional().describe("Supplier name (partial match)"),
    belowMin: z.boolean().optional().describe("Only items below their minimum quantity"),
    tags: z.array(z.string()).optional(),
    location: z.string().optional(),
    noMovementDays: z.number().optional().describe("Only items with no consumption in this many days"),
  })
  .describe("Filter. Omit all fields to match every item.");

const itemFields = z
  .object({
    name: z.string().optional(),
    description: z.string().optional(),
    category: z.string().optional(),
    type: z.enum(["part", "assembly", "kit"]).optional(),
    unit: z.string().optional(),
    status: z.enum(["active", "inactive", "superseded"]).optional(),
    tags: z.array(z.string()).optional(),
    minQty: z.number().nullable().optional(),
    maxQty: z.number().nullable().optional(),
    leadTimeDays: z.number().nullable().optional(),
    unitCost: z.number().optional(),
    price: z.number().optional(),
    salePrice: z.number().nullable().optional().describe("Set null to clear the sale price"),
    priceBreaks: z.array(z.object({ minQty: z.number(), price: z.number() })).optional(),
    location: z.string().optional(),
    supplierName: z.string().optional().describe("Supplier by name; created if missing"),
    supplierSku: z.string().optional(),
    expectedWastePct: z.number().nullable().optional(),
    barcode: z.string().optional(),
    replenishment: z
      .object({
        route: z.enum(["buy", "build"]).optional().describe("buy = purchase order; build = from the BOM (assemblies)"),
        auto: z.boolean().optional().describe("true = a draft purchase order is created daily without asking when the forecast dips below min"),
        multiple: z.number().nullable().optional().describe("Order quantities round up to a multiple of this (case size)"),
        snoozedUntil: z.string().nullable().optional().describe("YYYY-MM-DD; hidden from Replenishment until then"),
      })
      .optional()
      .describe("Replenishment rule (replaces the whole rule)"),
  })
  .describe("Fields to set. Only include fields that should change.");

/** Which items a bulk change targets. */
const bulkTarget = {
  skus: skuList.optional(),
  filter: itemFilter.optional(),
  all: z.boolean().optional().describe("true = every active item. Use when the user says all / every item."),
};

/** What a bulk change does. Shared by previewBulkUpdate and bulkUpdateItems. */
const bulkChange = {
  set: itemFields.optional().describe("Same values for every targeted item"),
  adjustPricePct: z.number().optional().describe("Relative price change in percent: 10 raises every targeted price by 10%, -5 lowers it by 5%"),
  adjustCostPct: z.number().optional().describe("Relative unit-cost change in percent"),
  addTags: z.array(z.string()).optional(),
  removeTags: z.array(z.string()).optional(),
  lines: z
    .array(z.object({ sku: z.string(), set: itemFields }))
    .optional()
    .describe("Per-item values when items get different values, e.g. [{sku:'A', set:{price:10}}, {sku:'B', set:{price:12}}]. Listed SKUs are targeted automatically, so one call covers any number of items."),
};

export const agentTools = {
  // ---- READ -----------------------------------------------------------------
  getWorkspaceSummary: tool({
    description: "Overview of the workspace: item counts, inventory value, low-stock count, open orders/RMAs, categories, suppliers and live connections. Call this first when you need context.",
    inputSchema: z.object({}),
  }),
  getConnections: tool({
    description: "The workspace's live connections (Shopify, WooCommerce, Shippo, EasyPost): status, store, what syncs, last sync and its result, last error, how many items are linked and which items are not yet in the store. Never includes credentials.",
    inputSchema: z.object({}),
  }),
  syncChannel: tool({
    description: "Run a sales-channel sync now: products and open orders in from the store, and optionally push stock levels and new items out. Only works in the hosted app with the channel connected.",
    inputSchema: z.object({
      channel: z.enum(["shopify", "woocommerce"]),
      products: z.boolean().optional().describe("Pull products in (default: the connection's setting)"),
      orders: z.boolean().optional().describe("Pull open orders in (default: the connection's setting)"),
      pushStock: z.boolean().optional().describe("Push on-hand counts out for linked items"),
      pushProducts: z.boolean().optional().describe("Create items the store does not have yet"),
    }),
  }),
  listStoreProductsWithoutSku: tool({
    description: "Products a connected store (Shopify / WooCommerce) lists without a SKU, which is why they were not imported. Returns each one's key, title, variant, price, store quantity and a suggested SKU in the workspace's style. Use assignStoreSkus to fix them.",
    inputSchema: z.object({ channel: z.enum(["shopify", "woocommerce"]).optional().describe("Default: every connected store") }),
  }),
  assignStoreSkus: tool({
    description: "Fix store products that have no SKU: writes the SKU to the store product (Shopify variant / WooCommerce product) and creates the matching item here, linked, with the store's quantity as its opening count. Keys come from listStoreProductsWithoutSku; SKUs must be unique. Put every product in ONE call.",
    inputSchema: z.object({
      channel: z.enum(["shopify", "woocommerce"]),
      assignments: z.array(z.object({ key: z.string().describe("The product's key from listStoreProductsWithoutSku"), sku: z.string() })),
    }),
  }),
  searchItems: tool({
    description: "Search and filter items in ONE call. Pass a list of SKUs to look several up at once, or a filter. Returns SKU, name, type, category, on-hand, min/max, cost, price, supplier, lead time, status. Use limit to keep results small.",
    inputSchema: z.object({ skus: skuList.optional().describe("Look up these SKUs (any number) in a single call"), filter: itemFilter.optional(), limit: z.number().optional().describe("Default 50, max 200"), sortBy: z.enum(["sku", "name", "onHand", "value", "updatedAt"]).optional() }),
  }),
  getItem: tool({
    description: "Full detail for one item: fields, BOM, where-used, recent stock movements, lots on the shelf, buildable quantity (for assemblies).",
    inputSchema: z.object({ sku: z.string().describe("SKU or item id") }),
  }),
  explodeBom: tool({
    description: "Component requirements to build a quantity of an assembly, including sub-assemblies and shortages.",
    inputSchema: z.object({ sku: z.string(), qty: z.number().default(1), consumeSubassemblies: z.boolean().optional().describe("true = pull sub-assemblies from their own stock (default). false = explode them to base parts.") }),
  }),
  whereUsed: tool({
    description: "Which assemblies use this item, directly and indirectly.",
    inputSchema: z.object({ sku: z.string() }),
  }),
  getReport: tool({
    description: "Run a built-in report. lowStock: items below min with reorder qty and days of cover (shelf count only; getReplenishment uses the forecast). valuation: inventory value under the workspace's costing method (standard / average / FIFO), by category, with COGS and receipts over N days and the value on a past date (asOf). shelfLife: oldest batches on the shelf. deadStock: no consumption in N days. consumption: usage by layer (sold / consumed in builds / written off) over N days. seasonality: monthly sales & consumption. backorders: open order lines short on stock with when they could ship. kpis: turnover, days on hand, fill rate, stockouts over N days. transfers: stock moving between locations. openOrders, openRmas, recentActivity, suppliers, recentReceipts, recentBuilds.",
    inputSchema: z.object({
      report: z.enum(["lowStock", "valuation", "shelfLife", "deadStock", "consumption", "seasonality", "backorders", "kpis", "transfers", "openOrders", "openRmas", "recentActivity", "suppliers", "recentReceipts", "recentBuilds"]),
      days: z.number().optional().describe("Window in days for consumption/deadStock/valuation COGS (default 90 / 120 / 30)"),
      sku: z.string().optional().describe("Restrict seasonality/consumption to one item"),
      asOf: z.string().optional().describe("valuation: YYYY-MM-DD to value the stock as it stood at the end of that day"),
      limit: z.number().optional(),
    }),
  }),
  getReplenishment: tool({
    description: "The replenishment plan, forecast-based: for every item with a min/max or a replenishment rule, on hand, incoming (open purchase orders, transfers in transit), outgoing (open sales orders, components for suggested builds), forecast, min/max, usage per day, days of cover, the date to order by, the suggested quantity and route (buy from the supplier or build from the BOM). status 'order' = forecast below min; 'covered' = below min on the shelf but incoming covers it; 'snoozed'; 'ok'. Read-only; use replenish to act. Prefer this over suggestPurchaseOrders.",
    inputSchema: z.object({ status: z.enum(["order", "covered", "snoozed", "ok", "all"]).optional().describe("Default: order"), supplierName: z.string().optional(), route: z.enum(["buy", "build"]).optional(), limit: z.number().optional() }),
  }),
  traceLot: tool({
    description: "Trace a batch (lot): where it came from (the receipt, purchase order and supplier, or the build and the component batches that went into it) and where every unit went (sales with order and customer, builds with the batch they produced, write-offs). query is a lot number (LOT-1001), a supplier's batch code, a SKU, or a receipt / purchase order / build number; several matches come back as a list to choose from.",
    inputSchema: z.object({ query: z.string(), limit: z.number().optional().describe("Max batches to return when several match (default 10)") }),
  }),
  previewBulkUpdate: tool({
    description: "Dry-run of bulkUpdateItems with the same arguments: which items match and what would change on each. Use it to confirm scope before a large change.",
    inputSchema: z.object({ ...bulkTarget, ...bulkChange }),
  }),

  // ---- WRITE (require approval) ---------------------------------------------
  bulkUpdateItems: tool({
    description: "Update any number of items in ONE call. Target them with skus, a filter, or all: true. Same value for every target: set. Percentage change: adjustPricePct / adjustCostPct. Different values per item: lines (one entry per SKU, all in this single call). Never call this once per item. Always give a reason.",
    inputSchema: z.object({ ...bulkTarget, ...bulkChange, reason: z.string() }),
  }),
  createItems: tool({
    description: "Create new items (parts or assemblies). SKUs must be unique. Optional openingQty records an opening balance. Optional bom uses component SKUs.",
    inputSchema: z.object({
      items: z.array(
        z.object({
          sku: z.string(),
          name: z.string(),
          type: z.enum(["part", "assembly", "kit"]).optional(),
          category: z.string().optional(),
          description: z.string().optional(),
          unit: z.string().optional(),
          unitCost: z.number().optional(),
          price: z.number().optional(),
          minQty: z.number().optional(),
          maxQty: z.number().optional(),
          leadTimeDays: z.number().optional(),
          location: z.string().optional(),
          supplierName: z.string().optional(),
          tags: z.array(z.string()).optional(),
          openingQty: z.number().optional(),
          bom: z.array(z.object({ sku: z.string(), qty: z.number(), wastePct: z.number().optional() })).optional(),
        }),
      ),
      reason: z.string().optional(),
    }),
  }),
  adjustStock: tool({
    description: "Adjust on-hand quantities: cycle counts (newQty), corrections (qtyDelta), or write-offs (negative qtyDelta with type write_off). Every change is logged to the ledger. Supports back-dating with occurredAt.",
    inputSchema: z.object({
      adjustments: z.array(
        z.object({
          sku: z.string(),
          qtyDelta: z.number().optional(),
          newQty: z.number().optional(),
          type: z.enum(["adjustment", "count", "write_off"]).optional(),
          reason: z.string().optional(),
        }),
      ),
      reason: z.string().describe("Overall reason, e.g. 'Q3 cycle count'"),
      occurredAt: z.string().optional().describe("ISO date to back-date the movement"),
    }),
  }),
  receiveStock: tool({
    description: "Record a receipt of goods from a supplier. Creates lots for shelf-life tracking and updates standard cost. Supports back-dating.",
    inputSchema: z.object({
      supplierName: z.string().optional(),
      reference: z.string().optional().describe("PO or packing slip number"),
      receivedAt: z.string().optional().describe("ISO date; defaults to now"),
      lines: z.array(z.object({ sku: z.string(), qty: z.number(), unitCost: z.number().optional() })),
      note: z.string().optional(),
    }),
  }),
  buildAssembly: tool({
    description: "Build an assembly from its BOM: consumes components (and sub-assemblies) and adds finished units to stock. Fails with a shortage list if parts are missing.",
    inputSchema: z.object({ sku: z.string(), qty: z.number(), consumeSubassemblies: z.boolean().optional(), note: z.string().optional() }),
  }),
  updateBom: tool({
    description: "Replace or modify the bill of materials for an assembly, or the contents of a kit. Use mode 'replace' to set the full list, 'merge' to add/update lines, 'remove' to drop lines.",
    inputSchema: z.object({
      sku: z.string(),
      mode: z.enum(["replace", "merge", "remove"]).default("merge"),
      lines: z.array(z.object({ sku: z.string(), qty: z.number().optional(), wastePct: z.number().optional() })),
      reason: z.string().optional(),
    }),
  }),
  deactivateItems: tool({
    description: "Deactivate or supersede part numbers in bulk. Provide supersededBySku to mark them as superseded by a replacement.",
    inputSchema: z.object({ skus: skuList.optional(), filter: itemFilter.optional(), supersededBySku: z.string().optional(), reason: z.string() }),
  }),
  createOrder: tool({
    description: "Create a sales order. Set fulfill=true to ship immediately and relieve stock.",
    inputSchema: z.object({ customer: z.string(), lines: z.array(z.object({ sku: z.string(), qty: z.number(), unitPrice: z.number().optional() })), fulfill: z.boolean().optional(), note: z.string().optional() }),
  }),
  fulfillOrders: tool({
    description: "Ship open sales orders by number (e.g. SO-1042). Relieves stock.",
    inputSchema: z.object({ orderNumbers: z.array(z.string()) }),
  }),
  createRma: tool({
    description: "Open a return (RMA) ticket for goods coming back.",
    inputSchema: z.object({ customer: z.string(), reason: z.string(), reference: z.string().optional(), lines: z.array(z.object({ sku: z.string(), qty: z.number(), condition: z.enum(["good", "damaged", "unknown"]).optional() })) }),
  }),
  resolveRma: tool({
    description: "Resolve an RMA: restock (returns to inventory automatically), refund, or scrap each line.",
    inputSchema: z.object({ rmaNumber: z.string(), dispositions: z.array(z.object({ sku: z.string(), disposition: z.enum(["restock", "refund", "scrap"]) })), note: z.string().optional() }),
  }),
  upsertSupplier: tool({
    description: "Create or update a supplier by name.",
    inputSchema: z.object({ name: z.string(), email: z.string().optional(), phone: z.string().optional(), website: z.string().optional(), leadTimeDays: z.number().optional(), terms: z.string().optional(), notes: z.string().optional() }),
  }),
  listPurchaseOrders: tool({
    description: "List purchase orders with their lines, what has been received and what is still due. status 'open' = draft, sent or partly received.",
    inputSchema: z.object({ status: z.enum(["open", "draft", "sent", "partial", "received", "cancelled", "all"]).optional(), supplierName: z.string().optional(), limit: z.number().optional() }),
  }),
  suggestPurchaseOrders: tool({
    description: "Draft purchase orders from the replenishment plan (forecast below min), grouped by supplier, with quantities and each supplier's last cost. Read-only: use replenish (preferred, merges into open drafts) or createPurchaseOrder to place them.",
    inputSchema: z.object({ supplierName: z.string().optional() }),
  }),
  replenish: tool({
    description: "Act on the replenishment plan: creates draft purchase orders, one per supplier, adding lines to a supplier's open draft instead of raising a second order. Pass lines (SKU, optional qty to override the plan, optional supplierName) or all: true for everything the plan says to order. Assemblies routed to build are reported back, not ordered. send=true marks new orders sent.",
    inputSchema: z.object({
      lines: z.array(z.object({ sku: z.string(), qty: z.number().optional(), supplierName: z.string().optional() })).optional(),
      all: z.boolean().optional().describe("Every item whose status is 'order'"),
      send: z.boolean().optional(),
      mergeIntoDrafts: z.boolean().optional().describe("Default true. false always raises a new order."),
    }),
  }),
  snoozeReplenishment: tool({
    description: "Hide items from the replenishment plan until a date (YYYY-MM-DD), or clear the snooze with until = null.",
    inputSchema: z.object({ skus: skuList, until: z.string().nullable() }),
  }),
  mergePurchaseOrders: tool({
    description: "Fold several open purchase orders to the same supplier, with nothing received yet, into one. The oldest (or keepNumber) keeps its number, terms and expected date and takes the others' lines (same item: quantities added at the weighted cost); the rest close as merged. Nothing moves in stock.",
    inputSchema: z.object({ poNumbers: z.array(z.string()).min(2), keepNumber: z.string().optional() }),
  }),
  createPurchaseOrder: tool({
    description: "Create a purchase order to a supplier. Lines take SKUs; unit cost defaults to the supplier's last cost for the item. It is a draft unless send=true. fromTemplate names a saved PO template; its lines are used when no lines are given.",
    inputSchema: z.object({
      supplierName: z.string(),
      lines: z.array(z.object({ sku: z.string(), qty: z.number(), unitCost: z.number().optional(), note: z.string().optional() })).optional(),
      fromTemplate: z.string().optional(),
      expectedAt: z.string().optional().describe("YYYY-MM-DD"),
      terms: z.string().optional(),
      reference: z.string().optional(),
      note: z.string().optional(),
      send: z.boolean().optional(),
    }),
  }),
  receivePurchaseOrder: tool({
    description: "Receive goods against one purchase order (poNumber) or several from the same supplier that arrived together (poNumbers): ONE receipt closes lines on all of them. Omit lines to receive everything still open; give lines for a partial delivery (a line may name its poNumber; otherwise the oldest order with that item open is used). Optional supplierLot / expiresAt per line go on the batch for traceability. Books a receipt, so stock, batches and costs update.",
    inputSchema: z.object({
      poNumber: z.string().optional(),
      poNumbers: z.array(z.string()).optional(),
      lines: z.array(z.object({ sku: z.string(), qty: z.number(), unitCost: z.number().optional(), poNumber: z.string().optional(), supplierLot: z.string().optional(), expiresAt: z.string().optional() })).optional(),
      receivedAt: z.string().optional(),
      note: z.string().optional(),
    }),
  }),
  savePurchaseOrderTemplate: tool({
    description: "Save a reusable purchase order template (supplier and lines) under a name so the same order can be placed again later.",
    inputSchema: z.object({ name: z.string(), supplierName: z.string().optional(), lines: z.array(z.object({ sku: z.string(), qty: z.number(), unitCost: z.number().optional() })), description: z.string().optional(), note: z.string().optional() }),
  }),
  proposeCycleCount: tool({
    description: "Propose a cycle count: which items at a location deserve counting now (never counted, busy since the last count, low or negative on paper, high value), each with the quantity the system expects. Read-only; use startCycleCount to begin one.",
    inputSchema: z.object({ locationName: z.string().optional(), limit: z.number().optional() }),
  }),
  getCycleCount: tool({
    description: "Read a cycle count by number (e.g. CC-1001): every line with expected, counted, the difference, and any proposal Strato made.",
    inputSchema: z.object({ countNumber: z.string() }),
  }),
  startCycleCount: tool({
    description: "Start a cycle count at a location. Scope is a list of bins, a category, or a list of SKUs. Optional proposals record the quantity you expect per SKU so the result can be compared with your expectation afterwards.",
    inputSchema: z.object({
      locationName: z.string().optional(),
      scope: z.object({ kind: z.enum(["location", "bins", "category", "items"]), bins: z.array(z.string()).optional(), category: z.string().optional(), skus: z.array(z.string()).optional() }),
      name: z.string().optional(),
      blind: z.boolean().optional(),
      note: z.string().optional(),
      proposals: z.array(z.object({ sku: z.string(), expected: z.number(), note: z.string().optional() })).optional(),
    }),
  }),
  recordCycleCounts: tool({
    description: "Record counted quantities on an open cycle count by number. Only the SKUs given change; the rest stay as they are.",
    inputSchema: z.object({ countNumber: z.string(), entries: z.array(z.object({ sku: z.string(), counted: z.number(), note: z.string().optional() })) }),
  }),
  completeCycleCount: tool({
    description: "Complete a cycle count: every counted line that differs from the system quantity becomes a count movement at the location. Lines left uncounted are untouched.",
    inputSchema: z.object({ countNumber: z.string(), applyAdjustments: z.boolean().optional() }),
  }),
  deleteItems: tool({
    description: "Permanently delete items and their history. Prefer deactivateItems. Only use when the user explicitly asks to delete.",
    inputSchema: z.object({ skus: skuList, reason: z.string() }),
  }),
};

export type AgentTools = typeof agentTools;
export type AgentToolName = keyof AgentTools;

export const READ_TOOLS: AgentToolName[] = ["getWorkspaceSummary", "getConnections", "listStoreProductsWithoutSku", "searchItems", "getItem", "explodeBom", "whereUsed", "getReport", "getReplenishment", "traceLot", "previewBulkUpdate", "listPurchaseOrders", "suggestPurchaseOrders", "proposeCycleCount", "getCycleCount"];
export const WRITE_TOOLS: AgentToolName[] = [
  "replenish",
  "snoozeReplenishment",
  "mergePurchaseOrders",
  "bulkUpdateItems",
  "createItems",
  "adjustStock",
  "receiveStock",
  "buildAssembly",
  "updateBom",
  "deactivateItems",
  "createOrder",
  "fulfillOrders",
  "createRma",
  "resolveRma",
  "upsertSupplier",
  "createPurchaseOrder",
  "receivePurchaseOrder",
  "savePurchaseOrderTemplate",
  "startCycleCount",
  "recordCycleCounts",
  "completeCycleCount",
  "deleteItems",
  "syncChannel",
  "assignStoreSkus",
];

export function isWriteTool(name: string): name is AgentToolName {
  return (WRITE_TOOLS as string[]).includes(name);
}

/** Human labels for proposal cards. */
export const TOOL_LABELS: Record<AgentToolName, string> = {
  getWorkspaceSummary: "Workspace summary",
  getConnections: "Connections",
  syncChannel: "Sync channel",
  listStoreProductsWithoutSku: "Store products without SKU",
  assignStoreSkus: "Assign store SKUs",
  searchItems: "Search items",
  getItem: "Item detail",
  explodeBom: "Explode BOM",
  whereUsed: "Where used",
  getReport: "Report",
  getReplenishment: "Replenishment plan",
  traceLot: "Trace batch",
  replenish: "Replenish",
  snoozeReplenishment: "Snooze replenishment",
  mergePurchaseOrders: "Merge purchase orders",
  previewBulkUpdate: "Preview bulk update",
  bulkUpdateItems: "Bulk update items",
  createItems: "Create items",
  adjustStock: "Adjust stock",
  receiveStock: "Receive stock",
  buildAssembly: "Build assembly",
  updateBom: "Update BOM",
  deactivateItems: "Deactivate items",
  createOrder: "Create order",
  fulfillOrders: "Fulfill orders",
  createRma: "Create RMA",
  resolveRma: "Resolve RMA",
  upsertSupplier: "Save supplier",
  listPurchaseOrders: "Purchase orders",
  suggestPurchaseOrders: "Suggest purchase orders",
  createPurchaseOrder: "Create purchase order",
  receivePurchaseOrder: "Receive purchase order",
  savePurchaseOrderTemplate: "Save PO template",
  proposeCycleCount: "Propose cycle count",
  getCycleCount: "Cycle count",
  startCycleCount: "Start cycle count",
  recordCycleCounts: "Record counts",
  completeCycleCount: "Complete cycle count",
  deleteItems: "Delete items",
};
