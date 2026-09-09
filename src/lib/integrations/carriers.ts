import { createHmac } from "node:crypto";
import type { Address, ParcelDefaults, Shipment } from "@/lib/types";
import { HttpError, fetchJson, safeEqual } from "./server";

/**
 * Factor 41: shipping carriers through an aggregator. Shippo and EasyPost each
 * front USPS, UPS, FedEx, DHL and more with one API key, so connecting one of
 * them gives rate shopping, labels and tracking for every carrier on the account.
 */

export type CarrierId = "shippo" | "easypost";

export function isCarrier(id: string): id is CarrierId {
  return id === "shippo" || id === "easypost";
}

export interface RateRequest {
  from: Address;
  to: Address;
  parcel: ParcelDefaults;
}

export interface RateQuote {
  provider: CarrierId;
  rateId: string;
  carrier: string;
  service: string;
  amount: number;
  currency: string;
  days?: number;
}

export interface LabelResult {
  carrier: string;
  service: string;
  trackingNumber: string;
  trackingUrl?: string;
  labelUrl?: string;
  cost?: number;
  currency?: string;
  providerRef: string;
}

export type TrackingStatus = NonNullable<Shipment["trackingStatus"]>;

export interface TrackResult {
  status: string;
  detail?: string;
}

export interface CarrierProvider {
  id: CarrierId;
  verify(token: string): Promise<{ account?: string }>;
  rates(token: string, req: RateRequest): Promise<RateQuote[]>;
  buy(token: string, rateId: string): Promise<LabelResult>;
  track(token: string, shipment: Pick<Shipment, "carrier" | "trackingNumber">): Promise<TrackResult>;
  registerWebhook(token: string, url: string, secret: string): Promise<string | undefined>;
  removeWebhook(token: string, id: string): Promise<void>;
  /** Pulls the tracking number and status out of a webhook delivery, if it carries one. */
  parseWebhook(payload: unknown): { trackingNumber: string; status: string; carrier?: string } | null;
  verifyWebhook?(rawBody: string, headers: Headers, secret: string): boolean;
}

/** Maps a provider's status vocabulary onto one set the UI understands. */
export function normalizeTrackingStatus(raw: string): string {
  const s = raw.toLowerCase();
  if (s.includes("deliver") && !s.includes("out_for")) return "delivered";
  if (s.includes("out_for_delivery")) return "out_for_delivery";
  if (s.includes("transit")) return s.includes("pre") ? "pre_transit" : "in_transit";
  if (s.includes("return")) return "returned";
  if (s.includes("fail") || s.includes("error") || s.includes("cancel")) return "failure";
  if (s.includes("pickup")) return "available_for_pickup";
  if (s === "unknown" || !s) return "unknown";
  return s;
}

// ---- unit helpers ------------------------------------------------------------------

function toOunces(weight: number, unit: ParcelDefaults["massUnit"]): number {
  const factor = { lb: 16, oz: 1, kg: 35.274, g: 0.035274 }[unit] ?? 16;
  return Math.max(0.1, Math.round(weight * factor * 100) / 100);
}

function toInches(value: number, unit: ParcelDefaults["distanceUnit"]): number {
  return Math.round((unit === "cm" ? value / 2.54 : value) * 100) / 100;
}

// ---- Shippo ---------------------------------------------------------------------------

const SHIPPO = "https://api.goshippo.com";

function shippoAddress(a: Address) {
  return { name: a.name || a.company || "Recipient", company: a.company, street1: a.street1, street2: a.street2, city: a.city, state: a.state, zip: a.zip, country: a.country, phone: a.phone, email: a.email };
}

