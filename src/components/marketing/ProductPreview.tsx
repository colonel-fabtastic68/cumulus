"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { AlertTriangle, Boxes, ClipboardList, Eye, FileBarChart2, Hammer, Home, PackageCheck, Plus, RotateCcw, Search, ShoppingCart, Sparkles, Truck } from "lucide-react";
import { Badge, Button, CloudMark, Kbd, SimpleTable, Toggle } from "@/components/ui";
import { cn } from "@/lib/utils";

const TABS = [
  { id: "home", label: "Home", icon: Home, caption: "Home: what needs attention today, from the same ledger every table reads." },
  { id: "inventory", label: "Inventory", icon: Boxes, caption: "Inventory: a price change proposed by Nimbus, previewed in the table before anyone approves it." },
  { id: "receiving", label: "Receiving", icon: PackageCheck, caption: "Receiving: book a delivery against its purchase order, back-dated to the day it arrived." },
  { id: "builds", label: "Builds", icon: Hammer, caption: "Builds: component requirements for an assembly, with what is short and who supplies it." },
  { id: "orders", label: "Orders", icon: ShoppingCart, caption: "Orders: open sales orders and what shipping them will take from stock." },
  { id: "returns", label: "Returns", icon: RotateCcw, caption: "Returns: RMAs move through inspection to restock or write-off, in the same ledger." },
  { id: "suppliers", label: "Suppliers", icon: Truck, caption: "Suppliers: lead times and the items each one covers, so reorders land on time." },
  { id: "reports", label: "Reports", icon: FileBarChart2, caption: "Reports: low stock, valuation by category and shelf life, straight from the movements." },
] as const;

type TabId = (typeof TABS)[number]["id"];

/** Time on each tab while nobody is interacting. */
const CYCLE_MS = 3200;
/** How long a click keeps the tour paused. */
const IDLE_MS = 12_000;

/** Records a click so the idle tour stays out of the way for a while. Kept outside render for the purity rule. */
function markInteraction(ref: { current: number }) {
  ref.current = Date.now();
}

function nextTab(id: TabId): TabId {
  const idx = TABS.findIndex((t) => t.id === id);
  return TABS[(idx + 1) % TABS.length]!.id;
}

/**
 * The app, rendered from its own components with demo data. The sidebar tabs
 * work; the rest is decorative. Left alone, it tours the tabs on its own and
 * stops while hovered, focused, off-screen, or under prefers-reduced-motion.
 */
