"use client";

import { useMemo, useState } from "react";
import { PackageCheck, RefreshCw, Truck } from "lucide-react";
import type { Address, ParcelDefaults, SalesOrder, Shipment } from "@/lib/types";
import { openQty, qtyAt, shipOrder } from "@/lib/inventory";
import { useDefaultLocation, useLocations } from "@/lib/locations";
import { useCollection, useItemsById, useSettings, useStore } from "@/lib/store/provider";
import { useCurrentUser } from "@/lib/auth";
import { useApi } from "@/lib/api-client";
import { useSession } from "@/lib/session";
import { formatMoney, formatQty, pluralize } from "@/lib/format";
import { round } from "@/lib/utils";
import { Badge, Banner, Button, FormGrid, Modal, Segmented, Select, SimpleTable, TextField, useToast } from "@/components/ui";

export interface CarrierRate {
  provider: "shippo" | "easypost";
  rateId: string;
  carrier: string;
  service: string;
  amount: number;
  currency: string;
  days?: number;
}

type Mode = "manual" | "label";

const EMPTY_ADDRESS: Address = { name: "", company: "", street1: "", street2: "", city: "", state: "", zip: "", country: "US", phone: "", email: "" };

interface ShipOrderModalProps {
  order: SalesOrder | null;
  onClose: () => void;
  onShipped?: (shipment: Shipment) => void;
}

/** Factor 34 and 41: ship all or part of an order, by hand or with a carrier label. */
export function ShipOrderModal({ order, ...rest }: ShipOrderModalProps) {
  if (!order) return null;
  return <ShipForm key={order.id} order={order} {...rest} />;
}

