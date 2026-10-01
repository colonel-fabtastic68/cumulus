"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowDownToLine, ArrowUpFromLine, ScanSearch } from "lucide-react";
import type { Lot } from "@/lib/types";
import { customersFor, downstreamLots, findLots, lotLabel, lotSourceLabel, traceLot, upstreamLots, type TraceSource } from "@/lib/traceability";
import { useCollection, useItems, useSettings } from "@/lib/store/provider";
import { formatDate, formatMoney, formatQty, pluralize } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge, Button, DescriptionList, EmptyState, SearchField, SimpleTable, Table, type Column } from "@/components/ui";
import { MOVEMENT_LABELS, refHref } from "@/components/item/utils";
import { csvFilename, downloadCsv } from "./csv";
import { AskAgentButton, ExportCsvButton, ReportHeader, ReportSubheader, SkuLink } from "./shared";

/**
 * Traceability: pick a batch (by lot number, supplier code, SKU or document)
 * and see where it came from and where every unit went, following builds
 * through to the batches they produced and sales through to the customer.
 */
export function TraceabilityReport() {
  const params = useSearchParams();
  const items = useItems();
  const lots = useCollection("lots");
  const movements = useCollection("movements");
  const receipts = useCollection("receipts");
  const purchaseOrders = useCollection("purchaseOrders");
  const suppliers = useCollection("suppliers");
  const builds = useCollection("builds");
  const orders = useCollection("orders");
  const shipments = useCollection("shipments");
  const customers = useCollection("customers");
  const { currency } = useSettings();

  const src = useMemo<TraceSource>(() => ({ items, lots, movements, receipts, purchaseOrders, suppliers, builds, orders, shipments, customers }), [items, lots, movements, receipts, purchaseOrders, suppliers, builds, orders, shipments, customers]);

  const [q, setQ] = useState(() => params.get("q") ?? "");
  const [lotId, setLotId] = useState<string | null>(() => params.get("lot"));
  // A link with ?lot= or ?q= while already on the report: re-sync when the URL changes underneath us.
  const paramLot = params.get("lot");
  const paramQ = params.get("q");
  const [seenLot, setSeenLot] = useState(paramLot);
  const [seenQ, setSeenQ] = useState(paramQ);
  if (paramLot !== seenLot) {
    setSeenLot(paramLot);
    if (paramLot) setLotId(paramLot);
  }
  if (paramQ !== seenQ) {
    setSeenQ(paramQ);
    if (paramQ) setQ(paramQ);
  }

  const matchesList = useMemo(() => (q.trim() ? findLots(src, q).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)).slice(0, 200) : []), [src, q]);
  const lot = useMemo(() => (lotId ? (lots.find((l) => l.id === lotId) ?? null) : null), [lots, lotId]);
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const columns = useMemo<Column<Lot>[]>(
    () => [
      { key: "lot", header: "Batch", render: (l) => <span className="font-mono text-[12px] font-medium text-text">{lotLabel(l)}</span>, sortValue: (l) => lotLabel(l) },
      {
        key: "sku",
        header: "Item",
        render: (l) => {
          const item = itemById.get(l.itemId);
          return item ? (
            <span className="block min-w-0">
              <SkuLink item={item} />
              <span className="block max-w-[240px] truncate text-[12px] text-text-secondary">{item.name}</span>
            </span>
          ) : (
            <span className="text-text-tertiary">{l.itemId}</span>
          );
        },
        sortValue: (l) => itemById.get(l.itemId)?.sku ?? "",
      },
      { key: "supplierLot", header: "Supplier lot", hideBelow: "md", render: (l) => l.supplierLot ?? <span className="text-text-tertiary">—</span>, sortValue: (l) => l.supplierLot ?? "" },
      { key: "source", header: "From", hideBelow: "sm", render: (l) => lotSourceLabel(l), sortValue: (l) => lotSourceLabel(l) },
      { key: "received", header: "Received", render: (l) => formatDate(l.receivedAt), sortValue: (l) => l.receivedAt },
      { key: "qty", header: "Remaining", align: "right", render: (l) => <span>{formatQty(l.qtyRemaining, itemById.get(l.itemId)?.unit)} <span className="text-text-tertiary">of {formatQty(l.qtyReceived, itemById.get(l.itemId)?.unit)}</span></span>, sortValue: (l) => l.qtyRemaining },
      { key: "expires", header: "Expires", hideBelow: "lg", render: (l) => (l.expiresAt ? formatDate(l.expiresAt) : <span className="text-text-tertiary">—</span>), sortValue: (l) => l.expiresAt ?? "" },
    ],
    [itemById],
  );

  return (
    <div className="flex flex-col gap-4">
      <ReportHeader
        title="Traceability"
        description="Every delivery and build creates a numbered batch, and every sale, build or write-off remembers which batches it took from. Look a batch up by its lot number, the supplier's code, a SKU, or a receipt, order or build number, then follow it upstream to the supplier and downstream to the customer."
        actions={<AskAgentButton prompt={lot ? `Trace batch ${lotLabel(lot)} and summarize where it came from and every customer or build it went into.` : "Which batches on the shelf are expired or expiring within 30 days, and which customers received units from any batch that came in during the last week?"} label="Ask Strato" />}
      />
      <div className="card flex flex-wrap items-center gap-2 px-3 py-2.5">
        <SearchField value={q} onChange={setQ} placeholder="Lot number, supplier lot, SKU, RCV-, PO- or BLD- number" className="w-full sm:w-96" autoFocus={!lot} />
        {lot && (
          <Button size="sm" variant="plain" onClick={() => setLotId(null)}>
            Back to results
          </Button>
        )}
      </div>

      {lot ? (
        <LotDetail lot={lot} src={src} currency={currency} onPick={(l) => setLotId(l.id)} />
      ) : q.trim() ? (
        <Table rows={matchesList} columns={columns} rowKey={(l) => l.id} onRowClick={(l) => setLotId(l.id)} defaultSort={{ key: "received", dir: "desc" }} pageSize={25} dense emptyState={<EmptyState icon={<ScanSearch />} title="No batch matches" description="Try the lot number printed on the receipt, the supplier's batch code, or the SKU." />} footer={`${pluralize(matchesList.length, "batch", "batches")} · click one to trace it`} />
      ) : (
        <div className="card">
          <EmptyState icon={<ScanSearch />} title="Look up a batch" description="Type a lot number (LOT-1001), a supplier's batch code, a SKU, or a receipt, purchase order or build number." />
        </div>
      )}
    </div>
  );
}

