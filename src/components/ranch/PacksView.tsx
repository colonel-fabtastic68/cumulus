"use client";

import { useEffect, useMemo, useState } from "react";
import { ClipboardPaste, Package, Plus, Send, Trash2 } from "lucide-react";
import type { Item, PackComponent, PackListing } from "@/lib/types";
import { useCollection, useSettings, useStore } from "@/lib/store/provider";
import { canWrite, useCurrentUser } from "@/lib/auth";
import { useApi } from "@/lib/api-client";
import { useSession } from "@/lib/session";
import { formatMoney, formatQty } from "@/lib/format";
import { newId, nowIso } from "@/lib/utils";
import { newListingFor, packWeight, packsAvailable, parsePriceSheet, pricePerPound, suggestItem, type SheetRow } from "@/lib/ranch/packs";
import { Badge, Banner, Button, Combobox, EmptyState, IconButton, Modal, Page, Select, Table, TextArea, TextField, Toggle, useToast, type Column } from "@/components/ui";

interface StoreProduct {
  productId: string;
  variationId?: string;
  name: string;
  sku: string;
  price: number;
  stock: number | null;
  status: string;
}

function useStoreProducts(enabled: boolean): { products: StoreProduct[]; error: string | null; loading: boolean } {
  const api = useApi();
  const [state, setState] = useState<{ products: StoreProduct[]; error: string | null; loading: boolean }>({ products: [], error: null, loading: enabled });
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    api<{ products: StoreProduct[] }>("/api/ranch/store-products", undefined, { method: "GET" })
      .then((r) => !cancelled && setState({ products: r.products, error: null, loading: false }))
      .catch((e) => !cancelled && setState({ products: [], error: e instanceof Error ? e.message : String(e), loading: false }));
    return () => {
      cancelled = true;
    };
  }, [api, enabled]);
  return state;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** The store product a sheet row (or listing name) most likely is. */
function matchProduct(name: string, products: StoreProduct[]): StoreProduct | undefined {
  const n = norm(name);
  return products.find((p) => norm(p.name) === n) ?? products.find((p) => norm(p.name).startsWith(n) || n.startsWith(norm(p.name)));
}

function describeComponents(listing: PackListing, byId: Map<string, Item>): string {
  const parts = listing.components.filter((c) => c.qty > 0);
  if (parts.length === 0) return "Nothing set";
  if (parts.length === 1) {
    const item = byId.get(parts[0]!.itemId);
    return `${formatQty(parts[0]!.qty, item?.unit ?? "lb")} of ${item?.name ?? "a removed item"}`;
  }
  return `Box: ${parts.length} cuts, ${formatQty(packWeight(listing), byId.get(parts[0]!.itemId)?.unit ?? "lb")}`;
}

type StoreState = { tone: "success" | "warning" | "critical" | "default"; label: string };

function storeState(listing: PackListing, available: number): StoreState {
  if (listing.pushError) return { tone: "critical", label: listing.pushError.startsWith("No store product") ? "Not on the store" : "Push failed" };
  if (!listing.pushed) return { tone: "default", label: "Not pushed yet" };
  if (listing.pushed.stock !== available || (listing.active && listing.pushed.price !== listing.price)) return { tone: "warning", label: "Out of date" };
  return { tone: "success", label: listing.active ? `On the store: ${listing.pushed.stock}` : "Hidden (0)" };
}

