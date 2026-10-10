import type { Integration } from "@/lib/types";
import { activityOp } from "@/lib/inventory";
import { consumeSquareState, exchangeSquareCode, locations, merchant, requireSquareConfig, squareStateInstance } from "@/lib/integrations/square";
import { HttpError, appUrl, firestoreFor, instanceAppUrl, requireServiceAccount, systemContext, writeSecrets } from "@/lib/integrations/server";
import { setUpRanchSquare } from "@/lib/integrations/connect";
import { hasFeature, instanceById } from "@/lib/instances";
import { nowIso } from "@/lib/utils";

export const maxDuration = 60;

/**
 * Where Square sends the browser after the seller approves (the app's one
 * redirect URL, on the shared host). The state alone ties it to a workspace
 * and the manager who started it; a state that names an instance is read from,
 * and the connection written to, that instance's own database, and the browser
 * goes back to the instance.
 */
export async function GET(req: Request) {
  const base = appUrl(req);
  const params = new URL(req.url).searchParams;
  const state = params.get("state") ?? "";
  const instanceId = squareStateInstance(state);
  const instance = instanceId ? instanceById(instanceId) : null;
  const home = instance ? instanceAppUrl(instance, req) : base;
  const back = (query: Record<string, string>) => Response.redirect(`${home}/integrations?${new URLSearchParams(query).toString()}`, 302);
  try {
    if (instanceId && !instance) throw new HttpError(400, "The Square sign-in did not come from this app (unknown instance).");
    const sa = requireServiceAccount();
    const config = requireSquareConfig();
    const db = firestoreFor(sa, instance);
    if (!state) throw new HttpError(400, "The Square sign-in did not come from this app (missing state).");
    const issued = await consumeSquareState(db, state);
    if (instance && issued.workspaceId !== instance.workspaceId) throw new HttpError(400, "The Square sign-in did not come from this app (wrong workspace).");
    const denied = params.get("error");
    if (denied) throw new HttpError(400, denied === "access_denied" ? "Square access was not granted." : `Square reported: ${params.get("error_description") ?? denied}`);
    const code = params.get("code") ?? "";
    if (!code) throw new HttpError(400, "Square did not send back an authorization code.");

    const ctx = systemContext(issued.workspaceId, sa, instance);
    const member = await db.doc(`workspaces/${issued.workspaceId}/members/${issued.uid}`).get();
    if (!member.exists) throw new HttpError(403, "The account that started the connection is no longer a member of the workspace.");
    ctx.actor = { id: issued.uid, name: (member.data() as { name?: string }).name ?? "Member" };

    const secrets = await exchangeSquareCode(config, code, base);
    const [m, locs] = await Promise.all([merchant(config.environment, secrets.accessToken), locations(config.environment, secrets.accessToken)]);
    await writeSecrets(ctx, "square", secrets);
    const existing = await ctx.store.get("integrations", "square");
    const now = nowIso();
    const active = locs.filter((l) => l.status !== "INACTIVE");
    // A ranch instance keeps who holds the counts, where it counts from and how far it has read Square's history.
    const kept = Object.fromEntries(Object.entries(existing?.config ?? {}).filter(([k]) => k.startsWith("ranch")));
    const doc: Integration = {
      id: "square",
      status: "connected",
      config: { merchantId: m.id, businessName: m.business_name ?? m.id, environment: config.environment, auth: "oauth", locationIds: active.map((l) => l.id).join(","), locationNames: active.map((l) => l.name ?? l.id).join(", "), ...(m.currency ? { currency: m.currency } : {}), ...(m.country ? { country: m.country } : {}), ...kept },
      settings: existing?.settings ?? { syncProducts: true, takeStockOnFirstSync: false },
      connectedAt: now,
      connectedBy: issued.uid,
      lastSyncAt: existing?.lastSyncAt,
      lastSyncSummary: existing?.lastSyncSummary,
      webhooks: [],
      createdAt: existing?.createdAt ?? now,
    };
    if (hasFeature(instance, "ranch")) await setUpRanchSquare(ctx, doc, m, active);
    await ctx.store.batch([{ op: "put", collection: "integrations", doc }, activityOp(ctx.actor, "integration.connected", `Connected Square (${doc.config!.businessName})`, { entityType: "integration", entityId: "square" })]);
    return back({ connected: "square" });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (!(e instanceof HttpError) || e.status >= 500) console.error("[square callback]", e);
    return back({ error: `Square: ${message}` });
  }
}
