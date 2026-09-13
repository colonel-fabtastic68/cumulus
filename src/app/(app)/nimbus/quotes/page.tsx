"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { BookmarkPlus, ChevronDown, FileText, Plus, Trash2 } from "lucide-react";
import type { Quote, QuoteTemplate } from "@/lib/types";
import { deleteQuoteTemplate, isQuoteExpired, quoteTotals } from "@/lib/quotes";
import { useCollection, useSettings, useStore } from "@/lib/store/provider";
import { canWrite, useCurrentUser } from "@/lib/auth";
import { useAgent } from "@/components/agent/AgentProvider";
import { Button, ConfirmDialog, EmptyState, Menu, Modal, Page, QueryParamEffect, Stat, useToast } from "@/components/ui";
import { QuoteEditor, QuotesTable } from "@/components/quotes";
import { formatDate, formatMoney, formatNumber, pluralize } from "@/lib/format";

export default function QuotesPage() {
  const quotes = useCollection("quotes");
  const settings = useSettings();
  const user = useCurrentUser();
  const writable = canWrite(user);
  const { setPageContext } = useAgent();
  const templates = useCollection("quoteTemplates");
  const store = useStore();
  const toast = useToast();
  const [editor, setEditor] = useState<{ open: boolean; id: string | null; templateId?: string | null }>({ open: false, id: null });
  const [manage, setManage] = useState(false);
  const [deleting, setDeleting] = useState<QuoteTemplate | null>(null);

  useEffect(() => {
    setPageContext({ page: "Quotes" });
  }, [setPageContext]);

  const selected = useMemo(() => (editor.id ? (quotes.find((q) => q.id === editor.id) ?? null) : null), [quotes, editor.id]);
  const template = useMemo(() => (editor.templateId ? (templates.find((t) => t.id === editor.templateId) ?? null) : null), [templates, editor.templateId]);
  const sortedTemplates = useMemo(() => [...templates].sort((a, b) => a.name.localeCompare(b.name)), [templates]);
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
      secondaryActions={
        writable ? (
          <Menu
            align="right"
            trigger={
              <Button icon={<BookmarkPlus />} iconRight={<ChevronDown />}>
                From template
              </Button>
            }
            items={[
              ...(sortedTemplates.length
                ? sortedTemplates.map((t) => ({
                    label: (
                      <span className="block min-w-0">
                        <span className="block truncate">{t.name}</span>
                        <span className="block text-[11px] text-text-tertiary">
                          {pluralize(t.lines.length, "line")}
                          {t.description ? ` · ${t.description}` : ""}
                        </span>
                      </span>
                    ),
                    onSelect: () => setEditor({ open: true, id: null, templateId: t.id }),
                  }))
                : [{ label: <span className="text-text-tertiary">No templates yet. Open a quote and choose “Save as template”.</span>, disabled: true }]),
              "divider" as const,
              { label: "Manage templates", onSelect: () => setManage(true) },
            ]}
          />
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
      <QuoteEditor open={editor.open} quote={selected} template={template} onClose={() => setEditor({ open: false, id: null })} onSaved={(q) => setEditor({ open: true, id: q.id })} />
      <Modal open={manage} onClose={() => setManage(false)} size="md" title="Quote templates" subtitle="Saved sets of lines. Start a quote from one and change the quantities." footer={<Button onClick={() => setManage(false)}>Close</Button>}>
        {sortedTemplates.length === 0 ? (
          <EmptyState icon={<BookmarkPlus />} title="No templates yet" description="Open any quote and use the bookmark button in its header to save its lines as a template." />
        ) : (
          <ul className="divide-y divide-border">
            {sortedTemplates.map((t) => (
              <li key={t.id} className="flex items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium text-text">{t.name}</div>
                  <div className="truncate text-[12px] text-text-secondary">
                    {pluralize(t.lines.length, "line")} · {formatMoney(quoteTotals({ lines: t.lines, discountPct: t.discountPct, taxPct: t.taxPct }).total, settings.currency)} at saved prices · saved {formatDate(t.updatedAt)}
                    {t.description ? ` · ${t.description}` : ""}
                  </div>
                </div>
                <Button size="sm" onClick={() => { setManage(false); setEditor({ open: true, id: null, templateId: t.id }); }}>
                  Use
                </Button>
                <Button size="sm" variant="plain" icon={<Trash2 />} className="text-critical" onClick={() => setDeleting(t)} aria-label={`Delete ${t.name}`} />
              </li>
            ))}
          </ul>
        )}
      </Modal>
      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} destructive title={`Delete template “${deleting?.name}”?`} confirmLabel="Delete" onConfirm={async () => { if (!deleting) return; await deleteQuoteTemplate(store, deleting.id); toast("Template deleted", "success"); setDeleting(null); }} message={<>Quotes already created from it are not affected.</>} />
    </Page>
  );
}
