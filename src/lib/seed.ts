import type {
  ActivityEvent,
  Build,
  Item,
  Lot,
  Member,
  Receipt,
  Rma,
  SalesOrder,
  StockMovement,
  Supplier,
  WorkspaceSettings,
  WorkspaceSnapshot,
} from "@/lib/types";

/**
 * Demo workspace: "Halcyon Audio", a small guitar-pedal maker that sells on
 * Shopify. Chosen because it exercises BOMs-within-BOMs, receiving, builds,
 * sales, RMAs and write-offs with a realistic six months of history.
 *
 * The generator is deterministic (seeded RNG) so every fresh workspace looks
 * the same and reports are reproducible.
 */

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

const DAY = 86_400_000;

function iso(daysAgo: number, hour = 10, base = Date.now()): string {
  const d = new Date(base - daysAgo * DAY);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

export const SEED_MEMBERS: Member[] = [
  { id: "u_baker", name: "Baker Cobb", email: "bakerjcobb@gmail.com", role: "owner", color: "#1f5f8b", status: "active", createdAt: iso(200) },
  { id: "u_maya", name: "Maya Chen", email: "maya@halcyonaudio.example", role: "admin", color: "#7a3e9d", status: "active", createdAt: iso(180) },
  { id: "u_luis", name: "Luis Ortega", email: "luis@halcyonaudio.example", role: "member", color: "#2e7d4f", status: "active", createdAt: iso(150) },
  { id: "u_priya", name: "Priya Nair", email: "priya@halcyonaudio.example", role: "viewer", color: "#b5541c", status: "invited", createdAt: iso(3) },
];

export function seedSettings(): WorkspaceSettings {
  return {
    id: "default",
    companyName: "Halcyon Audio",
    currency: "USD",
    timezone: "America/Chicago",
    trackInUse: false,
    relievePolicy: "on_build",
    inactivityDays: 120,
    agentAutoApprove: false,
    automations: [
      {
        id: "auto_lowstock",
        name: "Daily low-stock digest",
        description: "Summarise every item below its minimum and draft reorder quantities using lead times.",
        prompt: "Review all items below minimum quantity. For each, recommend a reorder quantity that brings it to max, grouped by supplier, and flag anything with a lead time over 14 days.",
        schedule: "daily",
        enabled: true,
      },
      {
        id: "auto_inactive",
        name: "Weekly inactive-part sweep",
        description: "Find parts with no movement in the inactivity window and propose deactivating them.",
        prompt: "Find active items with no stock movement in the last 120 days that are not used in any active BOM. Propose deactivating them.",
        schedule: "weekly",
        enabled: false,
      },
      {
        id: "auto_shelf",
        name: "Monthly shelf-life review",
        description: "Surface batches sitting on the shelf longest and suggest sale pricing.",
        prompt: "Show me the ten batches that have been on the shelf the longest, with remaining quantity, and suggest a sale price that keeps at least 30% margin.",
        schedule: "monthly",
        enabled: false,
      },
    ],
    counters: { receipt: 1001, build: 1001, order: 1001, rma: 1001 },
    updatedAt: iso(0),
  };
}

type ItemSeed = Omit<Item, "id" | "onHand" | "inUse" | "bom" | "tags" | "createdAt" | "updatedAt" | "unit" | "status"> & {
  id?: string;
  unit?: string;
  tags?: string[];
  status?: Item["status"];
  bom?: Array<{ sku: string; qty: number; wastePct?: number }>;
  /** Opening stock at the start of history. */
  opening: number;
  /** Rough weekly demand used by the generator. */
  demand?: number;
};

const SUPPLIERS: Supplier[] = [
  { id: "sup_hammond", name: "Hammond Manufacturing", email: "orders@hammond.example", leadTimeDays: 10, terms: "Net 30", createdAt: iso(200) },
  { id: "sup_mouser", name: "Mouser Electronics", email: "sales@mouser.example", website: "https://mouser.example", leadTimeDays: 4, terms: "Credit card", createdAt: iso(200) },
  { id: "sup_pcbway", name: "PCBWay", email: "service@pcbway.example", leadTimeDays: 21, terms: "Prepaid", createdAt: iso(200) },
  { id: "sup_uline", name: "Uline", leadTimeDays: 3, terms: "Net 30", createdAt: iso(200) },
  { id: "sup_lovemyswitches", name: "Love My Switches", leadTimeDays: 6, terms: "Prepaid", createdAt: iso(180) },
];

const ITEM_SEEDS: ItemSeed[] = [
  // Enclosures & finishing
  { sku: "ENC-125B-RAW", name: "1590B aluminium enclosure, raw", type: "part", category: "Enclosures", unitCost: 4.85, price: 9.5, minQty: 100, maxQty: 400, leadTimeDays: 10, supplierId: "sup_hammond", supplierSku: "1590B", location: "A-01", opening: 260, demand: 28 },
  { sku: "ENC-125B-PC-BLK", name: "1590B enclosure, powder coat black", type: "part", category: "Enclosures", unitCost: 7.4, price: 14, minQty: 60, maxQty: 250, leadTimeDays: 14, supplierId: "sup_hammond", location: "A-02", opening: 140, demand: 14 },
  { sku: "ENC-125B-PC-WHT", name: "1590B enclosure, powder coat white", type: "part", category: "Enclosures", unitCost: 7.4, price: 14, minQty: 40, maxQty: 200, leadTimeDays: 14, supplierId: "sup_hammond", location: "A-02", opening: 90, demand: 8 },
  { sku: "ENC-1590BB-RAW", name: "1590BB aluminium enclosure, raw", type: "part", category: "Enclosures", unitCost: 6.9, price: 13, minQty: 40, maxQty: 160, leadTimeDays: 10, supplierId: "sup_hammond", supplierSku: "1590BB", location: "A-03", opening: 70, demand: 6 },
  { sku: "SCR-M3-6-BLK", name: "M3 x 6mm black screw", type: "part", category: "Hardware", unit: "ea", unitCost: 0.04, price: 0.1, minQty: 2000, maxQty: 8000, leadTimeDays: 4, supplierId: "sup_mouser", location: "H-11", opening: 5200, demand: 220 },
  { sku: "FT-RUBBER-12", name: "Rubber foot, 12mm adhesive", type: "part", category: "Hardware", unitCost: 0.09, price: 0.25, minQty: 800, maxQty: 4000, leadTimeDays: 3, supplierId: "sup_uline", location: "H-12", opening: 2600, demand: 110 },

  // Electronics
  { sku: "SW-3PDT-BLU", name: "3PDT footswitch, blue", type: "part", category: "Electronics", unitCost: 2.35, price: 4.5, minQty: 150, maxQty: 600, leadTimeDays: 6, supplierId: "sup_lovemyswitches", location: "E-01", opening: 320, demand: 30 },
  { sku: "JK-6.35-MONO", name: "1/4\" mono jack, Switchcraft style", type: "part", category: "Electronics", unitCost: 1.1, price: 2.25, minQty: 300, maxQty: 1200, leadTimeDays: 4, supplierId: "sup_mouser", location: "E-02", opening: 640, demand: 60 },
  { sku: "JK-DC-2.1", name: "DC power jack 2.1mm", type: "part", category: "Electronics", unitCost: 0.62, price: 1.5, minQty: 200, maxQty: 800, leadTimeDays: 4, supplierId: "sup_mouser", location: "E-03", opening: 410, demand: 30 },
  { sku: "POT-A100K-16", name: "Potentiometer A100K 16mm", type: "part", category: "Electronics", unitCost: 0.78, price: 1.8, minQty: 300, maxQty: 1000, leadTimeDays: 5, supplierId: "sup_mouser", location: "E-04", opening: 720, demand: 75 },
  { sku: "POT-B10K-16", name: "Potentiometer B10K 16mm", type: "part", category: "Electronics", unitCost: 0.78, price: 1.8, minQty: 200, maxQty: 800, leadTimeDays: 5, supplierId: "sup_mouser", location: "E-04", opening: 380, demand: 40 },
  { sku: "POT-B500K-16", name: "Potentiometer B500K 16mm", type: "part", category: "Electronics", unitCost: 0.78, price: 1.8, minQty: 150, maxQty: 600, leadTimeDays: 5, supplierId: "sup_mouser", location: "E-04", opening: 210, demand: 25 },
  { sku: "LED-5MM-BLU", name: "5mm LED, diffused blue", type: "part", category: "Electronics", unitCost: 0.12, price: 0.35, minQty: 400, maxQty: 2000, leadTimeDays: 4, supplierId: "sup_mouser", location: "E-05", opening: 900, demand: 30 },
  { sku: "LED-5MM-RED", name: "5mm LED, diffused red", type: "part", category: "Electronics", unitCost: 0.12, price: 0.35, minQty: 200, maxQty: 1000, leadTimeDays: 4, supplierId: "sup_mouser", location: "E-05", opening: 450, demand: 18 },
  { sku: "IC-JRC4558D", name: "JRC4558D dual op-amp", type: "part", category: "Electronics", unitCost: 0.55, price: 1.4, minQty: 200, maxQty: 800, leadTimeDays: 9, supplierId: "sup_mouser", location: "E-06", opening: 330, demand: 30 },
  { sku: "IC-TL072", name: "TL072 dual op-amp", type: "part", category: "Electronics", unitCost: 0.48, price: 1.2, minQty: 150, maxQty: 600, leadTimeDays: 9, supplierId: "sup_mouser", location: "E-06", opening: 260, demand: 20 },
  { sku: "TR-2N5088", name: "2N5088 NPN transistor", type: "part", category: "Electronics", unitCost: 0.14, price: 0.4, minQty: 300, maxQty: 1500, leadTimeDays: 7, supplierId: "sup_mouser", location: "E-07", opening: 640, demand: 60 },
  { sku: "CAP-100N-FILM", name: "100nF film capacitor", type: "part", category: "Electronics", unitCost: 0.07, price: 0.2, minQty: 1000, maxQty: 5000, leadTimeDays: 4, supplierId: "sup_mouser", location: "E-08", opening: 2800, demand: 260 },
  { sku: "CAP-47U-EL", name: "47µF electrolytic capacitor", type: "part", category: "Electronics", unitCost: 0.09, price: 0.25, minQty: 600, maxQty: 3000, leadTimeDays: 4, supplierId: "sup_mouser", location: "E-08", opening: 1500, demand: 120 },
  { sku: "RES-KIT-MF", name: "Metal film resistor assortment (per pedal)", type: "part", category: "Electronics", unitCost: 0.35, price: 0.9, minQty: 300, maxQty: 1500, leadTimeDays: 4, supplierId: "sup_mouser", location: "E-09", opening: 860, demand: 60 },
  { sku: "DIO-1N4148", name: "1N4148 diode", type: "part", category: "Electronics", unitCost: 0.03, price: 0.1, minQty: 1000, maxQty: 5000, leadTimeDays: 4, supplierId: "sup_mouser", location: "E-10", opening: 2200, demand: 200 },
  { sku: "DIO-1N4001", name: "1N4001 diode (polarity)", type: "part", category: "Electronics", unitCost: 0.04, price: 0.12, minQty: 300, maxQty: 1500, leadTimeDays: 4, supplierId: "sup_mouser", location: "E-10", opening: 520, demand: 30 },
  { sku: "WIRE-24-BLK", name: "24 AWG hookup wire, black", type: "part", category: "Electronics", unit: "ft", unitCost: 0.06, price: 0.15, minQty: 300, maxQty: 1500, leadTimeDays: 3, supplierId: "sup_mouser", location: "E-11", opening: 900, demand: 90, expectedWastePct: 8 },
  { sku: "WIRE-24-RED", name: "24 AWG hookup wire, red", type: "part", category: "Electronics", unit: "ft", unitCost: 0.06, price: 0.15, minQty: 300, maxQty: 1500, leadTimeDays: 3, supplierId: "sup_mouser", location: "E-11", opening: 820, demand: 90, expectedWastePct: 8 },

  // PCBs
  { sku: "PCB-OD1-R3", name: "Overdrive PCB rev 3 (bare)", type: "part", category: "PCBs", unitCost: 1.9, price: 6, minQty: 100, maxQty: 400, leadTimeDays: 21, supplierId: "sup_pcbway", location: "P-01", opening: 240, demand: 22 },
  { sku: "PCB-OD1-R2", name: "Overdrive PCB rev 2 (bare)", type: "part", category: "PCBs", unitCost: 1.9, price: 6, leadTimeDays: 21, supplierId: "sup_pcbway", location: "P-01", opening: 36, status: "superseded" },
  { sku: "PCB-FZ1-R1", name: "Fuzz PCB rev 1 (bare)", type: "part", category: "PCBs", unitCost: 1.7, price: 5.5, minQty: 60, maxQty: 250, leadTimeDays: 21, supplierId: "sup_pcbway", location: "P-02", opening: 130, demand: 10 },
  { sku: "PCB-DLY1-R1", name: "Delay PCB rev 1 (bare)", type: "part", category: "PCBs", unitCost: 3.4, price: 9, minQty: 40, maxQty: 160, leadTimeDays: 21, supplierId: "sup_pcbway", location: "P-03", opening: 80, demand: 6 },
  { sku: "IC-PT2399", name: "PT2399 delay IC", type: "part", category: "Electronics", unitCost: 0.95, price: 2.4, minQty: 60, maxQty: 240, leadTimeDays: 12, supplierId: "sup_mouser", location: "E-06", opening: 110, demand: 6 },

  // Packaging & knobs
  { sku: "KNB-DAVIES-1510-BLK", name: "Davies 1510 knob, black", type: "part", category: "Hardware", unitCost: 0.55, price: 1.25, minQty: 300, maxQty: 1200, leadTimeDays: 6, supplierId: "sup_lovemyswitches", location: "H-01", opening: 780, demand: 75 },
  { sku: "KNB-DAVIES-1510-WHT", name: "Davies 1510 knob, white", type: "part", category: "Hardware", unitCost: 0.55, price: 1.25, minQty: 100, maxQty: 500, leadTimeDays: 6, supplierId: "sup_lovemyswitches", location: "H-01", opening: 140, demand: 12 },
  { sku: "PKG-BOX-PEDAL", name: "Retail box, single pedal", type: "part", category: "Packaging", unitCost: 0.85, price: 2, minQty: 150, maxQty: 600, leadTimeDays: 3, supplierId: "sup_uline", location: "K-01", opening: 340, demand: 30 },
  { sku: "PKG-INSERT-FOAM", name: "Foam insert, pedal box", type: "part", category: "Packaging", unitCost: 0.4, price: 1, minQty: 150, maxQty: 600, leadTimeDays: 3, supplierId: "sup_uline", location: "K-01", opening: 320, demand: 30 },
  { sku: "PKG-MANUAL-OD1", name: "Printed manual, Overdrive", type: "part", category: "Packaging", unitCost: 0.18, price: 0.5, minQty: 100, maxQty: 500, leadTimeDays: 5, location: "K-02", opening: 260, demand: 20 },
  { sku: "PKG-STICKER", name: "Halcyon logo sticker", type: "part", category: "Packaging", unitCost: 0.07, price: 0.5, minQty: 500, maxQty: 2000, leadTimeDays: 5, location: "K-02", opening: 1200, demand: 60 },

  // Sub-assemblies
  {
    sku: "SA-OD1-PCBA", name: "Overdrive populated PCB (sub-assembly)", type: "assembly", category: "Sub-assemblies", unitCost: 0, price: 0, minQty: 10, maxQty: 60, location: "S-01", opening: 24,
    bom: [
      { sku: "PCB-OD1-R3", qty: 1 }, { sku: "IC-JRC4558D", qty: 1 }, { sku: "TR-2N5088", qty: 2 }, { sku: "CAP-100N-FILM", qty: 8 }, { sku: "CAP-47U-EL", qty: 3 },
      { sku: "RES-KIT-MF", qty: 1 }, { sku: "DIO-1N4148", qty: 4 }, { sku: "DIO-1N4001", qty: 1 }, { sku: "POT-A100K-16", qty: 1 }, { sku: "POT-B10K-16", qty: 1 }, { sku: "POT-B500K-16", qty: 1 },
    ],
  },
  {
    sku: "SA-FZ1-PCBA", name: "Fuzz populated PCB (sub-assembly)", type: "assembly", category: "Sub-assemblies", unitCost: 0, price: 0, minQty: 6, maxQty: 30, location: "S-01", opening: 10,
    bom: [
      { sku: "PCB-FZ1-R1", qty: 1 }, { sku: "TR-2N5088", qty: 3 }, { sku: "CAP-100N-FILM", qty: 4 }, { sku: "CAP-47U-EL", qty: 2 }, { sku: "RES-KIT-MF", qty: 1 }, { sku: "DIO-1N4001", qty: 1 },
      { sku: "POT-A100K-16", qty: 1 }, { sku: "POT-B500K-16", qty: 1 },
    ],
  },
  {
    sku: "SA-DLY1-PCBA", name: "Delay populated PCB (sub-assembly)", type: "assembly", category: "Sub-assemblies", unitCost: 0, price: 0, minQty: 4, maxQty: 20, location: "S-01", opening: 6,
    bom: [
      { sku: "PCB-DLY1-R1", qty: 1 }, { sku: "IC-PT2399", qty: 1 }, { sku: "IC-TL072", qty: 2 }, { sku: "CAP-100N-FILM", qty: 12 }, { sku: "CAP-47U-EL", qty: 5 }, { sku: "RES-KIT-MF", qty: 2 },
      { sku: "DIO-1N4001", qty: 1 }, { sku: "POT-A100K-16", qty: 1 }, { sku: "POT-B10K-16", qty: 2 },
    ],
  },
  {
    sku: "SA-ENC-125B-BLK", name: "Drilled & finished 1590B, black (sub-assembly)", type: "assembly", category: "Sub-assemblies", unitCost: 0, price: 0, minQty: 20, maxQty: 80, location: "S-02", opening: 32,
    bom: [{ sku: "ENC-125B-PC-BLK", qty: 1 }, { sku: "SCR-M3-6-BLK", qty: 4 }, { sku: "FT-RUBBER-12", qty: 4 }],
  },

  // Finished goods
  {
    sku: "FG-OD1-BLK", name: "Halcyon Overdrive, black", type: "assembly", category: "Finished goods", unitCost: 0, price: 189, salePrice: 169, priceBreaks: [{ minQty: 5, price: 159 }, { minQty: 20, price: 139 }], minQty: 12, maxQty: 60, location: "F-01", opening: 18, demand: 9, tags: ["shopify", "bestseller"],
    bom: [
      { sku: "SA-OD1-PCBA", qty: 1 }, { sku: "SA-ENC-125B-BLK", qty: 1 }, { sku: "SW-3PDT-BLU", qty: 1 }, { sku: "JK-6.35-MONO", qty: 2 }, { sku: "JK-DC-2.1", qty: 1 }, { sku: "LED-5MM-BLU", qty: 1 },
      { sku: "KNB-DAVIES-1510-BLK", qty: 3 }, { sku: "WIRE-24-BLK", qty: 1.5, wastePct: 10 }, { sku: "WIRE-24-RED", qty: 1.5, wastePct: 10 }, { sku: "PKG-BOX-PEDAL", qty: 1 }, { sku: "PKG-INSERT-FOAM", qty: 1 }, { sku: "PKG-MANUAL-OD1", qty: 1 }, { sku: "PKG-STICKER", qty: 2 },
    ],
  },
  {
    sku: "FG-OD1-WHT", name: "Halcyon Overdrive, white", type: "assembly", category: "Finished goods", unitCost: 0, price: 189, priceBreaks: [{ minQty: 5, price: 159 }], minQty: 6, maxQty: 30, location: "F-01", opening: 7, demand: 3, tags: ["shopify"],
    bom: [
      { sku: "SA-OD1-PCBA", qty: 1 }, { sku: "ENC-125B-PC-WHT", qty: 1 }, { sku: "SCR-M3-6-BLK", qty: 4 }, { sku: "FT-RUBBER-12", qty: 4 }, { sku: "SW-3PDT-BLU", qty: 1 }, { sku: "JK-6.35-MONO", qty: 2 }, { sku: "JK-DC-2.1", qty: 1 }, { sku: "LED-5MM-BLU", qty: 1 },
      { sku: "KNB-DAVIES-1510-WHT", qty: 3 }, { sku: "WIRE-24-BLK", qty: 1.5, wastePct: 10 }, { sku: "WIRE-24-RED", qty: 1.5, wastePct: 10 }, { sku: "PKG-BOX-PEDAL", qty: 1 }, { sku: "PKG-INSERT-FOAM", qty: 1 }, { sku: "PKG-MANUAL-OD1", qty: 1 }, { sku: "PKG-STICKER", qty: 2 },
    ],
  },
  {
    sku: "FG-FZ1-RAW", name: "Halcyon Fuzz, raw aluminium", type: "assembly", category: "Finished goods", unitCost: 0, price: 179, minQty: 6, maxQty: 30, location: "F-02", opening: 9, demand: 3, tags: ["shopify"],
    bom: [
      { sku: "SA-FZ1-PCBA", qty: 1 }, { sku: "ENC-125B-RAW", qty: 1 }, { sku: "SCR-M3-6-BLK", qty: 4 }, { sku: "FT-RUBBER-12", qty: 4 }, { sku: "SW-3PDT-BLU", qty: 1 }, { sku: "JK-6.35-MONO", qty: 2 }, { sku: "JK-DC-2.1", qty: 1 }, { sku: "LED-5MM-RED", qty: 1 },
      { sku: "KNB-DAVIES-1510-BLK", qty: 2 }, { sku: "WIRE-24-BLK", qty: 1.2, wastePct: 10 }, { sku: "WIRE-24-RED", qty: 1.2, wastePct: 10 }, { sku: "PKG-BOX-PEDAL", qty: 1 }, { sku: "PKG-INSERT-FOAM", qty: 1 }, { sku: "PKG-STICKER", qty: 2 },
    ],
  },
  {
    sku: "FG-DLY1-BLK", name: "Halcyon Delay, black", type: "assembly", category: "Finished goods", unitCost: 0, price: 249, minQty: 4, maxQty: 20, location: "F-03", opening: 3, demand: 2, tags: ["shopify", "new"],
    bom: [
      { sku: "SA-DLY1-PCBA", qty: 1 }, { sku: "ENC-1590BB-RAW", qty: 1 }, { sku: "SCR-M3-6-BLK", qty: 4 }, { sku: "FT-RUBBER-12", qty: 4 }, { sku: "SW-3PDT-BLU", qty: 1 }, { sku: "JK-6.35-MONO", qty: 2 }, { sku: "JK-DC-2.1", qty: 1 }, { sku: "LED-5MM-BLU", qty: 1 },
      { sku: "KNB-DAVIES-1510-BLK", qty: 4 }, { sku: "WIRE-24-BLK", qty: 2, wastePct: 10 }, { sku: "WIRE-24-RED", qty: 2, wastePct: 10 }, { sku: "PKG-BOX-PEDAL", qty: 1 }, { sku: "PKG-INSERT-FOAM", qty: 1 }, { sku: "PKG-STICKER", qty: 2 },
    ],
  },
  // Accessories sold directly (component sales)
  { sku: "ACC-PSU-9V", name: "9V DC power supply, 500mA", type: "part", category: "Accessories", unitCost: 6.2, price: 19, minQty: 20, maxQty: 100, leadTimeDays: 7, supplierId: "sup_mouser", location: "F-04", opening: 34, demand: 4, tags: ["shopify"] },
  { sku: "ACC-PATCH-6IN", name: "6\" patch cable", type: "part", category: "Accessories", unitCost: 2.1, price: 8, minQty: 30, maxQty: 150, leadTimeDays: 7, supplierId: "sup_mouser", location: "F-04", opening: 62, demand: 6, tags: ["shopify"] },
  { sku: "ACC-TEE-L", name: "Halcyon tee, large", type: "part", category: "Merch", unitCost: 7.5, price: 28, location: "F-05", opening: 14, demand: 1, tags: ["shopify"] },
];

/**
 * One simulation pass. `overrides` replaces seed min/max per SKU; `behind`
 * maps supplier ids to the number of trailing days with no deliveries
 * (procurement "fell behind"), which is what produces the reorder list.
 */
function generate(overrides: Map<string, { min: number; max: number }>, behind: Map<string, number>, debug?: string[]): WorkspaceSnapshot {
  const rand = rng(20260902);
  const now = Date.now();
  const HISTORY_DAYS = 180;

  const items: Item[] = [];
  const bySku = new Map<string, Item>();
  for (const s of ITEM_SEEDS) {
    const id = `itm_${s.sku.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
    const item: Item = {
      id,
      sku: s.sku,
      name: s.name,
      description: s.description,
      type: s.type,
      category: s.category,
      tags: s.tags ?? [],
      unit: s.unit ?? "ea",
      status: s.status ?? "active",
      onHand: 0,
      inUse: 0,
      minQty: overrides.get(s.sku)?.min ?? s.minQty,
      maxQty: overrides.get(s.sku)?.max ?? s.maxQty,
      leadTimeDays: s.leadTimeDays,
      unitCost: s.unitCost,
      price: s.price,
      salePrice: s.salePrice,
      priceBreaks: s.priceBreaks,
      supplierId: s.supplierId,
      supplierSku: s.supplierSku,
      location: s.location,
      expectedWastePct: s.expectedWastePct,
      bom: [],
      createdAt: iso(HISTORY_DAYS + 20, 9, now),
      updatedAt: iso(HISTORY_DAYS + 20, 9, now),
    };
    items.push(item);
    bySku.set(s.sku, item);
  }
  // Resolve BOMs and superseded links
  for (const s of ITEM_SEEDS) {
    const item = bySku.get(s.sku)!;
    if (s.bom) item.bom = s.bom.map((l) => ({ itemId: bySku.get(l.sku)!.id, qty: l.qty, wastePct: l.wastePct }));
  }
  bySku.get("PCB-OD1-R2")!.supersededBy = bySku.get("PCB-OD1-R3")!.id;
  bySku.get("PCB-OD1-R2")!.status = "superseded";
  bySku.get("PCB-OD1-R2")!.description = "Replaced by rev 3 in March. Remaining boards usable for repairs only.";
  bySku.get("SA-OD1-PCBA")!.description = "Fully populated overdrive board, tested on the bench before it goes on the shelf.";
  bySku.get("FG-OD1-BLK")!.description = "Our flagship transparent overdrive. Ships with manual, sticker and foam insert.";

  // Roll up assembly unit cost from BOM (recursive)
  const costOf = (item: Item, depth = 0): number => {
    if (item.type !== "assembly" || item.bom.length === 0 || depth > 6) return item.unitCost;
    let total = 0;
    for (const line of item.bom) {
      const c = items.find((i) => i.id === line.itemId)!;
      total += costOf(c, depth + 1) * line.qty * (1 + (line.wastePct ?? 0) / 100);
    }
    return Math.round(total * 100) / 100;
  };
  for (const it of items) if (it.type === "assembly") it.unitCost = costOf(it);

  // ---- Ledger generation ----
  const movements: StockMovement[] = [];
  const lots: Lot[] = [];
  const receipts: Receipt[] = [];
  const builds: Build[] = [];
  const orders: SalesOrder[] = [];
  const rmas: Rma[] = [];
  const activity: ActivityEvent[] = [];
  const balances = new Map<string, number>();
  let counters = { receipt: 1001, build: 1001, order: 1001, rma: 1001 };
  let seq = 0;
  const mid = () => `mv_${(seq++).toString(36).padStart(5, "0")}`;

  const actorFor = (r: number) => (r < 0.5 ? SEED_MEMBERS[2] : r < 0.85 ? SEED_MEMBERS[1] : SEED_MEMBERS[0]);

  function move(item: Item, type: StockMovement["type"], qty: number, at: string, extra: Partial<StockMovement> = {}): StockMovement {
    const bal = Math.round(((balances.get(item.id) ?? 0) + qty) * 1000) / 1000;
    balances.set(item.id, bal);
    const m: StockMovement = {
      id: mid(),
      itemId: item.id,
      type,
      qty,
      unitCost: item.unitCost,
      balanceAfter: bal,
      occurredAt: at,
      createdAt: at,
      createdBy: "u_luis",
      ...extra,
    };
    movements.push(m);
    // FIFO lot relief for consumption
    if (qty < 0) {
      let remaining = -qty;
      for (const lot of lots.filter((l) => l.itemId === item.id && l.qtyRemaining > 0).sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))) {
        if (remaining <= 0) break;
        const take = Math.min(lot.qtyRemaining, remaining);
        lot.qtyRemaining -= take;
        remaining -= take;
      }
    }
    return m;
  }

  // Opening balances as an opening count, recorded as a single lot each.
  const openingAt = iso(HISTORY_DAYS, 8, now);
  for (const s of ITEM_SEEDS) {
    const item = bySku.get(s.sku)!;
    // When min/max come from measured usage, start the history at max so replenishment cycles are realistic.
    const opening = overrides.get(s.sku)?.max ?? s.opening;
    if (opening > 0) {
      const lot: Lot = { id: `lot_open_${item.id}`, itemId: item.id, qtyReceived: opening, qtyRemaining: opening, unitCost: item.unitCost, receivedAt: openingAt };
      lots.push(lot);
      move(item, "count", opening, openingAt, { lotId: lot.id, reason: "Opening balance", createdBy: "u_baker" });
    }
  }

  // Weekly loop over history: sales, builds, receipts.
  const customers = ["Sweetwater", "Reverb buyer", "Shopify — J. Alvarez", "Shopify — T. Okafor", "Chicago Music Exchange", "Shopify — M. Petrov", "Guitar Center Pro", "Shopify — S. Lindqvist", "Ridge Sound Studio"];
  const seasonal = (dayAgo: number) => {
    // Bump demand around late-November/December (holiday) and dip mid-summer.
    const date = new Date(now - dayAgo * DAY);
    const m = date.getMonth();
    if (m === 10 || m === 11) return 1.5;
    if (m === 6 || m === 7) return 0.75;
    return 1;
  };

  const pending = new Map<string, { arriveDay: number; qty: number }>();
  for (let day = HISTORY_DAYS - 1; day >= 0; day--) {
    const at = (h: number) => iso(day, h, now);
    const weekday = new Date(now - day * DAY).getDay();

    // Sales: finished goods & accessories
    const sellables = ITEM_SEEDS.filter((s) => s.demand && (s.category === "Finished goods" || s.category === "Accessories" || s.category === "Merch"));
    if (rand() < 0.65 * seasonal(day)) {
      const lines: SalesOrder["lines"] = [];
      const lineCount = rand() < 0.7 ? 1 : 2;
      for (let i = 0; i < lineCount; i++) {
        const s = sellables[Math.floor(rand() * sellables.length)]!;
        const item = bySku.get(s.sku)!;
        const maxQty = s.category === "Finished goods" ? 3 : 4;
        const qty = 1 + Math.floor(rand() * maxQty);
        const available = balances.get(item.id) ?? 0;
        if (available >= qty) lines.push({ itemId: item.id, qty, unitPrice: item.salePrice ?? item.price });
      }
      if (lines.length) {
        const customer = customers[Math.floor(rand() * customers.length)]!;
        const order: SalesOrder = {
          id: `so_${counters.order}`,
          number: `SO-${counters.order++}`,
          customer,
          status: "fulfilled",
          source: customer.startsWith("Shopify") ? "shopify" : "manual",
          lines,
          fulfilledAt: at(14),
          createdAt: at(11),
          createdBy: "u_priya",
        };
        orders.push(order);
        for (const l of lines) {
          move(items.find((i) => i.id === l.itemId)!, "sale", -l.qty, at(14), { refType: "order", refId: order.id, createdBy: "u_luis" });
        }
      }
    }

    // Builds: keep finished goods and sub-assemblies topped up (Tue/Thu)
    if (weekday === 2 || weekday === 4) {
      const assemblies = items.filter((i) => i.type === "assembly");
      for (const asm of assemblies) {
        const bal = balances.get(asm.id) ?? 0;
        const min = asm.minQty ?? 0;
        if (bal <= min && rand() < 0.8) {
          const wanted = Math.max(1, Math.min((asm.maxQty ?? min * 2) - bal, asm.category === "Finished goods" ? 8 : 16));
          // Build as many as components allow, down to a minimum lot of 2 (one level).
          const canMake = Math.floor(Math.min(...asm.bom.map((l) => (balances.get(l.itemId) ?? 0) / (l.qty * (1 + (l.wastePct ?? 0) / 100)))));
          const qty = Math.min(wanted, canMake);
          const shortLines = qty < 2 ? asm.bom.filter((l) => (balances.get(l.itemId) ?? 0) < l.qty * wanted * (1 + (l.wastePct ?? 0) / 100)) : [];
          if (shortLines.length) {
            debug?.push(`day ${day}: skip build ${asm.sku} x${wanted}: short ${shortLines.map((l) => `${items.find((i) => i.id === l.itemId)?.sku}(${balances.get(l.itemId) ?? 0}<${l.qty * wanted})`).join(", ")}`);
            continue;
          }
          const build: Build = {
            id: `bld_${counters.build}`,
            number: `BLD-${counters.build++}`,
            assemblyId: asm.id,
            qty,
            status: "completed",
            consumeSubassemblies: true,
            components: asm.bom.map((l) => ({ itemId: l.itemId, qtyPer: l.qty, qtyConsumed: Math.ceil(l.qty * qty * (1 + (l.wastePct ?? 0) / 100) * 100) / 100 })),
            completedAt: at(15),
            createdAt: at(9),
            createdBy: "u_luis",
          };
          builds.push(build);
          for (const c of build.components) {
            move(items.find((i) => i.id === c.itemId)!, "build_consume", -c.qtyConsumed, at(15), { refType: "build", refId: build.id });
          }
          const produced = move(asm, "build_produce", qty, at(15), { refType: "build", refId: build.id });
          lots.push({ id: `lot_${build.id}`, itemId: asm.id, qtyReceived: qty, qtyRemaining: qty, unitCost: asm.unitCost, receivedAt: produced.occurredAt });
        }
      }
    }

    // Deliveries: purchase orders placed when a part drops below min arrive after the
    // supplier lead time. Suppliers listed in `behind` ship nothing in their trailing
    // window, which is what puts parts on the reorder list.
    const arrivingBySupplier = new Map<string, Array<{ item: Item; qty: number }>>();
    for (const [itemId, po] of pending) {
      const it = items.find((i) => i.id === itemId)!;
      const supplierKey = it.supplierId ?? "sup_none";
      if (po.arriveDay < day) continue;
      if (day <= (behind.get(supplierKey) ?? 0)) continue;
      (arrivingBySupplier.get(supplierKey) ?? arrivingBySupplier.set(supplierKey, []).get(supplierKey)!).push({ item: it, qty: po.qty });
      pending.delete(itemId);
    }
    for (const [supplierId, list] of arrivingBySupplier) {
      const actor = actorFor(rand());
      const receipt: Receipt = {
        id: `rcv_${counters.receipt}`,
        number: `RCV-${counters.receipt++}`,
        supplierId: supplierId === "sup_none" ? undefined : supplierId,
        reference: `PO-${5000 + Math.floor(rand() * 900)}`,
        status: "received",
        receivedAt: at(10),
        lines: [],
        createdAt: at(10),
        createdBy: actor.id,
      };
      for (const { item: it, qty } of list) {
        const drift = 1 + (rand() - 0.5) * 0.08; // ±4% cost drift
        const unitCost = Math.round(it.unitCost * drift * 100) / 100;
        const lot: Lot = { id: `lot_${receipt.id}_${it.id}`, itemId: it.id, receiptId: receipt.id, qtyReceived: qty, qtyRemaining: qty, unitCost, receivedAt: receipt.receivedAt };
        lots.push(lot);
        receipt.lines.push({ itemId: it.id, qty, unitCost, lotId: lot.id });
        move(it, "receipt", qty, receipt.receivedAt, { unitCost, lotId: lot.id, refType: "receipt", refId: receipt.id, createdBy: actor.id });
      }
      receipts.push(receipt);
    }

    // Purchasing review (Mon/Wed/Fri): order anything below min that is not already on order.
    if (weekday === 1 || weekday === 3 || weekday === 5) {
      for (const it of items) {
        if (it.type !== "part" || it.status !== "active" || !it.minQty || pending.has(it.id)) continue;
        const bal = balances.get(it.id) ?? 0;
        if (bal >= it.minQty * 1.1 || rand() > 0.85) continue;
        const lead = it.leadTimeDays ?? 7;
        const arriveDay = day - Math.round(lead * (0.85 + rand() * 0.45));
        const qty = Math.max(1, Math.round((it.maxQty ?? it.minQty * 3) - bal));
        pending.set(it.id, { arriveDay, qty });
      }
    }

    // Occasional write-offs / count corrections
    if (rand() < 0.04) {
      const parts = items.filter((i) => i.type === "part" && (balances.get(i.id) ?? 0) > 20);
      const it = parts[Math.floor(rand() * parts.length)]!;
      const qty = -(1 + Math.floor(rand() * 4));
      const reasons = ["Damaged in handling", "Failed QC", "Used for R&D prototype", "Cycle count variance"];
      const reason = reasons[Math.floor(rand() * reasons.length)]!;
      move(it, reason === "Cycle count variance" ? "count" : "write_off", qty, at(16), { reason, createdBy: "u_luis" });
    }
  }

  // RMAs: two resolved, one open
  const fgOd = bySku.get("FG-OD1-BLK")!;
  const fgFz = bySku.get("FG-FZ1-RAW")!;
  rmas.push({
    id: "rma_1001", number: "RMA-1001", customer: "Shopify — T. Okafor", reference: "SO-1012", status: "restocked", reason: "Customer changed mind, unopened",
    lines: [{ itemId: fgOd.id, qty: 1, condition: "good", disposition: "restock" }], createdAt: iso(41, 11, now), resolvedAt: iso(38, 15, now), createdBy: "u_priya",
  });
  move(fgOd, "rma_return", 1, iso(38, 15, now), { refType: "rma", refId: "rma_1001", reason: "Restocked from RMA-1001" });
  rmas.push({
    id: "rma_1002", number: "RMA-1002", customer: "Reverb buyer", reference: "SO-1027", status: "scrapped", reason: "Footswitch failed after 2 weeks",
    lines: [{ itemId: fgFz.id, qty: 1, condition: "damaged", disposition: "scrap" }], note: "Replacement shipped. Board harvested for parts.", createdAt: iso(22, 9, now), resolvedAt: iso(19, 13, now), createdBy: "u_priya",
  });
  rmas.push({
    id: "rma_1003", number: "RMA-1003", customer: "Chicago Music Exchange", reference: "SO-1088", status: "open", reason: "Cosmetic scratch on enclosure",
    lines: [{ itemId: fgOd.id, qty: 2, condition: "unknown" }], createdAt: iso(2, 14, now), createdBy: "u_priya",
  });
  counters = { ...counters, rma: 1004 };

  // A few open orders for the "to ship" list
  const openCustomers = ["Sweetwater", "Shopify — A. Brandt", "Ridge Sound Studio"];
  for (let i = 0; i < 3; i++) {
    const sku = i === 0 ? "FG-OD1-BLK" : i === 1 ? "FG-DLY1-BLK" : "FG-FZ1-RAW";
    const it = bySku.get(sku)!;
    orders.push({
      id: `so_${counters.order}`, number: `SO-${counters.order++}`, customer: openCustomers[i]!, status: "open", source: i === 1 ? "shopify" : "manual",
      lines: [{ itemId: it.id, qty: i === 0 ? 6 : 1, unitPrice: it.salePrice ?? it.price }, ...(i === 0 ? [{ itemId: bySku.get("ACC-PSU-9V")!.id, qty: 6, unitPrice: 19 }] : [])],
      createdAt: iso(i, 9, now), createdBy: "u_priya",
    });
  }

  // Finalise balances
  for (const it of items) {
    it.onHand = Math.round((balances.get(it.id) ?? 0) * 100) / 100;
    const last = movements.filter((m) => m.itemId === it.id).at(-1);
    if (last) it.updatedAt = last.occurredAt;
  }

  // Activity feed (most recent 40 events, newest last)
  const recentMoves = movements.slice(-60);
  for (const m of recentMoves) {
    const it = items.find((i) => i.id === m.itemId)!;
    const actor = SEED_MEMBERS.find((u) => u.id === m.createdBy) ?? SEED_MEMBERS[2];
    const verb = m.type === "receipt" ? "received" : m.type === "sale" ? "shipped" : m.type === "build_produce" ? "built" : m.type === "build_consume" ? "consumed" : m.type === "write_off" ? "wrote off" : m.type === "rma_return" ? "restocked" : "adjusted";
    if (m.type === "build_consume") continue;
    activity.push({
      id: `act_${m.id}`,
      type: m.type === "receipt" ? "stock.received" : m.type === "write_off" ? "stock.written_off" : m.type === "build_produce" ? "build.completed" : m.type === "sale" ? "order.fulfilled" : "stock.adjusted",
      message: `${actor.name} ${verb} ${Math.abs(m.qty)} × ${it.sku}`,
      actorId: actor.id,
      actorName: actor.name,
      entityType: "item",
      entityId: it.id,
      createdAt: m.occurredAt,
    });
  }
  activity.push({ id: "act_rma_1003", type: "rma.created", message: "Priya Nair opened RMA-1003 for Chicago Music Exchange", actorId: "u_priya", actorName: "Priya Nair", entityType: "rma", entityId: "rma_1003", createdAt: iso(2, 14, now) });
  activity.push({ id: "act_agent_1", type: "agent.action", message: "Nimbus updated lead time on 9 Mouser parts (approved by Maya Chen)", actorId: "u_maya", actorName: "Maya Chen", meta: { count: 9 }, createdAt: iso(1, 16, now) });
  activity.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const settings = seedSettings();
  settings.counters = counters;

  return {
    items,
    movements,
    lots,
    suppliers: SUPPLIERS,
    receipts,
    builds,
    orders,
    rmas,
    members: SEED_MEMBERS,
    activity: activity.slice(-80),
    integrations: [
      { id: "shopify", status: "not_connected", createdAt: iso(0) },
      { id: "woocommerce", status: "not_connected", createdAt: iso(0) },
      { id: "quickbooks", status: "not_connected", createdAt: iso(0) },
      { id: "square", status: "not_connected", createdAt: iso(0) },
    ],
    settings: [settings],
    agentSessions: [],
    locations: [],
    transfers: [],
    shipments: [],
    quotes: [],
    channelTombstones: [],
  };
}

function roundNice(n: number): number {
  if (n < 50) return Math.ceil(n / 5) * 5;
  if (n < 500) return Math.ceil(n / 10) * 10;
  return Math.ceil(n / 50) * 50;
}

/**
 * Demo workspace. Runs the simulation twice: the first pass measures real
 * consumption, which sets min/max per part from usage and lead time (factor
 * 21c); the second pass replays history with those thresholds so the
 * reorder list, days of cover and shortages are all coherent.
 */
export function buildSeed(debug?: string[]): WorkspaceSnapshot {
  const behind = new Map<string, number>([
    ["sup_mouser", 8],
    ["sup_hammond", 16],
    ["sup_pcbway", 12],
  ]);
  const first = generate(new Map(), behind);
  const since = Date.now() - 90 * DAY;
  const used = new Map<string, number>();
  const biggestDraw = new Map<string, number>();
  for (const m of first.movements) {
    if (m.qty >= 0 || (m.type !== "build_consume" && m.type !== "sale")) continue;
    biggestDraw.set(m.itemId, Math.max(biggestDraw.get(m.itemId) ?? 0, -m.qty));
    if (new Date(m.occurredAt).getTime() < since) continue;
    used.set(m.itemId, (used.get(m.itemId) ?? 0) + -m.qty);
  }
  const overrides = new Map<string, { min: number; max: number }>();
  for (const it of first.items) {
    if (it.type !== "part" || it.status !== "active" || it.minQty === undefined) continue;
    const perDay = (used.get(it.id) ?? 0) / 90;
    if (perDay <= 0) continue;
    const lead = it.leadTimeDays ?? 7;
    // Build lots are lumpy: min must cover the largest single draw, max at least two of them.
    const draw = biggestDraw.get(it.id) ?? 0;
    const min = Math.max(5, Math.ceil(perDay * (lead + 7) * 1.5), Math.ceil(draw * 1.25));
    const max = Math.max(min + 10, Math.ceil(perDay * (lead + 7 + 42)), min + Math.ceil(draw * 2));
    overrides.set(it.sku, { min: roundNice(min), max: roundNice(max) });
  }
  return generate(overrides, behind, debug);
}

/**
 * A clean workspace for a real company: no items, no history, fresh document
 * counters, and an empty company name so the app asks for it on first load.
 * Pass the current members to keep the team (their accounts are real).
 */
export function freshWorkspace(opts: { members?: Member[]; companyName?: string; currency?: string } = {}): WorkspaceSnapshot {
  const settings = seedSettings();
  return {
    items: [],
    movements: [],
    lots: [],
    suppliers: [],
    receipts: [],
    builds: [],
    orders: [],
    rmas: [],
    members: opts.members ?? [],
    activity: [],
    integrations: [
      { id: "shopify", status: "not_connected", createdAt: iso(0) },
      { id: "woocommerce", status: "not_connected", createdAt: iso(0) },
      { id: "quickbooks", status: "not_connected", createdAt: iso(0) },
      { id: "square", status: "not_connected", createdAt: iso(0) },
      { id: "shippo", status: "not_connected", createdAt: iso(0) },
      { id: "easypost", status: "not_connected", createdAt: iso(0) },
    ],
    settings: [{ ...settings, companyName: opts.companyName ?? "", currency: opts.currency ?? settings.currency, automations: settings.automations.map((a) => ({ ...a, enabled: false })) }],
    agentSessions: [],
    locations: [],
    transfers: [],
    shipments: [],
    quotes: [],
    channelTombstones: [],
  };
}

/** Kept for compatibility: an empty workspace with the demo owner. */
export function buildEmpty(): WorkspaceSnapshot {
  return freshWorkspace({ members: [SEED_MEMBERS[0]!], companyName: "My company" });
}
