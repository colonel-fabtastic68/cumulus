"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { BookmarkPlus, ChevronDown, FileText, FileUp, Lightbulb, Merge, Plus, Sparkles, Trash2 } from "lucide-react";
import type { PurchaseOrder, PurchaseOrderTemplate } from "@/lib/types";
import { cancelPurchaseOrder, deletePurchaseOrderTemplate, markPurchaseOrderSent, mergePurchaseOrders, poTotal, savePurchaseOrderTemplate, templateFromPurchaseOrder } from "@/lib/purchaseOrders";
import { replenishmentSummary } from "@/lib/replenishment";
import { formatDate, formatMoney, pluralize } from "@/lib/format";
import { useCollection, useItemsById, useSettings, useStore } from "@/lib/store/provider";
import { canWrite, useCurrentUser } from "@/lib/auth";
import { useAgent } from "@/components/agent/AgentProvider";
import { Button, ConfirmDialog, EmptyState, Menu, Modal, Page, QueryParamEffect, Select, TextField, useToast } from "@/components/ui";
import { NewPurchaseOrderModal, PurchaseOrderDetailModal, PurchaseOrderStats, PurchaseOrdersTable, ReceivePurchaseOrderModal, UploadPoTemplateModal } from "@/components/purchasing";
import { useReplenishmentPlan } from "@/components/replenishment/useReplenishmentPlan";
import { useDocuments } from "@/lib/documents";

