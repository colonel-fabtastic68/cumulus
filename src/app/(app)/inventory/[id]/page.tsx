"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Copy, Hammer, MoreHorizontal, Pencil, Power, Replace, SlidersHorizontal, Sparkles, Trash2 } from "lucide-react";
import { deleteItems, isLowStock, updateItem } from "@/lib/inventory";
import { useCollection, useItems, useSettings, useStore } from "@/lib/store/provider";
import { canWrite, useCurrentUser } from "@/lib/auth";
import { Badge, Button, Card, ConfirmDialog, EmptyState, IconButton, Menu, Page, PageLayout, StatusBadge, Tabs, useToast } from "@/components/ui";
import { AdjustStockModal, BuildModal, ItemFormModal } from "@/components/inventory";
import { useAgent } from "@/components/agent/AgentProvider";
import { StockSummaryCard } from "@/components/item/StockSummaryCard";
import { OverviewTab } from "@/components/item/OverviewTab";
import { BomTab } from "@/components/item/BomTab";
import { WhereUsedTab } from "@/components/item/WhereUsedTab";
import { StockHistoryTab } from "@/components/item/StockHistoryTab";
import { BatchesTab } from "@/components/item/BatchesTab";
import { PricingTab } from "@/components/item/PricingTab";
import { ItemAside } from "@/components/item/ItemAside";
import { SupersedeModal } from "@/components/item/SupersedeModal";
import { duplicateDefaults, errorMessage } from "@/components/item/utils";
import { whereUsed } from "@/lib/inventory";

type Tab = "overview" | "bom" | "whereUsed" | "history" | "batches" | "pricing";

