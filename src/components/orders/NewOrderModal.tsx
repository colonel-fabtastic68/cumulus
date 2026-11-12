"use client";

import { useMemo, useState } from "react";
import { BookmarkPlus, MapPin, Plus, Trash2 } from "lucide-react";
import type { Address, Item, OrderSource, OrderTemplate, SalesOrder } from "@/lib/types";
import { createOrder, InventoryError, priceForCustomer } from "@/lib/inventory";
import { useCollection, useSettings, useStore } from "@/lib/store/provider";
import { useCurrentUser } from "@/lib/auth";
import { formatMoney, formatQty } from "@/lib/format";
import { cn, newId, round, sum, uniq } from "@/lib/utils";
import { Button, Checkbox, Combobox, FormGrid, IconButton, Modal, Select, TextArea, TextField, useToast } from "@/components/ui";
import { saveOrderTemplate } from "@/lib/orderTemplates";
import { ensureCustomer, findCustomer } from "@/lib/customers";
import { ItemPicker } from "@/components/inventory";
import { currencySymbol } from "./orderUtils";
import { QuickLineEntry } from "./QuickLineEntry";
import { useFeatures } from "@/lib/useFeature";
import { useTerms } from "@/lib/useTerms";
import { useDefaultLocation, useLocations } from "@/lib/locations";
import { routedLocation } from "@/lib/inventory";
import { enteredFor, toStockQty, unitOptions } from "@/lib/units";

interface NewOrderModalProps {
  open: boolean;
  onClose: () => void;
  onCreated?: (order: SalesOrder) => void;
  /** Start pre-filled from a saved template. */
  template?: OrderTemplate | null;
}

/** Mounts the form only while open so every opening starts from a clean state. */
export function NewOrderModal(props: NewOrderModalProps) {
  if (!props.open) return null;
  return <NewOrderForm key={props.template?.id ?? "new"} {...props} />;
}

interface LineState {
  key: string;
  item: Item | null;
  qty: string;
  unitPrice: string;
  /** Once the user edits the price by hand we stop recomputing it from quantity. */
  priceTouched: boolean;
  /** Ship this line from here; "" leaves it to the part's routing and the shipment. */
  locationId: string;
  /** The unit qty was typed in; "" is the item's stocking unit. */
  unit: string;
}

const newLine = (): LineState => ({ key: newId("ln"), item: null, qty: "1", unitPrice: "", priceTouched: false, locationId: "", unit: "" });

/** The line's quantity in the item's stocking unit: what the order, the price and the shelf are counted in. */
function stockQty(l: Pick<LineState, "item" | "qty" | "unit">): number {
  const n = Number(l.qty);
  if (!l.item || !l.unit || !Number.isFinite(n)) return n;
  try {
    return toStockQty(l.item, n, l.unit);
  } catch {
    return n;
  }
}

const SOURCE_OPTIONS: Array<{ value: OrderSource; label: string }> = [
  { value: "manual", label: "Manual" },
  { value: "shopify", label: "Shopify" },
  { value: "woocommerce", label: "WooCommerce" },
];

