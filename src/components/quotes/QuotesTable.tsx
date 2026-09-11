"use client";

import { useMemo, useState } from "react";
import { FileText } from "lucide-react";
import type { Quote, QuoteStatus } from "@/lib/types";
import { QUOTE_STATUS_LABEL, isQuoteExpired, quoteTotals } from "@/lib/quotes";
import { formatDate, formatDateTime, formatMoney, formatRelative, pluralize } from "@/lib/format";
import { matches } from "@/lib/utils";
import { Badge, Button, EmptyState, SearchField, Segmented, Table, type BadgeTone, type Column } from "@/components/ui";

type Filter = "open" | "accepted" | "declined" | "all";

const STATUS_TONE: Record<QuoteStatus, BadgeTone> = { draft: "default", sent: "info", accepted: "success", declined: "critical", expired: "warning" };

export function QuoteStatusBadge({ quote }: { quote: Quote }) {
  const expired = isQuoteExpired(quote);
  const status: QuoteStatus = expired ? "expired" : quote.status;
  return <Badge tone={STATUS_TONE[status]}>{QUOTE_STATUS_LABEL[status]}</Badge>;
}

export function QuotesTable({ quotes, currency, onSelect, onNew }: { quotes: Quote[]; currency: string; onSelect: (q: Quote) => void; onNew?: () => void }) {
  const [filter, setFilter] = useState<Filter>("open");
  const [q, setQ] = useState("");

  const counts = useMemo(() => {
    const c = { open: 0, accepted: 0, declined: 0, all: quotes.length };
    for (const x of quotes) {
      if (x.status === "accepted") c.accepted++;
      else if (x.status === "declined") c.declined++;
      else c.open++;
    }
    return c;
  }, [quotes]);

  const rows = useMemo(() => {
    let list = quotes;
    if (filter === "open") list = list.filter((x) => x.status === "draft" || x.status === "sent" || x.status === "expired");
    else if (filter !== "all") list = list.filter((x) => x.status === filter);
    if (q.trim()) list = list.filter((x) => matches(q, x.number, x.customer, x.customerEmail, x.notes) || x.lines.some((l) => matches(q, l.description)));
    return [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [quotes, filter, q]);

  const columns = useMemo<Column<Quote>[]>(
    () => [
      { key: "number", header: "Quote", render: (x) => <span className="font-mono text-[12px] font-medium text-text">{x.number}</span>, sortValue: (x) => x.number, width: "100px" },
      { key: "customer", header: "Customer", render: (x) => <span className="block max-w-[240px] truncate">{x.customer}</span>, sortValue: (x) => x.customer },
      { key: "lines", header: "Lines", align: "right", render: (x) => x.lines.length, sortValue: (x) => x.lines.length, hideBelow: "sm" },
      { key: "total", header: "Total", align: "right", render: (x) => <span className="tabular font-medium">{formatMoney(quoteTotals(x).total, x.currency || currency)}</span>, sortValue: (x) => quoteTotals(x).total },
      { key: "margin", header: "Margin", align: "right", render: (x) => { const t = quoteTotals(x); return t.marginPct === null ? <span className="text-text-tertiary">—</span> : <span className={t.marginPct < 15 ? "text-warning" : "text-text-secondary"}>{t.marginPct}%</span>; }, sortValue: (x) => quoteTotals(x).marginPct ?? -1, hideBelow: "md" },
      { key: "valid", header: "Valid until", render: (x) => <span className={isQuoteExpired(x) ? "text-warning" : "text-text-secondary"}>{x.validUntil ? formatDate(x.validUntil) : "—"}</span>, sortValue: (x) => x.validUntil ?? null, hideBelow: "lg" },
      { key: "updated", header: "Updated", render: (x) => <span className="text-text-secondary" title={formatDateTime(x.updatedAt)}>{formatRelative(x.updatedAt)}</span>, sortValue: (x) => x.updatedAt, hideBelow: "md" },
      { key: "status", header: "Status", render: (x) => <QuoteStatusBadge quote={x} />, sortValue: (x) => x.status },
    ],
    [currency],
  );

  return (
    <Table
      rows={rows}
      columns={columns}
      rowKey={(x) => x.id}
      onRowClick={onSelect}
      defaultSort={{ key: "updated", dir: "desc" }}
      pageSize={25}
      toolbar={
        <div className="flex w-full flex-wrap items-center gap-2">
          <Segmented<Filter> value={filter} onChange={setFilter} options={[{ value: "open", label: "Open", count: counts.open }, { value: "accepted", label: "Accepted", count: counts.accepted }, { value: "declined", label: "Declined", count: counts.declined }, { value: "all", label: "All", count: counts.all }]} />
          <SearchField value={q} onChange={setQ} placeholder="Search number, customer, line" className="w-full sm:ml-auto sm:w-72" />
        </div>
      }
      footer={`${pluralize(rows.length, "quote")}${rows.length ? ` · ${formatMoney(rows.reduce((a, x) => a + quoteTotals(x).total, 0), currency)}` : ""}`}
      emptyState={<EmptyState icon={<FileText />} title={quotes.length ? "No quotes match" : "No quotes yet"} description={quotes.length ? "Try another filter." : "Describe what a customer wants and Nimbus prices it from your items and labour rate, or build one line by line."} action={onNew && !quotes.length ? <Button variant="primary" onClick={onNew}>New quote</Button> : undefined} />}
    />
  );
}
