import { getFirestore } from "firebase-admin/firestore";
import type { Integration } from "@/lib/types";
import { CARRIERS, isCarrier } from "@/lib/integrations/carriers";
import { isChannel, runChannelSync } from "@/lib/integrations/channelSync";
import { runQuickbooksSync } from "@/lib/integrations/quickbooksSync";
import { runCloverSync } from "@/lib/integrations/cloverSync";
import { runSquareSync } from "@/lib/integrations/squareSync";
import { readSecrets, requireServiceAccount, systemContext } from "@/lib/integrations/server";
import { applyTracking } from "@/lib/integrations/tracking";
import { adminApp } from "@/lib/mcp/adminStore";
import { nowIso } from "@/lib/utils";
import { autoBackup } from "@/lib/server/backups";
import { autoReplenish } from "@/lib/replenishment";
import { INSTANCES, hasFeature } from "@/lib/instances";
import { ranchSync } from "@/lib/ranch/bridge";

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
          const result = await runChannelSync(ctx, integration, secrets, {});
          report.push({ workspace: wsRef.id, integration: integration.id, outcome: result.summary });
        } else if (integration.id === "square" && integration.settings?.syncProducts !== false) {
          const result = await runSquareSync(ctx, integration, secrets);
          report.push({ workspace: wsRef.id, integration: integration.id, outcome: result.summary });
        } else if (integration.id === "clover" && integration.settings?.syncProducts !== false) {
          const result = await runCloverSync(ctx, integration, secrets);
          report.push({ workspace: wsRef.id, integration: integration.id, outcome: result.summary });
        } else if (integration.id === "quickbooks" && integration.settings?.syncProducts !== false) {
          const result = await runQuickbooksSync(ctx, integration, secrets);
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
  // Replenishment: items on automatic rules whose forecast fell below min get a draft order.
  for (const wsRef of workspaces) {
    try {
      const ctx = systemContext(wsRef.id, sa);
      const outcome = await autoReplenish(ctx.store, ctx.actor);
      if (outcome !== "nothing to order") report.push({ workspace: wsRef.id, integration: "replenishment", outcome });
    } catch (e) {
      report.push({ workspace: wsRef.id, integration: "replenishment", outcome: `error: ${e instanceof Error ? e.message : String(e)}` });
    }
  }
  // Time Machine: one automatic backup a day for every workspace that changed.
  for (const wsRef of workspaces) {
    try {
      const outcome = await autoBackup(systemContext(wsRef.id, sa));
      if (outcome !== "unchanged") report.push({ workspace: wsRef.id, integration: "backup", outcome });
    } catch (e) {
      report.push({ workspace: wsRef.id, integration: "backup", outcome: `error: ${e instanceof Error ? e.message : String(e)}` });
    }
  }
  // Bespoke instances: each in its own database, never mixed into the loops above.
  for (const instance of INSTANCES) {
    const ctx = systemContext(instance.workspaceId, sa, instance);
    const label = `${instance.id}/${instance.workspaceId}`;
    try {
      if (!(await ctx.db.doc(`workspaces/${instance.workspaceId}/settings/default`).get()).exists) continue;
    } catch (e) {
      // The instance's database does not exist yet (or is unreachable): nothing to do until it is set up.
      report.push({ workspace: label, integration: "instance", outcome: `skipped: ${e instanceof Error ? e.message : String(e)}` });
      continue;
    }
    if (hasFeature(instance, "ranch")) {
      try {
        report.push({ workspace: label, integration: "ranch", outcome: (await ranchSync(ctx)).summary });
      } catch (e) {
        report.push({ workspace: label, integration: "ranch", outcome: `error: ${e instanceof Error ? e.message : String(e)}` });
      }
    }
    try {
      const outcome = await autoReplenish(ctx.store, ctx.actor);
      if (outcome !== "nothing to order") report.push({ workspace: label, integration: "replenishment", outcome });
      const backup = await autoBackup(ctx);
      if (backup !== "unchanged") report.push({ workspace: label, integration: "backup", outcome: backup });
    } catch (e) {
      report.push({ workspace: label, integration: "housekeeping", outcome: `error: ${e instanceof Error ? e.message : String(e)}` });
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
