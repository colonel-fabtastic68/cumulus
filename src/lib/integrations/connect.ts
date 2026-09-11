import type { Integration, IntegrationId, IntegrationSettings } from "@/lib/types";
import { activityOp } from "@/lib/inventory";
import { nowIso } from "@/lib/utils";
import { CARRIERS, isCarrier } from "./carriers";
import { isChannel } from "./channelSync";
import { HttpError, appUrl, deleteSecrets, newToken, readSecrets, writeSecrets, type Secrets, type ServerContext } from "./server";
import * as shopify from "./shopify";
import * as woo from "./woocommerce";

export interface ConnectBody {
  credentials?: Record<string, string>;
  settings?: IntegrationSettings;
}

const NAMES: Record<IntegrationId, string> = { shopify: "Shopify", woocommerce: "WooCommerce", quickbooks: "QuickBooks", square: "Square", shippo: "Shippo", easypost: "EasyPost" };

function clean(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Verifies the credentials against the platform, stores them server-side,
 * registers webhooks and marks the integration connected.
 */
export async function connectIntegration(ctx: ServerContext, req: Request, id: IntegrationId, body: ConnectBody): Promise<Integration> {
  if (!isChannel(id) && !isCarrier(id)) throw new HttpError(501, `${NAMES[id]} is on the roadmap; use the CSV export for now.`);
  const creds = body.credentials ?? {};
  const existing = await ctx.store.get("integrations", id);
  const previous = existing?.status !== "not_connected" ? await readSecrets(ctx, id) : null;
  const settings: IntegrationSettings = { ...(existing?.settings ?? {}), ...(body.settings ?? {}) };
  const config: Record<string, string> = {};
  const secrets: Secrets = { webhookToken: previous?.webhookToken ?? newToken() };
  const base = appUrl(req);
  const webhooks: Array<{ id: string; topic: string }> = [];
  const warnings: string[] = [];

  if (id === "shopify") {
    const shop = shopify.normalizeShop(clean(creds.shop) || existing?.config?.shop || "");
    const accessToken = clean(creds.accessToken) || previous?.accessToken || "";
    if (!accessToken) throw new HttpError(400, "Enter the Admin API access token.");
    const apiSecret = clean(creds.apiSecret) || previous?.apiSecret || "";
    const info = await shopify.verifyShop({ shop, accessToken });
    Object.assign(config, { shop, shopName: info.name, domain: info.domain, currency: info.currency });
    secrets.accessToken = accessToken;
    if (apiSecret) secrets.apiSecret = apiSecret;
    if (!settings.channelLocationId && info.primaryLocationId) settings.channelLocationId = info.primaryLocationId;
    const url = `${base}/api/integrations/shopify/webhook?ws=${encodeURIComponent(ctx.workspaceId)}&t=${secrets.webhookToken}`;
    const topics = ["orders/create", "orders/updated", "orders/cancelled", "products/update", "products/delete", ...(settings.acceptStockFromChannel ? ["inventory_levels/update"] : [])];
    await removeWebhooks(existing, previous, id);
    for (const topic of topics) {
      try {
        webhooks.push({ id: await shopify.createWebhook({ shop, accessToken }, topic, url), topic });
      } catch (e) {
        warnings.push(`Webhook ${topic}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  } else if (id === "woocommerce") {
    const siteUrl = woo.normalizeSiteUrl(clean(creds.siteUrl) || existing?.config?.siteUrl || "");
    const consumerKey = clean(creds.consumerKey) || previous?.consumerKey || "";
    const consumerSecret = clean(creds.consumerSecret) || previous?.consumerSecret || "";
    if (!consumerKey || !consumerSecret) throw new HttpError(400, "Enter the consumer key and consumer secret.");
    const { plainPermalinks } = await woo.detectPermalinks(siteUrl);
    if (plainPermalinks) throw new HttpError(409, woo.PLAIN_PERMALINKS_HELP);
    const authMode = await woo.detectAuthMode({ siteUrl, consumerKey, consumerSecret, plainPermalinks });
    const wc: woo.WooCreds = { siteUrl, consumerKey, consumerSecret, plainPermalinks, authMode };
    const info = await woo.verifySite(wc);
    Object.assign(config, { siteUrl, plainPermalinks: "0", authMode, ...(info.name ? { siteName: info.name } : {}), ...(info.currency ? { currency: info.currency } : {}), ...(info.weightUnit ? { weightUnit: info.weightUnit } : {}), ...(info.version ? { version: info.version } : {}) });
    secrets.consumerKey = consumerKey;
    secrets.consumerSecret = consumerSecret;
    const url = `${base}/api/integrations/woocommerce/webhook?ws=${encodeURIComponent(ctx.workspaceId)}&t=${secrets.webhookToken}`;
    const topics = ["order.created", "order.updated", "product.updated", "product.deleted"];
    await removeWebhooks(existing, previous, id);
    for (const topic of topics) {
      try {
        webhooks.push({ id: await woo.createWebhook(wc, topic, url, secrets.webhookToken), topic });
      } catch (e) {
        warnings.push(`Webhook ${topic}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  } else {
    const token = clean(creds.token) || previous?.token || "";
    if (!token) throw new HttpError(400, `Enter the ${NAMES[id]} API token.`);
    const provider = CARRIERS[id];
    const info = await provider.verify(token);
    if (info.account) config.account = info.account;
    config.mode = /test/i.test(token) || token.startsWith("EZTK") ? "test" : "live";
    secrets.token = token;
    const url = `${base}/api/shipping/webhook/${id}?ws=${encodeURIComponent(ctx.workspaceId)}&t=${secrets.webhookToken}`;
    await removeWebhooks(existing, previous, id);
    try {
      const hookId = await provider.registerWebhook(token, url, secrets.webhookToken);
      if (hookId) webhooks.push({ id: hookId, topic: "tracking" });
    } catch (e) {
      warnings.push(`Tracking webhook: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  await writeSecrets(ctx, id, secrets);
  const now = nowIso();
  const doc: Integration = {
    id,
    status: "connected",
    config,
    settings,
    connectedAt: now,
    connectedBy: ctx.actor.id,
    lastSyncAt: existing?.lastSyncAt,
    lastSyncSummary: existing?.lastSyncSummary,
    lastError: warnings.length ? warnings.join(" · ") : undefined,
    webhooks,
    createdAt: existing?.createdAt ?? now,
  };
  await ctx.store.batch([{ op: "put", collection: "integrations", doc }, activityOp(ctx.actor, "integration.connected", `Connected ${NAMES[id]}${config.shop ? ` (${config.shop})` : config.siteUrl ? ` (${config.siteUrl})` : ""}`, { entityType: "integration", entityId: id })]);
  return doc;
}

async function removeWebhooks(existing: Integration | null, secrets: Secrets | null, id: IntegrationId): Promise<void> {
  if (!existing?.webhooks?.length || !secrets) return;
  for (const hook of existing.webhooks) {
    try {
      if (id === "shopify" && existing.config?.shop && secrets.accessToken) await shopify.deleteWebhook({ shop: existing.config.shop, accessToken: secrets.accessToken }, hook.id);
      else if (id === "woocommerce" && existing.config?.siteUrl && secrets.consumerKey && secrets.consumerSecret) await woo.deleteWebhook({ siteUrl: existing.config.siteUrl, consumerKey: secrets.consumerKey, consumerSecret: secrets.consumerSecret, plainPermalinks: existing.config.plainPermalinks === "1", authMode: (existing.config.authMode as woo.WooAuthMode | undefined) ?? "basic" }, hook.id);
      else if (isCarrier(id) && secrets.token) await CARRIERS[id].removeWebhook(secrets.token, hook.id);
    } catch {
      // Best effort: a webhook that is already gone is fine.
    }
  }
}

/** Removes webhooks on the platform, deletes the stored credentials and marks the integration disconnected. */
export async function disconnectIntegration(ctx: ServerContext, id: IntegrationId): Promise<void> {
  const existing = await ctx.store.get("integrations", id);
  const secrets = await readSecrets(ctx, id);
  await removeWebhooks(existing, secrets, id);
  await deleteSecrets(ctx, id);
  const now = nowIso();
  const doc: Integration = { id, status: "not_connected", config: existing?.config ? { ...(existing.config.shop ? { shop: existing.config.shop } : {}), ...(existing.config.siteUrl ? { siteUrl: existing.config.siteUrl } : {}) } : {}, settings: existing?.settings, webhooks: [], createdAt: existing?.createdAt ?? now };
  await ctx.store.batch([{ op: "put", collection: "integrations", doc }, activityOp(ctx.actor, "integration.disconnected", `Disconnected ${NAMES[id]}`, { entityType: "integration", entityId: id })]);
}

export { NAMES as INTEGRATION_NAMES };