export function ProductPreview({ className }: { className?: string }) {
  const [active, setActive] = useState<TabId>("inventory");
  const [paused, setPaused] = useState(false);
  const [inView, setInView] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const lastPick = useRef(0);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || !("IntersectionObserver" in window)) {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver((entries) => setInView(entries.some((e) => e.isIntersecting)), { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!inView || paused) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => {
      if (Date.now() - lastPick.current < IDLE_MS) return;
      setActive((current) => nextTab(current));
    }, CYCLE_MS);
    return () => window.clearInterval(timer);
  }, [inView, paused]);

  const pick = (id: TabId) => {
    markInteraction(lastPick);
    setActive(id);
  };

  const onTabKey = (e: KeyboardEvent<HTMLElement>) => {
    const dir = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const idx = TABS.findIndex((t) => t.id === active);
    const next = TABS[(idx + dir + TABS.length) % TABS.length]!.id;
    pick(next);
    e.currentTarget.querySelector<HTMLElement>(`[data-tab="${next}"]`)?.focus();
  };

  const tab = TABS.find((t) => t.id === active)!;

  return (
    <div>
      <div
        ref={rootRef}
        className={cn("card overflow-hidden text-[13px] leading-5", className)}
        onPointerEnter={() => setPaused(true)}
        onPointerLeave={() => setPaused(false)}
        onFocusCapture={() => setPaused(true)}
        onBlurCapture={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setPaused(false);
        }}
      >
        <div className="flex h-12 items-center gap-3 border-b border-border bg-nav-bg px-4" inert>
          <span className="flex h-7 w-7 items-center justify-center rounded-[8px] bg-primary text-text-inverse">
            <CloudMark />
          </span>
          <div className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-[var(--radius-sm)] border border-border bg-surface px-3 text-text-tertiary shadow-[var(--shadow-100)] sm:max-w-sm">
            <Search className="h-3.5 w-3.5" />
            <span className="flex-1 truncate text-left">Search items, orders, suppliers</span>
            <Kbd>⌘K</Kbd>
          </div>
          <div className="ml-auto hidden items-center gap-2 sm:flex">
            <Button variant="primary" size="md" icon={<Sparkles />}>
              Nimbus <Kbd>⌘J</Kbd>
            </Button>
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#1f5f8b] text-[11px] font-semibold text-white">MO</span>
          </div>
        </div>

        <div role="tablist" aria-label="Preview pages" aria-orientation="horizontal" onKeyDown={onTabKey} className="flex gap-1 overflow-x-auto border-b border-border bg-nav-bg px-3 py-2 md:hidden">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              data-tab={t.id}
              aria-selected={active === t.id}
              tabIndex={active === t.id ? 0 : -1}
              onClick={() => pick(t.id)}
              className={cn("shrink-0 rounded-full px-3 py-1 text-[12.5px] font-[550] transition-colors", active === t.id ? "bg-primary text-text-inverse" : "text-text-secondary hover:bg-[rgba(0,0,0,0.05)]")}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="grid md:grid-cols-[168px_minmax(0,1fr)] lg:grid-cols-[168px_minmax(0,1fr)_300px]">
          <aside className="hidden flex-col border-r border-border bg-nav-bg p-3 md:flex">
            <div role="tablist" aria-label="Preview pages" aria-orientation="vertical" onKeyDown={onTabKey} className="flex flex-col gap-0.5">
              {TABS.map(({ id, label, icon: Icon }) => {
                const selected = active === id;
                return (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    data-tab={id}
                    aria-selected={selected}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => pick(id)}
                    className={cn(
                      "flex h-8 items-center gap-2.5 rounded-[var(--radius-sm)] px-2.5 text-left font-[550] transition-[background-color,box-shadow,color] duration-200",
                      selected ? "bg-surface text-text shadow-[var(--shadow-100),0_0_0_1px_rgba(26,26,26,0.07)]" : "text-text hover:bg-[rgba(0,0,0,0.04)]",
                    )}
                  >
                    <Icon className={cn("h-4 w-4", selected ? "text-text" : "text-icon")} />
                    <span className="flex-1">{label}</span>
                    {id === "inventory" && <span className="rounded-full bg-warning-soft px-1.5 text-[11px] font-medium text-warning">1</span>}
                    {id === "orders" && <span className="rounded-full bg-surface-hover px-1.5 text-[11px] font-medium text-text-secondary">3</span>}
                  </button>
                );
              })}
            </div>
            <div inert>
              <div className="mt-4 mb-1 px-2.5 text-[12px] font-[550] text-text-secondary">Workspace</div>
              <div className="flex h-8 items-center gap-2.5 px-2.5 font-[550] text-text">
                <Sparkles className="h-4 w-4 text-icon" /> Nimbus
              </div>
              <div className="flex h-8 items-center gap-2.5 px-2.5 font-[550] text-text">
                <ClipboardList className="h-4 w-4 text-icon" /> Activity
              </div>
            </div>
          </aside>

          <div key={active} className="preview-swap min-h-[440px] min-w-0" inert>
            {VIEWS[active]}
          </div>

          <aside key={`nimbus-${active}`} className="preview-swap hidden flex-col border-l border-border bg-surface lg:flex" inert>
            <NimbusPane tab={active} />
          </aside>
        </div>
      </div>
      <p className="mt-3 text-[12.5px] text-text-tertiary" aria-live="polite">
        {tab.caption}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page mocks. Demo numbers in the shape of the seed workspace (Halcyon Audio).
// ---------------------------------------------------------------------------

function PageHeader({ title, meta, action }: { title: string; meta?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2 px-4 pt-4 pb-3">
      <div>
        <div className="text-[16px] font-semibold text-text">{title}</div>
        {meta && <div className="text-[12.5px] text-text-secondary">{meta}</div>}
      </div>
      {action}
    </div>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "warning" }) {
  return (
    <div className="rounded-[var(--radius)] bg-surface p-3 shadow-[var(--shadow-bevel)]">
      <div className="text-[12px] text-text-secondary">{label}</div>
      <div className={cn("mt-1 text-[18px] font-semibold leading-6 tabular", tone === "warning" ? "text-warning" : "text-text")}>{value}</div>
      {hint && <div className="text-[11.5px] text-text-tertiary">{hint}</div>}
    </div>
  );
}

