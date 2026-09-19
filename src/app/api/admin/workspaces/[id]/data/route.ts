import type { Member, WorkspaceSnapshot } from "@/lib/types";
import { COLLECTIONS } from "@/lib/types";
import { HttpError, authenticateAccount, jsonError, readJson } from "@/lib/integrations/server";
import { AdminFirestoreStore } from "@/lib/mcp/adminStore";
import { buildSeed, freshWorkspace } from "@/lib/seed";
import { isAdminEmail } from "@/lib/server/admin";
import { nowIso } from "@/lib/utils";

export const maxDuration = 300;

/** Backup, restore, reset and clear for any workspace, from the admin dashboard only. Every run is logged. */
async function guard(req: Request, id: string) {
  const ctx = await authenticateAccount(req);
  if (!isAdminEmail(ctx.email, ctx.emailVerified, process.env.ADMIN_EMAILS)) throw new HttpError(403, "This action is for cumulusOS administrators.");
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new HttpError(400, "Unknown workspace.");
  const ws = await ctx.db.doc(`workspaces/${id}`).get();
  if (!ws.exists) throw new HttpError(404, "That workspace does not exist.");
  return { ctx, store: new AdminFirestoreStore(ctx.sa, id) };
}

/** The whole workspace as JSON (every collection), for download. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { store } = await guard(req, id);
    const snapshot = await store.snapshot();
    return new Response(JSON.stringify(snapshot, null, 2), { headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="cumulusos-${id}-${nowIso().slice(0, 10)}.json"`, "Cache-Control": "no-store" } });
  } catch (e) {
    return jsonError(e);
  }
}

/** Real accounts keep their seat through a reset or clear; demo people (u_…) and guests do not. */
function realMembers(members: Member[]): Member[] {
  return members.filter((m) => !m.id.startsWith("u_") && !m.guest);
}

function parseSnapshot(raw: unknown): WorkspaceSnapshot {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new HttpError(400, "That file is not a workspace export.");
  const r = raw as Record<string, unknown>;
  const out = {} as Record<string, unknown[]>;
  for (const c of COLLECTIONS) {
    const rows = r[c];
    if (rows !== undefined && !Array.isArray(rows)) throw new HttpError(400, `Collection "${c}" is not a list.`);
    out[c] = (rows as unknown[] | undefined) ?? [];
  }
  if (out.items!.length === 0 && out.settings!.length === 0) throw new HttpError(400, "That file has no items and no settings; it does not look like a workspace export.");
  return out as unknown as WorkspaceSnapshot;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { ctx, store } = await guard(req, id);
    const body = await readJson<{ action?: unknown; snapshot?: unknown }>(req);
    const action = body.action;
    const current = await store.snapshot();
    const keep = realMembers(current.members);
    let next: WorkspaceSnapshot;
    let summary: string;
    if (action === "import") {
      next = parseSnapshot(body.snapshot);
      const ids = new Set(next.members.map((m) => m.id));
      next = { ...next, members: [...next.members, ...keep.filter((m) => !ids.has(m.id))] };
      summary = `imported ${next.items.length} items, ${next.orders.length} orders`;
    } else if (action === "reset") {
      const seed = buildSeed();
      const ids = new Set(seed.members.map((m) => m.id));
      next = { ...seed, members: [...seed.members, ...keep.filter((m) => !ids.has(m.id))], settings: [{ ...seed.settings[0]!, companyName: current.settings[0]?.companyName ?? seed.settings[0]!.companyName, billing: current.settings[0]?.billing }] };
      summary = "reset to the Halcyon Audio demo";
    } else if (action === "clear") {
      const currentSettings = current.settings[0];
      next = freshWorkspace({ members: keep, companyName: currentSettings?.companyName, currency: currentSettings?.currency });
      if (currentSettings) next.settings = [{ ...next.settings[0]!, ...currentSettings, automations: next.settings[0]!.automations }];
      summary = "cleared to an empty workspace";
    } else {
      throw new HttpError(400, "Unknown action.");
    }
    await store.replaceAll(next);
    await ctx.db.doc(`adminActions/${nowIso()}-${id}`).set({ action: `workspace.${action}`, actorUid: ctx.uid, actorEmail: ctx.email, target: id, summary, at: nowIso() });
    return Response.json({ ok: true, summary });
  } catch (e) {
    return jsonError(e);
  }
}
