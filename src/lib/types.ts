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

  brand?: string;
  weight?: number;
  /** Unit for `weight`, e.g. "lb" or "kg". */
  weightUnit?: string;
  dimensions?: { length?: number; width?: number; height?: number; unit?: string };
  imageUrl?: string;
  /** Extra attributes captured on import (custom fields), keyed by field name. */
  attributes?: Record<string, string>;

  /** Quantity and bin per location. Absent on items that pre-date locations: everything then sits in the default location. */
  stock?: Record<ID, ItemStock>;
  /** Units that have left one location on a transfer and not yet arrived at the other. */
  inTransit?: number;
  /** Other numbers this part is known by (OEM, aftermarket, competitor, supplier, nickname). Searchable everywhere. */
  crossRefs?: CrossRef[];
  /** Ids on connected sales channels, filled in by sync. */
  channels?: ChannelRefs;

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
  | "import"
  | "transfer_out"
  | "transfer_in";

export type RefType = "receipt" | "build" | "order" | "rma" | "import" | "agent" | "manual" | "transfer" | "shipment" | "channel";

export interface StockMovement {
  id: ID;
  itemId: ID;
  type: MovementType;
  /** Signed quantity delta. Positive adds stock, negative removes it. */
  qty: number;
  /** Unit cost at the time of the movement (used for valuation and COGS). */
  unitCost?: number;
  /** Where the stock moved. Absent on movements that pre-date locations (the default location). */
  locationId?: ID;
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
  /** Units shipped so far. The difference to qty is open, and backordered when stock is short. */
  shipped?: number;
}