const ROWS = [
  { sku: "ENC-125B-RAW", name: "1590B aluminium enclosure, raw", category: "Enclosures", onHand: "260", min: "100", price: "$10.45", proposed: true, status: "Active" },
  { sku: "SW-3PDT-BLU", name: "3PDT footswitch, blue", category: "Electronics", onHand: "320", min: "150", price: "$4.95", proposed: true, status: "Active" },
  { sku: "POT-A100K-16", name: "Potentiometer A100K 16mm", category: "Electronics", onHand: "720", min: "300", price: "$1.98", proposed: true, status: "Active" },
  { sku: "JK-DC-2.1", name: "DC power jack 2.1mm", category: "Electronics", onHand: "92", min: "200", price: "$1.50", proposed: false, status: "Low stock" },
  { sku: "FT-RUBBER-12", name: "Rubber foot, 12mm adhesive", category: "Hardware", onHand: "2,600", min: "800", price: "$0.25", proposed: false, status: "Active" },
];

function HomeView() {
  return (
    <div className="bg-bg">
      <PageHeader title="Good morning, Maya" meta="Halcyon Audio" action={<Button size="sm" variant="primary" icon={<Sparkles />}>Ask Nimbus</Button>} />
      <div className="grid grid-cols-2 gap-2 px-4 sm:grid-cols-4">
        <Stat label="Inventory value" value="$18,420" hint="At standard cost" />
        <Stat label="Active SKUs" value="46" hint="8 assemblies" />
        <Stat label="Below minimum" value="1" hint="Needs reordering" tone="warning" />
        <Stat label="Open orders" value="3" hint="14 units to ship" />
      </div>
      <div className="m-4 rounded-[var(--radius)] bg-surface shadow-[var(--shadow-bevel)]">
        <div className="flex items-center gap-2 px-3 py-2 font-semibold">
          <AlertTriangle className="h-4 w-4 text-warning" /> Needs attention <Badge tone="warning">1 below minimum</Badge>
        </div>
        <SimpleTable>
          <thead>
            <tr>
              <th>SKU</th>
              <th className="text-right">On hand / min</th>
              <th className="text-right">Reorder</th>
              <th className="hidden sm:table-cell">Supplier</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="font-mono text-[12px]">JK-DC-2.1</td>
              <td className="text-right tabular">
                <span className="text-warning">92</span> / 200
              </td>
              <td className="text-right tabular">308</td>
              <td className="hidden sm:table-cell">Mouser Electronics</td>
            </tr>
          </tbody>
        </SimpleTable>
      </div>
    </div>
  );
}

function InventoryView() {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 border-b border-[#ffd6a4] bg-[#fff4e5] px-4 py-2 text-[12.5px]">
        <span className="flex items-center gap-1.5 font-medium text-warning">
          <Eye className="h-4 w-4" /> Previewing: Update 3 items · Price +10%
        </span>
        <span className="text-text-secondary">3 items highlighted</span>
        <span className="ml-auto inline-flex rounded-[var(--radius-sm)] bg-surface p-0.5 shadow-[var(--shadow-button)]">
          <span className="rounded-[6px] px-2 py-0.5 text-text-secondary">Current</span>
          <span className="rounded-[6px] bg-primary px-2 py-0.5 text-text-inverse">Proposed</span>
        </span>
        <Button size="sm" className="hidden sm:inline-flex">
          Close preview
        </Button>
        <Button size="sm" variant="primary">
          Apply
        </Button>
      </div>
      <PageHeader title="Inventory" meta="46 items · 1 below minimum · value $18,420" />
      <div className="overflow-x-auto px-4 pb-4">
        <SimpleTable className="[&_td]:whitespace-nowrap">
          <thead>
            <tr>
              <th>SKU</th>
              <th className="hidden md:table-cell">Category</th>
              <th className="text-right">On hand</th>
              <th className="hidden text-right lg:table-cell">Min</th>
              <th className="text-right">Price</th>
              <th className="hidden sm:table-cell">Status</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r.sku} className={r.proposed ? "preview-row" : undefined}>
                <td>
                  <div className="font-mono text-[12px] text-text">{r.sku}</div>
                  <div className="truncate text-[12px] text-text-secondary">{r.name}</div>
                </td>
                <td className="hidden md:table-cell">{r.category}</td>
                <td className="text-right tabular">{r.onHand}</td>
                <td className="hidden text-right tabular lg:table-cell">{r.min}</td>
                <td className="text-right tabular">{r.price}</td>
                <td className="hidden sm:table-cell">
                  <Badge tone={r.status === "Low stock" ? "warning" : "success"}>{r.status}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </SimpleTable>
      </div>
    </div>
  );
}

