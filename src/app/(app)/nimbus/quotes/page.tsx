"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { FileText, Plus } from "lucide-react";
import type { Quote } from "@/lib/types";
import { isQuoteExpired, quoteTotals } from "@/lib/quotes";
import { useCollection, useSettings } from "@/lib/store/provider";
import { canWrite, useCurrentUser } from "@/lib/auth";
import { useAgent } from "@/components/agent/AgentProvider";
import { Button, Page, QueryParamEffect, Stat } from "@/components/ui";
import { QuoteEditor, QuotesTable } from "@/components/quotes";
import { formatMoney, formatNumber } from "@/lib/format";

export default function QuotesPage() {
  const quotes = useCollection("quotes");
  const settings = useSettings();
  const user = useCurrentUser();
  const writable = canWrite(user);
  const { setPageContext } = useAgent();
  const [editor, setEditor] = useState<{ open: boolean; id: string | null }>({ open: false, id: null });

  useEffect(() => {
    setPageContext({ page: "Quotes" });
  }, [setPageContext]);

  const selected = useMemo(() => (editor.id ? (quotes.find((q) => q.id === editor.id) ?? null) : null), [quotes, editor.id]);
  // "?new=1" opens a blank quote; "?highlight=<id>" opens an existing one.
  const onNewParam = useCallback(() => setEditor({ open: true, id: null }), []);
  const onHighlightParam = useCallback((id: string) => setEditor({ open: true, id }), []);
  const open = useMemo(() => quotes.filter((q) => (q.status === "draft" || q.status === "sent") && !isQuoteExpired(q)), [quotes]);
  const openValue = open.reduce((a, q) => a + quoteTotals(q).total, 0);
  const monthStart = new Date();
  monthStart.setDate(1);
  const acceptedThisMonth = quotes.filter((q) => q.status === "accepted" && q.decidedAt && new Date(q.decidedAt) >= monthStart);
  const decided = quotes.filter((q) => q.status === "accepted" || q.status === "declined");
  const winRate = decided.length ? Math.round((quotes.filter((q) => q.status === "accepted").length / decided.length) * 100) : null;

  return (
    <Page
      title="Quotes"
      subtitle="Priced offers built from your items, labour rate and margins. Nimbus drafts them from a sentence."
      primaryAction={
        writable ? (
          <Button variant="primary" icon={<Plus />} onClick={() => setEditor({ open: true, id: null })}>
            New quote
          </Button>
        ) : undefined
      }
    >
      <Suspense fallback={null}>
        <QueryParamEffect param="new" onValue={onNewParam} />
        <QueryParamEffect param="highlight" onValue={onHighlightParam} />
      </Suspense>
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3 @xl:grid-cols-4">
          <Stat label="Open quotes" value={formatNumber(open.length)} hint={formatMoney(openValue, settings.currency)} icon={<FileText />} />
          <Stat label="Accepted this month" value={formatNumber(acceptedThisMonth.length)} hint={formatMoney(acceptedThisMonth.reduce((a, q) => a + quoteTotals(q).total, 0), settings.currency)} />
          <Stat label="Win rate" value={winRate === null ? "—" : `${winRate}%`} hint={decided.length ? `${decided.length} decided` : "No decisions yet"} />
          <Stat label="Labour rate" value={formatMoney(settings.quoting?.laborRate ?? 0, settings.currency)} hint={settings.quoting?.laborRate ? "per hour · Settings → Quoting" : "Set it under Settings → Quoting"} href="/settings" />
        </div>
        <QuotesTable quotes={quotes} currency={settings.currency} onSelect={(q: Quote) => setEditor({ open: true, id: q.id })} onNew={writable ? () => setEditor({ open: true, id: null }) : undefined} />
      </div>
      <QuoteEditor open={editor.open} quote={selected} onClose={() => setEditor({ open: false, id: null })} onSaved={(q) => setEditor({ open: true, id: q.id })} />
    </Page>
  );
}
