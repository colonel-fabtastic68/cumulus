import { getFirestore } from "firebase-admin/firestore";
import type { Integration } from "@/lib/types";
import { CARRIERS, isCarrier } from "@/lib/integrations/carriers";
import { isChannel, syncChannel } from "@/lib/integrations/channelSync";
import { readSecrets, requireServiceAccount, systemContext } from "@/lib/integrations/server";
import { applyTracking } from "@/lib/integrations/tracking";
import { adminApp } from "@/lib/mcp/adminStore";
import { nowIso } from "@/lib/utils";

export const maxDuration = 300;

const TRACK_WINDOW_MS = 30 * 86_400_000;
const FINAL = new Set(["delivered", "returned", "failure"]);

/**
 * Scheduled reconciliation (vercel.json → crons). Webhooks keep things live;
 * this pass catches anything they missed: open channel orders, product edits,
 * and tracking updates on recent shipments.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  const header = req.headers.get("authorization") ?? "";
  if (!secret || header !== `Bearer ${secret}`) return new Response("Unauthorized", { status: 401 });
  const sa = requireServiceAccount();
  const db = getFirestore(adminApp(sa));
  const workspaces = await db.collection("workspaces").listDocuments();
  const report: Array<{ workspace: string; integration: string; outcome: string }> = [];

  for (const wsRef of workspaces) {
    const integrations = await wsRef.collection("integrations").where("status", "==", "connected").get();
    if (integrations.empty) continue;
    const ctx = systemContext(wsRef.id, sa);
    for (const doc of integrations.docs) {
      const integration = doc.data() as Integration;
      const secrets = await readSecrets(ctx, integration.id);
      if (!secrets) continue;
      try {
        if (isChannel(integration.id)) {
          const what = { products: integration.settings?.syncProducts !== false, orders: integration.settings?.syncOrders !== false };
          if (!what.products && !what.orders) continue;
          const result = await syncChannel(ctx, integration, secrets, what);
          report.push({ workspace: wsRef.id, integration: integration.id, outcome: result.summary });
        } else if (isCarrier(integration.id) && secrets.token) {
          const outcome = await refreshTracking(ctx, integration.id, secrets.token);
          report.push({ workspace: wsRef.id, integration: integration.id, outcome });
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        await ctx.store.patch("integrations", integration.id, { lastError: message });
        report.push({ workspace: wsRef.id, integration: integration.id, outcome: `error: ${message}` });
      }
    }
  }
  return Response.json({ ranAt: nowIso(), report });
}

async function refreshTracking(ctx: ReturnType<typeof systemContext>, provider: "shippo" | "easypost", token: string): Promise<string> {
  const cutoff = Date.now() - TRACK_WINDOW_MS;
  const shipments = (await ctx.store.list("shipments")).filter((s) => s.provider === provider && s.trackingNumber && !FINAL.has(s.trackingStatus ?? "") && new Date(s.shippedAt).getTime() > cutoff).slice(0, 40);
  let updated = 0;
  for (const s of shipments) {
    try {
      const res = await CARRIERS[provider].track(token, s);
      if (res.status !== s.trackingStatus) {
        await applyTracking(ctx, s, res.status);
        updated++;
      }
    } catch {
      // Try again next run.
    }
  }
  return `${shipments.length} shipments checked, ${updated} updated`;
}
