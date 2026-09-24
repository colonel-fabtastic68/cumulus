import { createBackup, listBackups } from "@/lib/server/backups";
import { authenticate, jsonError, readJson } from "@/lib/integrations/server";

export const maxDuration = 120;

/** Time Machine: list the workspace's backups, or take one now. Owners and admins only. */
export async function GET(req: Request) {
  try {
    const ctx = await authenticate(req, { manage: true });
    return Response.json({ backups: await listBackups(ctx.db, ctx.workspaceId) });
  } catch (e) {
    return jsonError(e);
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await authenticate(req, { manage: true });
    const body = await readJson<{ label?: unknown }>(req).catch(() => ({}) as { label?: unknown });
    const backup = await createBackup(ctx, { kind: "manual", label: typeof body.label === "string" ? body.label.slice(0, 120) : undefined });
    return Response.json({ backup });
  } catch (e) {
    return jsonError(e);
  }
}
