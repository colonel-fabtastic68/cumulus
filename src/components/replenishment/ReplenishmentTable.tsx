"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { AlarmClock, BellOff, CheckCircle2, Hammer, MoreHorizontal, ShoppingCart, SlidersHorizontal, Wand2 } from "lucide-react";
import type { Item, ReplenishmentRule } from "@/lib/types";
import type { ReplenishmentRow } from "@/lib/replenishment";
import { useSettings } from "@/lib/store/provider";
import { formatDate, formatMoney, formatNumber, formatQty, pluralize } from "@/lib/format";
import { cn, matches } from "@/lib/utils";
import { Badge, Button, EmptyState, IconButton, Menu, Modal, SearchField, Segmented, Select, Table, TextField, Toggle, type Column } from "@/components/ui";

/** Items above their line ("ok") only show under All. */
type View = "order" | "covered" | "snoozed" | "auto" | "all";

const VIEWS: Array<{ value: View; label: string }> = [
  { value: "order", label: "To order" },
  { value: "covered", label: "Covered" },
  { value: "snoozed", label: "Snoozed" },
  { value: "auto", label: "Automatic" },
  { value: "all", label: "All" },
];

const SNOOZES: Array<{ label: string; days: number }> = [
  { label: "Snooze a week", days: 7 },
  { label: "Snooze two weeks", days: 14 },
  { label: "Snooze a month", days: 30 },
];

