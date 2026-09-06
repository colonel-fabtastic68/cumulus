/**
 * Cumulus domain model.
 *
 * Every record has a string `id`. Dates are ISO-8601 strings so records
 * serialise cleanly to localStorage and Firestore alike.
 */

export type ID = string;

// ---------------------------------------------------------------------------
// Items (parts, assemblies)
// ---------------------------------------------------------------------------

export type ItemType = "part" | "assembly";
export type ItemStatus = "active" | "inactive" | "superseded";

export interface PriceBreak {
  minQty: number;
  price: number;
}

export interface BomLine {
  itemId: ID;
  qty: number;
  /** Expected waste on this component when building, as a percentage (0-100). */
  wastePct?: number;
  note?: string;
}

export interface Item {
  id: ID;
  sku: string;
  name: string;
  description?: string;
  type: ItemType;
  category?: string;
  tags: string[];
  /** Unit of measure, e.g. "ea", "ft", "kg". */
  unit: string;
  status: ItemStatus;
  /** When status is "superseded", the item that replaces this one. */
  supersededBy?: ID;

  /** Quantity on the shelf and available. Always derived from stock movements. */
  onHand: number;
  /** Optional in-use tracking (checked out to jobs but not yet consumed). */
  inUse: number;

  minQty?: number;
  maxQty?: number;
  leadTimeDays?: number;

  /** Current standard unit cost. */
  unitCost: number;
  /** List price. */
  price: number;
  salePrice?: number;
  priceBreaks?: PriceBreak[];

  supplierId?: ID;
  supplierSku?: string;
  /** Bin / shelf location. */
  location?: string;
  barcode?: string;
  /** Expected manufacturing waste for this item when consumed, as a percentage. */
  expectedWastePct?: number;

  /** Bill of materials. Only meaningful for assemblies. */
  bom: BomLine[];

  externalIds?: {
    shopify?: string;
    woocommerce?: string;
    quickbooks?: string;
  };

  createdAt: string;
  updatedAt: string;
  updatedBy?: string;
}

// ---------------------------------------------------------------------------
// Stock ledger
// ---------------------------------------------------------------------------

export type MovementType =
  | "receipt"
  | "adjustment"
  | "count"
  | "write_off"
  | "build_consume"
  | "build_produce"
  | "sale"
  | "rma_return"
  | "import";

export type RefType = "receipt" | "build" | "order" | "rma" | "import" | "agent" | "manual";

export interface StockMovement {
  id: ID;
  itemId: ID;
  type: MovementType;
  /** Signed quantity delta. Positive adds stock, negative removes it. */
  qty: number;
  /** Unit cost at the time of the movement (used for valuation and COGS). */
  unitCost?: number;
  lotId?: ID;
  refType?: RefType;
  refId?: ID;
  reason?: string;
  note?: string;
  /** Running on-hand balance after this movement was applied. */
  balanceAfter: number;
  /** Effective date. May be back-dated relative to createdAt. */
  occurredAt: string;
  createdAt: string;
  createdBy: string;
}