export default function PurchaseOrdersPage() {
  const purchaseOrders = useCollection("purchaseOrders");
  const templates = useCollection("purchaseOrderTemplates");
  const docs = useDocuments();
  const documentTemplates = docs.templatesFor("purchase-orders");
  const itemsById = useItemsById();
  const settings = useSettings();
  const store = useStore();
  const user = useCurrentUser();
  const toast = useToast();
  const writable = canWrite(user);
  const { open: openAgent, setPageContext } = useAgent();
  const plan = useReplenishmentPlan();
  const toOrder = useMemo(() => replenishmentSummary(plan).toOrder, [plan]);

  const [creating, setCreating] = useState(false);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [editing, setEditing] = useState<PurchaseOrder | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [manageTemplates, setManageTemplates] = useState(false);
  const [deletingTemplate, setDeletingTemplate] = useState<PurchaseOrderTemplate | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [receiveTargets, setReceiveTargets] = useState<PurchaseOrder[] | null>(null);
  const [cancelTarget, setCancelTarget] = useState<PurchaseOrder | null>(null);
  const [mergeTargets, setMergeTargets] = useState<PurchaseOrder[] | null>(null);
  const [mergeInto, setMergeInto] = useState("");
  const [merging, setMerging] = useState(false);
  const [templateFrom, setTemplateFrom] = useState<PurchaseOrder | null>(null);
  const [templateName, setTemplateName] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const sortedTemplates = useMemo(() => [...templates].sort((a, b) => a.name.localeCompare(b.name)), [templates]);
  const template = useMemo(() => (templateId ? (templates.find((t) => t.id === templateId) ?? null) : null), [templates, templateId]);
  const selected = useMemo(() => (selectedId ? (purchaseOrders.find((p) => p.id === selectedId) ?? null) : null), [purchaseOrders, selectedId]);
  const selectedSkus = useMemo(() => selected?.lines.map((l) => itemsById.get(l.itemId)?.sku).filter((s): s is string => !!s), [selected, itemsById]);
  const mergePreview = useMemo(() => {
    if (!mergeTargets) return null;
    const items = new Set(mergeTargets.flatMap((p) => p.lines.map((l) => l.itemId)));
    return { lines: items.size, total: mergeTargets.reduce((t, p) => t + poTotal(p), 0), sent: mergeTargets.filter((p) => p.status !== "draft") };
  }, [mergeTargets]);

  useEffect(() => {
    setPageContext({ page: "Purchase orders", selectedSkus });
  }, [setPageContext, selectedSkus]);

  const startFromTemplate = (id: string) => {
    setManageTemplates(false);
    setEditing(null);
    setTemplateId(id);
    setCreating(true);
  };
  const startNew = () => {
    setTemplateId(null);
    setEditing(null);
    setCreating(true);
  };
  const edit = (po: PurchaseOrder) => {
    setSelectedId(null);
    setTemplateId(null);
    setEditing(po);
    setCreating(true);
  };
  const startMerge = (pos: PurchaseOrder[]) => {
    const sorted = [...pos].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    setMergeTargets(sorted);
    setMergeInto(sorted[0]?.id ?? "");
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

  const confirmMerge = async () => {
    if (!mergeTargets || !mergeInto) return;
    setMerging(true);
    try {
      const merged = await mergePurchaseOrders(
        store,
        user,
        mergeTargets.map((p) => p.id),
        { into: mergeInto },
      );
      toast(`Merged ${pluralize(mergeTargets.length, "order")} into ${merged.number}`, "success");
      setMergeTargets(null);
      setSelectedId(merged.id);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "critical");
    } finally {
      setMerging(false);
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
                ...(documentTemplates.length
                  ? [
                      "divider" as const,
                      ...documentTemplates.map((d) => ({
                        label: (
                          <span className="block min-w-0">
                            <span className="block truncate">{d.name}</span>
                            <span className="block text-[11px] text-text-tertiary">Document from the library{d.description ? ` · ${d.description}` : ""}</span>
                          </span>
                        ),
                        icon: <FileText />,
                        onSelect: () => void docs.open(d).catch((e) => toast(e instanceof Error ? e.message : String(e), "critical")),
                      })),
                    ]
                  : []),
                "divider" as const,
                { label: "Upload a template…", icon: <FileUp />, onSelect: () => setUploadOpen(true) },
                { label: "Manage templates", onSelect: () => setManageTemplates(true) },
                { label: "Document templates…", href: "/documents" },
              ]}
            />
          )}
          <Button icon={<Lightbulb />} href="/orders/replenishment">
            Replenishment{toOrder ? ` (${toOrder})` : ""}
          </Button>
          <Button icon={<Sparkles />} onClick={() => openAgent("Check the replenishment plan and draft purchase orders for everything the forecast says to order, one per supplier, merging into any open drafts. Show me the totals before creating them.")}>
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
        <PurchaseOrdersTable purchaseOrders={purchaseOrders} canWrite={writable} busyId={busyId} onSelect={(p) => setSelectedId(p.id)} onSend={send} onReceive={setReceiveTargets} onCancel={setCancelTarget} onMerge={startMerge} onNew={writable ? startNew : undefined} />
      </div>

      <NewPurchaseOrderModal
        open={creating}
        template={template}
        editing={editing}
        onClose={() => {
          setCreating(false);
          setTemplateId(null);
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
        onReceive={(po) => setReceiveTargets([po])}
        onEdit={edit}
        onCancel={setCancelTarget}
        onSaveTemplate={(po) => {
          setTemplateFrom(po);
          setTemplateName(`${po.supplier} reorder`);
        }}
      />
      <ReceivePurchaseOrderModal pos={receiveTargets} onClose={() => setReceiveTargets(null)} onReceived={(pos) => setSelectedId(pos[0]?.id ?? null)} />

      <Modal
        open={!!mergeTargets}
        onClose={() => setMergeTargets(null)}
        size="md"
        title="Merge into one order"
        subtitle={mergeTargets ? `${mergeTargets.map((p) => p.number).join(", ")} to ${mergeTargets[0]?.supplier}. Lines move onto the order you keep; the others close as merged.` : undefined}
        footer={
          <>
            <Button onClick={() => setMergeTargets(null)}>Cancel</Button>
            <Button variant="primary" icon={<Merge />} onClick={() => void confirmMerge()} loading={merging} disabled={!mergeInto}>
              Merge orders
            </Button>
          </>
        }
      >
        {mergeTargets && mergePreview && (
          <div className="flex flex-col gap-4">
            <Select label="Keep" value={mergeInto} onChange={(e) => setMergeInto(e.target.value)} options={mergeTargets.map((p) => ({ value: p.id, label: `${p.number} · ${p.status} · created ${formatDate(p.createdAt)}` }))} help="This order keeps its number, terms and expected date, and takes the others' lines." />
            <ul className="divide-y divide-border rounded-[var(--radius)] border border-border text-[13px]">
              {mergeTargets.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span>
                    <span className="font-mono font-medium text-text">{p.number}</span>
                    <span className="text-text-secondary">
                      {" "}
                      · {pluralize(p.lines.length, "line")} · {p.status}
                      {p.expectedAt ? ` · expected ${formatDate(p.expectedAt)}` : ""}
                    </span>
                  </span>
                  <span className="tabular text-text-secondary">{formatMoney(poTotal(p), settings.currency)}</span>
                </li>
              ))}
            </ul>
            <p className="text-[12.5px] text-text-secondary">
              Result: <span className="font-medium text-text">{pluralize(mergePreview.lines, "line")}</span> · <span className="font-medium text-text tabular">{formatMoney(mergePreview.total, settings.currency)}</span>. An item on more than one order gets its quantities added at the quantity-weighted cost.
              {mergePreview.sent.length > 0 && <span className="text-warning"> {mergePreview.sent.map((p) => p.number).join(", ")} already went to the supplier; let them know which order to fill.</span>}
            </p>
          </div>
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
