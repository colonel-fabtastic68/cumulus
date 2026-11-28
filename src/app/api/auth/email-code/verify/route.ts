import { authenticateAccount, jsonError, readJson } from "@/lib/integrations/server";
import { checkCode, clearCode, markEmailVerified } from "@/lib/server/emailCodes";
import { markSessionVerified } from "@/lib/server/signInCodes";

/**
 * Checks the code. A match marks the account's email as verified and, where
 * sign-in codes are on, records this session as having finished signing in, so
 * a new account is not asked for a second code straight after its first.
 */
export async function POST(req: Request) {
  try {
    const ctx = await authenticateAccount(req, { allowPendingCode: true });
    if (ctx.emailVerified && ctx.secondStep !== "pending") return Response.json({ verified: true });
    const body = await readJson<{ code?: unknown }>(req);
    const code = typeof body.code === "string" ? body.code.replace(/\s+/g, "") : "";
    await checkCode(ctx.db, ctx.sa, ctx.uid, code);
    if (!ctx.emailVerified) await markEmailVerified(ctx.sa, ctx.uid);
    if (ctx.secondStep === "pending") await markSessionVerified(ctx.db, ctx.uid, ctx.authTime);
    await clearCode(ctx.db, ctx.uid);
    return Response.json({ verified: true });
  } catch (e) {
    return jsonError(e);
  }
}