export function PacksView() {
  const packs = useCollection("packs");
  const items = useCollection("items");
  const integrations = useCollection("integrations");
  const settings = useSettings();
  const user = useCurrentUser();
  const writable = canWrite(user);
  const api = useApi();
  const toast = useToast();
  const { mode } = useSession();
  const [editing, setEditing] = useState<PackListing | "new" | null>(null);
  const [pasting, setPasting] = useState(false);
  const [pushing, setPushing] = useState(false);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const wooConnected = integrations.some((i) => i.id === "woocommerce" && i.status === "connected");
  const currency = settings.currency || "USD";
  const rows = useMemo(() => [...packs].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name)), [packs]);

  const push = async (opts: { listingIds?: string[]; force?: boolean } = {}) => {
    setPushing(true);
    try {
      const r = await api<{ summary: string; errors: string[] }>("/api/ranch/push", opts);
      toast(`Store updated: ${r.summary}`, r.errors.length ? "critical" : "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Push failed", "critical");
    } finally {
      setPushing(false);
    }
  };

  const columns: Column<PackListing>[] = [
    {
      key: "name",
      header: "Product",
      render: (l) => (
        <div className="min-w-0">
          <div className="truncate font-medium text-text">{l.name}</div>
          <div className="truncate text-[12px] text-text-tertiary">
            {l.sku || "No SKU"}
            {l.packLabel ? ` · ${l.packLabel}` : ""}
          </div>
        </div>
      ),
      sortValue: (l) => l.name,
      minWidth: 200,
      flex: true,
    },
    { key: "takes", header: "Takes from stock", render: (l) => <span className="text-text-secondary">{describeComponents(l, byId)}</span>, minWidth: 190, maxWidth: 320, priority: 1 },
    {
      key: "price",
      header: "Web price",
      align: "right",
      render: (l) => {
        const perLb = pricePerPound(l);
        return (
          <div>
            <div className="font-medium tabular-nums">{formatMoney(l.price, currency)}</div>
            {perLb !== null && <div className="text-[12px] tabular-nums text-text-tertiary">{formatMoney(perLb, currency)} / lb</div>}
          </div>
        );
      },
      sortValue: (l) => l.price,
      minWidth: 110,
    },
    {
      key: "counter",
      header: "Counter / lb",
      align: "right",
      render: (l) => {
        const parts = l.components.filter((c) => c.qty > 0);
        const item = parts.length === 1 ? byId.get(parts[0]!.itemId) : undefined;
        const perLb = pricePerPound(l);
        if (!item?.price || perLb === null) return <span className="text-text-tertiary">–</span>;
        const diff = Math.round((perLb / item.price - 1) * 100);
        return (
          <div>
            <div className="tabular-nums">{formatMoney(item.price, currency)}</div>
            <div className={`text-[12px] tabular-nums ${Math.abs(diff) >= 50 || diff < 0 ? "text-warning" : "text-text-tertiary"}`}>{diff > 0 ? `+${diff}` : diff}% online</div>
          </div>
        );
      },
      minWidth: 110,
      priority: 2,
    },
    {
      key: "packs",
      header: "Packs",
      align: "right",
      render: (l) => {
        const n = packsAvailable(l, byId);
        return (
          <div>
            <div className={`font-medium tabular-nums ${n === 0 && l.active ? "text-critical" : ""}`}>{n}</div>
            {l.reserve ? <div className="text-[12px] text-text-tertiary">{l.reserve} held back</div> : null}
          </div>
        );
      },
      sortValue: (l) => packsAvailable(l, byId),
      minWidth: 80,
    },
    {
      key: "store",
      header: "Store",
      render: (l) => {
        const s = storeState(l, packsAvailable(l, byId));
        return (
          <Badge tone={s.tone} dot>
            {s.label}
          </Badge>
        );
      },
      minWidth: 150,
      priority: 3,
    },
  ];

  return (
    <Page
      title="Web packs"
      subtitle="What each store product takes from stock and what it sells for. Packs for sale come from the pounds on hand."
      primaryAction={
        writable ? (
          <Button variant="primary" icon={<Plus />} onClick={() => setEditing("new")}>
            Add pack
          </Button>
        ) : undefined
      }
      secondaryActions={
        <>
          {writable && (
            <Button icon={<ClipboardPaste />} onClick={() => setPasting(true)}>
              Paste price sheet
            </Button>
          )}
          {writable && wooConnected && (
            <Button icon={<Send />} loading={pushing} onClick={() => void push({ force: true })}>
              Push to store
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {mode === "firestore" && !wooConnected && (
          <Banner tone="info" title="The store is not connected yet">
            Set up packs here any time. Once WooCommerce is connected under Integrations, each pack&apos;s stock and price go to the store product with the same SKU.
          </Banner>
        )}
        <Table
          rows={rows}
          columns={columns}
          rowKey={(l) => l.id}
          onRowClick={writable ? (l) => setEditing(l) : undefined}
          fit
          layoutKey="ranch-packs"
          defaultSort={{ key: "name", dir: "asc" }}
          emptyState={
            <EmptyState
              icon={<Package />}
              title="No web packs yet"
              description="Add each store product with the cut it comes from and its average pack weight, or paste the price sheet to start from it."
              action={
                writable ? (
                  <Button icon={<ClipboardPaste />} onClick={() => setPasting(true)}>
                    Paste price sheet
                  </Button>
                ) : undefined
              }
            />
          }
        />
      </div>
      {editing && <PackFormModal listing={editing === "new" ? null : editing} items={items} wooConnected={wooConnected} onClose={() => setEditing(null)} onSaved={(id) => wooConnected && void push({ listingIds: [id] })} />}
      {pasting && <PriceSheetModal items={items} existing={packs} wooConnected={wooConnected} onClose={() => setPasting(false)} />}
    </Page>
  );
}

// ---- one listing ---------------------------------------------------------------------------

function PackFormModal({ listing, items, wooConnected, onClose, onSaved }: { listing: PackListing | null; items: Item[]; wooConnected: boolean; onClose: () => void; onSaved: (id: string) => void }) {
  const store = useStore();
  const toast = useToast();
  const { products, error: productsError } = useStoreProducts(wooConnected);
  const [name, setName] = useState(listing?.name ?? "");
  const [sku, setSku] = useState(listing?.sku ?? "");
  const [productKey, setProductKey] = useState(listing?.woo ? `${listing.woo.productId}:${listing.woo.variationId ?? ""}` : "");
  const [packLabel, setPackLabel] = useState(listing?.packLabel ?? "");
  const [price, setPrice] = useState(listing ? String(listing.price) : "");
  const [reserve, setReserve] = useState(listing?.reserve ? String(listing.reserve) : "");
  const [active, setActive] = useState(listing?.active ?? true);
  const [components, setComponents] = useState<PackComponent[]>(listing?.components.length ? listing.components : [{ itemId: "", qty: 1 }]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);

  const itemOptions = useMemo(() => [...items].sort((a, b) => a.name.localeCompare(b.name)).map((i) => ({ value: i.id, label: i.name, description: `${i.sku} · ${i.unit}` })), [items]);
  const productOptions = useMemo(() => products.map((p) => ({ value: `${p.productId}:${p.variationId ?? ""}`, label: p.name, description: p.sku ? `SKU ${p.sku}` : "No SKU on the store" })), [products]);

  const pickProduct = (key: string) => {
    setProductKey(key);
    const p = products.find((x) => `${x.productId}:${x.variationId ?? ""}` === key);
    if (!p) return;
    if (p.sku) setSku(p.sku);
    if (!name.trim()) setName(p.name);
    if (!price && p.price) setPrice(String(p.price));
  };

  const save = async () => {
    const e: Record<string, string> = {};
    const usable = components.filter((c) => c.itemId && c.qty > 0);
    if (!name.trim()) e.name = "Name the product.";
    if (!sku.trim() && !productKey) e.sku = "Enter the store SKU or pick the store product.";
    const p = Number(price);
    if (!(p >= 0) || price.trim() === "") e.price = "Enter the web price.";
    if (usable.length === 0) e.components = "Pick the cut this pack comes from and its weight.";
    setErrors(e);
    if (Object.keys(e).length) return;
    const product = products.find((x) => `${x.productId}:${x.variationId ?? ""}` === productKey);
    const now = nowIso();
    const doc: PackListing = {
      ...(listing ?? newListingFor({ name }, newId("pk"), now)),
      name: name.trim(),
      sku: sku.trim().toUpperCase(),
      woo: product ? { productId: product.productId, ...(product.variationId ? { variationId: product.variationId } : {}) } : listing?.woo,
      components: usable.map((c) => ({ itemId: c.itemId, qty: Math.round(c.qty * 1000) / 1000 })),
      packLabel: packLabel.trim() || undefined,
      price: Math.round(p * 100) / 100,
      reserve: Number(reserve) > 0 ? Math.floor(Number(reserve)) : undefined,
      active,
      pushError: undefined,
      updatedAt: now,
    };
    await store.put("packs", doc);
    toast(listing ? "Pack saved" : "Pack added", "success");
    onSaved(doc.id);
    onClose();
  };

  const remove = async () => {
    if (!listing) return;
    await store.remove("packs", listing.id);
    toast("Pack removed. Its store product keeps the last stock it was given.", "success");
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={listing ? listing.name : "Add a web pack"}
      subtitle="One store product: the cut(s) a pack takes and what it sells for."
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <div>
            {listing &&
              (confirmDelete ? (
                <Button variant="critical" onClick={() => void remove()}>
                  Remove this pack
                </Button>
              ) : (
                <Button variant="plain" icon={<Trash2 />} onClick={() => setConfirmDelete(true)}>
                  Remove
                </Button>
              ))}
          </div>
          <div className="flex gap-2">
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={() => void save()}>
              {listing ? "Save" : "Add pack"}
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {wooConnected && (
          <Combobox label="Store product" value={productKey} onChange={pickProduct} options={productOptions} placeholder={productsError ? "Could not load the store's products" : "Search the store's products…"} />
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TextField label="Product name" value={name} onChange={(e) => setName(e.target.value)} error={errors.name} placeholder="Wagyu Ribeye" />
          <TextField label="Store SKU" value={sku} onChange={(e) => setSku(e.target.value)} error={errors.sku} placeholder="WR-WAG-RIB" help="Web orders find this pack by the store product, then by SKU." />
          <TextField label="Web price" type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} error={errors.price} prefix="$" />
          <TextField label="Pack size label" value={packLabel} onChange={(e) => setPackLabel(e.target.value)} placeholder="2 × 8 oz avg/pack" />
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[13px] font-medium text-text">Takes from stock, per pack</span>
            <Button size="sm" variant="plain" icon={<Plus />} onClick={() => setComponents((c) => [...c, { itemId: "", qty: 1 }])}>
              Add a cut (box)
            </Button>
          </div>
          <div className="flex flex-col gap-2">
            {components.map((c, i) => (
              <div key={i} className="flex items-end gap-2">
                <div className="min-w-0 flex-1">
                  <Combobox aria-label="Cut" value={c.itemId} onChange={(v) => setComponents((all) => all.map((x, j) => (j === i ? { ...x, itemId: v } : x)))} options={itemOptions} placeholder="Search cuts…" />
                </div>
                <div className="w-[130px]">
                  <TextField aria-label="Weight per pack" type="number" min={0} step="any" value={String(c.qty)} onChange={(e) => setComponents((all) => all.map((x, j) => (j === i ? { ...x, qty: Number(e.target.value) } : x)))} suffix={items.find((it) => it.id === c.itemId)?.unit ?? "lb"} />
                </div>
                {components.length > 1 && <IconButton variant="plain" aria-label="Remove cut" icon={<Trash2 />} onClick={() => setComponents((all) => all.filter((_, j) => j !== i))} />}
              </div>
            ))}
          </div>
          {errors.components && <p className="mt-1.5 text-[12.5px] text-critical">{errors.components}</p>}
          <p className="mt-1.5 text-[12.5px] text-text-tertiary">Use the average pack weight: a pack of two 8 oz steaks takes 1 lb. A box lists every cut it holds.</p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TextField label="Hold back from the web" inputMode="numeric" value={reserve} onChange={(e) => setReserve(e.target.value.replace(/[^0-9]/g, ""))} placeholder="0" suffix="packs" help="Kept for counter sales so the site does not sell the last ones." />
          <div className="pt-6">
            <Toggle label="For sale on the store" checked={active} onChange={setActive} help="Off sends 0 to the store." />
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ---- the price sheet ----------------------------------------------------------------------

interface SheetChoice extends SheetRow {
  include: boolean;
  itemId: string;
  weight: string;
  productKey: string;
}

function PriceSheetModal({ items, existing, wooConnected, onClose }: { items: Item[]; existing: PackListing[]; wooConnected: boolean; onClose: () => void }) {
  const store = useStore();
  const toast = useToast();
  const { products } = useStoreProducts(wooConnected);
  const [text, setText] = useState("");
  const [rows, setRows] = useState<SheetChoice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cuts = useMemo(() => items.filter((i) => i.status !== "inactive"), [items]);
  const itemOptions = useMemo(() => [{ value: "", label: "Choose later" }, ...[...cuts].sort((a, b) => a.name.localeCompare(b.name)).map((i) => ({ value: i.id, label: i.name }))], [cuts]);
  const productOptions = useMemo(() => [{ value: "", label: "Match by SKU later" }, ...products.map((p) => ({ value: `${p.productId}:${p.variationId ?? ""}`, label: `${p.name}${p.sku ? ` (${p.sku})` : ""}` }))], [products]);
  const taken = useMemo(() => new Set(existing.map((l) => norm(l.name))), [existing]);

  const read = () => {
    const parsed = parsePriceSheet(text);
    if (parsed.error) {
      setError(parsed.error);
      setRows(null);
      return;
    }
    setError(null);
    setRows(
      parsed.rows.map((r) => {
        const product = matchProduct(r.name, products);
        const boxed = /box|bundle/i.test(`${r.name} ${r.category ?? ""}`);
        return { ...r, include: !taken.has(norm(r.name)), itemId: boxed ? "" : (suggestItem(r.name, cuts)?.id ?? ""), weight: r.packWeight ? String(r.packWeight) : "", productKey: product ? `${product.productId}:${product.variationId ?? ""}` : "" };
      }),
    );
  };

  const save = async () => {
    if (!rows) return;
    setBusy(true);
    const now = nowIso();
    const docs: PackListing[] = rows
      .filter((r) => r.include)
      .map((r) => {
        const product = products.find((p) => `${p.productId}:${p.variationId ?? ""}` === r.productKey);
        const doc = newListingFor({ name: r.name, sku: product?.sku, itemId: r.itemId || undefined, weight: Number(r.weight) || null, price: r.price, packLabel: r.packLabel, category: r.category }, newId("pk"), now);
        return product ? { ...doc, woo: { productId: product.productId, ...(product.variationId ? { variationId: product.variationId } : {}) } } : doc;
      });
    try {
      await store.batch(docs.map((doc) => ({ op: "put" as const, collection: "packs" as const, doc })));
      const needCut = docs.filter((d) => d.components.length === 0).length;
      toast(`${docs.length} pack${docs.length === 1 ? "" : "s"} added${needCut ? `; ${needCut} still need their cuts (boxes)` : ""}`, "success");
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save", "critical");
    } finally {
      setBusy(false);
    }
  };

  const update = (i: number, patch: Partial<SheetChoice>) => setRows((all) => all!.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title="Paste the price sheet"
      subtitle="Copy the rows from the spreadsheet (header row included). Each product becomes a web pack; check the cut and weight before adding."
      footer={
        <div className="flex gap-2">
          <Button onClick={onClose}>Cancel</Button>
          {rows ? (
            <Button variant="primary" loading={busy} disabled={!rows.some((r) => r.include)} onClick={() => void save()}>
              Add {rows.filter((r) => r.include).length} packs
            </Button>
          ) : (
            <Button variant="primary" disabled={!text.trim()} onClick={read}>
              Read sheet
            </Button>
          )}
        </div>
      }
    >
      {!rows ? (
        <div className="flex flex-col gap-3">
          <TextArea aria-label="Price sheet" rows={12} value={text} onChange={(e) => setText(e.target.value)} placeholder={"Product Name\tPack Size\tPrice\nWagyu Ribeye\t1lb avg/pack\t$70"} className="font-mono text-[12px]" />
          {error && <Banner tone="critical">{error}</Banner>}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-divider text-left text-[12px] text-text-secondary">
                <th className="py-2 pr-2 font-medium">Add</th>
                <th className="py-2 pr-2 font-medium">Product</th>
                <th className="py-2 pr-2 font-medium">Cut</th>
                <th className="py-2 pr-2 font-medium">lb / pack</th>
                <th className="py-2 pr-2 text-right font-medium">Price</th>
                {wooConnected && <th className="py-2 font-medium">Store product</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-divider align-top">
                  <td className="py-2 pr-2">
                    <input type="checkbox" checked={r.include} onChange={(e) => update(i, { include: e.target.checked })} aria-label={`Add ${r.name}`} />
                  </td>
                  <td className="py-2 pr-2">
                    <div className="font-medium">{r.name}</div>
                    <div className="text-[12px] text-text-tertiary">
                      {r.packLabel}
                      {taken.has(norm(r.name)) ? " · already a pack" : ""}
                    </div>
                  </td>
                  <td className="w-[260px] py-2 pr-2">
                    <Select aria-label="Cut" options={itemOptions} value={r.itemId} onChange={(e) => update(i, { itemId: e.target.value })} />
                  </td>
                  <td className="w-[110px] py-2 pr-2">
                    <TextField aria-label="Pounds per pack" type="number" min={0} step="any" value={r.weight} onChange={(e) => update(i, { weight: e.target.value })} />
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums">{r.price !== null ? formatMoney(r.price) : "–"}</td>
                  {wooConnected && (
                    <td className="w-[240px] py-2">
                      <Select aria-label="Store product" options={productOptions} value={r.productKey} onChange={(e) => update(i, { productKey: e.target.value })} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[12.5px] text-text-tertiary">Boxes start without cuts: open each one afterwards and list what it holds, so selling a box takes the right pounds.</p>
        </div>
      )}
    </Modal>
  );
}
