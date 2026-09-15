import { authenticateAccount, jsonError, readJson } from "@/lib/integrations/server";
import { checkCode, clearCode, markEmailVerified } from "@/lib/server/emailCodes";

/** Checks the code and, when it matches, marks the account's email as verified. */
export async function POST(req: Request) {
  try {
    const ctx = await authenticateAccount(req);
    if (ctx.emailVerified) return Response.json({ verified: true });
    const body = await readJson<{ code?: unknown }>(req);
    const code = typeof body.code === "string" ? body.code.replace(/\s+/g, "") : "";
    await checkCode(ctx.db, ctx.sa, ctx.uid, code);
    await markEmailVerified(ctx.sa, ctx.uid);
    await clearCode(ctx.db, ctx.uid);
    return Response.json({ verified: true });
  } catch (e) {
    return jsonError(e);
  }
}
