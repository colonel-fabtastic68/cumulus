import type { BadgeTone } from "@/components/ui/Badge";

/**
 * Companies with a page of their own at /for/<slug>, linked from the emails we
 * send them. Add a row to add a page; logos live in public/logos/prospects.
 * Rows in a panel are sample data and the page labels them so.
 */
export type ProspectSegment = "motorsport" | "aftermarket";

interface PanelRow {
  a: string;
  b: string;
  c: string;
  s: string;
  tone: BadgeTone;
}

interface Panel {
  title: string;
  statA: string;
  valA: string;
  statB: string;
  valB: string;
  c1: string;
  c2: string;
  c3: string;
  rows: PanelRow[];
  strato: string;
}

interface SegmentCopy {
  headline: string;
  lede: string;
  bullets: string[];
  problemHead: string;
  problems: Array<{ t: string; d: string }>;
  panel: Panel;
}

export interface ProspectPage {
  slug: string;
  company: string;
  segment: ProspectSegment;
  /** `dark` sets a light logo on a black tile so it reads on the white page. */
  logo: { src: string; width: number; height: number; dark?: boolean };
  note: string;
  panel: Pick<Panel, "rows" | "strato"> & Partial<Panel>;
}

const LIVE = "Live for the whole shop in an afternoon, from the spreadsheet you have.";

const SEGMENTS: Record<ProspectSegment, SegmentCopy> = {
  motorsport: {
    headline: "Every part at {c}, traced to the build.",
    lede: "cumulusOS runs parts, BOMs, builds, receiving and orders in one place, with Strato drafting the bulk work for your approval.",
    bullets: ["Every part traced to its lot, heat number and build.", "Store, counter and accounting in sync, so stock is never oversold.", LIVE],
    problemHead: "Tight timelines. Tighter traceability.",
    problems: [
      { t: "A cert request turns into a paper chase.", d: "Every tube and casting keeps its heat or lot number from receipt to the finished car, so a cert request or a recall takes minutes." },
      { t: "The pick comes up short on build day.", d: "A build pulls tubes, brackets, fasteners and sub-assemblies from stock in one go, with scrap allowances built in." },
      { t: "The trailer never matches the shop.", d: "Transfers move spares to the hauler for a race weekend and back again, with par levels per trailer and a count that matches the paddock." },
    ],
    panel: {
      title: "Build 118",
      statA: "Short before the pick",
      valA: "1 line",
      statB: "Heats on this build",
      valB: "3",
      c1: "Part",
      c2: "Heat or lot",
      c3: "On hand",
      rows: [],
      strato: "",
    },
  },
  aftermarket: {
    headline: "One stock count for everything {c} sells.",
    lede: "cumulusOS is the one count your web store, your counter and your dealers all read, with Strato drafting the bulk work for your approval.",
    bullets: ["Online, counter and wholesale pull from one count, so no channel oversells another.", "Landed cost per lot, FIFO or average, so margins hold up when freight changes.", LIVE],
    problemHead: "Stock accuracy across every channel.",
    problems: [
      { t: "One channel sells what another just sold.", d: "Shopify or WooCommerce, the Square register and dealer orders all pull from the same stock." },
      { t: "Freight moves and the margin goes with it.", d: "Containers are received the day they landed, with back-dated receiving and landed cost per lot." },
      { t: "Fitment returns turn into arguments.", d: "RMAs move through inspection to restock or write-off with the reason on each line, and the ledger shows the real return rate per SKU." },
    ],
    panel: {
      title: "Stock",
      statA: "Channels on one count",
      valA: "3",
      statB: "Oversold this month",
      valB: "0",
      c1: "SKU",
      c2: "Fitment and finish",
      c3: "On hand",
      rows: [],
      strato: "",
    },
  },
};

const ready = (a: string, b: string, c: string): PanelRow => ({ a, b, c, s: "Ready", tone: "success" });
const inStock = (a: string, b: string, c: string): PanelRow => ({ a, b, c, s: "In stock", tone: "success" });
const short = (a: string, b: string, c: string, s: string): PanelRow => ({ a, b, c, s, tone: "critical" });
const low = (a: string, b: string, c: string): PanelRow => ({ a, b, c, s: "Low", tone: "attention" });