export interface SalesOrder {
  id: ID;
  number: string; // SO-1001
  customer: string;
  /** partial = some units shipped, the rest still open. */
  status: "open" | "partial" | "fulfilled" | "cancelled";
  source: OrderSource;
  lines: OrderLine[];
  note?: string;
  customerEmail?: string;
  shipTo?: Address;
  /** Set when the order came from a connected channel. */
  channel?: IntegrationId;
  externalId?: string;
  /** Human reference on the channel, e.g. Shopify "#1042". */
  externalRef?: string;
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

// ---------------------------------------------------------------------------
// Locations, transfers, shipments and cross-references
// ---------------------------------------------------------------------------

export interface Address {
  name?: string;
  company?: string;
  street1: string;
  street2?: string;
  city: string;
  state?: string;
  zip: string;
  /** ISO 3166-1 alpha-2, e.g. "US". */
  country: string;
  phone?: string;
  email?: string;
}

export type LocationKind = "warehouse" | "store" | "vehicle" | "trailer" | "customer" | "other";

/** Somewhere stock can sit: a warehouse, a store, a truck. Bins live inside a location per item. */
export interface Location {
  id: ID;
  name: string;
  kind: LocationKind;
  /** Short code for labels and scanning, e.g. "WH-B". */
  code?: string;
  address?: Address;
  isDefault?: boolean;
  active: boolean;
  createdAt: string;
}

export interface ItemStock {
  qty: number;
  /** Aisle / rack / bin within the location. */
  bin?: string;
}

export type CrossRefKind = "oem" | "aftermarket" | "competitor" | "supplier" | "alias";

export interface CrossRef {
  number: string;
  kind: CrossRefKind;
  /** Whose number it is: the OEM, a competitor brand, a supplier. */
  source?: string;
  note?: string;
}

export type TransferStatus = "in_transit" | "received" | "cancelled";

export interface TransferLine {
  itemId: ID;
  qty: number;
  /** Filled in when the transfer is received; less than qty means units went missing in transit. */
  receivedQty?: number;
}

/** Stock moving between locations. In transit it is on hand at neither end. */
export interface Transfer {
  id: ID;
  number: string; // TR-1001
  fromLocationId: ID;
  toLocationId: ID;
  status: TransferStatus;
  lines: TransferLine[];
  note?: string;
  carrier?: string;
  trackingNumber?: string;
  shippedAt: string;
  receivedAt?: string;
  receivedBy?: string;
  createdAt: string;
  createdBy: string;
}

export type ShipmentProvider = "manual" | "shippo" | "easypost";

export interface ShipmentLine {
  itemId: ID;
  qty: number;
}

/** One parcel or hand-off against an order. An order can have several (partial shipments). */
export interface Shipment {
  id: ID;
  number: string; // SH-1001
  orderId: ID;
  lines: ShipmentLine[];
  locationId?: ID;
  carrier?: string;
  service?: string;
  trackingNumber?: string;
  trackingUrl?: string;
  /** Latest carrier status, e.g. "in_transit", "delivered". */
  trackingStatus?: string;
  trackingUpdatedAt?: string;
  labelUrl?: string;
  cost?: number;
  currency?: string;
  provider?: ShipmentProvider;
  /** The carrier platform's own id for the label/transaction. */
  providerRef?: string;
  note?: string;
  shippedAt: string;
  createdAt: string;
  createdBy: string;
}

export interface ChannelRefs {
  shopify?: { productId: string; variantId: string; inventoryItemId?: string };
  woocommerce?: { productId: string; variationId?: string };
}

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
  /** Firestore mode: the invite this member joined through (checked by the security rules). */
  inviteId?: string;
  lastSeenAt?: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Accounts and workspaces (Firestore mode). These live outside the workspace:
// users/{uid}, workspaces/{id} (the document itself) and invites/{code}.
// ---------------------------------------------------------------------------

export interface WorkspaceMembership {
  id: ID;
  name: string;
  role: MemberRole;
  joinedAt: string;
}

export interface UserProfile {
  id: ID;
  email: string;
  name: string;
  guest?: boolean;
  /** Workspaces this account belongs to, by workspace id. */
  workspaces: Record<ID, WorkspaceMembership>;
  lastWorkspaceId?: ID;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceDoc {
  id: ID;
  name: string;
  ownerId: ID;
  createdAt: string;
}

export type InviteStatus = "pending" | "accepted" | "revoked";

export interface WorkspaceInvite {
  /** The invite code. */
  id: ID;
  workspaceId: ID;
  workspaceName: string;
  /** Lower-case address the invite is for; absent for a link anyone can use. */
  email?: string;
  role: MemberRole;
  invitedById: ID;
  invitedByName: string;
  status: InviteStatus;
  createdAt: string;
  acceptedById?: ID;
  acceptedByName?: string;
  acceptedAt?: string;
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
  | "settings.updated"
  | "transfer.created"
  | "transfer.received"
  | "transfer.cancelled"
  | "order.shipped"
  | "order.ready"
  | "integration.connected"
  | "integration.disconnected"
  | "integration.synced"
  | "shipment.tracked"
  | "quote.created"
  | "quote.sent"
  | "quote.accepted"
  | "quote.declined";

export interface ActivityEvent {
  id: ID;
  type: ActivityType;
  message: string;
  actorId: string;
  actorName: string;
  entityType?: "item" | "receipt" | "build" | "order" | "rma" | "supplier" | "member" | "transfer" | "shipment" | "integration" | "location" | "quote";
  entityId?: ID;
  /** Free-form details, e.g. { count: 12 } for bulk operations. */
  meta?: Record<string, unknown>;
  createdAt: string;
}

export type IntegrationId = "shopify" | "woocommerce" | "quickbooks" | "square" | "shippo" | "easypost";

export interface IntegrationSettings {
  /** Pull products and variants in as items (channels). */
  syncProducts?: boolean;
  /** Pull unfulfilled orders in as sales orders (channels). */
  syncOrders?: boolean;
  /** Push Cumulus on-hand counts to the channel after every stock change. */
  pushStock?: boolean;
  /** Create items that are not in the channel yet as products there: a few seconds after they are added here, and on every sync. */
  pushProducts?: boolean;
  /** Pushed products go live at once instead of waiting as drafts. */
  publishProducts?: boolean;
  /** On the first product sync, take the channel's quantities as the opening counts. */
  takeStockOnFirstSync?: boolean;
  /** Apply stock changes reported by the channel (webhooks) as counts. Off means Cumulus is the source of truth. */
  acceptStockFromChannel?: boolean;
  /** Cumulus location that mirrors the channel's stock. */
  locationId?: ID;
  /** The channel's own location id (Shopify) that stock is pushed to. */
  channelLocationId?: string;
}

export interface Integration {
  id: IntegrationId;
  status: "not_connected" | "connected" | "error";
  /** Non-secret connection details (store domain, shop name, account). Secrets live server-side only. */
  config?: Record<string, string>;
  settings?: IntegrationSettings;
  connectedAt?: string;
  connectedBy?: string;
  lastSyncAt?: string;
  /** One line about the last sync, e.g. "12 products, 3 orders". */
  lastSyncSummary?: string;
  lastError?: string;
  /** Webhooks registered on the platform, so they can be removed on disconnect. */
  webhooks?: Array<{ id: string; topic: string }>;
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
    transfer?: number;
    shipment?: number;
    quote?: number;
  };
  shipping?: ShippingSettings;
  scanning?: ScanningSettings;
  quoting?: QuotingSettings;
  updatedAt: string;
}

export interface ShippingSettings {
  /** Where parcels ship from. Needed to rate-shop with a connected carrier. */
  from?: Address;
  /** Package used when a rate is requested and the items carry no dimensions. */
  parcel?: ParcelDefaults;
}

export interface ParcelDefaults {
  length: number;
  width: number;
  height: number;
  distanceUnit: "in" | "cm";
  weight: number;
  massUnit: "lb" | "oz" | "kg" | "g";
}

export interface ScanningSettings {
  /** Treat fast keyboard input ending in Enter as a barcode scan anywhere in the app. */
  keyboardWedge: boolean;
}

// ---------------------------------------------------------------------------
// Quotes
// ---------------------------------------------------------------------------

export type QuoteStatus = "draft" | "sent" | "accepted" | "declined" | "expired";
export type QuoteLineKind = "item" | "labor" | "other";

export interface QuoteLine {
  id: ID;
  kind: QuoteLineKind;
  /** Inventory item for "item" lines. */
  itemId?: ID;
  description: string;
  qty: number;
  /** Unit for the quantity: the item's unit, "h" for labour, free text otherwise. */
  unit?: string;
  unitPrice: number;
  /** What the line costs the business per unit, for margin. Item cost, labour cost rate, or supplier price. */
  unitCost?: number;
  discountPct?: number;
  note?: string;
}

export interface Quote {
  id: ID;
  number: string; // QT-1001
  customer: string;
  customerEmail?: string;
  status: QuoteStatus;
  lines: QuoteLine[];
  /** Whole-quote discount on the subtotal. */
  discountPct?: number;
  taxPct?: number;
  currency: string;
  validUntil?: string;
  notes?: string;
  terms?: string;
  /** The request the quote was drafted from, when Nimbus wrote it. */
  sourcePrompt?: string;
  /** Sales order created from this quote, if accepted. */
  orderId?: ID;
  sentAt?: string;
  decidedAt?: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export interface QuotingSettings {
  /** What an hour of labour is charged at. */
  laborRate: number;
  /** What an hour of labour costs the business, for margin. */
  laborCost?: number;
  /** Target margin used when an item has no list price. */
  defaultMarginPct?: number;
  taxPct?: number;
  /** Days a quote stays valid. */
  validDays: number;
  terms?: string;
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
  locations: Location;
  transfers: Transfer;
  shipments: Shipment;
  quotes: Quote;
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
  "locations",
  "transfers",
  "shipments",
  "quotes",
];

/** A full snapshot of a workspace. Used for seed data, export and import. */
export type WorkspaceSnapshot = { [K in CollectionName]: CollectionMap[K][] };
