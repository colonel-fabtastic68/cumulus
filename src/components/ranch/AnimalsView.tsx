"use client";

import { useMemo, useState } from "react";
import { Tags } from "lucide-react";
import type { Item, Lot } from "@/lib/types";
import { useCollection, useSettings } from "@/lib/store/provider";
import { formatDate, formatMoney, formatQty } from "@/lib/format";
import { Badge, Drawer, EmptyState, Page, SearchField, SimpleTable, Table, type Column } from "@/components/ui";

/** One animal (a Square "Lot #" value) across every cut it was broken into. */
interface Animal {
  key: string;
  label: string;
  /** Animal number(s) or tag, e.g. "1975" or "1846, 1847, …". */
  number: string;
  tag?: string;
  genetics?: string;
  pounds: number;
  value: number;
  cutsInStock: number;
  oldest: string;
  lots: Array<{ lot: Lot; item: Item | undefined }>;
}

/** "1975 - 27F - PURE" → number 1975, tag 27F, genetics PURE. */
export function parseAnimalLabel(label: string): { number: string; tag?: string; genetics?: string } {
  const parts = label.split(" - ").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return { number: label };
  const last = parts[parts.length - 1]!;
  const genetics = /^(pure|f\d|fullblood|purebred|cross)/i.test(last) && parts.length > 1 ? last.toUpperCase() : undefined;
  const middle = parts.slice(1, genetics ? -1 : undefined).join(" - ");
  return { number: parts[0]!, tag: middle ? middle.replace(/^#/, "") : undefined, genetics };
}

export function AnimalsView() {
  const lots = useCollection("lots");
  const items = useCollection("items");
  const settings = useSettings();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Animal | null>(null);
  const currency = settings.currency || "USD";

  const animals = useMemo(() => {
    const byId = new Map(items.map((i) => [i.id, i]));
    const groups = new Map<string, Animal>();
    for (const lot of lots) {
      const label = lot.supplierLot?.trim();
      if (!label) continue;
      const item = byId.get(lot.itemId);
      if (lot.externalIds?.square === undefined && item?.externalIds?.square === undefined) continue;
      const key = label.toLowerCase();
      const a = groups.get(key) ?? { key, label, ...parseAnimalLabel(label), pounds: 0, value: 0, cutsInStock: 0, oldest: lot.receivedAt, lots: [] };
      a.lots.push({ lot, item });
      if (lot.qtyRemaining > 0) {
        a.pounds += lot.qtyRemaining;
        a.value += lot.qtyRemaining * (item?.price ?? 0);
        a.cutsInStock++;
      }
      if (lot.receivedAt < a.oldest) a.oldest = lot.receivedAt;
      groups.set(key, a);
    }
    return Array.from(groups.values()).map((a) => ({ ...a, pounds: Math.round(a.pounds * 1000) / 1000 }));
  }, [lots, items]);

  const q = query.trim().toLowerCase();
  const rows = q ? animals.filter((a) => a.label.toLowerCase().includes(q) || a.lots.some((l) => l.item?.name.toLowerCase().includes(q))) : animals;
  const totalLb = animals.reduce((s, a) => s + a.pounds, 0);

  const columns: Column<Animal>[] = [
    {
      key: "animal",
      header: "Animal",
      render: (a) => (
        <div className="min-w-0">
          <div className="truncate font-medium">{a.number}</div>
          {a.tag && <div className="truncate text-[12px] text-text-tertiary">Tag {a.tag}</div>}
        </div>
      ),
      sortValue: (a) => a.number,
      minWidth: 160,
      flex: true,
    },
    { key: "genetics", header: "Genetics", render: (a) => (a.genetics ? <Badge tone={a.genetics === "PURE" ? "success" : "info"}>{a.genetics === "PURE" ? "Fullblood" : a.genetics}</Badge> : <span className="text-text-tertiary">–</span>), sortValue: (a) => a.genetics ?? "", minWidth: 110 },
    { key: "pounds", header: "On hand", align: "right", render: (a) => <span className="tabular-nums">{formatQty(a.pounds, "lb")}</span>, sortValue: (a) => a.pounds, minWidth: 100 },
    { key: "cuts", header: "Cuts in stock", align: "right", render: (a) => <span className="tabular-nums">{a.cutsInStock}</span>, sortValue: (a) => a.cutsInStock, minWidth: 100, priority: 2 },
    { key: "value", header: "Counter value", align: "right", render: (a) => <span className="tabular-nums">{formatMoney(a.value, currency)}</span>, sortValue: (a) => a.value, minWidth: 120, priority: 1 },
    { key: "oldest", header: "In since", render: (a) => formatDate(a.oldest), sortValue: (a) => a.oldest, minWidth: 110, priority: 1 },
  ];

  return (
    <Page title="Animals" subtitle={`Every animal's cuts, sold oldest first. ${formatQty(totalLb, "lb")} across ${animals.length} animal${animals.length === 1 ? "" : "s"}.`}>
      <Table
        rows={rows}
        columns={columns}
        rowKey={(a) => a.key}
        onRowClick={setOpen}
        fit
        layoutKey="ranch-animals"
        defaultSort={{ key: "oldest", dir: "asc" }}
        toolbar={<SearchField value={query} onChange={setQuery} placeholder="Search animals or cuts" />}
        emptyState={<EmptyState icon={<Tags />} title="No animals yet" description="Connect Square under Integrations and press Sync now on Square & store. Each Lot # in Square becomes an animal here, with its cuts and pounds." />}
      />
      <Drawer open={!!open} onClose={() => setOpen(null)} title={open ? `Animal ${open.number}` : ""} subtitle={open ? [open.tag ? `Tag ${open.tag}` : "", open.genetics ?? "", formatQty(open.pounds, "lb")].filter(Boolean).join(" · ") : undefined} width={560}>
        {open && (
          <SimpleTable>
            <thead>
              <tr>
                <th>Cut</th>
                <th>Lot</th>
                <th className="text-right">On hand</th>
              </tr>
            </thead>
            <tbody>
              {[...open.lots]
                .sort((a, b) => b.lot.qtyRemaining - a.lot.qtyRemaining)
                .map(({ lot, item }) => (
                  <tr key={lot.id}>
                    <td>{item?.name ?? "Removed item"}</td>
                    <td className="text-text-secondary">{lot.number ?? lot.id.slice(-6)}</td>
                    <td className={`text-right tabular-nums ${lot.qtyRemaining <= 0 ? "text-text-tertiary" : ""}`}>{formatQty(lot.qtyRemaining, item?.unit ?? "lb")}</td>
                  </tr>
                ))}
            </tbody>
          </SimpleTable>
        )}
      </Drawer>
    </Page>
  );
}