export const PROSPECTS: ProspectPage[] = [
  {
    slug: "mpi",
    company: "MPI",
    segment: "motorsport",
    logo: { src: "/logos/prospects/mpi.png", width: 200, height: 200 },
    note: "I put this page together for MPI because a run of wheels shouldn't wait on a count nobody trusts. Send a spreadsheet and I'll show you what your parts look like in here.",
    panel: { rows: [ready("Steering wheel, DM3-15", "0412", "14"), ready("Quick release, RX-06", "0398", "22"), short("Steering wheel, F2-14", "0371", "3 of 6", "3 short")], strato: "F2-14 wheels, 3 short. Build drafted." },
  },
  {
    slug: "roadactive",
    company: "RoadActive Suspension",
    segment: "aftermarket",
    logo: { src: "/logos/prospects/roadactive.webp", width: 577, height: 130, dark: true },
    note: "I put this page together for RoadActive because a helper kit that fits dozens of trucks is a hard thing to count in a spreadsheet. Send an export and I'll show you what your SKUs look like in here.",
    panel: { rows: [inStock("HD Kit, F-150", "Springs and brackets", "42"), inStock("HD Kit, Silverado", "Springs and brackets", "18"), low("RAS Mega-Duty, Tundra", "Complete kit", "3")], strato: "Reorder drafted for 2 low SKUs." },
  },
  {
    slug: "re-suspension",
    company: "RE Suspension",
    segment: "motorsport",
    logo: { src: "/logos/prospects/re-suspension.png", width: 900, height: 260, dark: true },
    note: "I put this page together for RE Suspension because a rebuild shouldn't stall over a count nobody trusts. Send a spreadsheet and I'll show you what your parts look like in here.",
    panel: { rows: [ready("Bump stop, RSW series", "7A2219", "38"), ready("Bump stop, SW series", "0931", "120"), short("Bump stop, 5153 series", "0874", "6 of 8", "2 short")], strato: "5153 bump stops, 2 short. PO drafted." },
  },
  {
    slug: "steele-rubber",
    company: "Steele Rubber Products",
    segment: "aftermarket",
    logo: { src: "/logos/prospects/steele-rubber.png", width: 200, height: 200 },
    note: "I put this page together for Steele Rubber because 12,000 parts for classic cars and trucks is about as hard as a count gets. Send an export and I'll show you what your part numbers look like in here.",
    panel: { rows: [inStock("Door weatherstrip", "By the foot", "420 ft"), inStock("Firewall grommet", "Classic truck", "118"), low("Body mount kit", "Classic truck", "3")], strato: "Reorder drafted for 2 low part numbers." },
  },
  {
    slug: "carbotech",
    company: "Carbotech",
    segment: "aftermarket",
    logo: { src: "/logos/prospects/carbotech.png", width: 309, height: 52 },
    note: "I put this page together for Carbotech because every pad shape in a run of compounds multiplies fast on the shelf. Send an export and I'll show you what your SKUs look like in here.",
    panel: { c2: "Compound", rows: [inStock("Brake pad set, front", "XP10", "42"), inStock("Brake pad set, rear", "XP8", "18"), low("Brake pad set, front", "RP2", "3")], strato: "Reorder drafted for 2 low SKUs." },
  },
  {
    slug: "underground-racing",
    company: "Underground Racing",
    segment: "motorsport",
    logo: { src: "/logos/prospects/underground-racing.png", width: 576, height: 164, dark: true },
    note: "I put this page together for Underground Racing because a twin-turbo package is only as ready as the one part that's missing. Send a spreadsheet and I'll show you what your parts look like in here.",
    panel: { rows: [ready("Billet twin-turbo kit, Huracan", "7A2219", "4"), ready("TiAL wastegate", "0931", "6"), short("Fuel pump set", "0874", "2 of 4", "2 short")], strato: "Fuel pump sets, 2 short. PO drafted." },
  },
  {
    slug: "port-city-racecars",
    company: "Port City Racecars",
    segment: "motorsport",
    logo: { src: "/logos/prospects/port-city-racecars.png", width: 803, height: 365 },
    note: "I put this page together for Port City because a chassis shouldn't stall over a count nobody trusts. Send a spreadsheet and I'll show you what your parts look like in here.",
    panel: { rows: [ready("4130 tube, 1.75 x .095", "7A2219", "38 ft"), ready("Hyper Coil spring", "0931", "12"), short("Swift spring", "0874", "6 of 8", "2 short")], strato: "Swift springs, 2 short. PO drafted." },
  },
  {
    slug: "profabrication",
    company: "ProFabrication",
    segment: "motorsport",
    logo: { src: "/logos/prospects/profabrication.png", width: 200, height: 83 },
    note: "I put this page together for ProFabrication because a set of headers shouldn't stall over a count nobody trusts. Send a spreadsheet and I'll show you what your parts look like in here.",
    panel: { rows: [ready("304 bend, 2.5 in 180 degree", "7A2219", "64"), ready("Inconel 625 tubing", "0931", "22 ft"), short("Header tab, 2520 SS", "0874", "6 of 8", "2 short")], strato: "Header tabs, 2 short. PO drafted." },
  },
  {
    slug: "harrah-enterprise",
    company: "Harrah Enterprise",
    segment: "motorsport",
    logo: { src: "/logos/prospects/harrah-enterprise.jpg", width: 291, height: 60 },
    note: "I put this page together for Harrah Enterprise because a 4-speed shouldn't stall over a count nobody trusts, and leased drivelines make that count harder. Send a spreadsheet and I'll show you what your parts look like in here.",
    panel: { rows: [ready("Jasper 4-speed gear set", "7A2219", "12"), ready("Gerotor pump", "0931", "9"), short("Direct Drive housing", "0874", "6 of 8", "2 short")], strato: "Direct Drive housings, 2 short. PO drafted." },
  },
  {
    slug: "quick-time-performance",
    company: "Quick Time Performance",
    segment: "aftermarket",
    logo: { src: "/logos/prospects/quick-time-performance.png", width: 295, height: 63 },
    note: "I put this page together for Quick Time Performance because a cutout in every size from 2.25 to 5 inches adds up fast. Send an export and I'll show you what your SKUs look like in here.",
    panel: { c2: "Size", rows: [inStock("QTEC electric cutout", "3 in, single", "42"), inStock("Aggressor cutout pipe", "2.5 in", "18"), low("Screamer Twintronic", "3 in", "3")], strato: "Reorder drafted for 2 low SKUs." },
  },
  {
    slug: "usa1-industries",
    company: "USA1 Industries",
    segment: "aftermarket",
    logo: { src: "/logos/prospects/usa1-industries.png", width: 192, height: 152 },
    note: "I put this page together for USA1 because a Square Body interior is cut, sewn and dyed in your own shop, and that's a lot of material and parts to keep straight. Send an export and I'll show you what your SKUs look like in here.",
    panel: { c2: "Fitment and color", rows: [inStock("Silverado style interior kit", "1981-87, Carmine Red", "6"), inStock("Door panel set", "1973-87, black", "18"), low("Headliner", "1973-87, tan", "3")], strato: "Reorder drafted for 2 low SKUs." },
  },
  {
    slug: "koolmat",
    company: "Koolmat",
    segment: "motorsport",
    logo: { src: "/logos/prospects/koolmat.png", width: 200, height: 51 },
    note: "I put this page together for Koolmat because bulk rolls, pre-cut kits and sleeving all draw on the same material. Send a spreadsheet and I'll show you what your parts look like in here.",
    panel: { rows: [ready("Restoration kit 97234, TR6", "7A2219", "12"), ready("Koolmat, bulk roll", "0931", "42"), short("Koolsox sleeving", "0874", "6 of 8 ft", "2 ft short")], strato: "Koolsox sleeving, 2 ft short. PO drafted." },
  },
  {
    slug: "cocomats",
    company: "CocoMats",
    segment: "aftermarket",
    logo: { src: "/logos/prospects/cocomats.png", width: 196, height: 60 },
    note: "I put this page together for CocoMats because every set is made to order, and the matting and backing still have to be on the shelf. Send an export and I'll show you what your SKUs look like in here.",
    panel: { c1: "Material", c2: "Color", rows: [inStock("Coco matting", "Natural", "420 ft"), inStock("Rubber backing", "Black", "310 ft"), low("Seagrass matting", "Natural", "30 ft")], strato: "Reorder drafted for 2 low materials." },
  },
  {
    slug: "driveshaft-shop",
    company: "The Driveshaft Shop",
    segment: "aftermarket",
    logo: { src: "/logos/prospects/driveshaft-shop.png", width: 800, height: 286 },
    note: "I put this page together for The Driveshaft Shop because a shaft or an axle in several materials for hundreds of cars is a hard thing to count by hand. Send an export and I'll show you what your SKUs look like in here.",
    panel: { c2: "Application", rows: [inStock("Level 5 front axle", "R35 GT-R", "12"), inStock("Pro-Level axle and hub kit", "1993-98 Supra", "8"), low("Aluminum torque tube", "C7 Corvette", "3")], strato: "Reorder drafted for 2 low SKUs." },
  },
  {
    slug: "custom-speaker-pods",
    company: "Custom Speaker Pods",
    segment: "aftermarket",
    logo: { src: "/logos/prospects/custom-speaker-pods.png", width: 200, height: 85 },
    note: "I put this page together for Custom Speaker Pods because a pod for every vehicle plus the speakers you resell is a lot to keep straight. Send an export and I'll show you what your SKUs look like in here.",
    panel: { c2: "Vehicle", rows: [inStock("Front door pods, pair", "2015-20 F-150", "42"), inStock("Dual 8 in front door pods", "2019-23 Silverado", "18"), low("Resold speaker, pair", "Door", "3")], strato: "Reorder drafted for 2 low SKUs." },
  },
  {
    slug: "thermal-control-products",
    company: "Thermal Control Products",
    segment: "motorsport",
    logo: { src: "/logos/prospects/thermal-control-products.png", width: 244, height: 77 },
    note: "I put this page together for Thermal Control Products because heat shields, boots and aprons all draw on the same material. Send a spreadsheet and I'll show you what your parts look like in here.",
    panel: { rows: [ready("Aluminized fiberglass", "7A2219", "120 yd"), ready("Throttle boot", "0931", "12"), short("Fueler apron", "0874", "6 of 8", "2 short")], strato: "Fueler aprons, 2 short. Build drafted." },
  },
  {
    slug: "fury-race-cars",
    company: "Fury Race Cars",
    segment: "motorsport",
    logo: { src: "/logos/prospects/fury-race-cars.png", width: 336, height: 57, dark: true },
    note: "I put this page together for Fury because a Model-L chassis shouldn't stall over a count nobody trusts. Send a spreadsheet and I'll show you what your parts look like in here.",
    panel: { rows: [ready("4130 tube, 1.75 x .095", "7A2219", "38 ft"), ready("Billet track-bar clamp", "0931", "12"), short("4130 spindle", "0874", "6 of 8", "2 short")], strato: "Spindles, 2 short. PO drafted." },
  },
  {
    slug: "custom-performance-engineering",
    company: "Custom Performance Engineering",
    segment: "aftermarket",
    logo: { src: "/logos/prospects/custom-performance-engineering.png", width: 700, height: 145, dark: true },
    note: "I put this page together for CP-E because mounts, intakes and fuel parts for a lot of turbo cars add up fast on the shelf. Send an export and I'll show you what your SKUs look like in here.",
    panel: { c2: "Application", rows: [inStock("xFlex rear motor mount", "Focus RS", "42"), inStock("Alpha Intake", "Focus RS", "18"), low("Delta Core intercooler", "Focus RS", "3")], strato: "Reorder drafted for 2 low SKUs." },
  },
  {
    slug: "msi-racing-products",
    company: "MSI Racing Products",
    segment: "motorsport",
    logo: { src: "/logos/prospects/msi-racing-products.png", width: 700, height: 249 },
    note: "I put this page together for MSI because lug nuts and pit sockets are small parts that stop a whole weekend when you're short. Send a spreadsheet and I'll show you what your parts look like in here.",
    panel: { rows: [ready("Lug nut 5/8-18, yellow", "0931", "1,240"), ready("Lug nut 14x1.5 mm, black", "0412", "380"), short("Pit socket, 4340 steel", "0874", "6 of 8", "2 short")], strato: "Pit sockets, 2 short. Build drafted." },
  },
];

export function findProspect(slug: string): ProspectPage | undefined {
  return PROSPECTS.find((p) => p.slug === slug);
}

/** The segment's copy with this company's name and sample workspace filled in. */
export function prospectView(prospect: ProspectPage) {
  const seg = SEGMENTS[prospect.segment];
  return {
    headline: seg.headline.replace("{c}", prospect.company),
    lede: seg.lede,
    bullets: seg.bullets,
    problemHead: seg.problemHead,
    problems: seg.problems,
    note: prospect.note,
    panel: { ...seg.panel, ...prospect.panel },
  };
}