function NewOrderForm({ open, onClose, onCreated, template }: NewOrderModalProps) {
  const store = useStore();
  const user = useCurrentUser();
  const toast = useToast();
  const orders = useCollection("orders");
  const allItems = useCollection("items");
  const customerRecords = useCollection("customers");
  const { currency } = useSettings();
  const symbol = currencySymbol(currency);
  const features = useFeatures();
  const terms = useTerms();
  const locations = useLocations();
  const home = useDefaultLocation();
  const pickLocation = features.lineLocations && locations.length > 1;

  const [customer, setCustomer] = useState(template?.customer ?? "");
  const [customerEmail, setCustomerEmail] = useState(template?.customerEmail ?? "");
  const [addressOpen, setAddressOpen] = useState(!!template?.shipTo);
  const [shipTo, setShipTo] = useState<Address>(template?.shipTo ?? { street1: "", city: "", state: "", zip: "", country: "US" });
  const setA = (k: keyof Address) => (e: React.ChangeEvent<HTMLInputElement>) => setShipTo((a) => ({ ...a, [k]: e.target.value }));
  const [source, setSource] = useState<OrderSource>("manual");
  // Template lines find their items by id; the price is the template's, else today's price for that quantity.
  const [lines, setLines] = useState<LineState[]>(() => {
    // With keyboard entry the form starts empty: the entry row under the lines is where typing begins.
    if (!template) return features.fastLineEntry ? [] : [newLine()];
    const fromTemplate = template.lines.flatMap((l) => {
      const item = allItems.find((i) => i.id === l.itemId);
      if (!item) return [];
      const price = l.unitPrice ?? priceForCustomer(item, l.qty, null);
      return [{ key: newId("ln"), item, qty: String(l.qty), unitPrice: price === undefined ? "" : String(price), priceTouched: l.unitPrice !== undefined, locationId: "", unit: "" }];
    });
    return fromTemplate.length || features.fastLineEntry ? fromTemplate : [newLine()];
  });
  const [note, setNote] = useState(template?.note ?? "");
  const [orderNumber, setOrderNumber] = useState("");
  const [templateModal, setTemplateModal] = useState(false);
  const [templateName, setTemplateName] = useState(template?.name ?? "");
  const [templateNote, setTemplateNote] = useState(template?.description ?? "");
  const [savingTemplate, setSavingTemplate] = useState(false);

  const saveTemplate = async () => {
    const chosen = lines.filter((l) => l.item && stockQty(l) > 0);
    if (!templateName.trim() || chosen.length === 0) return;
    setSavingTemplate(true);
    try {
      const address = shipTo.street1.trim() ? { ...shipTo, country: shipTo.country.trim().toUpperCase() || "US" } : undefined;
      const t = await saveOrderTemplate(store, user, { name: templateName, description: templateNote, customer, customerEmail, shipTo: address, note, lines: chosen.map((l) => ({ itemId: l.item!.id, qty: stockQty(l), unitPrice: l.priceTouched && l.unitPrice !== "" ? Number(l.unitPrice) : undefined })) }, template?.id);
      toast(`Saved template “${t.name}”`, "success");
      setTemplateModal(false);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save the template", "critical");
    } finally {
      setSavingTemplate(false);
    }
  };
  const [shipNow, setShipNow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Suggestions: customer records (searchable by name, company and email) first, then names seen on past orders that have no record yet.
  const customerOptions = useMemo(() => {
    const fromRecords = [...customerRecords].sort((a, b) => a.name.localeCompare(b.name)).map((c) => ({ value: c.name, label: c.name, description: [c.company, c.email].filter(Boolean).join(" · ") || undefined }));
    const seen = new Set(fromRecords.map((o) => o.value.toLowerCase()));
    const fromOrders = uniq(orders.map((o) => o.customer.trim()).filter((n) => n && !seen.has(n.toLowerCase()))).sort((a, b) => a.localeCompare(b)).map((n) => ({ value: n, label: n, description: "from past orders" }));
    return [...fromRecords, ...fromOrders];
  }, [customerRecords, orders]);
  // The matched customer record drives pricing (group price, discount) for every line.
  const customerRecord = useMemo(() => findCustomer(customerRecords, { name: customer, email: customerEmail }), [customerRecords, customer, customerEmail]);
  const priceGroupList = useSettings().catalog?.priceGroups ?? [];
  const priceFor = (item: Item, qty: number) => priceForCustomer(item, qty, customerRecord, priceGroupList);
  // Picking a known customer fills in what the record knows.
  const onCustomerChange = (value: string) => {
    setCustomer(value);
    const known = findCustomer(customerRecords, { name: value });
    if (known) {
      if (known.email && !customerEmail) setCustomerEmail(known.email);
      if (known.address && !shipTo.street1) {
        setShipTo({ ...known.address, name: known.address.name ?? known.name });
        setAddressOpen(true);
      }
    }
  };

  const patchLine = (key: string, fn: (line: LineState) => LineState) => setLines((prev) => prev.map((l) => (l.key === key ? fn(l) : l)));

  /** Choosing an item (or a different one) always starts from its list price for the current quantity. */
  const setItem = (key: string, item: Item | null) =>
    patchLine(key, (l) => {
      // A new item starts in the unit it is usually sold in.
      const unit = features.unitConversions ? (item?.salesUnit ?? "") : "";
      const qty = Math.max(1, stockQty({ item, qty: l.qty, unit }) || 1);
      return { ...l, item, unit, unitPrice: item ? String(priceFor(item, qty)) : "", priceTouched: false };
    });

  const setQty = (key: string, qty: string) =>
    patchLine(key, (l) => {
      const n = stockQty({ ...l, qty });
      const unitPrice = l.item && !l.priceTouched && Number.isFinite(n) && n > 0 ? String(priceFor(l.item, n)) : l.unitPrice;
      return { ...l, qty, unitPrice };
    });

  const setUnit = (key: string, unit: string) =>
    patchLine(key, (l) => {
      const n = stockQty({ ...l, unit });
      const unitPrice = l.item && !l.priceTouched && Number.isFinite(n) && n > 0 ? String(priceFor(l.item, n)) : l.unitPrice;
      return { ...l, unit, unitPrice };
    });

  /** Keyboard entry: a part already on the order gets the quantity added to its line instead of a second line. */
  const addQuick = (item: Item, qty: number) =>
    setLines((prev) => {
      const unit = features.unitConversions ? (item.salesUnit ?? "") : "";
      const existing = prev.find((l) => l.item?.id === item.id && l.unit === unit);
      if (existing) {
        const total = String((Number(existing.qty) || 0) + qty);
        const n = stockQty({ ...existing, qty: total });
        return prev.map((l) => (l === existing ? { ...l, qty: total, unitPrice: l.priceTouched ? l.unitPrice : String(priceFor(item, n)) } : l));
      }
      const n = stockQty({ item, qty: String(qty), unit });
      return [...prev.filter((l) => l.item), { ...newLine(), item, qty: String(qty), unit, unitPrice: String(priceFor(item, n)) }];
    });

  const setPrice = (key: string, unitPrice: string) => patchLine(key, (l) => ({ ...l, unitPrice, priceTouched: true }));

  const removeLine = (key: string) => setLines((prev) => prev.filter((l) => l.key !== key));
  const addLine = () => setLines((prev) => [...prev, newLine()]);

  const lineTotal = (l: LineState) => {
    const q = stockQty(l);
    const p = Number(l.unitPrice);
    return Number.isFinite(q) && Number.isFinite(p) ? round(q * p) : 0;
  };

  const validLines = lines.filter((l) => l.item && stockQty(l) > 0);
  const total = round(sum(validLines.map(lineTotal)));
  const shortLines = validLines.filter((l) => l.item && l.item.onHand < stockQty(l));

  const submit = async () => {
    if (validLines.length === 0) return setError("Add at least one line with an item and a quantity");
    for (const l of lines) {
      if (!l.item) continue;
      const q = stockQty(l);
      const p = Number(l.unitPrice);
      if (!Number.isFinite(q) || q <= 0) return setError(`Enter a quantity for ${l.item.sku}`);
      if (!Number.isFinite(p) || p < 0) return setError(`Enter a unit price for ${l.item.sku}`);
    }
    setBusy(true);
    setError(null);
    try {
      const address = shipTo.street1.trim() ? { ...shipTo, name: shipTo.name?.trim() || customer.trim() || undefined, country: shipTo.country.trim().toUpperCase() || "US" } : undefined;
      const order = await createOrder(store, user, {
        customer: customer.trim(),
        number: orderNumber.trim() || undefined,
        customerEmail: customerEmail.trim() || undefined,
        shipTo: address,
        source,
        note: note.trim() || undefined,
        lines: validLines.map((l) => ({
          itemId: l.item!.id,
          qty: stockQty(l),
          unitPrice: Number(l.unitPrice),
          ...(pickLocation && l.locationId ? { locationId: l.locationId } : {}),
          ...(l.unit ? { entered: enteredFor(l.item!, Number(l.qty), l.unit) } : {}),
        })),
        fulfill: shipNow,
      });
      // Every order points at a customer record; one is created from the order when none matches.
      const record = await ensureCustomer(store, user, { name: order.customer, email: order.customerEmail, address: address, source: "order" }).catch(() => undefined);
      if (record) await store.patch("orders", order.id, { customerId: record.id }).catch(() => {});
      toast(shipNow ? `Created and shipped ${order.number} for ${order.customer}` : `Created ${order.number} for ${order.customer}`, "success");
      onCreated?.(order);
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (shipNow && e instanceof InventoryError && /^Cannot fulfill/i.test(msg)) {
        // The order was saved but could not ship (stock short). Leave it open rather than lose it.
        toast(`Order created but not shipped. ${msg}`, "critical");
        onClose();
        return;
      }
      setError(msg);
      toast(msg, "critical");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New order"
      subtitle={template ? `From template “${template.name}”. Check quantities and prices, then create.` : "Open orders wait on the shelf; stock is relieved when the order ships."}
      size={features.largeOrderForms ? "full" : "lg"}
      footer={
        <>
          <Button variant="plain" icon={<BookmarkPlus />} onClick={() => setTemplateModal(true)} disabled={validLines.length === 0} className="mr-auto">
            Save as template
          </Button>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={validLines.length === 0}>
            {shipNow ? "Create and ship" : "Create order"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <FormGrid cols={3}>
          <div className="sm:col-span-2">
            <Combobox
              label="Customer"
              value={customer}
              onChange={onCustomerChange}
              onCreate={onCustomerChange}
              createLabel={(q) => `Use “${q}” as a new customer`}
              placeholder="Type a name, company or email; Tab fills it in"
              options={customerOptions}
            />
          </div>
          <Select label="Source" value={source} onChange={(e) => setSource(e.target.value as OrderSource)} options={SOURCE_OPTIONS} />
        </FormGrid>
        <FormGrid cols={3}>
          <TextField label="Order number" hint="(optional)" value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} placeholder="Next SO number" help="Leave blank for the next SO-xxxx, or type your own (a customer PO, a web order id)." />
        </FormGrid>
        <FormGrid cols={3}>
          <div className="sm:col-span-2">
            <TextField label="Customer email" hint="(optional)" type="email" value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} placeholder="For carrier notifications" />
          </div>
          <div className="flex items-end">
            <Button size="md" variant="plain" icon={<MapPin />} onClick={() => setAddressOpen((v) => !v)}>
              {addressOpen ? "Hide shipping address" : "Add shipping address"}
            </Button>
          </div>
        </FormGrid>
        {addressOpen && (
          <div className="rounded-[var(--radius)] border border-border p-3">
            <FormGrid cols={2}>
              <TextField label="Recipient" value={shipTo.name ?? ""} onChange={setA("name")} placeholder={customer || "Name on the label"} />
              <TextField label="Company" hint="(optional)" value={shipTo.company ?? ""} onChange={setA("company")} />
              <TextField label="Street" value={shipTo.street1} onChange={setA("street1")} />
              <TextField label="Street 2" hint="(optional)" value={shipTo.street2 ?? ""} onChange={setA("street2")} />
              <TextField label="City" value={shipTo.city} onChange={setA("city")} />
              <TextField label="State / region" value={shipTo.state ?? ""} onChange={setA("state")} />
              <TextField label="Postal code" value={shipTo.zip} onChange={setA("zip")} />
              <TextField label="Country" value={shipTo.country} onChange={setA("country")} maxLength={2} help="Two-letter code" />
              <TextField label="Phone" hint="(optional)" value={shipTo.phone ?? ""} onChange={setA("phone")} />
            </FormGrid>
          </div>
        )}

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[12.5px] font-medium text-text">Lines</span>
            {!features.fastLineEntry && (
              <Button size="sm" variant="plain" icon={<Plus />} onClick={addLine}>
                Add line
              </Button>
            )}
          </div>
          <div className="rounded-[var(--radius)] border border-border">
            <div className="hidden grid-cols-[minmax(0,1fr)_84px_120px_100px_32px] gap-2 border-b border-border bg-surface-subdued px-3 py-1.5 text-[12px] font-medium text-text-secondary sm:grid">
              <span>Item</span>
              <span className="text-right">Qty</span>
              <span className="text-right">Unit price</span>
              <span className="text-right">Total</span>
              <span />
            </div>
            {lines.length === 0 ? (
              <div className="px-3 py-6 text-center text-[12.5px] text-text-tertiary">{features.fastLineEntry ? `No lines yet. Type a ${terms.itemCodeShort} below.` : "No lines yet. Add one to get started."}</div>
            ) : (
              lines.map((l) => {
                const q = stockQty(l);
                const short = l.item && Number.isFinite(q) && l.item.onHand < q;
                const units = features.unitConversions && l.item ? unitOptions(l.item) : [];
                const routed = l.item ? routedLocation("fulfill", l.item, locations) : undefined;
                return (
                  <div key={l.key} className="grid grid-cols-1 gap-2 border-b border-border px-3 py-2 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_84px_120px_100px_32px] sm:items-start">
                    <div className="min-w-0">
                      <ItemPicker value={l.item} onChange={(item) => setItem(l.key, item)} filter={(i) => i.status === "active"} placeholder={`Search ${terms.itemCodeShort} or name`} />
                      {l.item && (pickLocation || units.length > 1) && (
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px] text-text-secondary">
                          {pickLocation && (
                            <label className="flex items-center gap-1.5">
                              Ship from
                              <Select
                                aria-label={`Ship ${l.item.sku} from`}
                                value={l.locationId}
                                onChange={(e) => patchLine(l.key, (cur) => ({ ...cur, locationId: e.target.value }))}
                                options={[{ value: "", label: `${(routed ?? home).name} (default)` }, ...locations.filter((loc) => loc.id !== (routed ?? home).id).map((loc) => ({ value: loc.id, label: loc.name }))]}
                                containerClassName="w-44"
                              />
                            </label>
                          )}
                          {units.length > 1 && (
                            <label className="flex items-center gap-1.5">
                              Qty in
                              <Select aria-label={`Unit for ${l.item.sku}`} value={units.some((u) => u.source !== "stock" && u.unit === l.unit) ? l.unit : ""} onChange={(e) => setUnit(l.key, e.target.value)} options={units.map((u) => ({ value: u.source === "stock" ? "" : u.unit, label: u.unit }))} containerClassName="w-28" />
                            </label>
                          )}
                          {l.unit && Number.isFinite(q) && <span className="tabular">= {formatQty(q, l.item.unit || "ea")}{l.item.unit === "ea" || !l.item.unit ? " ea" : ""}</span>}
                        </div>
                      )}
                      {short && l.item && (
                        <p className="mt-1 text-[12px] text-warning">
                          Short by {formatQty(q - l.item.onHand, l.item.unit)} · {formatQty(l.item.onHand, l.item.unit)} on hand
                        </p>
                      )}
                    </div>
                    <div className="grid grid-cols-3 gap-2 sm:contents">
                      <TextField type="number" min={1} step="any" value={l.qty} onChange={(e) => setQty(l.key, e.target.value)} aria-label="Quantity" className="text-right" />
                      <TextField type="number" min={0} step="any" prefix={symbol} value={l.unitPrice} onChange={(e) => setPrice(l.key, e.target.value)} aria-label="Unit price" className="text-right" disabled={!l.item} />
                      <div className={cn("flex h-8 items-center justify-end text-[13px] tabular", l.item ? "text-text" : "text-text-tertiary")}>{l.item ? formatMoney(lineTotal(l), currency) : "—"}</div>
                    </div>
                    <div className="flex justify-end sm:justify-center">
                      <IconButton variant="plain" size="md" onClick={() => removeLine(l.key)} aria-label="Remove line" className="text-text-tertiary hover:text-critical">
                        <Trash2 className="h-3.5 w-3.5" />
                      </IconButton>
                    </div>
                  </div>
                );
              })
            )}
            {features.fastLineEntry && <QuickLineEntry onAdd={addQuick} codeLabel={terms.itemCodeShort} autoFocus={!!customer} />}
            <div className="flex items-center justify-between border-t border-border bg-surface-subdued px-3 py-2 text-[13px]">
              <span className="text-text-secondary">
                {validLines.length} {validLines.length === 1 ? "line" : "lines"}
                {shortLines.length > 0 && <span className="ml-2 text-warning">· {shortLines.length} short on stock</span>}
              </span>
              <span className="font-semibold tabular">{formatMoney(total, currency)}</span>
            </div>
          </div>
        </div>

        <TextArea label="Note" hint="(optional)" value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Gift wrap, ship with SO-1090, etc." />
        <Checkbox
          label="Ship immediately"
          help={shortLines.length > 0 ? "Some lines are short. Shipping will fail until stock is built or received." : "Relieves stock now and marks the order fulfilled."}
          checked={shipNow}
          onChange={setShipNow}
        />
        {error && <p className="text-[12.5px] text-critical">{error}</p>}
      </div>
      <Modal
        open={templateModal}
        onClose={() => setTemplateModal(false)}
        size="sm"
        title={template ? "Update template" : "Save as template"}
        subtitle="Customer, lines and note are kept. Prices you typed by hand are saved; the rest follow today's prices when the template is used."
        footer={
          <>
            <Button onClick={() => setTemplateModal(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => void saveTemplate()} loading={savingTemplate} disabled={!templateName.trim()}>
              {template ? "Update template" : "Save template"}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <TextField label="Template name" value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder={customer ? `${customer} standing order` : "Weekly restock"} autoFocus />
          <TextField label="Description" hint="(optional)" value={templateNote} onChange={(e) => setTemplateNote(e.target.value)} placeholder="When to use it" />
        </div>
      </Modal>
    </Modal>
  );
}
