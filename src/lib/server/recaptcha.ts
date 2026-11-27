import { cleanEnv } from "@/lib/firebase-config";
import { serverFeatureEnabled } from "@/lib/features";
import { HttpError } from "@/lib/integrations/server";
import { readServiceAccount } from "@/lib/mcp/adminStore";
import { serviceAccessToken } from "./emailCodes";

/**
 * reCAPTCHA Enterprise for the public forms that post to our own routes
 * (newsletter, demo, contact). Sign-in and sign-up are checked by Firebase
 * itself (scripts/recaptcha.mjs). On when the `recaptcha` feature is on for the
 * deployment and RECAPTCHA_SITE_KEY holds a score-based web key from the same
 * Google Cloud project as the service account (or RECAPTCHA_PROJECT_ID). The
 * service account needs the reCAPTCHA Enterprise Agent role to ask for scores.
 */

/** Below this a submission is refused (0 = surely a script, 1 = surely a person). Google's suggested starting point. */
export const MIN_SCORE = 0.5;

const NOT_A_PERSON = "We couldn't confirm you're a person. Reload the page and try again, or email us instead.";

/** The site key the public pages should load, or null when the check is off here. */
export function recaptchaSiteKey(): string | null {
  if (!serverFeatureEnabled("recaptcha")) return null;
  return cleanEnv(process.env.RECAPTCHA_SITE_KEY) ?? null;
}

export interface Assessment {
  tokenProperties?: { valid?: boolean; invalidReason?: string; action?: string };
  riskAnalysis?: { score?: number; reasons?: string[] };
}

/** What to make of reCAPTCHA's answer. Kept apart from the network call so it can be checked on its own. */
export function judgeAssessment(a: Assessment, expectedAction: string, minScore = MIN_SCORE): { ok: true } | { ok: false; why: string } {
  if (!a.tokenProperties?.valid) return { ok: false, why: `invalid token (${a.tokenProperties?.invalidReason ?? "no reason"})` };
  if (a.tokenProperties.action !== expectedAction) return { ok: false, why: `action ${a.tokenProperties.action ?? "none"}, expected ${expectedAction}` };
  const score = a.riskAnalysis?.score;
  if (typeof score !== "number") return { ok: false, why: "no score" };
  if (score < minScore) return { ok: false, why: `score ${score}` };
  return { ok: true };
}

/** Throws a 400 a person can act on unless the token shows a person sent the form (see humanCheck). */
export async function assertHuman(req: Request, token: unknown, action: string): Promise<void> {
  const refusal = await humanCheck(req, token, action);
  if (refusal) throw new HttpError(400, refusal);
}

/**
 * Null when a person sent the form, otherwise the message to show. Null too
 * while the check is off, and when Google itself cannot be reached: an outage
 * there should not lose a sign-up.
 */
export async function humanCheck(req: Request, token: unknown, action: string): Promise<string | null> {
  const siteKey = recaptchaSiteKey();
  if (!siteKey) return null;
  const sa = readServiceAccount();
  if (!sa) return null;
  if (typeof token !== "string" || !token) return "The check that you're a person didn't run. Allow www.google.com in your ad blocker, reload the page and try again.";
  const project = cleanEnv(process.env.RECAPTCHA_PROJECT_ID) ?? sa.project_id;
  let assessment: Assessment;
  try {
    const res = await fetch(`https://recaptchaenterprise.googleapis.com/v1/projects/${encodeURIComponent(project)}/assessments`, {
      method: "POST",
      headers: { Authorization: `Bearer ${await serviceAccessToken(sa)}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        event: {
          token,
          siteKey,
          expectedAction: action,
          userIpAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || undefined,
          userAgent: req.headers.get("user-agent") || undefined,
        },
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      console.error("[recaptcha] assessment failed", res.status, (await res.text().catch(() => "")).slice(0, 300));
      return null;
    }
    assessment = (await res.json()) as Assessment;
  } catch (e) {
    console.error("[recaptcha] assessment unreachable", e);
    return null;
  }
  const verdict = judgeAssessment(assessment, action);
  if (verdict.ok) return null;
  console.warn(`[recaptcha] refused ${action}: ${verdict.why}`);
  return NOT_A_PERSON;
}
