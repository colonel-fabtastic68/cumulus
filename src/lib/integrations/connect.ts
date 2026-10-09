import type { Integration, IntegrationId, IntegrationSettings } from "@/lib/types";
import { activityOp } from "@/lib/inventory";
import { nowIso } from "@/lib/utils";
import { CARRIERS, isCarrier } from "./carriers";
import { isChannel } from "./channelSync";
import { HttpError, appUrl, deleteSecrets, newToken, readSecrets, writeSecrets, type Secrets, type ServerContext } from "./server";
import { hasFeature } from "@/lib/instances";
import * as qbo from "./quickbooks";
import * as square from "./square";
import * as clover from "./clover";
import * as shopify from "./shopify";
import { freshShopifySecrets } from "./shopifyOAuth";
import * as woo from "./woocommerce";

export interface ConnectBody {
  credentials?: Record<string, string>;
  settings?: IntegrationSettings;
}

const NAMES: Record<IntegrationId, string> = { shopify: "Shopify", woocommerce: "WooCommerce", quickbooks: "QuickBooks", square: "Square", clover: "Clover", shippo: "Shippo", easypost: "EasyPost" };

function clean(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Verifies the credentials against the platform, stores them server-side,
 * registers webhooks and marks the integration connected.
 */
export async function connectIntegration(ctx: ServerContext, req: Request, id: IntegrationId, body: ConnectBody): Promise<Integration> {
  assertIntegrationAllowed(ctx, id);
  if (id === "quickbooks") return reconnectQuickbooks(ctx, body);
  if (id === "square") return reconnectSquare(ctx, body, req);
  if (id === "clover") return reconnectClover(ctx, body);
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
    // A reconnect with no new token reuses the stored one, refreshed first when it is an expiring one.
    const reused = !clean(creds.accessToken) && previous?.accessToken && existing?.config?.shop === shop ? await freshShopifySecrets(ctx, existing, previous) : null;
    const accessToken = clean(creds.accessToken) || reused?.accessToken || "";
    if (!accessToken) throw new HttpError(400, "Enter the Admin API access token.");
    const apiSecret = clean(creds.apiSecret) || previous?.apiSecret || "";
    const info = await shopify.verifyShop({ shop, accessToken });
    Object.assign(config, { shop, shopName: info.name, domain: info.domain, currency: info.currency });
    secrets.accessToken = accessToken;
    for (const k of ["refreshToken", "accessTokenExpiresAt", "refreshTokenExpiresAt"] as const) {
      const v = clean(creds[k]) || (reused ?? previous)?.[k] || "";
      if (v) secrets[k] = v;
    }
    if (apiSecret) secrets.apiSecret = apiSecret;
    if (!settings.channelLocationId && info.primaryLocationId) settings.channelLocationId = info.primaryLocationId;
    const url = `${base}/api/integrations/shopify/webhook?ws=${encodeURIComponent(ctx.workspaceId)}&t=${secrets.webhookToken}`;
    const topics = ["orders/create", "orders/updated", "orders/cancelled", "products/update", "products/delete"];
    await removeWebhooks(existing, reused ?? previous, id);
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
    // A ranch instance drives products from its pack listings, so only orders come back from the store.
    const topics = hasFeature(ctx.instance, "ranch") ? ["order.created", "order.updated"] : ["order.created", "order.updated", "product.updated", "product.deleted"];
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

/**
 * QuickBooks connects through OAuth (see /api/integrations/quickbooks/authorize),
 * so "connect" here re-checks the stored tokens against the company and
 * saves any settings changes; it never takes credentials from the browser.
 */
async function reconnectQuickbooks(ctx: ServerContext, body: ConnectBody): Promise<Integration> {
  const existing = await ctx.store.get("integrations", "quickbooks");
  const pastedRefresh = clean(body.credentials?.refreshToken);
  const pastedRealm = clean(body.credentials?.realmId);
  if (pastedRefresh || pastedRealm) {
    // Sandbox-only: a refresh token minted by Intuit's OAuth playground for this app, while the hosted consent page is unavailable.
    const config = qbo.requireQuickbooksConfig();
    if (config.environment !== "sandbox") throw new HttpError(400, "Pasting playground tokens only works with sandbox keys. Use Connect to QuickBooks.");
    if (!pastedRefresh || !/^\d{1,32}$/.test(pastedRealm)) throw new HttpError(400, "Enter both the refresh token and the realm (company) id from the playground.");
    await writeSecrets(ctx, "quickbooks", qbo.secretsFromRefreshToken(pastedRefresh, pastedRealm, config.environment));
  }
  const { company, secrets } = await qbo.verifyConnection(ctx);
  const now = nowIso();
  const doc: Integration = {
    id: "quickbooks",
    status: "connected",
    config: { ...(existing?.config ?? {}), realmId: secrets.realmId, companyName: company.CompanyName, environment: secrets.environment ?? "sandbox", ...(company.Country ? { country: company.Country } : {}) },
    settings: { ...(existing?.settings ?? {}), ...(body.settings ?? {}) },
    connectedAt: pastedRefresh ? now : (existing?.connectedAt ?? now),
    connectedBy: pastedRefresh ? ctx.actor.id : (existing?.connectedBy ?? ctx.actor.id),
    lastSyncAt: existing?.lastSyncAt,
    lastSyncSummary: existing?.lastSyncSummary,
    webhooks: [],
    createdAt: existing?.createdAt ?? now,
  };
  await ctx.store.put("integrations", doc);
  return doc;
}

/**
 * Square connects either through OAuth (see /api/integrations/square/authorize)
 * or with the access token of an application the seller creates in their own
 * Developer Console, pasted here. Without a pasted token, "connect" re-checks
 * the stored credentials and saves settings.
 */
async function reconnectSquare(ctx: ServerContext, body: ConnectBody, req: Request): Promise<Integration> {
  const existing = await ctx.store.get("integrations", "square");
  const pasted = clean(body.credentials?.accessToken);
  const now = nowIso();
  let merchant: square.SquareMerchant;
  let locations: square.SquareLocation[];
  let environment: string;
  let auth: "oauth" | "token";
  if (pasted) {
    const env: square.SquareEnvironment = /^sand/i.test(clean(body.credentials?.environment)) ? "sandbox" : "production";
    ({ merchant, locations } = await square.verifySquareAccessToken(env, pasted));
    // The seller's own application: nothing to refresh, revoked from their Developer Console. A previous OAuth grant is replaced.
    const previous = await readSecrets(ctx, "square");
    if (previous?.refreshToken && previous.accessToken) {
      const config = square.squareConfig();
      if (config) await square.revokeSquare(config, previous).catch((e) => console.warn("[square] revoke failed:", e instanceof Error ? e.message : e));
    }
    // A ranch instance's live-count subscription is carried over so the new connection replaces it rather than adding a second.
    await writeSecrets(ctx, "square", { accessToken: pasted, environment: env, tokenKind: "personal", ...(previous?.webhookSubscriptionId ? { webhookSubscriptionId: previous.webhookSubscriptionId } : {}) });
    environment = env;
    auth = "token";
  } else {
    const verified = await square.verifySquareConnection(ctx);
    ({ merchant, locations } = verified);
    environment = verified.secrets.environment ?? "sandbox";
    auth = square.isPersonalToken(verified.secrets) ? "token" : "oauth";
  }
  const active = locations.filter((l) => l.status !== "INACTIVE");
  const doc: Integration = {
    id: "square",
    status: "connected",
    config: { ...(existing?.config ?? {}), merchantId: merchant.id, businessName: merchant.business_name ?? merchant.id, environment, auth, locationIds: active.map((l) => l.id).join(","), locationNames: active.map((l) => l.name ?? l.id).join(", "), ...(merchant.currency ? { currency: merchant.currency } : {}), ...(merchant.country ? { country: merchant.country } : {}) },
    settings: { ...(existing?.settings ?? {}), ...(body.settings ?? {}) },
    connectedAt: pasted ? now : (existing?.connectedAt ?? now),
    connectedBy: pasted ? ctx.actor.id : (existing?.connectedBy ?? ctx.actor.id),
    lastSyncAt: existing?.lastSyncAt,
    lastSyncSummary: existing?.lastSyncSummary,
    webhooks: [],
    createdAt: existing?.createdAt ?? now,
  };
  if (hasFeature(ctx.instance, "ranch")) await subscribeRanchSquare(ctx, req, doc, merchant, active);
  if (pasted) await ctx.store.batch([{ op: "put", collection: "integrations", doc }, activityOp(ctx.actor, "integration.connected", `Connected Square (${doc.config!.businessName})`, { entityType: "integration", entityId: "square" })]);
  else await ctx.store.put("integrations", doc);
  return doc;
}

/**
 * Ranch instances count and sell from one Square location and hear about
 * count changes as they happen: the seller's own application (a pasted
 * personal token; Square only lets an app's own token manage its webhooks)
 * subscribes to inventory.count.updated, delivered to this instance's host.
 * Without a subscription the daily pass and Sync now still mirror the counts.
 */
async function subscribeRanchSquare(ctx: ServerContext, req: Request, doc: Integration, merchant: square.SquareMerchant, active: square.SquareLocation[]): Promise<void> {
  const config = doc.config!;
  if (!config.ranchLocationId || !active.some((l) => l.id === config.ranchLocationId)) {
    config.ranchLocationId = (merchant.main_location_id && active.some((l) => l.id === merchant.main_location_id) ? merchant.main_location_id : active[0]?.id) ?? "";
  }
  const secrets = await readSecrets(ctx, "square");
  if (!secrets?.accessToken || !square.isPersonalToken(secrets)) {
    doc.lastError = "Live Square updates need your own Square application's access token; counts update on Sync now and the daily pass until then.";
    return;
  }
  const environment = (secrets.environment as square.SquareEnvironment | undefined) ?? "production";
  if (secrets.webhookSubscriptionId) await square.deleteWebhookSubscription(environment, secrets.accessToken, secrets.webhookSubscriptionId).catch(() => undefined);
  const url = `${appUrl(req)}/api/integrations/square/webhook?ws=${encodeURIComponent(ctx.workspaceId)}`;
  try {
    const sub = await square.createWebhookSubscription(environment, secrets.accessToken, { name: `cumulusOS ${ctx.instance?.brand.name ?? "ranch"} counts`, eventTypes: ["inventory.count.updated"], notificationUrl: url });
    await writeSecrets(ctx, "square", { ...secrets, webhookSubscriptionId: sub.id, webhookSignatureKey: sub.signatureKey, webhookUrl: url });
    doc.webhooks = [{ id: sub.id, topic: "inventory.count.updated" }];
    doc.lastError = undefined;
  } catch (e) {
    doc.lastError = `Square connected, but live count updates could not be switched on: ${e instanceof Error ? e.message : String(e)}`;
  }
}

/** A bespoke instance only uses the connections it was set up with. */
export function assertIntegrationAllowed(ctx: Pick<ServerContext, "instance">, id: IntegrationId): void {
  if (ctx.instance && !(ctx.instance.integrations as string[]).includes(id)) throw new HttpError(404, "This connection is not available here.");
}

/**
 * Clover connects either through OAuth (see /api/integrations/clover/authorize)
 * or with an API token the merchant creates in their own Clover dashboard,
 * pasted here with the merchant id. Without a pasted token, "connect"
 * re-checks the stored credentials and saves settings.
 */
async function reconnectClover(ctx: ServerContext, body: ConnectBody): Promise<Integration> {
  const existing = await ctx.store.get("integrations", "clover");
  const pasted = clean(body.credentials?.accessToken);
  const now = nowIso();
  let merchant: clover.CloverMerchant;
  let currency: string | undefined;
  let site: clover.CloverSite;
  let auth: "oauth" | "token";
  if (pasted) {
    const merchantId = clean(body.credentials?.merchantId) || existing?.config?.merchantId || "";
    if (!clover.isMerchantId(merchantId)) throw new HttpError(400, "Enter the merchant id: it is under Account & Setup → Business Information in the Clover dashboard.");
    site = { ...clover.parsePlace(clean(body.credentials?.place)), merchantId };
    ({ merchant, currency } = await clover.verifyCloverApiToken(site, pasted));
    // The merchant's own token: nothing to refresh, deleted from their dashboard. A previous OAuth grant is replaced.
    await writeSecrets(ctx, "clover", { accessToken: pasted, merchantId, environment: site.environment, region: site.region, tokenKind: "personal" });
    auth = "token";
  } else {
    const verified = await clover.verifyCloverConnection(ctx);
    ({ merchant, currency } = verified);
    site = clover.siteOf(verified.secrets);
    auth = clover.isPersonalToken(verified.secrets) ? "token" : "oauth";
  }
  const doc: Integration = {
    id: "clover",
    status: "connected",
    config: clover.connectionConfig(site, merchant, currency, auth),
    settings: { ...(existing?.settings ?? {}), ...(body.settings ?? {}) },
    connectedAt: pasted ? now : (existing?.connectedAt ?? now),
    connectedBy: pasted ? ctx.actor.id : (existing?.connectedBy ?? ctx.actor.id),
    lastSyncAt: existing?.lastSyncAt,
    lastSyncSummary: existing?.lastSyncSummary,
    webhooks: [],
    createdAt: existing?.createdAt ?? now,
  };
  if (pasted) await ctx.store.batch([{ op: "put", collection: "integrations", doc }, activityOp(ctx.actor, "integration.connected", `Connected Clover (${doc.config!.businessName})`, { entityType: "integration", entityId: "clover" })]);
  else await ctx.store.put("integrations", doc);
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
  let secrets = await readSecrets(ctx, id);
  if (id === "shopify" && existing && secrets) secrets = await freshShopifySecrets(ctx, existing, secrets).catch(() => secrets);
  await removeWebhooks(existing, secrets, id);
  if (id === "square" && secrets?.webhookSubscriptionId && secrets.accessToken && square.isPersonalToken(secrets)) {
    await square.deleteWebhookSubscription((secrets.environment as square.SquareEnvironment | undefined) ?? "production", secrets.accessToken, secrets.webhookSubscriptionId).catch((e) => console.warn("[square] webhook removal failed:", e instanceof Error ? e.message : e));
  }
  // Only a token this server's OAuth app was granted can be revoked here; a pasted one is revoked in the seller's own Developer Console.
  if (id === "square" && secrets?.accessToken && secrets.refreshToken) {
    const config = square.squareConfig();
    if (config) await square.revokeSquare(config, secrets).catch((e) => console.warn("[square] revoke failed:", e instanceof Error ? e.message : e));
  }
  // Clover has no revoke call: the stored tokens are deleted here, and the merchant uninstalls the app or deletes the API token on their side to cut access there.
  if (id === "quickbooks" && secrets?.refreshToken) {
    // Best effort: the tokens are deleted here regardless, and Intuit's own expiry finishes the job if revocation fails.
    const config = qbo.quickbooksConfig();
    if (config) await qbo.revoke(config, secrets).catch((e) => console.warn("[quickbooks] revoke failed:", e instanceof Error ? e.message : e));
  }
  await deleteSecrets(ctx, id);
  const now = nowIso();
  const doc: Integration = { id, status: "not_connected", config: existing?.config ? { ...(existing.config.shop ? { shop: existing.config.shop } : {}), ...(existing.config.siteUrl ? { siteUrl: existing.config.siteUrl } : {}), ...(existing.config.realmId ? { realmId: existing.config.realmId } : {}), ...(id === "clover" && existing.config.merchantId ? { merchantId: existing.config.merchantId } : {}) } : {}, settings: existing?.settings, webhooks: [], createdAt: existing?.createdAt ?? now };
  await ctx.store.batch([{ op: "put", collection: "integrations", doc }, activityOp(ctx.actor, "integration.disconnected", `Disconnected ${NAMES[id]}`, { entityType: "integration", entityId: id })]);
}

export { NAMES as INTEGRATION_NAMES };
