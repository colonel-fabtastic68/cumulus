import { getFirestore } from "firebase-admin/firestore";
import type { Integration } from "@/lib/types";
import { activityOp } from "@/lib/inventory";
import { companyInfo, consumeState, exchangeCode, requireQuickbooksConfig } from "@/lib/integrations/quickbooks";
import { HttpError, appUrl, requireServiceAccount, systemContext, writeSecrets } from "@/lib/integrations/server";
import { adminApp } from "@/lib/mcp/adminStore";
import { nowIso } from "@/lib/utils";

export const maxDuration = 60;

/**
 * Where Intuit sends the browser after the customer approves (or refuses)
 * access. There is no bearer token on a redirect, so the `state` we issued
 * is what ties the callback to a workspace and the manager who started it.
 */
export async function GET(req: Request) {
  const base = appUrl(req);
  const params = new URL(req.url).searchParams;
  const back = (query: Record<string, string>) => Response.redirect(`${base}/integrations?${new URLSearchParams(query).toString()}`, 302);
  try {
    const sa = requireServiceAccount();
    const config = requireQuickbooksConfig();
    const db = getFirestore(adminApp(sa));
    const state = params.get("state") ?? "";
    if (!state) throw new HttpError(400, "The QuickBooks sign-in did not come from this app (missing state).");
    const issued = await consumeState(db, state);
    const denied = params.get("error");
    if (denied) throw new HttpError(400, denied === "access_denied" ? "QuickBooks access was not granted." : `QuickBooks reported: ${denied}`);
    const code = params.get("code") ?? "";
    const realmId = params.get("realmId") ?? "";
    if (!code || !/^\d{1,32}$/.test(realmId)) throw new HttpError(400, "QuickBooks did not send back an authorisation code and company.");

    const ctx = systemContext(issued.workspaceId, sa);
    const member = await db.doc(`workspaces/${issued.workspaceId}/members/${issued.uid}`).get();
    if (!member.exists) throw new HttpError(403, "The account that started the connection is no longer a member of the workspace.");
    ctx.actor = { id: issued.uid, name: (member.data() as { name?: string }).name ?? "Member" };

    const secrets = await exchangeCode(config, code, base, realmId);
    const company = await companyInfo(config.environment, secrets.accessToken, realmId);
    await writeSecrets(ctx, "quickbooks", secrets);
    const existing = await ctx.store.get("integrations", "quickbooks");
    const now = nowIso();
    const doc: Integration = {
      id: "quickbooks",
      status: "connected",
      config: { realmId, companyName: company.CompanyName, environment: config.environment, ...(company.Country ? { country: company.Country } : {}) },
      settings: existing?.settings ?? { syncProducts: true, takeStockOnFirstSync: false },
      connectedAt: now,
      connectedBy: issued.uid,
      lastSyncAt: existing?.lastSyncAt,
      lastSyncSummary: existing?.lastSyncSummary,
      webhooks: [],
      createdAt: existing?.createdAt ?? now,
    };
    await ctx.store.batch([{ op: "put", collection: "integrations", doc }, activityOp(ctx.actor, "integration.connected", `Connected QuickBooks (${company.CompanyName})`, { entityType: "integration", entityId: "quickbooks" })]);
    return back({ connected: "quickbooks" });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (!(e instanceof HttpError) || e.status >= 500) console.error("[quickbooks callback]", e);
    return back({ error: `QuickBooks: ${message}` });
  }
}
