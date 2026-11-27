import { HttpError, authenticateAccount, jsonError, readJson } from "@/lib/integrations/server";
import { emailCodesConfigured } from "@/lib/server/emailCodes";
import { issueTwoStepCode } from "@/lib/server/twoStep";
import { serverFeatureEnabled } from "@/lib/features";
import { isTwoStepPurpose, twoStepRefusal } from "@/lib/twoStep";

export const maxDuration = 30;

/**
 * Emails a 6-digit code for two-step sign-in (src/lib/twoStep.ts): to finish
 * signing in, to turn it on, or to turn it off. Finishing a sign-in and
 * turning it off always work, so nobody is locked out if the feature is
 * switched off later; turning it on needs the feature.
 */
export async function POST(req: Request) {
  try {
    const ctx = await authenticateAccount(req, { twoStepPending: true });
    const body = await readJson<{ purpose?: unknown }>(req);
    if (!isTwoStepPurpose(body.purpose)) throw new HttpError(400, "Say what the code is for.");
    const purpose = body.purpose;
    if (purpose === "sign-in" && !ctx.twoStep.enabled) return Response.json({ verified: true });
    if (purpose === "sign-in" && ctx.twoStep.verified) return Response.json({ verified: true });
    const refusal = twoStepRefusal(purpose, ctx.twoStep);
    if (refusal) throw new HttpError(409, refusal);
    if (purpose === "enable") {
      if (!serverFeatureEnabled("twoStep")) throw new HttpError(404, "Two-step sign-in is not available here yet.");
      if (ctx.instance) throw new HttpError(400, "Two-step sign-in is not available on this site yet.");
    }
    if (!ctx.email || ctx.signInProvider === "anonymous") throw new HttpError(400, "Guest sessions have no email address for codes.");
    if (!emailCodesConfigured()) throw new HttpError(503, "Email codes are not set up on this installation.");
    const result = await issueTwoStepCode(ctx.db, ctx.sa, ctx.uid, ctx.email, purpose, ctx.authTime);
    if (result.sent) return Response.json({ sent: true, email: ctx.email });
    return Response.json({ sent: false, email: ctx.email, reason: result.reason, retryAfterSeconds: Math.ceil(result.retryAfterMs / 1000) });
  } catch (e) {
    return jsonError(e);
  }
}
