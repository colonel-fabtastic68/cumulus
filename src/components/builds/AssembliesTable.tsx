"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Hammer, Layers } from "lucide-react";
import type { Item } from "@/lib/types";
import { buildableQty, isLowStock } from "@/lib/inventory";
import { formatNumber, formatQty } from "@/lib/format";
import { cn, matches } from "@/lib/utils";
import { Badge, Button, EmptyState, SearchField, Table, type Column } from "@/components/ui";

interface AssembliesTableProps {
  /** Every item in the workspace; needed to explode BOMs. */
  items: Item[];
  /** Active assemblies with a BOM. */
  assemblies: Item[];
  canWrite: boolean;
  onBuild: (assembly: Item) => void;
}

export function AssembliesTable({ items, assemblies, canWrite, onBuild }: AssembliesTableProps) {
  const [q, setQ] = useState("");

  const buildable = useMemo(() => new Map(assemblies.map((a) => [a.id, buildableQty(items, a)])), [items, assemblies]);

  const rows = useMemo(() => (q.trim() ? assemblies.filter((a) => matches(q, a.sku, a.name, a.category, a.location)) : assemblies), [assemblies, q]);

  const columns = useMemo<Column<Item>[]>(
    () => [
      {
        key: "item",
        header: "Assembly",
        render: (a) => (
          <span className="block min-w-0">
            <Link href={"/inventory/" + a.id} className="font-mono text-[12px] font-medium text-accent hover:underline" onClick={(e) => e.stopPropagation()}>
              {a.sku}
            </Link>
            <span className="block max-w-[280px] truncate text-text" title={a.name}>
              {a.name}
            </span>
          </span>
        ),
        sortValue: (a) => a.sku,
      },
      {
        key: "category",
        header: "Category",
        render: (a) => <span className="text-text-secondary">{a.category ?? "—"}</span>,
        sortValue: (a) => a.category ?? "",
        hideBelow: "md",
      },
      {
        key: "bom",
        header: "BOM",
        render: (a) => <span className="text-text-secondary">{formatNumber(a.bom.length)}</span>,
        sortValue: (a) => a.bom.length,
        align: "right",
        width: "70px",
        hideBelow: "lg",
      },
      {
        key: "onHand",
        header: "On hand",
        render: (a) => <span className={cn(isLowStock(a) && "font-medium text-warning")}>{formatQty(a.onHand, a.unit)}</span>,
        sortValue: (a) => a.onHand,
        align: "right",
        width: "90px",
      },
      {
        key: "minmax",
        header: "Min / max",
        render: (a) => (
          <span className="text-text-secondary">
            {a.minQty !== undefined ? formatNumber(a.minQty) : "—"} / {a.maxQty !== undefined ? formatNumber(a.maxQty) : "—"}
          </span>
        ),
        sortValue: (a) => a.minQty ?? null,
        align: "right",
        width: "100px",
        hideBelow: "sm",
      },
      {
        key: "buildable",
        header: "Buildable now",
        render: (a) => {
          const n = buildable.get(a.id) ?? 0;
          return <span className={cn("font-medium", n === 0 ? "text-critical" : "text-text")}>{formatNumber(n)}</span>;
        },
        sortValue: (a) => buildable.get(a.id) ?? 0,
        align: "right",
        width: "120px",
      },
      {
        key: "stock",
        header: "Stock",
        render: (a) => (isLowStock(a) ? <Badge tone="warning">Low stock</Badge> : <Badge tone="success">OK</Badge>),
        sortValue: (a) => (isLowStock(a) ? 0 : 1),
        width: "100px",
      },
      {
        key: "actions",
        header: "",
        align: "right",
        width: "90px",
        render: (a) =>
          canWrite ? (
            <Button
              size="sm"
              icon={<Hammer />}
              onClick={() => onBuild(a)}
              title={(buildable.get(a.id) ?? 0) === 0 ? "Short on components from stock. The build dialog can explode sub-assemblies into base parts." : undefined}
            >
              Build
            </Button>
          ) : null,
      },
    ],
    [buildable, canWrite, onBuild],
  );

  const lowCount = assemblies.filter(isLowStock).length;

  const empty = q.trim() ? (
    <EmptyState icon={<Layers />} title="No assemblies match" description={`Nothing matches “${q.trim()}”. Try a SKU, name or category.`} action={<Button size="sm" onClick={() => setQ("")}>Clear search</Button>} />
  ) : (
    <EmptyState
      icon={<Layers />}
      title="No assemblies yet"
      description="An assembly is an item with a bill of materials. Add one in Inventory and it will show up here ready to build."
      action={
        <Button size="sm" href="/inventory">
          Go to inventory
        </Button>
      }
    />
  );

  return (
    <Table
      rows={rows}
      columns={columns}
      rowKey={(a) => a.id}
      defaultSort={{ key: "item", dir: "asc" }}
      pageSize={25}
      emptyState={empty}
      toolbar={
        <div className="flex w-full flex-wrap items-center gap-2">
          <div className="flex items-center gap-2">
            <h3 className="text-[13.5px] font-semibold text-text">Assemblies</h3>
            {lowCount > 0 && <Badge tone="warning">{lowCount} below minimum</Badge>}
          </div>
          <SearchField value={q} onChange={setQ} placeholder="Search SKU, name or category" className="w-full sm:ml-auto sm:w-72" />
        </div>
      }
      footer={`${rows.length} of ${assemblies.length} ${assemblies.length === 1 ? "assembly" : "assemblies"}`}
    />
  );
}
