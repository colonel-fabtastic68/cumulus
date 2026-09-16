import { deleteUser } from "@/lib/server/adminActions";
import { isAdminEmail } from "@/lib/server/admin";
import { HttpError, authenticateAccount, jsonError, readJson } from "@/lib/integrations/server";

export const maxDuration = 120;

/** Deletes an account (and, when confirmed, the workspaces it owns). Admins only; logged to adminActions. */
export async function POST(req: Request) {
  try {
    const ctx = await authenticateAccount(req);
    if (!isAdminEmail(ctx.email, ctx.emailVerified, process.env.ADMIN_EMAILS)) throw new HttpError(403, "This action is for cumulusOS administrators.");
    const body = await readJson<{ uid?: unknown; deleteOwnedWorkspaces?: unknown }>(req);
    const uid = typeof body.uid === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(body.uid) ? body.uid : "";
    if (!uid) throw new HttpError(400, "Missing account id.");
    const result = await deleteUser(ctx.db, ctx.sa, { uid, actorUid: ctx.uid, actorEmail: ctx.email, deleteOwnedWorkspaces: body.deleteOwnedWorkspaces === true });
    return Response.json(result);
  } catch (e) {
    return jsonError(e);
  }
}