export default function ItemDetailPage() {
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(String(params?.id ?? ""));
  const router = useRouter();
  const store = useStore();
  const user = useCurrentUser();
  const toast = useToast();
  const settings = useSettings();
  const { open: openAgent, setPageContext } = useAgent();

  const items = useItems();
  const movements = useCollection("movements");
  const lots = useCollection("lots");
  const receipts = useCollection("receipts");
  const builds = useCollection("builds");
  const orders = useCollection("orders");
  const rmas = useCollection("rmas");
  const members = useCollection("members");
  const activity = useCollection("activity");
  const suppliers = useCollection("suppliers");

  const item = useMemo(() => items.find((i) => i.id === id) ?? items.find((i) => i.sku.toUpperCase() === id.toUpperCase()), [items, id]);
  const itemMovements = useMemo(() => (item ? movements.filter((m) => m.itemId === item.id) : []), [movements, item]);
  const itemLots = useMemo(() => (item ? lots.filter((l) => l.itemId === item.id) : []), [lots, item]);
  const membersById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const supplierId = item?.supplierId;
  const supplier = useMemo(() => (supplierId ? suppliers.find((s) => s.id === supplierId) : undefined), [suppliers, supplierId]);
  const usedIn = useMemo(() => (item ? whereUsed(items, item.id).length : 0), [items, item]);
  const lotsOnShelf = itemLots.filter((l) => l.qtyRemaining > 0).length;

  const [tab, setTab] = useState<Tab>("overview");
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [buildOpen, setBuildOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [supersedeOpen, setSupersedeOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (item) setPageContext({ page: `Item ${item.sku} (${item.name})`, selectedSkus: [item.sku] });
  }, [item, setPageContext]);

  if (!item) {
    return (
      <Page title="Item not found" backHref="/inventory" backLabel="Inventory">
        <Card padded={false}>
          <EmptyState title="We couldn't find that item" description="It may have been deleted, or the link is out of date." action={<Button href="/inventory">Back to inventory</Button>} />
        </Card>
      </Page>
    );
  }

  const writable = canWrite(user);
  const isAssembly = item.type === "assembly";
  const low = isLowStock(item);

  const toggleActive = async () => {
    try {
      const next = item.status === "active" ? "inactive" : "active";
      await updateItem(store, user, item.id, next === "active" ? { status: "active", supersededBy: undefined } : { status: "inactive" }, next === "active" ? "Reactivated" : "Deactivated");
      toast(`${item.sku} ${next === "active" ? "reactivated" : "deactivated"}`, "success");
    } catch (e) {
      toast(errorMessage(e), "critical");
    }
  };

  const remove = async () => {
    setDeleting(true);
    try {
      await deleteItems(store, user, [item.id]);
      toast(`Deleted ${item.sku}`, "success");
      router.push("/inventory");
    } catch (e) {
      toast(errorMessage(e), "critical");
      setDeleting(false);
    }
  };

  const tabs: Array<{ value: Tab; label: string; count?: number }> = [
    { value: "overview", label: "Overview" },
    ...(isAssembly ? [{ value: "bom" as Tab, label: "BOM", count: item.bom.length }] : [{ value: "bom" as Tab, label: "BOM" }]),
    { value: "whereUsed", label: "Where used", count: usedIn },
    { value: "history", label: "Stock history", count: itemMovements.length },
    { value: "batches", label: "Batches", count: lotsOnShelf },
    { value: "pricing", label: "Pricing" },
  ];

  return (
    <Page
      backHref="/inventory"
      backLabel="Inventory"
      title={<span className="font-mono">{item.sku}</span>}
      titleMeta={
        <>
          <StatusBadge status={item.status} />
          <Badge tone={isAssembly ? "info" : "default"}>{isAssembly ? "Assembly" : "Part"}</Badge>
          {low && <Badge tone="warning">Low stock</Badge>}
          {item.category && <Badge>{item.category}</Badge>}
        </>
      }
      subtitle={item.name}
      primaryAction={
        writable ? (
          <Button variant="primary" icon={<SlidersHorizontal />} onClick={() => setAdjustOpen(true)}>
            Adjust stock
          </Button>
        ) : undefined
      }
      secondaryActions={
        <>
          {writable && isAssembly && item.bom.length > 0 && (
            <Button icon={<Hammer />} onClick={() => setBuildOpen(true)}>
              Build
            </Button>
          )}
          {writable && (
            <Button icon={<Pencil />} onClick={() => setEditOpen(true)}>
              Edit
            </Button>
          )}
          <Menu
            trigger={<IconButton aria-label="More actions" icon={<MoreHorizontal />} />}
            items={[
              { label: "Ask Nimbus about this item", icon: <Sparkles />, onSelect: () => openAgent(`Tell me about ${item.sku} (${item.name}): stock position, recent usage, days of cover, where it is used, and anything I should act on.`, { send: true }) },
              ...(writable
                ? [
                    "divider" as const,
                    { label: "Duplicate", icon: <Copy />, onSelect: () => setDuplicateOpen(true) },
                    { label: item.status === "active" ? "Deactivate" : "Reactivate", icon: <Power />, onSelect: toggleActive },
                    { label: "Supersede with another part", icon: <Replace />, onSelect: () => setSupersedeOpen(true), disabled: item.status === "superseded" },
                    "divider" as const,
                    { label: "Delete item", icon: <Trash2 />, destructive: true, onSelect: () => setDeleteOpen(true) },
                  ]
                : []),
            ]}
          />
        </>
      }
    >
      <PageLayout aside={<ItemAside item={item} items={items} supplier={supplier} membersById={membersById} activity={activity} />}>
        <StockSummaryCard item={item} movements={itemMovements} lots={itemLots} settings={settings} />
        <Card padded={false}>
          <Tabs value={tab} onChange={setTab} tabs={tabs} className="px-3" />
          <div className="p-4">
            {/* BOM and Pricing stay mounted (hidden) so unsaved drafts survive a tab switch. */}
            {tab === "overview" && <OverviewTab item={item} supplier={supplier} movements={itemMovements} membersById={membersById} />}
            <div hidden={tab !== "bom"}>
              <BomTab item={item} items={items} currency={settings.currency} canEdit={writable} />
            </div>
            {tab === "whereUsed" && <WhereUsedTab item={item} items={items} />}
            {tab === "history" && <StockHistoryTab item={item} movements={itemMovements} lookups={{ receipts, builds, orders, rmas, membersById }} />}
            {tab === "batches" && <BatchesTab item={item} lots={itemLots} receipts={receipts} currency={settings.currency} />}
            <div hidden={tab !== "pricing"}>
              <PricingTab item={item} currency={settings.currency} canEdit={writable} />
            </div>
          </div>
        </Card>
      </PageLayout>

      <AdjustStockModal open={adjustOpen} onClose={() => setAdjustOpen(false)} item={item} />
      <BuildModal open={buildOpen} onClose={() => setBuildOpen(false)} assembly={item} />
      <ItemFormModal open={editOpen} onClose={() => setEditOpen(false)} item={item} />
      <ItemFormModal open={duplicateOpen} onClose={() => setDuplicateOpen(false)} defaults={duplicateDefaults(item)} onSaved={(created) => router.push(`/inventory/${created.id}`)} />
      <SupersedeModal open={supersedeOpen} onClose={() => setSupersedeOpen(false)} item={item} />
      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={remove}
        loading={deleting}
        destructive
        confirmLabel="Delete permanently"
        title={`Delete ${item.sku}?`}
        message={
          <span>
            This removes the item, its {itemMovements.length} stock movements and {itemLots.length} batches, and drops it from {usedIn} bill{usedIn === 1 ? "" : "s"} of materials. History reports will no longer include it, and it is refused while any open order or RMA still references it. Prefer <strong>Deactivate</strong> if you only want it out of active inventory.
          </span>
        }
      />
    </Page>
  );
}
