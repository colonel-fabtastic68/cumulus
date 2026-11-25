"use client";

import { useSettings } from "@/lib/store/provider";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Copy, Hammer, Layers, ListPlus, Plus } from "lucide-react";
import type { Item } from "@/lib/types";
import { buildableQty, isLowStock } from "@/lib/inventory";
import { formatNumber, formatQty } from "@/lib/format";
import { cn, matches } from "@/lib/utils";
import { Badge, Button, EmptyState, SearchField, Segmented, Table, type Column } from "@/components/ui";
import { ExportBomMenu } from "./ExportBomMenu";

interface AssembliesTableProps {
  /** Every item in the workspace; needed to explode BOMs. */
  items: Item[];
  /** Active assemblies with a BOM, and (feature `assembliesWithoutBom`) ones with no parts yet. */
  assemblies: Item[];
  canWrite: boolean;
  onBuild: (assembly: Item) => void;
  onCopyBom?: (assembly: Item) => void;
  /** Feature `newAssembly`: the empty page offers to create the first assembly here. */
  onNew?: () => void;
}

export function AssembliesTable({ items, assemblies, canWrite, onBuild, onCopyBom, onNew }: AssembliesTableProps) {
  const rule = useSettings().stockAlerts;
  const [q, setQ] = useState("");
  const [show, setShow] = useState<"all" | "ready" | "empty">("all");

  const buildable = useMemo(() => new Map(assemblies.filter((a) => a.bom.length > 0).map((a) => [a.id, buildableQty(items, a)])), [items, assemblies]);
  const emptyCount = useMemo(() => assemblies.filter((a) => a.bom.length === 0).length, [assemblies]);

  const rows = useMemo(() => {
    const shown = show === "all" ? assemblies : assemblies.filter((a) => (show === "empty" ? a.bom.length === 0 : a.bom.length > 0));
    return q.trim() ? shown.filter((a) => matches(q, a.sku, a.name, a.category, a.location)) : shown;
  }, [assemblies, q, show]);

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
        render: (a) => (a.bom.length === 0 ? <Badge tone="attention">No parts yet</Badge> : <span className="text-text-secondary">{formatNumber(a.bom.length)}</span>),
        sortValue: (a) => a.bom.length,
        align: "right",
        width: "120px",
      },
      {
        key: "onHand",
        header: "On hand",
        render: (a) => <span className={cn(isLowStock(a, rule) && "font-medium text-warning")}>{formatQty(a.onHand, a.unit)}</span>,
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
          if (a.bom.length === 0) return <span className="text-text-tertiary">—</span>;
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
        render: (a) => (isLowStock(a, rule) ? <Badge tone="warning">Low stock</Badge> : <Badge tone="success">OK</Badge>),
        sortValue: (a) => (isLowStock(a, rule) ? 0 : 1),
        width: "100px",
      },
      {
        key: "actions",
        header: "",
        align: "right",
        width: "290px",
        render: (a) =>
          a.bom.length === 0 ? (
            <div className="flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
              {canWrite && (
                <Button size="sm" variant="primary" icon={<ListPlus />} href={`/inventory/${a.id}?tab=bom`} title="Open this assembly's BOM tab to add the parts it is built from">
                  Add parts
                </Button>
              )}
            </div>
          ) : (
          <div className="flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
            <ExportBomMenu assembly={a} items={items} label="Export" />
            {canWrite && onCopyBom && (
              <Button size="sm" icon={<Copy />} onClick={() => onCopyBom(a)} title="Copy this BOM onto another item, or duplicate the assembly">
                Copy
              </Button>
            )}
            {canWrite && (
              <Button
                size="sm"
                icon={<Hammer />}
                onClick={() => onBuild(a)}
                title={(buildable.get(a.id) ?? 0) === 0 ? "Short on components from stock. The build dialog can explode sub-assemblies into base parts." : undefined}
              >
                Build
              </Button>
            )}
          </div>
        ),
      },
    ],
    [buildable, canWrite, onBuild, onCopyBom, items, rule],
  );

  const lowCount = assemblies.filter((a) => isLowStock(a, rule)).length;

  const empty = q.trim() ? (
    <EmptyState icon={<Layers />} title="No assemblies match" description={`Nothing matches “${q.trim()}”. Try a SKU, name or category.`} action={<Button size="sm" onClick={() => setQ("")}>Clear search</Button>} />
  ) : onNew ? (
    <EmptyState
      icon={<Layers />}
      title="No assemblies yet"
      description="An assembly is an item with a bill of materials: the parts it is built from. Create one, list its parts, and it shows up here ready to build."
      action={
        <Button size="sm" variant="primary" icon={<Plus />} onClick={onNew}>
          New assembly
        </Button>
      }
    />
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
          {emptyCount > 0 && (
            <Segmented
              value={show}
              onChange={setShow}
              options={[
                { value: "all", label: "All", count: assemblies.length },
                { value: "ready", label: "Ready to build", count: assemblies.length - emptyCount },
                { value: "empty", label: "No parts yet", count: emptyCount },
              ]}
            />
          )}
          <SearchField value={q} onChange={setQ} placeholder="Search SKU, name or category" className="w-full sm:ml-auto sm:w-72" />
        </div>
      }
      footer={`${rows.length} of ${assemblies.length} ${assemblies.length === 1 ? "assembly" : "assemblies"}`}
    />
  );
}
