import { HttpError, authenticateAccount, jsonError, readJson } from "@/lib/integrations/server";
import { markEmailVerified } from "@/lib/server/emailCodes";
import { checkTwoStepCode, clearTwoStepCode, readCustomClaims, writeCustomClaims } from "@/lib/server/twoStep";
import { TWO_STEP_CLAIM, claimsWithVerifiedSignIn, claimsWithoutTwoStep, isTwoStepPurpose, twoStepRefusal } from "@/lib/twoStep";

export const maxDuration = 30;

/**
 * Checks a two-step code and acts on it: counts this sign-in as verified, turns
 * two-step sign-in on (this sign-in counts as verified too), or turns it off.
 * The browser then refreshes its ID token to pick up the new claims.
 */
export async function POST(req: Request) {
  try {
    const ctx = await authenticateAccount(req, { twoStepPending: true });
    const body = await readJson<{ purpose?: unknown; code?: unknown }>(req);
    if (!isTwoStepPurpose(body.purpose)) throw new HttpError(400, "Say what the code is for.");
    const purpose = body.purpose;
    if (purpose === "sign-in" && ctx.twoStep.verified) return Response.json({ enabled: ctx.twoStep.enabled });
    const refusal = twoStepRefusal(purpose, ctx.twoStep);
    if (refusal) throw new HttpError(409, refusal);
    const code = typeof body.code === "string" ? body.code.replace(/\s+/g, "") : "";
    await checkTwoStepCode(ctx.db, ctx.sa, ctx.uid, code, purpose, ctx.authTime);
    const claims = await readCustomClaims(ctx.sa, ctx.uid, ctx.tenant);
    // Turned off from another device since this token was issued: nothing left to finish.
    if (purpose === "sign-in" && claims[TWO_STEP_CLAIM] !== "email") {
      await clearTwoStepCode(ctx.db, ctx.uid);
      return Response.json({ enabled: false });
    }
    const next = purpose === "disable" ? claimsWithoutTwoStep(claims) : claimsWithVerifiedSignIn(claims, ctx.authTime);
    await writeCustomClaims(ctx.sa, ctx.uid, next, ctx.tenant);
    // The code just proved the inbox, so the address counts as confirmed (older password accounts never confirmed theirs).
    if (purpose === "enable" && !ctx.emailVerified && !ctx.tenant) await markEmailVerified(ctx.sa, ctx.uid).catch((e) => console.error("[two-step] could not mark the email verified", e));
    await clearTwoStepCode(ctx.db, ctx.uid);
    return Response.json({ enabled: purpose !== "disable" });
  } catch (e) {
    return jsonError(e);
  }
}