function plusDays(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

interface Props {
  rows: ReplenishmentRow[];
  canWrite: boolean;
  busy?: boolean;
  onOrder: (selections: Array<{ itemId: string; qty: number }>) => void;
  onBuild: (item: Item, qty: number) => void;
  onSnooze: (itemIds: string[], until: string | null) => void;
  onRule: (itemId: string, patch: Partial<ReplenishmentRule>) => void;
}

export function ReplenishmentTable({ rows, canWrite, busy, onOrder, onBuild, onSnooze, onRule }: Props) {
  const { currency } = useSettings();
  const [view, setView] = useState<View>("order");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [qtyEdits, setQtyEdits] = useState<Record<string, string>>({});
  const [ruleFor, setRuleFor] = useState<ReplenishmentRow | null>(null);

  const counts = useMemo<Record<View, number>>(
    () => ({ order: rows.filter((r) => r.status === "order").length, covered: rows.filter((r) => r.status === "covered").length, snoozed: rows.filter((r) => r.status === "snoozed").length, auto: rows.filter((r) => r.auto).length, all: rows.length }),
    [rows],
  );
  const visible = useMemo(() => {
    let list = view === "all" ? rows : view === "auto" ? rows.filter((r) => r.auto) : rows.filter((r) => r.status === view);
    if (q.trim()) list = list.filter((r) => matches(q, r.item.sku, r.item.name, r.item.category, r.supplier?.name));
    return list;
  }, [rows, view, q]);

  const qtyFor = (r: ReplenishmentRow): number => {
    const edit = qtyEdits[r.item.id];
    if (edit === undefined || edit.trim() === "") return r.toOrder;
    const n = Number(edit);
    return Number.isFinite(n) && n >= 0 ? n : r.toOrder;
  };
  const orderRows = (list: ReplenishmentRow[]) => {
    const buy = list.filter((r) => r.route === "buy" && qtyFor(r) > 0).map((r) => ({ itemId: r.item.id, qty: qtyFor(r) }));
    if (buy.length) onOrder(buy);
    setSelected(new Set());
  };

  const columns = useMemo<Column<ReplenishmentRow>[]>(
    () => [
      {
        key: "item",
        header: "Item",
        render: (r) => (
          <span className="block min-w-0">
            <Link href={`/inventory/${r.item.id}`} onClick={(e) => e.stopPropagation()} className="font-mono text-[12px] text-accent hover:underline">
              {r.item.sku}
            </Link>
            <span className="block max-w-[240px] truncate text-[12px] text-text-secondary" title={r.item.name}>
              {r.item.name}
            </span>
          </span>
        ),
        sortValue: (r) => r.item.sku,
      },
      {
        key: "route",
        header: "Route",
        hideBelow: "sm",
        render: (r) => (
          <span className="inline-flex items-center gap-1.5">
            <Badge tone={r.route === "build" ? "info" : "default"}>{r.route === "build" ? "Build" : "Buy"}</Badge>
            {r.auto && (
              <span title="Automatic: drafted daily without asking">
                <Wand2 className="h-3.5 w-3.5 text-accent" />
              </span>
            )}
          </span>
        ),
        sortValue: (r) => r.route,
      },
      {
        key: "supplier",
        header: "Supplier",
        hideBelow: "md",
        render: (r) =>
          r.route === "build" ? (
            <span className="text-text-tertiary">From the BOM</span>
          ) : r.supplier ? (
            <span className="block min-w-0">
              <span className="block max-w-[180px] truncate">{r.supplier.name}</span>
              {r.leadTimeDays !== undefined && <span className="block text-[11.5px] text-text-tertiary">{pluralize(r.leadTimeDays, "day")} lead time</span>}
            </span>
          ) : (
            <Badge tone="warning">No supplier</Badge>
          ),
        sortValue: (r) => r.supplier?.name ?? "",
      },
      { key: "onHand", header: "On hand", align: "right", render: (r) => <span className={cn(r.onHand <= 0 && "font-medium text-critical")}>{formatQty(r.onHand, r.item.unit)}</span>, sortValue: (r) => r.onHand },
      { key: "incoming", header: "Incoming", align: "right", hideBelow: "lg", render: (r) => (r.incoming ? <span className="text-success">+{formatQty(r.incoming, r.item.unit)}</span> : <span className="text-text-tertiary">—</span>), sortValue: (r) => r.incoming },
      { key: "outgoing", header: "Outgoing", align: "right", hideBelow: "lg", render: (r) => (r.outgoing ? <span className="text-critical">−{formatQty(r.outgoing, r.item.unit)}</span> : <span className="text-text-tertiary">—</span>), sortValue: (r) => r.outgoing },
      {
        key: "forecast",
        header: "Forecast",
        align: "right",
        render: (r) => <span className={cn("font-medium", r.min !== undefined && r.forecast < r.min ? "text-warning" : "text-text")}>{formatQty(r.forecast, r.item.unit)}</span>,
        sortValue: (r) => r.forecast,
      },
      {
        key: "minmax",
        header: "Min / max",
        align: "right",
        hideBelow: "md",
        render: (r) => (
          <span className="text-text-secondary">
            {r.min === undefined ? "—" : formatNumber(r.min, 2)} / {r.max === undefined ? "—" : formatNumber(r.max, 2)}
          </span>
        ),
        sortValue: (r) => r.min ?? null,
      },
      { key: "usage", header: "Usage / day", align: "right", hideBelow: "lg", render: (r) => (r.dailyUsage ? formatNumber(r.dailyUsage, 2) : <span className="text-text-tertiary">—</span>), sortValue: (r) => r.dailyUsage },
      {
        key: "orderBy",
        header: "Order by",
        render: (r) =>
          r.status === "snoozed" ? (
            <span className="inline-flex items-center gap-1.5 text-text-tertiary">
              <BellOff className="h-3.5 w-3.5" />
              until {formatDate(r.snoozedUntil)}
            </span>
          ) : r.orderBy ? (
            <span className="inline-flex items-center gap-1.5">
              {formatDate(r.orderBy)}
              {r.late && r.status === "order" && <Badge tone="critical">Late</Badge>}
            </span>
          ) : r.status === "order" ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="text-text-secondary">Now</span>
              {r.late && <Badge tone="critical">Late</Badge>}
            </span>
          ) : (
            <span className="text-text-tertiary">—</span>
          ),
        sortValue: (r) => r.orderBy ?? "9999",
      },
      {
        key: "toOrder",
        header: "To order",
        align: "right",
        width: "100px",
        render: (r) =>
          canWrite && r.status !== "snoozed" ? (
            <div onClick={(e) => e.stopPropagation()}>
              <TextField type="number" min={0} step="any" value={qtyEdits[r.item.id] ?? (r.toOrder ? String(r.toOrder) : "")} placeholder="0" onChange={(e) => setQtyEdits((prev) => ({ ...prev, [r.item.id]: e.target.value }))} aria-label={`Quantity to order for ${r.item.sku}`} className="text-right" />
            </div>
          ) : (
            <span className="font-medium">{r.toOrder ? formatQty(r.toOrder, r.item.unit) : <span className="text-text-tertiary">—</span>}</span>
          ),
        sortValue: (r) => r.toOrder,
      },
      { key: "cost", header: "Est. cost", align: "right", hideBelow: "sm", render: (r) => (r.route === "buy" && qtyFor(r) > 0 ? formatMoney(qtyFor(r) * r.unitCost, currency) : <span className="text-text-tertiary">—</span>), sortValue: (r) => r.estCost },
      {
        key: "actions",
        header: "",
        width: "44px",
        align: "right",
        render: (r) => (
          <div onClick={(e) => e.stopPropagation()} className="flex justify-end">
            <Menu
              trigger={
                <IconButton variant="plain" size="sm" aria-label={`Actions for ${r.item.sku}`} className="text-text-secondary">
                  <MoreHorizontal className="h-4 w-4" />
                </IconButton>
              }
              items={[
                ...(canWrite
                  ? [
                      r.route === "build"
                        ? { label: `Build ${formatQty(qtyFor(r) || r.toOrder || 1, r.item.unit)} now…`, icon: <Hammer />, onSelect: () => onBuild(r.item, qtyFor(r) || r.toOrder || 1) }
                        : { label: qtyFor(r) > 0 ? `Order ${formatQty(qtyFor(r), r.item.unit)} once` : "Order once", icon: <ShoppingCart />, disabled: qtyFor(r) <= 0 || !r.supplier, onSelect: () => orderRows([r]) },
                      { label: r.auto ? "Switch to manual" : "Automate: draft orders daily", icon: <Wand2 />, onSelect: () => onRule(r.item.id, { auto: !r.auto }) },
                      "divider" as const,
                      ...(r.status === "snoozed" ? [{ label: "Clear snooze", icon: <AlarmClock />, onSelect: () => onSnooze([r.item.id], null) }] : SNOOZES.map((s) => ({ label: s.label, icon: <BellOff />, onSelect: () => onSnooze([r.item.id], plusDays(s.days)) }))),
                      "divider" as const,
                      { label: "Rule: route, multiple…", icon: <SlidersHorizontal />, onSelect: () => setRuleFor(r) },
                    ]
                  : []),
                { label: "Open item", href: `/inventory/${r.item.id}` },
              ]}
            />
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currency, canWrite, qtyEdits, onBuild, onRule, onSnooze],
  );

  let empty: ReactNode;
  if (q.trim()) empty = <EmptyState icon={<CheckCircle2 />} title="Nothing matches" description={`No item in this view matches “${q.trim()}”.`} action={<Button size="sm" onClick={() => setQ("")}>Clear search</Button>} />;
  else if (view === "order") empty = <EmptyState icon={<CheckCircle2 />} title="Nothing to order" description={rows.length ? "Every item's forecast is above its minimum, or what is on order already covers it." : "Set minimum (and maximum) quantities on items and they show up here when the forecast dips below the line."} />;
  else empty = <EmptyState icon={<CheckCircle2 />} title={`No ${VIEWS.find((v) => v.value === view)?.label.toLowerCase() ?? ""} items`} description="Switch to another view." />;

  const bulk = (sel: Set<string>) => {
    const chosen = visible.filter((r) => sel.has(r.item.id));
    const buyable = chosen.filter((r) => r.route === "buy" && r.supplier && qtyFor(r) > 0);
    return (
      <>
        <Button size="sm" variant="primary" icon={<ShoppingCart />} disabled={buyable.length === 0 || busy} onClick={() => orderRows(chosen)}>
          Order {buyable.length ? pluralize(buyable.length, "item") : "selected"}
        </Button>
        <Menu
          trigger={
            <Button size="sm" icon={<BellOff />}>
              Snooze
            </Button>
          }
          items={[...SNOOZES.map((s) => ({ label: s.label, onSelect: () => { onSnooze(chosen.map((r) => r.item.id), plusDays(s.days)); setSelected(new Set()); } })), "divider", { label: "Clear snooze", onSelect: () => { onSnooze(chosen.map((r) => r.item.id), null); setSelected(new Set()); } }]}
        />
        <Button size="sm" icon={<Wand2 />} onClick={() => { chosen.forEach((r) => onRule(r.item.id, { auto: true })); setSelected(new Set()); }}>
          Automate
        </Button>
        <Button size="sm" onClick={() => { chosen.forEach((r) => onRule(r.item.id, { auto: false })); setSelected(new Set()); }}>
          Manual
        </Button>
      </>
    );
  };

  return (
    <>
      <Table
        rows={visible}
        columns={columns}
        rowKey={(r) => r.item.id}
        selectable={canWrite}
        selected={selected}
        onSelectedChange={setSelected}
        bulkActions={canWrite ? bulk : undefined}
        pageSize={50}
        emptyState={empty}
        toolbar={
          <div className="flex w-full flex-wrap items-center gap-2">
            <Segmented value={view} onChange={setView} options={VIEWS.map((v) => ({ ...v, count: counts[v.value] }))} />
            <SearchField value={q} onChange={setQ} placeholder="Search SKU, name, category or supplier" className="w-full sm:ml-auto sm:w-72" />
          </div>
        }
        footer={`${pluralize(visible.length, "item")}${canWrite ? " · edit a quantity, then order once, or select items to order together" : ""}`}
      />
      <RuleModal row={ruleFor} onClose={() => setRuleFor(null)} onSave={(patch) => { if (ruleFor) onRule(ruleFor.item.id, patch); setRuleFor(null); }} />
    </>
  );
}

/** Route, automation and order multiple for one item. */
function RuleModal({ row, onClose, onSave }: { row: ReplenishmentRow | null; onClose: () => void; onSave: (patch: Partial<ReplenishmentRule>) => void }) {
  if (!row) return null;
  return <RuleForm key={row.item.id} row={row} onClose={onClose} onSave={onSave} />;
}

function RuleForm({ row, onClose, onSave }: { row: ReplenishmentRow; onClose: () => void; onSave: (patch: Partial<ReplenishmentRule>) => void }) {
  const canBuild = row.item.type === "assembly" && row.item.bom.length > 0;
  const [route, setRoute] = useState<"buy" | "build">(row.route);
  const [auto, setAuto] = useState(row.auto);
  const [multiple, setMultiple] = useState(row.multiple ? String(row.multiple) : "");
  const m = Number(multiple);
  const multipleError = multiple.trim() !== "" && (!Number.isFinite(m) || m <= 0) ? "Enter a positive number, or leave it blank" : undefined;
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={`Replenishment rule for ${row.item.sku}`}
      subtitle={`Min ${row.min ?? "—"} · max ${row.max ?? "—"}. Change those on the item itself.`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!!multipleError} onClick={() => onSave({ route: route === (canBuild ? "build" : "buy") ? undefined : route, auto, multiple: multiple.trim() === "" ? null : m } as Partial<ReplenishmentRule>)}>
            Save rule
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {canBuild ? (
          <Select label="Route" value={route} onChange={(e) => setRoute(e.target.value as "buy" | "build")} options={[{ value: "build", label: "Build from the BOM" }, { value: "buy", label: "Buy from the supplier" }]} help="Built items pull their components into the plan, so parts get ordered for them." />
        ) : (
          <p className="text-[12.5px] text-text-secondary">Bought from {row.supplier?.name ?? "the supplier set on the item"}.</p>
        )}
        <Toggle label="Automatic" help="When the forecast dips below min, a draft purchase order is created without asking (daily, on hosted workspaces). Nothing is sent to the supplier until you send it." checked={auto} onChange={setAuto} />
        <TextField label="Order multiple" hint="(optional)" type="number" min={0} step="any" value={multiple} onChange={(e) => setMultiple(e.target.value)} error={multipleError} help="Quantities round up to a multiple of this: a case of 12, a pack of 50." placeholder="e.g. 12" />
      </div>
    </Modal>
  );
}