function ReceivingView() {
  return (
    <div>
      <PageHeader title="Receive stock" meta="Hammond Manufacturing · PO-1042" action={<Badge tone="info">Arrived yesterday</Badge>} />
      <div className="px-4">
        <SimpleTable>
          <thead>
            <tr>
              <th>SKU</th>
              <th className="text-right">Qty</th>
              <th className="text-right">Unit cost</th>
              <th className="hidden sm:table-cell">Lot</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <div className="font-mono text-[12px]">ENC-125B-RAW</div>
                <div className="text-[12px] text-text-secondary">1590B aluminium enclosure, raw</div>
              </td>
              <td className="text-right tabular">200</td>
              <td className="text-right tabular">$4.85</td>
              <td className="hidden font-mono text-[12px] sm:table-cell">H-0906</td>
            </tr>
            <tr>
              <td>
                <div className="font-mono text-[12px]">ENC-1590BB-RAW</div>
                <div className="text-[12px] text-text-secondary">1590BB aluminium enclosure, raw</div>
              </td>
              <td className="text-right tabular">60</td>
              <td className="text-right tabular">$6.90</td>
              <td className="hidden font-mono text-[12px] sm:table-cell">H-0906</td>
            </tr>
          </tbody>
        </SimpleTable>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4">
        <Toggle label="Back-date to the delivery date" checked onChange={() => {}} size="sm" />
        <Button size="md" variant="primary" icon={<PackageCheck />}>
          Receive 2 lines · $1,384.00
        </Button>
      </div>
    </div>
  );
}

const BUILD_LINES = [
  { sku: "PCB-DLY1-R1", need: "25", have: "12", short: "13", supplier: "PCBWay" },
  { sku: "IC-PT2399", need: "25", have: "12", short: "13", supplier: "Mouser" },
  { sku: "POT-B10K-16", need: "75", have: "30", short: "45", supplier: "Mouser" },
  { sku: "ENC-125B-PC-BLK", need: "25", have: "140", short: "", supplier: "Hammond" },
];

function BuildsView() {
  return (
    <div>
      <PageHeader title="Build FG-DLY1-BLK" meta="Delay pedal, black · 25 requested" action={<Badge tone="warning">Buildable now: 12</Badge>} />
      <div className="px-4">
        <SimpleTable>
          <thead>
            <tr>
              <th>Component</th>
              <th className="text-right">Need</th>
              <th className="text-right">On hand</th>
              <th className="text-right">Short</th>
              <th className="hidden sm:table-cell">Supplier</th>
            </tr>
          </thead>
          <tbody>
            {BUILD_LINES.map((l) => (
              <tr key={l.sku}>
                <td className="font-mono text-[12px]">{l.sku}</td>
                <td className="text-right tabular">{l.need}</td>
                <td className="text-right tabular">{l.have}</td>
                <td className={cn("text-right tabular", l.short && "font-medium text-critical")}>{l.short || "0"}</td>
                <td className="hidden sm:table-cell">{l.supplier}</td>
              </tr>
            ))}
          </tbody>
        </SimpleTable>
      </div>
      <div className="flex flex-wrap items-center gap-2 px-4 py-4">
        <Button size="md" variant="primary" icon={<Hammer />}>
          Build 12 now
        </Button>
        <Button size="md">Order the shortages</Button>
      </div>
    </div>
  );
}

const ORDERS = [
  { number: "#1041", customer: "Chicago Music Exchange", lines: "3 lines · 14 units", status: "Open", tone: "info" as const },
  { number: "#1040", customer: "Reverb order 88213", lines: "1 line · 1 unit", status: "Open", tone: "info" as const },
  { number: "#1039", customer: "Sweetwater", lines: "5 lines · 40 units", status: "Shipped", tone: "success" as const },
];

