import type { Address, ParcelDefaults } from "@/lib/types";
import { CARRIERS, isCarrier, type RateQuote } from "@/lib/integrations/carriers";
import { HttpError, authenticate, jsonError, readJson, readSecrets } from "@/lib/integrations/server";

export const maxDuration = 60;

interface RatesBody {
  orderId?: string;
  shipTo: Address;
  parcel: ParcelDefaults;
}

function checkAddress(a: Address | undefined, what: string): Address {
  if (!a || !a.street1?.trim() || !a.city?.trim() || !a.zip?.trim() || !a.country?.trim()) throw new HttpError(400, `The ${what} address needs a street, city, postal code and country.`);
  return { ...a, country: a.country.trim().toUpperCase() };
}

/** Rate-shops the connected carriers for one parcel. */
export async function POST(req: Request) {
  try {
    const ctx = await authenticate(req, { write: true });
    const body = await readJson<RatesBody>(req);
    const settings = await ctx.store.get("settings", "default");
    const from = checkAddress(settings?.shipping?.from, "ship-from");
    const to = checkAddress(body.shipTo, "ship-to");
    const parcel = body.parcel;
    if (!parcel || !(parcel.weight > 0) || !(parcel.length > 0) || !(parcel.width > 0) || !(parcel.height > 0)) throw new HttpError(400, "Enter the parcel's weight and dimensions.");
    const carriers = (await ctx.store.list("integrations")).filter((i) => isCarrier(i.id) && i.status === "connected");
    if (carriers.length === 0) throw new HttpError(409, "Connect Shippo or EasyPost under Integrations first.");
    const results = await Promise.allSettled(
      carriers.map(async (c) => {
        const secrets = await readSecrets(ctx, c.id);
        if (!secrets?.token) throw new HttpError(409, `${c.id} has no stored token; connect it again.`);
        return CARRIERS[c.id as "shippo" | "easypost"].rates(secrets.token, { from, to, parcel });
      }),
    );
    const rates: RateQuote[] = [];
    const errors: string[] = [];
    for (const r of results) {
      if (r.status === "fulfilled") rates.push(...r.value);
      else errors.push(r.reason instanceof Error ? r.reason.message : String(r.reason));
    }
    if (rates.length === 0 && errors.length) throw new HttpError(502, errors.join(" · "));
    rates.sort((a, b) => a.amount - b.amount);
    return Response.json({ rates, errors });
  } catch (e) {
    return jsonError(e);
  }
}
