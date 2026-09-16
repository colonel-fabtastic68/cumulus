import { buildAdminOverview, isAdminEmail } from "@/lib/server/admin";
import { HttpError, authenticateAccount, jsonError } from "@/lib/integrations/server";

export const maxDuration = 60;

/** Everything about accounts, workspaces and subscriptions, for the addresses in ADMIN_EMAILS. */
export async function GET(req: Request) {
  try {
    const ctx = await authenticateAccount(req);
    if (!isAdminEmail(ctx.email, ctx.emailVerified, process.env.ADMIN_EMAILS)) throw new HttpError(403, "This page is for cumulusOS administrators.");
    return Response.json(await buildAdminOverview(ctx.db), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return jsonError(e);
  }
}
