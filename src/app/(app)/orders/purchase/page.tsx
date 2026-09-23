"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { BookmarkPlus, ChevronDown, FileUp, Lightbulb, Plus, Sparkles, Trash2 } from "lucide-react";
import type { PurchaseOrder, PurchaseOrderTemplate } from "@/lib/types";
import { cancelPurchaseOrder, deletePurchaseOrderTemplate, markPurchaseOrderSent, savePurchaseOrderTemplate, suggestPurchaseOrders, templateFromPurchaseOrder, type PoSuggestion } from "@/lib/purchaseOrders";
import { formatDate, formatMoney, pluralize } from "@/lib/format";
import { useCollection, useItems, useItemsById, useSettings, useStore } from "@/lib/store/provider";
import { canWrite, useCurrentUser } from "@/lib/auth";
import { useAgent } from "@/components/agent/AgentProvider";
import { Button, ConfirmDialog, EmptyState, Menu, Modal, Page, QueryParamEffect, TextField, useToast } from "@/components/ui";
import { NewPurchaseOrderModal, PurchaseOrderDetailModal, PurchaseOrderStats, PurchaseOrdersTable, ReceivePurchaseOrderModal, UploadPoTemplateModal } from "@/components/purchasing";

export default function PurchaseOrdersPage() {
  const purchaseOrders = useCollection("purchaseOrders");
  const templates = useCollection("purchaseOrderTemplates");
  const suppliers = useCollection("suppliers");
  const items = useItems();
  const itemsById = useItemsById();
  const settings = useSettings();
  const store = useStore();
  const user = useCurrentUser();
  const toast = useToast();
  const writable = canWrite(user);
  const { open: openAgent, setPageContext } = useAgent();

  const [creating, setCreating] = useState(false);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<PoSuggestion | null>(null);
  const [editing, setEditing] = useState<PurchaseOrder | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [manageTemplates, setManageTemplates] = useState(false);
  const [deletingTemplate, setDeletingTemplate] = useState<PurchaseOrderTemplate | null>(null);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [receiveTarget, setReceiveTarget] = useState<PurchaseOrder | null>(null);
  const [cancelTarget, setCancelTarget] = useState<PurchaseOrder | null>(null);
  const [templateFrom, setTemplateFrom] = useState<PurchaseOrder | null>(null);
  const [templateName, setTemplateName] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const sortedTemplates = useMemo(() => [...templates].sort((a, b) => a.name.localeCompare(b.name)), [templates]);
  const template = useMemo(() => (templateId ? (templates.find((t) => t.id === templateId) ?? null) : null), [templates, templateId]);
  const selected = useMemo(() => (selectedId ? (purchaseOrders.find((p) => p.id === selectedId) ?? null) : null), [purchaseOrders, selectedId]);
  const suggestions = useMemo(() => suggestPurchaseOrders(items, suppliers, settings.stockAlerts), [items, suppliers, settings.stockAlerts]);
  const selectedSkus = useMemo(() => selected?.lines.map((l) => itemsById.get(l.itemId)?.sku).filter((s): s is string => !!s), [selected, itemsById]);

  useEffect(() => {
    setPageContext({ page: "Purchase orders", selectedSkus });
  }, [setPageContext, selectedSkus]);

  const startFromTemplate = (id: string) => {
    setManageTemplates(false);
    setSuggestion(null);
    setEditing(null);
    setTemplateId(id);
    setCreating(true);
  };
  const startFromSuggestion = (s: PoSuggestion) => {
    setSuggestOpen(false);
    setTemplateId(null);
    setEditing(null);
    setSuggestion(s);
    setCreating(true);
  };
  const startNew = () => {
    setTemplateId(null);
    setSuggestion(null);
    setEditing(null);
    setCreating(true);
  };
  const edit = (po: PurchaseOrder) => {
    setSelectedId(null);
    setTemplateId(null);
    setSuggestion(null);
    setEditing(po);
    setCreating(true);
  };

  const send = useCallback(
    async (po: PurchaseOrder) => {
      if (!writable) return;
      setBusyId(po.id);
      try {
        await markPurchaseOrderSent(store, user, po.id);
        toast(`${po.number} marked as sent`, "success");
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e), "critical");
      } finally {
        setBusyId(null);
      }
    },
    [store, user, toast, writable],
  );

  const confirmCancel = async () => {
    const po = cancelTarget;
    if (!po) return;
    setBusyId(po.id);
    try {
      await cancelPurchaseOrder(store, user, po.id);
      toast(`Cancelled ${po.number}`, "success");
      setCancelTarget(null);
      setSelectedId(null);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "critical");
    } finally {
      setBusyId(null);
    }
  };

  const saveTemplateFromOrder = async () => {
    if (!templateFrom || !templateName.trim()) return;
    try {
      const t = await savePurchaseOrderTemplate(store, user, { name: templateName, ...templateFromPurchaseOrder(templateFrom) });
      toast(`Saved template “${t.name}”`, "success");
      setTemplateFrom(null);
      setTemplateName("");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "critical");
    }
  };

  const onNewParam = useCallback(() => {
    if (writable) startNew();
  }, [writable]);

  return (
    <Page
      title="Purchase orders"
      subtitle="What is on order from suppliers, and what has arrived"
      primaryAction={
        writable ? (
          <Button variant="primary" icon={<Plus />} onClick={startNew}>
            New purchase order
          </Button>
        ) : undefined
      }
      secondaryActions={
        <>
          {writable && (
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
                            {t.supplier ? `${t.supplier} · ` : ""}
                            {pluralize(t.lines.length, "line")}
                            {t.description ? ` · ${t.description}` : ""}
                          </span>
                        </span>
                      ),
                      onSelect: () => startFromTemplate(t.id),
                    }))
                  : [{ label: <span className="text-text-tertiary">No templates yet. Upload a sheet, or save one from an order.</span>, disabled: true }]),
                "divider" as const,
                { label: "Upload a template…", icon: <FileUp />, onSelect: () => setUploadOpen(true) },
                { label: "Manage templates", onSelect: () => setManageTemplates(true) },
              ]}
            />
          )}
          {writable && (
            <Button icon={<Lightbulb />} onClick={() => setSuggestOpen(true)}>
              Suggest{suggestions.length ? ` (${suggestions.length})` : ""}
            </Button>
          )}
          <Button icon={<Sparkles />} onClick={() => openAgent("Draft purchase orders for everything below its minimum, one per supplier, and show me the totals before creating them.")}>
            Ask Strato
          </Button>
        </>
      }
    >
      <Suspense fallback={null}>
        <QueryParamEffect param="highlight" onValue={setSelectedId} />
        <QueryParamEffect param="new" onValue={onNewParam} />
      </Suspense>
      <div className="flex flex-col gap-4">
        <PurchaseOrderStats purchaseOrders={purchaseOrders} />
        <PurchaseOrdersTable purchaseOrders={purchaseOrders} canWrite={writable} busyId={busyId} onSelect={(p) => setSelectedId(p.id)} onSend={send} onReceive={setReceiveTarget} onCancel={setCancelTarget} onNew={writable ? startNew : undefined} />
      </div>

      <NewPurchaseOrderModal
        open={creating}
        template={template}
        suggestion={suggestion}
        editing={editing}
        onClose={() => {
          setCreating(false);
          setTemplateId(null);
          setSuggestion(null);
          setEditing(null);
        }}
        onCreated={(po) => setSelectedId(po.id)}
      />
      <UploadPoTemplateModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onSaved={(t, useNow) => {
          if (useNow) startFromTemplate(t.id);
        }}
      />
      <PurchaseOrderDetailModal
        po={selected}
        onClose={() => setSelectedId(null)}
        canWrite={writable}
        busy={!!selected && busyId === selected.id}
        onSend={send}
        onReceive={(po) => setReceiveTarget(po)}
        onEdit={edit}
        onCancel={setCancelTarget}
        onSaveTemplate={(po) => {
          setTemplateFrom(po);
          setTemplateName(`${po.supplier} reorder`);
        }}
      />
      <ReceivePurchaseOrderModal po={receiveTarget} onClose={() => setReceiveTarget(null)} onReceived={(po) => setSelectedId(po.id)} />

      <Modal open={suggestOpen} onClose={() => setSuggestOpen(false)} size="md" title="Suggested purchase orders" subtitle="Items below their low-stock line, grouped by primary supplier, at reorder quantity and the supplier's last cost." footer={<Button onClick={() => setSuggestOpen(false)}>Close</Button>}>
        {suggestions.length === 0 ? (
          <EmptyState icon={<Lightbulb />} title="Nothing to reorder" description="No active item is below its low-stock line right now." />
        ) : (
          <ul className="divide-y divide-border">
            {suggestions.map((s) => (
              <li key={s.supplierId ?? "none"} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium text-text">{s.supplier}</div>
                  <div className="truncate text-[12px] text-text-secondary">
                    {pluralize(s.lines.length, "item")} · {formatMoney(s.total, settings.currency)}
                    {s.leadTimeDays ? ` · ${s.leadTimeDays} day lead time` : ""} · {s.lines.slice(0, 4).map((l) => `${l.item.sku} × ${l.qty}`).join(", ")}
                    {s.lines.length > 4 ? "…" : ""}
                  </div>
                </div>
                <Button size="sm" variant="primary" onClick={() => startFromSuggestion(s)}>
                  Draft PO
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Modal>

      <Modal open={manageTemplates} onClose={() => setManageTemplates(false)} size="md" title="Purchase order templates" subtitle="Saved suppliers and lines. Start an order from one and adjust it." footer={<Button onClick={() => setManageTemplates(false)}>Close</Button>}>
        {sortedTemplates.length === 0 ? (
          <EmptyState icon={<BookmarkPlus />} title="No templates yet" description="Upload a sheet of SKUs and quantities, or open an order and choose “Save as template”." action={<Button size="sm" icon={<FileUp />} onClick={() => { setManageTemplates(false); setUploadOpen(true); }}>Upload a template</Button>} />
        ) : (
          <ul className="divide-y divide-border">
            {sortedTemplates.map((t) => (
              <li key={t.id} className="flex items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium text-text">{t.name}</div>
                  <div className="truncate text-[12px] text-text-secondary">
                    {t.supplier ? `${t.supplier} · ` : ""}
                    {pluralize(t.lines.length, "line")} · saved {formatDate(t.updatedAt)}
                    {t.source === "upload" ? " · uploaded" : t.source === "strato" ? " · by Strato" : ""}
                    {t.description ? ` · ${t.description}` : ""}
                  </div>
                </div>
                <Button size="sm" onClick={() => startFromTemplate(t.id)}>
                  Use
                </Button>
                <Button size="sm" variant="plain" icon={<Trash2 />} className="text-critical" onClick={() => setDeletingTemplate(t)} aria-label={`Delete ${t.name}`} />
              </li>
            ))}
          </ul>
        )}
      </Modal>
      <ConfirmDialog
        open={!!deletingTemplate}
        onClose={() => setDeletingTemplate(null)}
        destructive
        title={`Delete template “${deletingTemplate?.name}”?`}
        confirmLabel="Delete"
        onConfirm={async () => {
          if (!deletingTemplate) return;
          await deletePurchaseOrderTemplate(store, deletingTemplate.id);
          toast("Template deleted", "success");
          setDeletingTemplate(null);
        }}
        message={<>Orders already created from it are not affected.</>}
      />
      <Modal
        open={!!templateFrom}
        onClose={() => setTemplateFrom(null)}
        size="sm"
        title="Save as template"
        subtitle={templateFrom ? `${templateFrom.number}: supplier, lines and costs are kept for next time.` : undefined}
        footer={
          <>
            <Button onClick={() => setTemplateFrom(null)}>Cancel</Button>
            <Button variant="primary" onClick={() => void saveTemplateFromOrder()} disabled={!templateName.trim()}>
              Save template
            </Button>
          </>
        }
      >
        <TextField label="Template name" value={templateName} onChange={(e) => setTemplateName(e.target.value)} autoFocus />
      </Modal>
      <ConfirmDialog
        open={!!cancelTarget}
        onClose={() => setCancelTarget(null)}
        onConfirm={confirmCancel}
        title={cancelTarget ? `Cancel ${cancelTarget.number}?` : "Cancel purchase order?"}
        message={cancelTarget ? <p>The order to <span className="font-medium text-text">{cancelTarget.supplier}</span> will be marked cancelled. Anything already received stays on the shelf. This can&apos;t be undone.</p> : null}
        confirmLabel="Cancel order"
        destructive
        loading={!!cancelTarget && busyId === cancelTarget.id}
      />
    </Page>
  );
}