async function shippoRequest<T>(token: string, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const { data } = await fetchJson<T>(`${SHIPPO}${path}`, {
    method: init.method ?? "GET",
    headers: { Authorization: `ShippoToken ${token}`, "Content-Type": "application/json", Accept: "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  return data;
}

interface ShippoRate {
  object_id: string;
  provider: string;
  servicelevel: { name: string; token: string };
  amount: string;
  currency: string;
  estimated_days?: number | null;
}

const shippo: CarrierProvider = {
  id: "shippo",
  async verify(token) {
    const res = await shippoRequest<{ results?: Array<{ carrier: string }> }>(token, "/carrier_accounts/?results=5");
    const carriers = (res.results ?? []).map((c) => c.carrier).filter(Boolean);
    return { account: carriers.length ? `Carriers: ${Array.from(new Set(carriers)).join(", ")}` : "Connected" };
  },
  async rates(token, req) {
    const shipment = await shippoRequest<{ rates: ShippoRate[]; messages?: Array<{ text?: string }>; status?: string }>(token, "/shipments/", {
      method: "POST",
      body: {
        address_from: shippoAddress(req.from),
        address_to: shippoAddress(req.to),
        parcels: [{ length: String(req.parcel.length), width: String(req.parcel.width), height: String(req.parcel.height), distance_unit: req.parcel.distanceUnit, weight: String(req.parcel.weight), mass_unit: req.parcel.massUnit }],
        async: false,
      },
    });
    if (!shipment.rates?.length && shipment.messages?.length) throw new HttpError(422, shipment.messages.map((m) => m.text).filter(Boolean).join(" ") || "Shippo returned no rates");
    return (shipment.rates ?? []).map((r) => ({ provider: "shippo" as const, rateId: r.object_id, carrier: r.provider, service: r.servicelevel?.name ?? r.servicelevel?.token ?? "", amount: Number(r.amount), currency: r.currency, days: r.estimated_days ?? undefined }));
  },
  async buy(token, rateId) {
    const tx = await shippoRequest<{ object_id: string; status: string; label_url?: string; tracking_number?: string; tracking_url_provider?: string; rate?: string | ShippoRate; messages?: Array<{ text?: string }> }>(token, "/transactions/", { method: "POST", body: { rate: rateId, label_file_type: "PDF", async: false } });
    if (tx.status !== "SUCCESS" || !tx.tracking_number) throw new HttpError(422, tx.messages?.map((m) => m.text).filter(Boolean).join(" ") || `Shippo could not buy the label (${tx.status})`);
    const rate = typeof tx.rate === "object" && tx.rate ? tx.rate : await shippoRequest<ShippoRate>(token, `/rates/${rateId}/`);
    return { carrier: rate.provider, service: rate.servicelevel?.name ?? "", trackingNumber: tx.tracking_number, trackingUrl: tx.tracking_url_provider, labelUrl: tx.label_url, cost: Number(rate.amount), currency: rate.currency, providerRef: tx.object_id };
  },
  async track(token, shipment) {
    if (!shipment.trackingNumber) throw new HttpError(400, "No tracking number");
    const carrier = (shipment.carrier ?? "").toLowerCase().replace(/\s+/g, "_");
    if (!carrier) throw new HttpError(400, "No carrier on the shipment");
    const res = await shippoRequest<{ tracking_status?: { status?: string; status_details?: string } | null }>(token, `/tracks/${encodeURIComponent(carrier)}/${encodeURIComponent(shipment.trackingNumber)}/`);
    return { status: normalizeTrackingStatus(res.tracking_status?.status ?? "unknown"), detail: res.tracking_status?.status_details };
  },
  async registerWebhook(token, url) {
    const res = await shippoRequest<{ object_id?: string }>(token, "/webhooks/", { method: "POST", body: { url, event: "track_updated", is_test: false, active: true } });
    return res.object_id;
  },
  async removeWebhook(token, id) {
    await shippoRequest(token, `/webhooks/${id}/`, { method: "DELETE" });
  },
  parseWebhook(payload) {
    const p = payload as { event?: string; data?: { tracking_number?: string; carrier?: string; tracking_status?: { status?: string } } } | null;
    if (!p?.data?.tracking_number) return null;
    return { trackingNumber: p.data.tracking_number, status: normalizeTrackingStatus(p.data.tracking_status?.status ?? "unknown"), carrier: p.data.carrier };
  },
};

// ---- EasyPost ----------------------------------------------------------------------

const EASYPOST = "https://api.easypost.com/v2";

function easypostAddress(a: Address) {
  return { name: a.name || a.company || "Recipient", company: a.company, street1: a.street1, street2: a.street2, city: a.city, state: a.state, zip: a.zip, country: a.country, phone: a.phone, email: a.email };
}

async function easypostRequest<T>(token: string, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const { data } = await fetchJson<T>(`${EASYPOST}${path}`, {
    method: init.method ?? "GET",
    headers: { Authorization: `Basic ${Buffer.from(`${token}:`).toString("base64")}`, "Content-Type": "application/json", Accept: "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  return data;
}

interface EasyPostRate {
  id: string;
  carrier: string;
  service: string;
  rate: string;
  currency: string;
  delivery_days?: number | null;
}

const easypost: CarrierProvider = {
  id: "easypost",
  async verify(token) {
    const res = await easypostRequest<{ carrier_accounts?: Array<{ readable?: string }> } | Array<{ readable?: string }>>(token, "/carrier_accounts");
    const list = Array.isArray(res) ? res : (res.carrier_accounts ?? []);
    const names = list.map((c) => c.readable).filter(Boolean) as string[];
    return { account: names.length ? `Carriers: ${Array.from(new Set(names)).join(", ")}` : "Connected" };
  },
  async rates(token, req) {
    const shipment = await easypostRequest<{ id: string; rates: EasyPostRate[]; messages?: Array<{ message?: string }> }>(token, "/shipments", {
      method: "POST",
      body: {
        shipment: {
          to_address: easypostAddress(req.to),
          from_address: easypostAddress(req.from),
          parcel: { length: toInches(req.parcel.length, req.parcel.distanceUnit), width: toInches(req.parcel.width, req.parcel.distanceUnit), height: toInches(req.parcel.height, req.parcel.distanceUnit), weight: toOunces(req.parcel.weight, req.parcel.massUnit) },
        },
      },
    });
    if (!shipment.rates?.length && shipment.messages?.length) throw new HttpError(422, shipment.messages.map((m) => m.message).filter(Boolean).join(" ") || "EasyPost returned no rates");
    // The shipment id travels inside the rate id so the buy call can find it again.
    return (shipment.rates ?? []).map((r) => ({ provider: "easypost" as const, rateId: `${shipment.id}:${r.id}`, carrier: r.carrier, service: r.service.replace(/([a-z])([A-Z])/g, "$1 $2"), amount: Number(r.rate), currency: r.currency, days: r.delivery_days ?? undefined }));
  },
  async buy(token, rateId) {
    const [shipmentId, rate] = rateId.split(":");
    if (!shipmentId || !rate) throw new HttpError(400, "Malformed rate id");
    const bought = await easypostRequest<{ id: string; tracking_code?: string; postage_label?: { label_url?: string }; tracker?: { public_url?: string }; selected_rate?: EasyPostRate }>(token, `/shipments/${shipmentId}/buy`, { method: "POST", body: { rate: { id: rate } } });
    if (!bought.tracking_code) throw new HttpError(422, "EasyPost did not return a tracking code");
    return { carrier: bought.selected_rate?.carrier ?? "", service: bought.selected_rate?.service ?? "", trackingNumber: bought.tracking_code, trackingUrl: bought.tracker?.public_url, labelUrl: bought.postage_label?.label_url, cost: bought.selected_rate ? Number(bought.selected_rate.rate) : undefined, currency: bought.selected_rate?.currency, providerRef: bought.id };
  },
  async track(token, shipment) {
    if (!shipment.trackingNumber) throw new HttpError(400, "No tracking number");
    const res = await easypostRequest<{ trackers?: Array<{ status?: string; status_detail?: string }> }>(token, `/trackers?tracking_code=${encodeURIComponent(shipment.trackingNumber)}&page_size=1`);
    const t = res.trackers?.[0];
    if (!t) {
      const created = await easypostRequest<{ status?: string; status_detail?: string }>(token, "/trackers", { method: "POST", body: { tracker: { tracking_code: shipment.trackingNumber, carrier: shipment.carrier } } });
      return { status: normalizeTrackingStatus(created.status ?? "unknown"), detail: created.status_detail };
    }
    return { status: normalizeTrackingStatus(t.status ?? "unknown"), detail: t.status_detail };
  },
  async registerWebhook(token, url, secret) {
    const res = await easypostRequest<{ id?: string }>(token, "/webhooks", { method: "POST", body: { webhook: { url, webhook_secret: secret } } });
    return res.id;
  },
  async removeWebhook(token, id) {
    await easypostRequest(token, `/webhooks/${id}`, { method: "DELETE" });
  },
  parseWebhook(payload) {
    const p = payload as { description?: string; result?: { object?: string; tracking_code?: string; status?: string; carrier?: string } } | null;
    if (!p?.result?.tracking_code) return null;
    return { trackingNumber: p.result.tracking_code, status: normalizeTrackingStatus(p.result.status ?? "unknown"), carrier: p.result.carrier };
  },
  verifyWebhook(rawBody, headers, secret) {
    const header = headers.get("x-hmac-signature");
    if (!header) return true; // older accounts deliver unsigned; the URL token still gates it
    const expected = `hmac-sha256-hex=${createHmac("sha256", Buffer.from(secret, "utf8")).update(rawBody, "utf8").digest("hex")}`;
    return safeEqual(expected, header);
  },
};

export const CARRIERS: Record<CarrierId, CarrierProvider> = { shippo, easypost };
