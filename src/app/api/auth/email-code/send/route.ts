import { HttpError, authenticateAccount, jsonError } from "@/lib/integrations/server";
import { emailCodesConfigured, issueCode } from "@/lib/server/emailCodes";

/** Emails a 6-digit code to the signed-in account's address, within the resend limits. */
export async function POST(req: Request) {
  try {
    const ctx = await authenticateAccount(req);
    if (ctx.emailVerified) return Response.json({ verified: true });
    if (!ctx.email || ctx.signInProvider === "anonymous") throw new HttpError(400, "This session has no email address to verify.");
    if (!emailCodesConfigured()) throw new HttpError(503, "Email codes are not set up on this installation.");
    const result = await issueCode(ctx.db, ctx.sa, ctx.uid, ctx.email);
    if (result.sent) return Response.json({ sent: true, email: ctx.email });
    return Response.json({ sent: false, email: ctx.email, reason: result.reason, retryAfterSeconds: Math.ceil(result.retryAfterMs / 1000) });
  } catch (e) {
    return jsonError(e);
  }
}