function ShipForm({ order, onClose, onShipped }: ShipOrderModalProps & { order: SalesOrder }) {
  const store = useStore();
  const user = useCurrentUser();
  const toast = useToast();
  const api = useApi();
  const { mode: sessionMode } = useSession();
  const itemsById = useItemsById();
  const settings = useSettings();
  const integrations = useCollection("integrations");
  const locations = useLocations();
  const home = useDefaultLocation();
  const carriersConnected = integrations.filter((i) => (i.id === "shippo" || i.id === "easypost") && i.status === "connected");

  const [locationId, setLocationId] = useState(home.id);
  const openLines = useMemo(() => order.lines.filter((l) => openQty(l) > 0), [order]);
  const [qtys, setQtys] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const l of openLines) {
      const item = itemsById.get(l.itemId);
      const available = item ? qtyAt(item, home.id, home.id) : 0;
      out[l.itemId] = String(Math.max(0, Math.min(openQty(l), available)));
    }
    return out;
  });
  const [mode, setMode] = useState<Mode>(carriersConnected.length ? "label" : "manual");
  const [carrier, setCarrier] = useState("");
  const [tracking, setTracking] = useState("");
  const [trackingUrl, setTrackingUrl] = useState("");
  const [shipTo, setShipTo] = useState<Address>({ ...EMPTY_ADDRESS, ...(order.shipTo ?? {}), name: order.shipTo?.name ?? order.customer });
  const [parcel, setParcel] = useState<ParcelDefaults>(() => defaultParcel(order, itemsById, settings.shipping?.parcel));
  const [rates, setRates] = useState<CarrierRate[] | null>(null);
  const [rateId, setRateId] = useState<string | null>(null);
  const [busy, setBusy] = useState<"rates" | "ship" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const availableAt = (itemId: string) => {
    const item = itemsById.get(itemId);
    return item ? qtyAt(item, locationId, home.id) : 0;
  };
  const lines = openLines.map((l) => ({ itemId: l.itemId, qty: Number(qtys[l.itemId] ?? 0) })).filter((l) => Number.isFinite(l.qty) && l.qty > 0);
  const units = lines.reduce((a, l) => a + l.qty, 0);
  const leavesOpen = openLines.some((l) => openQty(l) > (Number(qtys[l.itemId]) || 0));
  const addressComplete = !!(shipTo.street1.trim() && shipTo.city.trim() && shipTo.zip.trim() && shipTo.country.trim());
  const setA = (k: keyof Address) => (e: React.ChangeEvent<HTMLInputElement>) => setShipTo((a) => ({ ...a, [k]: e.target.value }));

  const validate = (): string | null => {
    if (lines.length === 0) return "Enter a quantity for at least one line";
    for (const l of lines) {
      const line = openLines.find((x) => x.itemId === l.itemId)!;
      const item = itemsById.get(l.itemId);
      if (l.qty > openQty(line)) return `${item?.sku ?? l.itemId}: only ${openQty(line)} is open`;
      if (l.qty > availableAt(l.itemId)) return `${item?.sku ?? l.itemId}: only ${formatQty(availableAt(l.itemId), item?.unit)} at ${locations.find((x) => x.id === locationId)?.name ?? "this location"}`;
    }
    return null;
  };

  const saveAddress = async () => {
    if (!addressComplete) return;
    const clean: Address = { ...shipTo, country: shipTo.country.toUpperCase() };
    for (const k of Object.keys(clean) as Array<keyof Address>) if (clean[k] === "") delete clean[k];
    if (JSON.stringify(clean) !== JSON.stringify(order.shipTo ?? {})) await store.patch("orders", order.id, { shipTo: clean }).catch(() => {});
    return clean;
  };

  const getRates = async () => {
    setError(null);
    if (!addressComplete) return setError("Enter the full ship-to address first");
    if (!settings.shipping?.from) return setError("Add a ship-from address under Settings → Shipping and scanning first");
    setBusy("rates");
    try {
      const res = await api<{ rates: CarrierRate[] }>("/api/shipping/rates", { orderId: order.id, shipTo, parcel });
      setRates(res.rates);
      setRateId(res.rates[0]?.rateId ?? null);
      if (res.rates.length === 0) setError("The carrier returned no rates for this parcel and address");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not fetch rates");
    } finally {
      setBusy(null);
    }
  };

  const ship = async () => {
    const problem = validate();
    if (problem) return setError(problem);
    setBusy("ship");
    setError(null);
    try {
      const address = await saveAddress();
      if (mode === "label") {
        const rate = rates?.find((r) => r.rateId === rateId);
        if (!rate) throw new Error("Pick a rate first");
        const res = await api<{ shipment: Shipment }>("/api/shipping/buy", { orderId: order.id, provider: rate.provider, rateId: rate.rateId, lines, locationId, shipTo: address });
        toast(`Label bought · ${res.shipment.carrier ?? rate.carrier} ${res.shipment.trackingNumber ?? ""}`.trim(), "success");
        onShipped?.(res.shipment);
      } else {
        const { shipment } = await shipOrder(store, user, { orderId: order.id, lines, locationId, carrier: carrier.trim() || undefined, trackingNumber: tracking.trim() || undefined, trackingUrl: trackingUrl.trim() || undefined });
        toast(leavesOpen ? `Shipped ${units} units on ${order.number}; the rest stays backordered` : `Shipped ${order.number}`, "success");
        onShipped?.(shipment);
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not ship");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={
        <span className="inline-flex items-center gap-2">
          Ship <span className="font-mono">{order.number}</span>
          {leavesOpen && units > 0 && <Badge tone="warning">Partial</Badge>}
        </span>
      }
      subtitle={order.customer}
      footer={
        <>
          <div className="mr-auto text-[12.5px] text-text-secondary">{units > 0 ? `${units} units on ${pluralize(lines.length, "line")}${leavesOpen ? " · rest stays open" : ""}` : "Nothing selected"}</div>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={mode === "label" ? <Truck /> : <PackageCheck />} onClick={() => void ship()} loading={busy === "ship"} disabled={units === 0 || (mode === "label" && !rateId)}>
            {mode === "label" ? "Buy label and ship" : "Ship"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {locations.length > 1 && <Select label="Ship from" value={locationId} onChange={(e) => setLocationId(e.target.value)} options={locations.map((l) => ({ value: l.id, label: l.name }))} />}
        <SimpleTable>
          <thead>
            <tr>
              <th>SKU</th>
              <th className="text-right">Open</th>
              <th className="text-right">Available</th>
              <th className="text-right">Ship now</th>
            </tr>
          </thead>
          <tbody>
            {openLines.map((l) => {
              const item = itemsById.get(l.itemId);
              const available = availableAt(l.itemId);
              const short = available < openQty(l);
              return (
                <tr key={l.itemId}>
                  <td>
                    <div className="font-mono text-[12px]">{item?.sku ?? l.itemId}</div>
                    <div className="truncate text-[12px] text-text-secondary">{item?.name}</div>
                  </td>
                  <td className="text-right tabular">{formatQty(openQty(l), item?.unit)}</td>
                  <td className={`text-right tabular ${short ? "font-medium text-warning" : ""}`}>{formatQty(available, item?.unit)}</td>
                  <td className="text-right">
                    <TextField type="number" min={0} max={Math.min(openQty(l), available)} step="any" value={qtys[l.itemId] ?? ""} onChange={(e) => setQtys((q) => ({ ...q, [l.itemId]: e.target.value }))} aria-label={`Ship ${item?.sku ?? ""}`} className="w-24 text-right" containerClassName="ml-auto w-24" />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </SimpleTable>
        {leavesOpen && <p className="text-[12px] text-text-secondary">Lines not shipped in full stay open as backorders and show on the Backorders report until stock arrives.</p>}

        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-[13px] font-semibold text-text">Carrier</span>
            <Segmented<Mode> value={mode} onChange={setMode} options={[{ value: "manual", label: "Enter tracking" }, { value: "label", label: carriersConnected.length ? "Buy a label" : "Buy a label (connect a carrier)" }]} />
          </div>
          {mode === "manual" ? (
            <FormGrid cols={3}>
              <TextField label="Carrier" hint="(optional)" value={carrier} onChange={(e) => setCarrier(e.target.value)} placeholder="UPS, USPS, own truck" />
              <TextField label="Tracking number" hint="(optional)" value={tracking} onChange={(e) => setTracking(e.target.value)} />
              <TextField label="Tracking link" hint="(optional)" value={trackingUrl} onChange={(e) => setTrackingUrl(e.target.value)} placeholder="https://" />
            </FormGrid>
          ) : carriersConnected.length === 0 ? (
            <Banner tone="info">
              {sessionMode === "firestore" ? "Connect Shippo or EasyPost under Integrations to rate-shop and buy labels here." : "Carrier labels need Firestore mode; this install is local. Enter the tracking number by hand instead."}
            </Banner>
          ) : (
            <div className="flex flex-col gap-3">
              <FormGrid cols={2}>
                <TextField label="Name" value={shipTo.name ?? ""} onChange={setA("name")} />
                <TextField label="Company" value={shipTo.company ?? ""} onChange={setA("company")} />
                <TextField label="Street" value={shipTo.street1} onChange={setA("street1")} />
                <TextField label="Street 2" value={shipTo.street2 ?? ""} onChange={setA("street2")} />
                <TextField label="City" value={shipTo.city} onChange={setA("city")} />
                <TextField label="State / region" value={shipTo.state ?? ""} onChange={setA("state")} />
                <TextField label="Postal code" value={shipTo.zip} onChange={setA("zip")} />
                <TextField label="Country" value={shipTo.country} onChange={setA("country")} maxLength={2} />
                <TextField label="Phone" value={shipTo.phone ?? ""} onChange={setA("phone")} />
                <TextField label="Email" value={shipTo.email ?? ""} onChange={setA("email")} />
              </FormGrid>
              <FormGrid cols={4}>
                <TextField label={`Weight (${parcel.massUnit})`} type="number" min={0} step="any" value={String(parcel.weight)} onChange={(e) => setParcel((p) => ({ ...p, weight: Number(e.target.value) || 0 }))} />
                <TextField label={`Length (${parcel.distanceUnit})`} type="number" min={0} step="any" value={String(parcel.length)} onChange={(e) => setParcel((p) => ({ ...p, length: Number(e.target.value) || 0 }))} />
                <TextField label="Width" type="number" min={0} step="any" value={String(parcel.width)} onChange={(e) => setParcel((p) => ({ ...p, width: Number(e.target.value) || 0 }))} />
                <TextField label="Height" type="number" min={0} step="any" value={String(parcel.height)} onChange={(e) => setParcel((p) => ({ ...p, height: Number(e.target.value) || 0 }))} />
              </FormGrid>
              <div>
                <Button icon={<RefreshCw />} onClick={() => void getRates()} loading={busy === "rates"} disabled={!addressComplete}>
                  {rates ? "Refresh rates" : "Get rates"}
                </Button>
              </div>
              {rates && rates.length > 0 && (
                <ul className="divide-y divide-border rounded-[var(--radius)] border border-border">
                  {rates.map((r) => (
                    <li key={`${r.provider}-${r.rateId}`}>
                      <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-[13px]">
                        <input type="radio" name="rate" checked={rateId === r.rateId} onChange={() => setRateId(r.rateId)} className="accent-[var(--accent)]" />
                        <span className="min-w-0 flex-1">
                          <span className="font-medium text-text">{r.carrier}</span> <span className="text-text-secondary">{r.service}</span>
                          {r.days !== undefined && <span className="text-text-tertiary"> · {pluralize(r.days, "day")}</span>}
                        </span>
                        <span className="tabular font-medium">{formatMoney(r.amount, r.currency)}</span>
                        <Badge>{r.provider === "shippo" ? "Shippo" : "EasyPost"}</Badge>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
        {error && <Banner tone="critical">{error}</Banner>}
      </div>
    </Modal>
  );
}

/** Weight from the items when they all carry one, else the workspace default parcel. */
function defaultParcel(order: SalesOrder, itemsById: Map<string, { weight?: number; weightUnit?: string; dimensions?: { length?: number; width?: number; height?: number; unit?: string } }>, fallback?: ParcelDefaults): ParcelDefaults {
  const base: ParcelDefaults = fallback ?? { length: 12, width: 9, height: 4, distanceUnit: "in", weight: 1, massUnit: "lb" };
  let weight = 0;
  let all = true;
  for (const l of order.lines) {
    const item = itemsById.get(l.itemId);
    const open = openQty(l);
    if (!item?.weight) {
      all = false;
      break;
    }
    const unit = (item.weightUnit ?? base.massUnit) as ParcelDefaults["massUnit"];
    const factor = unit === base.massUnit ? 1 : unit === "kg" && base.massUnit === "lb" ? 2.20462 : unit === "lb" && base.massUnit === "kg" ? 0.453592 : unit === "oz" && base.massUnit === "lb" ? 1 / 16 : unit === "g" && base.massUnit === "kg" ? 1 / 1000 : 1;
    weight += item.weight * factor * open;
  }
  return all && weight > 0 ? { ...base, weight: round(weight, 2) } : base;
}