/** A batch of stock received together. Used for shelf-life tracking. */
export interface Lot {
  id: ID;
  itemId: ID;
  receiptId?: ID;
  qtyReceived: number;
  qtyRemaining: number;
  unitCost: number;
  receivedAt: string;
  expiresAt?: string;
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export interface Supplier {
  id: ID;
  name: string;
  email?: string;
  phone?: string;
  website?: string;
  leadTimeDays?: number;
  terms?: string;
  notes?: string;
  createdAt: string;
}

export interface ReceiptLine {
  itemId: ID;
  qty: number;
  unitCost: number;
  lotId?: ID;
}

export interface Receipt {
  id: ID;
  number: string; // RCV-1001
  supplierId?: ID;
  /** Vendor reference or PO number. */
  reference?: string;
  status: "draft" | "received";
  /** Effective receiving date (can be back-dated). */
  receivedAt: string;
  lines: ReceiptLine[];
  note?: string;
  createdAt: string;
  createdBy: string;
}

export interface BuildComponent {
  itemId: ID;
  qtyPer: number;
  qtyConsumed: number;
}

export interface Build {
  id: ID;
  number: string; // BLD-1001
  assemblyId: ID;
  qty: number;
  status: "planned" | "completed";
  /**
   * When true, sub-assemblies on the BOM are relieved from their own stock.
   * When false, sub-assemblies are exploded and their components consumed.
   */
  consumeSubassemblies: boolean;
  components: BuildComponent[];
  note?: string;
  completedAt?: string;
  createdAt: string;
  createdBy: string;
}

export type OrderSource = "manual" | "shopify" | "woocommerce" | "import";

export interface OrderLine {
  itemId: ID;
  qty: number;
  unitPrice: number;
}

export interface SalesOrder {
  id: ID;
  number: string; // SO-1001
  customer: string;
  status: "open" | "fulfilled" | "cancelled";
  source: OrderSource;
  lines: OrderLine[];
  note?: string;
  fulfilledAt?: string;
  createdAt: string;
  createdBy: string;
}

export type RmaStatus = "open" | "inspecting" | "restocked" | "refunded" | "scrapped";
export type RmaCondition = "good" | "damaged" | "unknown";
export type RmaDisposition = "restock" | "refund" | "scrap";

export interface RmaLine {
  itemId: ID;
  qty: number;
  condition: RmaCondition;
  disposition?: RmaDisposition;
}

export interface Rma {
  id: ID;
  number: string; // RMA-1001
  customer: string;
  orderId?: ID;
  reference?: string;
  status: RmaStatus;
  reason: string;
  lines: RmaLine[];
  note?: string;
  resolvedAt?: string;
  createdAt: string;
  createdBy: string;
}

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------

export type MemberRole = "owner" | "admin" | "member" | "viewer";

export interface Member {
  id: ID;
  name: string;
  email: string;
  role: MemberRole;
  /** Hex colour used for the avatar. */
  color: string;
  status: "active" | "invited";
  /** Signed in anonymously (Firestore mode). */
  guest?: boolean;
  lastSeenAt?: string;
  createdAt: string;
}

export type ActivityType =
  | "item.created"
  | "item.updated"
  | "item.deleted"
  | "stock.adjusted"
  | "stock.received"
  | "stock.written_off"
  | "build.completed"
  | "order.created"
  | "order.fulfilled"
  | "order.cancelled"
  | "rma.created"
  | "rma.resolved"
  | "import.completed"
  | "agent.action"
  | "member.joined"
  | "settings.updated";

export interface ActivityEvent {
  id: ID;
  type: ActivityType;
  message: string;
  actorId: string;
  actorName: string;
  entityType?: "item" | "receipt" | "build" | "order" | "rma" | "supplier" | "member";
  entityId?: ID;
  /** Free-form details, e.g. { count: 12 } for bulk operations. */
  meta?: Record<string, unknown>;
  createdAt: string;
}

export type IntegrationId = "shopify" | "woocommerce" | "quickbooks" | "square";

export interface Integration {
  id: IntegrationId;
  status: "not_connected" | "connected" | "error";
  /** Store URL / realm etc. Never store secrets here. */
  config?: Record<string, string>;
  lastSyncAt?: string;
  createdAt: string;
}

export interface AgentAutomation {
  id: ID;
  name: string;
  description: string;
  prompt: string;
  schedule: "daily" | "weekly" | "monthly" | "manual";
  enabled: boolean;
}

export interface WorkspaceSettings {
  id: "default";
  companyName: string;
  currency: string; // ISO 4217, e.g. "USD"
  timezone: string;
  /** Factor 2: optionally track in-use quantities as a separate bucket. */
  trackInUse: boolean;
  /** Factor 19/20: when component stock is relieved. */
  relievePolicy: "on_build" | "on_fulfill";
  /** Factor 16: auto-flag items with no movement for this many days. */
  inactivityDays: number;
  /** Let Nimbus apply write actions without an explicit approval click. */
  agentAutoApprove: boolean;
  automations: AgentAutomation[];
  /** Next document numbers. */
  counters: {
    receipt: number;
    build: number;
    order: number;
    rma: number;
  };
  updatedAt: string;
}

/** Persisted agent chat session so teammates can see what Nimbus did. */
export interface AgentSession {
  id: ID;
  title: string;
  /** Serialised AI SDK UIMessage[] */
  messages: unknown[];
  createdBy: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Collections
// ---------------------------------------------------------------------------

export interface CollectionMap {
  items: Item;
  movements: StockMovement;
  lots: Lot;
  suppliers: Supplier;
  receipts: Receipt;
  builds: Build;
  orders: SalesOrder;
  rmas: Rma;
  members: Member;
  activity: ActivityEvent;
  integrations: Integration;
  settings: WorkspaceSettings;
  agentSessions: AgentSession;
}

export type CollectionName = keyof CollectionMap;

export const COLLECTIONS: CollectionName[] = [
  "items",
  "movements",
  "lots",
  "suppliers",
  "receipts",
  "builds",
  "orders",
  "rmas",
  "members",
  "activity",
  "integrations",
  "settings",
  "agentSessions",
];

/** A full snapshot of a workspace. Used for seed data, export and import. */
export type WorkspaceSnapshot = { [K in CollectionName]: CollectionMap[K][] };
