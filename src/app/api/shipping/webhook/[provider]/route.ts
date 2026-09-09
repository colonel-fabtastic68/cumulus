import { CARRIERS, isCarrier } from "@/lib/integrations/carriers";
import { readSecrets, safeEqual, systemContext } from "@/lib/integrations/server";
import { applyTracking } from "@/lib/integrations/tracking";

export const maxDuration = 30;

/** Tracking updates pushed by Shippo or EasyPost. The URL token gates it; EasyPost deliveries are also HMAC-checked. */
export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  if (!isCarrier(provider)) return new Response("Unknown provider", { status: 404 });
  const url = new URL(req.url);
  const ws = url.searchParams.get("ws") ?? "";
  const token = url.searchParams.get("t") ?? "";
  if (!ws || !token || !/^[A-Za-z0-9_-]{1,128}$/.test(ws)) return new Response("Unauthorized", { status: 401 });
  const raw = await req.text();
  let ctx;
  try {
    ctx = systemContext(ws);
  } catch (e) {
    return new Response(e instanceof Error ? e.message : "Unavailable", { status: 503 });
  }
  const secrets = await readSecrets(ctx, provider);
  if (!secrets?.webhookToken || !safeEqual(secrets.webhookToken, token)) return new Response("Unauthorized", { status: 401 });
  const carrier = CARRIERS[provider];
  if (carrier.verifyWebhook && !carrier.verifyWebhook(raw, req.headers, secrets.webhookToken)) return new Response("Bad signature", { status: 401 });
  let payload: unknown;
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }
  const update = carrier.parseWebhook(payload);
  if (!update) return Response.json({ ok: true, outcome: "ignored" });
  const shipment = (await ctx.store.list("shipments")).find((s) => s.trackingNumber === update.trackingNumber);
  if (!shipment) return Response.json({ ok: true, outcome: "no matching shipment" });
  if (shipment.trackingStatus !== update.status) await applyTracking(ctx, shipment, update.status);
  return Response.json({ ok: true, outcome: `${shipment.number} ${update.status}` });
}
