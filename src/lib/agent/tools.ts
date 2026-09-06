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
    type: z.enum(["part", "assembly"]).optional(),
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
    type: z.enum(["part", "assembly"]).optional(),
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
    description: "Overview of the workspace: item counts, inventory value, low-stock count, open orders/RMAs, categories and suppliers. Call this first when you need context.",
    inputSchema: z.object({}),
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
    description: "Run a built-in report. lowStock: items below min with reorder qty and days of cover. valuation: inventory value by category. shelfLife: oldest batches on the shelf. deadStock: no consumption in N days. consumption: usage by layer (sold / consumed in builds / written off) over N days. seasonality: monthly sales & consumption. openOrders, openRmas, recentActivity, suppliers.",
    inputSchema: z.object({
      report: z.enum(["lowStock", "valuation", "shelfLife", "deadStock", "consumption", "seasonality", "openOrders", "openRmas", "recentActivity", "suppliers", "recentReceipts", "recentBuilds"]),
      days: z.number().optional().describe("Window in days for consumption/deadStock (default 90 / 120)"),
      sku: z.string().optional().describe("Restrict seasonality/consumption to one item"),
      limit: z.number().optional(),
    }),
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
          type: z.enum(["part", "assembly"]).optional(),
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
    description: "Replace or modify the bill of materials for an assembly. Use mode 'replace' to set the full list, 'merge' to add/update lines, 'remove' to drop lines.",
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
  deleteItems: tool({
    description: "Permanently delete items and their history. Prefer deactivateItems. Only use when the user explicitly asks to delete.",
    inputSchema: z.object({ skus: skuList, reason: z.string() }),
  }),
};

export type AgentTools = typeof agentTools;
export type AgentToolName = keyof AgentTools;

export const READ_TOOLS: AgentToolName[] = ["getWorkspaceSummary", "searchItems", "getItem", "explodeBom", "whereUsed", "getReport", "previewBulkUpdate"];
export const WRITE_TOOLS: AgentToolName[] = [
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
  "deleteItems",
];

export function isWriteTool(name: string): name is AgentToolName {
  return (WRITE_TOOLS as string[]).includes(name);
}

/** Human labels for proposal cards. */
export const TOOL_LABELS: Record<AgentToolName, string> = {
  getWorkspaceSummary: "Workspace summary",
  searchItems: "Search items",
  getItem: "Item detail",
  explodeBom: "Explode BOM",
  whereUsed: "Where used",
  getReport: "Report",
  previewBulkUpdate: "Preview bulk update",
  bulkUpdateItems: "Bulk update items",
  createItems: "Create items",
  adjustStock: "Adjust stock",
  receiveStock: "Receive stock",
  buildAssembly: "Build assembly",
  updateBom: "Update BOM",
  deactivateItems: "Deactivate items",
  createOrder: "Create order",
  fulfillOrders: "Fulfil orders",
  createRma: "Create RMA",
  resolveRma: "Resolve RMA",
  upsertSupplier: "Save supplier",
  deleteItems: "Delete items",
};
