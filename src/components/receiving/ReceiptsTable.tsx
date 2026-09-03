"use client";

import { useMemo, useState } from "react";
import { SearchX } from "lucide-react";
import type { Receipt } from "@/lib/types";
import { useSettings } from "@/lib/store/provider";
import { formatDate, formatMoney, formatNumber, pluralize } from "@/lib/format";
import { matches, sum } from "@/lib/utils";
import { Avatar, Badge, Button, EmptyState, SearchField, Select, StatusBadge, Table, type Column } from "@/components/ui";
import { isBackDated, receiptTotal, type ReceiptLookups } from "./receiptUtils";

const NO_SUPPLIER = "__none";

interface ReceiptsTableProps {
  receipts: Receipt[];
  lookups: ReceiptLookups;
  onOpen: (receipt: Receipt) => void;
}

export function ReceiptsTable({ receipts, lookups, onOpen }: ReceiptsTableProps) {
  const { currency } = useSettings();
  const [query, setQuery] = useState("");
  const [supplierId, setSupplierId] = useState("");

  const supplierOptions = useMemo(() => {
    const opts = Array.from(lookups.suppliersById.values())
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((s) => ({ value: s.id, label: s.name }));
    if (receipts.some((r) => !r.supplierId)) opts.push({ value: NO_SUPPLIER, label: "No supplier" });
    return opts;
  }, [lookups.suppliersById, receipts]);

  const filtered = useMemo(() => {
    const q = query.trim();
    return receipts.filter((r) => {
      if (supplierId === NO_SUPPLIER) {
        if (r.supplierId) return false;
      } else if (supplierId && r.supplierId !== supplierId) {
        return false;
      }
      if (!q) return true;
      const supplierName = r.supplierId ? lookups.suppliersById.get(r.supplierId)?.name : undefined;
      const skus = r.lines.map((l) => lookups.itemsById.get(l.itemId)?.sku);
      return matches(q, r.number, r.reference, supplierName, ...skus);
    });
  }, [receipts, query, supplierId, lookups]);

  const filteredTotal = useMemo(() => sum(filtered.map(receiptTotal)), [filtered]);

  const columns = useMemo<Column<Receipt>[]>(() => {
    const supplierName = (r: Receipt) => (r.supplierId ? lookups.suppliersById.get(r.supplierId)?.name : undefined);
    const memberName = (r: Receipt) => lookups.membersById.get(r.createdBy)?.name;
    return [
      {
        key: "number",
        header: "Number",
        width: "120px",
        render: (r) => <span className="font-mono text-[12.5px] font-medium text-text">{r.number}</span>,
        sortValue: (r) => r.number,
      },
      {
        key: "receivedAt",
        header: "Received",
        render: (r) => (
          <span className="inline-flex flex-wrap items-center gap-1.5">
            {formatDate(r.receivedAt)}
            {isBackDated(r) && <Badge tone="warning">Back-dated</Badge>}
          </span>
        ),
        sortValue: (r) => new Date(r.receivedAt).getTime(),
      },
      {
        key: "supplier",
        header: "Supplier",
        hideBelow: "sm",
        render: (r) => supplierName(r) ?? <span className="text-text-tertiary">—</span>,
        sortValue: supplierName,
      },
      {
        key: "reference",
        header: "Reference",
        hideBelow: "md",
        render: (r) => (r.reference ? <span className="text-text-secondary">{r.reference}</span> : <span className="text-text-tertiary">—</span>),
        sortValue: (r) => r.reference,
      },
      {
        key: "lines",
        header: "Lines",
        align: "right",
        render: (r) => formatNumber(r.lines.length),
        sortValue: (r) => r.lines.length,
      },
      {
        key: "total",
        header: "Total",
        align: "right",
        render: (r) => <span className="font-medium">{formatMoney(receiptTotal(r), currency)}</span>,
        sortValue: receiptTotal,
      },
      {
        key: "by",
        header: "Received by",
        hideBelow: "lg",
        render: (r) => {
          const m = lookups.membersById.get(r.createdBy);
          return m ? (
            <span className="inline-flex items-center gap-1.5">
              <Avatar member={m} size={20} />
              {m.name}
            </span>
          ) : (
            <span className="text-text-tertiary">—</span>
          );
        },
        sortValue: memberName,
      },
      {
        key: "status",
        header: "Status",
        render: (r) => <StatusBadge status={r.status} />,
        sortValue: (r) => r.status,
      },
    ];
  }, [lookups, currency]);

  const clearFilters = () => {
    setQuery("");
    setSupplierId("");
  };

  return (
    <Table
      rows={filtered}
      columns={columns}
      rowKey={(r) => r.id}
      onRowClick={onOpen}
      defaultSort={{ key: "receivedAt", dir: "desc" }}
      pageSize={25}
      toolbar={
        <>
          <SearchField value={query} onChange={setQuery} placeholder="Search number, reference, supplier or SKU" className="w-full sm:w-80" />
          <Select
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
            placeholder="All suppliers"
            options={supplierOptions}
            containerClassName="w-full sm:w-52"
            aria-label="Filter by supplier"
          />
        </>
      }
      footer={
        <span>
          {pluralize(filtered.length, "receipt")} · <span className="font-medium text-text tabular">{formatMoney(filteredTotal, currency)}</span>
        </span>
      }
      emptyState={
        <EmptyState
          className="py-4"
          icon={<SearchX />}
          title="No matching receipts"
          description="Try a different search or supplier."
          action={
            <Button size="sm" onClick={clearFilters}>
              Clear filters
            </Button>
          }
        />
      }
    />
  );
}