function LotDetail({ lot, src, currency, onPick }: { lot: Lot; src: TraceSource; currency: string; onPick: (lot: Lot) => void }) {
  const trace = useMemo(() => traceLot(src, lot), [src, lot]);
  const upstream = useMemo(() => upstreamLots(src, lot), [src, lot]);
  const downstream = useMemo(() => downstreamLots(src, lot), [src, lot]);
  const customers = useMemo(() => customersFor(src, lot), [src, lot]);
  const item = trace.item;
  const unit = item?.unit;
  const expired = !!lot.expiresAt && lot.expiresAt < new Date().toISOString();

  const originRows = (() => {
    const o = trace.origin;
    if (o.kind === "receipt") {
      return [
        { label: "Received on", value: o.receipt ? <Link href={refHref("receipt", o.receipt.id) ?? "#"} className="font-mono text-accent hover:underline">{o.receipt.number}</Link> : formatDate(lot.receivedAt) },
        { label: "Purchase order", value: o.purchaseOrder ? <Link href={`/orders/purchase?highlight=${o.purchaseOrder.id}`} className="font-mono text-accent hover:underline">{o.purchaseOrder.number}</Link> : "—" },
        { label: "Supplier", value: o.supplier ? <Link href={`/suppliers?highlight=${o.supplier.id}`} className="text-accent hover:underline">{o.supplier.name}</Link> : "—" },
        { label: "Supplier lot", value: lot.supplierLot ?? "—" },
        ...(o.receipt?.reference ? [{ label: "Reference", value: o.receipt.reference }] : []),
      ];
    }
    if (o.kind === "build") {
      return [
        { label: "Built on", value: o.build ? <Link href={refHref("build", o.build.id) ?? "#"} className="font-mono text-accent hover:underline">{o.build.number}</Link> : formatDate(lot.receivedAt) },
        { label: "Components", value: o.components.length ? `${pluralize(o.components.length, "batch", "batches")} consumed` : "Not recorded (built before batch tracking)" },
      ];
    }
    return [{ label: "Origin", value: o.label }];
  })();

  const exportCsv = () =>
    downloadCsv(
      csvFilename(`trace-${lotLabel(lot)}`),
      ["Direction", "Depth", "Date", "What", "Qty", "Batch", "SKU", "Document", "Customer / supplier"],
      [
        ...upstream.map((u) => ["Upstream", u.depth + 1, formatDate(u.lot.receivedAt), lotSourceLabel(u.lot), u.qty, lotLabel(u.lot), u.item?.sku ?? "", u.trace.origin.kind === "receipt" ? (u.trace.origin.receipt?.number ?? "") : u.trace.origin.kind === "build" ? (u.trace.origin.build?.number ?? "") : "", u.trace.origin.kind === "receipt" ? (u.trace.origin.supplier?.name ?? "") : ""]),
        ...downstream.map((d) => ["Downstream", d.depth, formatDate(d.use.movement.occurredAt), MOVEMENT_LABELS[d.use.movement.type], d.use.qty, lotLabel(d.fromLot), d.fromItem?.sku ?? "", d.use.order?.number ?? d.use.build?.number ?? "", d.use.order?.customer ?? ""]),
      ],
    );

  return (
    <div className="flex flex-col gap-4">
      <div className="card flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[15px] font-semibold text-text">{lotLabel(lot)}</span>
          {item && <SkuLink item={item} className="text-[13px]" />}
          {item && <span className="text-[13px] text-text-secondary">{item.name}</span>}
          <Badge tone={lot.qtyRemaining > 0 ? "success" : "default"}>{lot.qtyRemaining > 0 ? `${formatQty(lot.qtyRemaining, unit)} on the shelf` : "Used up"}</Badge>
          {expired && <Badge tone="critical">Expired</Badge>}
        </div>
        <div className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
          <DescriptionList rows={[{ label: lotSourceLabel(lot), value: formatDate(lot.receivedAt) }, { label: "Quantity", value: `${formatQty(lot.qtyReceived, unit)} in · ${formatQty(trace.used, unit)} out · ${formatQty(lot.qtyRemaining, unit)} left` }, { label: "Unit cost", value: formatMoney(lot.unitCost, currency) }, ...(lot.expiresAt ? [{ label: "Expires", value: formatDate(lot.expiresAt) }] : [])]} />
          <DescriptionList rows={originRows} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ExportCsvButton onExport={exportCsv} />
          {item && (
            <Button size="sm" variant="secondary" href={`/inventory/${item.id}?tab=batches`}>
              All batches of {item.sku}
            </Button>
          )}
        </div>
      </div>

      {trace.origin.kind === "build" && (
        <section className="flex flex-col gap-2">
          <ReportSubheader title={<span className="inline-flex items-center gap-1.5"><ArrowUpFromLine className="h-4 w-4 text-text-tertiary" />Upstream: what went into it</span>} description="The component batches this build consumed, and the deliveries behind them." />
          {upstream.length === 0 ? (
            <div className="card px-4 py-3 text-[13px] text-text-secondary">This build was recorded before component batches were tracked.</div>
          ) : (
            <SimpleTable>
              <thead>
                <tr>
                  <th>Batch</th>
                  <th>Item</th>
                  <th className="text-right">Qty used</th>
                  <th>From</th>
                  <th>Supplier</th>
                </tr>
              </thead>
              <tbody>
                {upstream.map((u) => (
                  <tr key={`${u.depth}-${u.lot.id}`}>
                    <td className={cn("font-mono text-[12px]")} style={{ paddingLeft: `${12 + u.depth * 16}px` }}>
                      <button type="button" className="text-accent hover:underline" onClick={() => onPick(u.lot)}>
                        {lotLabel(u.lot)}
                      </button>
                    </td>
                    <td>{u.item ? <span><SkuLink item={u.item} /> <span className="text-text-secondary">{u.item.name}</span></span> : "—"}</td>
                    <td className="text-right tabular">{formatQty(u.qty, u.item?.unit)}</td>
                    <td className="text-text-secondary">
                      {lotSourceLabel(u.lot)}
                      {u.trace.origin.kind === "receipt" && u.trace.origin.receipt ? ` ${u.trace.origin.receipt.number}` : u.trace.origin.kind === "build" && u.trace.origin.build ? ` ${u.trace.origin.build.number}` : ""} · {formatDate(u.lot.receivedAt)}
                    </td>
                    <td className="text-text-secondary">{u.trace.origin.kind === "receipt" ? (u.trace.origin.supplier?.name ?? "—") : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </SimpleTable>
          )}
        </section>
      )}

      <section className="flex flex-col gap-2">
        <ReportSubheader title={<span className="inline-flex items-center gap-1.5"><ArrowDownToLine className="h-4 w-4 text-text-tertiary" />Downstream: where it went</span>} description={customers.length ? `${pluralize(new Set(customers.map((c) => c.order.customer)).size, "customer")} received units from this batch${customers.some((c) => c.via) ? ", some inside assemblies built from it" : ""}.` : "Sales, builds and write-offs that took from this batch, following builds through to what they produced."} />
        {downstream.length === 0 ? (
          <div className="card px-4 py-3 text-[13px] text-text-secondary">{lot.qtyRemaining >= lot.qtyReceived ? "Nothing has been taken from this batch yet." : "Consumption from this batch was recorded before batch tracking, so there is no breakdown."}</div>
        ) : (
          <SimpleTable>
            <thead>
              <tr>
                <th>Date</th>
                <th>What</th>
                <th className="text-right">Qty</th>
                <th>Batch</th>
                <th>Document</th>
                <th>Customer / result</th>
              </tr>
            </thead>
            <tbody>
              {downstream.map((d) => {
                const m = d.use.movement;
                const doc = d.use.order ? { label: d.use.order.number, href: refHref("order", d.use.order.id) } : d.use.build ? { label: d.use.build.number, href: refHref("build", d.use.build.id) } : null;
                const tracking = d.use.shipments.find((s) => s.trackingNumber);
                return (
                  <tr key={`${d.depth}-${m.id}`}>
                    <td className="whitespace-nowrap" style={{ paddingLeft: `${12 + d.depth * 16}px` }}>{formatDate(m.occurredAt)}</td>
                    <td>
                      <Badge tone={d.use.kind === "sale" ? "info" : d.use.kind === "build" ? "accent" : d.use.kind === "write_off" ? "critical" : "default"}>{MOVEMENT_LABELS[m.type]}</Badge>
                      {m.reason && <span className="ml-1.5 text-[12px] text-text-tertiary">{m.reason}</span>}
                    </td>
                    <td className="text-right tabular">{formatQty(d.use.qty, d.fromItem?.unit)}</td>
                    <td className="font-mono text-[12px]">
                      {d.depth > 0 ? (
                        <button type="button" className="text-accent hover:underline" onClick={() => onPick(d.fromLot)}>
                          {lotLabel(d.fromLot)}
                        </button>
                      ) : (
                        lotLabel(d.fromLot)
                      )}
                      {d.fromItem && d.depth > 0 && <span className="ml-1 text-text-tertiary">{d.fromItem.sku}</span>}
                    </td>
                    <td>{doc ? doc.href ? <Link href={doc.href} className="font-mono text-[12px] text-accent hover:underline">{doc.label}</Link> : <span className="font-mono text-[12px]">{doc.label}</span> : <span className="text-text-tertiary">—</span>}</td>
                    <td className="text-text-secondary">
                      {d.use.order ? (
                        <span>
                          {d.use.order.customer}
                          {tracking ? ` · ${tracking.carrier ?? "tracking"} ${tracking.trackingNumber}` : ""}
                        </span>
                      ) : d.use.producedLot ? (
                        <span>
                          Produced{" "}
                          <button type="button" className="font-mono text-[12px] text-accent hover:underline" onClick={() => onPick(d.use.producedLot!)}>
                            {lotLabel(d.use.producedLot)}
                          </button>
                          {d.use.producedItem ? ` · ${d.use.producedItem.sku}` : ""}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </SimpleTable>
        )}
      </section>
    </div>
  );
}