function OrdersView() {
  return (
    <div>
      <PageHeader title="Orders" meta="3 open · 14 units to ship" action={<Button size="sm" variant="primary" icon={<Plus />}>New order</Button>} />
      <div className="px-4 pb-4">
        <SimpleTable>
          <thead>
            <tr>
              <th>Order</th>
              <th>Customer</th>
              <th className="hidden sm:table-cell">Lines</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {ORDERS.map((o) => (
              <tr key={o.number}>
                <td className="font-mono text-[12px]">{o.number}</td>
                <td>{o.customer}</td>
                <td className="hidden sm:table-cell">{o.lines}</td>
                <td>
                  <Badge tone={o.tone}>{o.status}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </SimpleTable>
      </div>
    </div>
  );
}

const RMAS = [
  { number: "RMA-1003", customer: "Chicago Music Exchange", item: "FG-DLY1-BLK × 2", status: "Inspecting", tone: "warning" as const },
  { number: "RMA-1002", customer: "Reverb order 87990", item: "FG-OD1-WHT × 1", status: "Restocked", tone: "success" as const },
  { number: "RMA-1001", customer: "Sweetwater", item: "FG-FZ1-RAW × 1", status: "Written off", tone: "critical" as const },
];

function ReturnsView() {
  return (
    <div>
      <PageHeader title="Returns" meta="1 open · 2 resolved this month" />
      <div className="px-4 pb-4">
        <SimpleTable>
          <thead>
            <tr>
              <th>RMA</th>
              <th className="hidden sm:table-cell">Customer</th>
              <th>Item</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {RMAS.map((r) => (
              <tr key={r.number}>
                <td className="font-mono text-[12px]">{r.number}</td>
                <td className="hidden sm:table-cell">{r.customer}</td>
                <td className="font-mono text-[12px]">{r.item}</td>
                <td>
                  <Badge tone={r.tone}>{r.status}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </SimpleTable>
      </div>
    </div>
  );
}

const SUPPLIERS = [
  { name: "Mouser Electronics", lead: "4 days", items: "21 items", onOrder: "$2,140" },
  { name: "Hammond Manufacturing", lead: "10 days", items: "4 items", onOrder: "$1,384" },
  { name: "PCBWay", lead: "12 days", items: "2 items", onOrder: "$0" },
  { name: "Uline", lead: "3 days", items: "3 items", onOrder: "$0" },
];

function SuppliersView() {
  return (
    <div>
      <PageHeader title="Suppliers" meta="4 suppliers · 2 open purchase orders" action={<Button size="sm" icon={<Plus />}>Add supplier</Button>} />
      <div className="px-4 pb-4">
        <SimpleTable>
          <thead>
            <tr>
              <th>Supplier</th>
              <th className="text-right">Lead time</th>
              <th className="hidden text-right sm:table-cell">Items</th>
              <th className="text-right">On order</th>
            </tr>
          </thead>
          <tbody>
            {SUPPLIERS.map((s) => (
              <tr key={s.name}>
                <td>{s.name}</td>
                <td className="text-right tabular">{s.lead}</td>
                <td className="hidden text-right tabular sm:table-cell">{s.items}</td>
                <td className="text-right tabular">{s.onOrder}</td>
              </tr>
            ))}
          </tbody>
        </SimpleTable>
      </div>
    </div>
  );
}

const VALUATION = [
  { label: "Electronics", value: "$8,910", pct: 100 },
  { label: "Enclosures", value: "$6,420", pct: 72 },
  { label: "Finished goods", value: "$1,700", pct: 19 },
  { label: "Hardware", value: "$1,390", pct: 16 },
];

function ReportsView() {
  return (
    <div className="bg-bg">
      <PageHeader title="Reports" meta="Built from the movement ledger" />
      <div className="grid gap-3 px-4 pb-4 sm:grid-cols-2">
        <div className="rounded-[var(--radius)] bg-surface p-3 shadow-[var(--shadow-bevel)]">
          <div className="font-semibold">Valuation by category</div>
          <ul className="mt-2 flex flex-col gap-2">
            {VALUATION.map((v) => (
              <li key={v.label} className="text-[12.5px]">
                <div className="flex justify-between">
                  <span>{v.label}</span>
                  <span className="tabular text-text-secondary">{v.value}</span>
                </div>
                <div className="mt-1 h-1 rounded-full bg-primary" style={{ width: `${v.pct}%` }} />
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col gap-3">
          <div className="rounded-[var(--radius)] bg-surface p-3 shadow-[var(--shadow-bevel)]">
            <div className="font-semibold">Low stock</div>
            <div className="mt-1 text-[12.5px] text-text-secondary">
              1 item below minimum. <span className="font-mono text-text">JK-DC-2.1</span> covers 22 days at current use.
            </div>
          </div>
          <div className="rounded-[var(--radius)] bg-surface p-3 shadow-[var(--shadow-bevel)]">
            <div className="font-semibold">Shelf life</div>
            <div className="mt-1 text-[12.5px] text-text-secondary">
              Oldest batch on the shelf: <span className="font-mono text-text">SOL-63-37</span> lot S-0512, 118 days. Leaves first on the next build.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const VIEWS: Record<TabId, ReactNode> = {
  home: <HomeView />,
  inventory: <InventoryView />,
  receiving: <ReceivingView />,
  builds: <BuildsView />,
  orders: <OrdersView />,
  returns: <ReturnsView />,
  suppliers: <SuppliersView />,
  reports: <ReportsView />,
};

// ---------------------------------------------------------------------------
// Nimbus, one exchange per page.
// ---------------------------------------------------------------------------

interface Exchange {
  ask: string;
  lookup: string;
  reply?: string;
  proposal?: { title: string; lines: string[]; action: string };
}

const NIMBUS: Record<TabId, Exchange> = {
  home: { ask: "What needs attention today?", lookup: "Looked up 2 things · Workspace summary, Low stock report", reply: "One item is below minimum: JK-DC-2.1 at 92 of 200. Reordering 308 from Mouser covers four weeks at current use." },
  inventory: { ask: "Raise prices in Enclosures and Electronics by 10%", lookup: "Looked up 2 things · Workspace summary, Preview bulk update", proposal: { title: "Update 3 items", lines: ["Fields: price", "Price +10%", "Reason: 10% increase across two categories"], action: "Apply" } },
  receiving: { ask: "Book the Hammond delivery from PO-1042, it arrived yesterday", lookup: "Looked up 2 things · Supplier, Open purchase orders", proposal: { title: "Receive 2 lines from Hammond Manufacturing", lines: ["ENC-125B-RAW × 200 @ $4.85", "ENC-1590BB-RAW × 60 @ $6.90", "Back-dated to yesterday"], action: "Receive" } },
  builds: { ask: "Can we build 25 delay pedals this week?", lookup: "Looked up 2 things · Explode BOM, Suppliers", reply: "12 now. PCB-DLY1-R1 and IC-PT2399 are short 13 each and POT-B10K-16 is short 45. PCBWay's lead time is 12 days, so the rest lands the week after." },
  orders: { ask: "Ship everything that is ready for Chicago Music Exchange", lookup: "Looked up 2 things · Open orders, Item detail", proposal: { title: "Ship order #1041", lines: ["3 lines · 14 units", "All lines in stock", "Reason: customer confirmed pickup"], action: "Ship" } },
  returns: { ask: "What came back this month?", lookup: "Looked up 1 thing · Open RMAs", reply: "Three returns. Two went back to stock after inspection and one FG-FZ1-RAW was written off for a cracked enclosure." },
  suppliers: { ask: "Which supplier is holding up builds?", lookup: "Looked up 2 things · Suppliers, Recent receipts", reply: "PCBWay. Its 12-day lead time on PCB-DLY1-R1 is the long pole for the delay pedal, and the last two deliveries landed late." },
  reports: { ask: "Show me dead stock over 120 days", lookup: "Looked up 1 thing · Dead stock report", reply: "Four items have not moved since May, $412 at cost. Want a write-off proposal, or a note to the next stock count?" },
};

function NimbusPane({ tab }: { tab: TabId }) {
  const x = NIMBUS[tab];
  return (
    <>
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-text-inverse">
          <CloudMark />
        </span>
        <div className="leading-tight">
          <div className="font-semibold">Nimbus</div>
          <div className="text-[11.5px] text-text-tertiary">Asks before changing data</div>
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="self-end rounded-[var(--radius)] bg-primary px-3 py-2 text-[12.5px] text-text-inverse">{x.ask}</div>
        <div className="rounded-[var(--radius-sm)] bg-surface-subdued px-2.5 py-1.5 text-[12px] text-text-secondary">{x.lookup}</div>
        {x.reply && <p className="text-[12.5px] text-text">{x.reply}</p>}
        {x.proposal && (
          <div className="rounded-[var(--radius)] border border-[rgba(94,66,0,0.3)] bg-surface shadow-[0_0_0_3px_#ffd6a4]">
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
              <Badge tone="warning">Needs approval</Badge>
              <span className="font-medium">{x.proposal.title}</span>
            </div>
            <ul className="list-disc px-3 py-2 pl-7 text-[12.5px] text-text-secondary">
              {x.proposal.lines.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
            <div className="flex items-center gap-2 border-t border-border px-3 py-2">
              <Button size="sm" variant={tab === "inventory" ? "primary" : "tertiary"} icon={<Eye />} className="mr-auto">
                {tab === "inventory" ? "Previewing" : "Preview in table"}
              </Button>
              <Button size="sm">Reject</Button>
              <Button size="sm" variant="primary">
                {x.proposal.action}
              </Button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
