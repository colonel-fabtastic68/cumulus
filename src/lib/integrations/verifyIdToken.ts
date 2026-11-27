import { createRemoteJWKSet, jwtVerify } from "jose";
import { twoStepFromClaims, type TwoStepState } from "@/lib/twoStep";

/**
 * Verifies a Firebase Auth ID token without firebase-admin/auth. That module
 * pulls in jwks-rsa, which `require()`s the ESM-only jose package and crashes
 * on Vercel's Node runtime. Firebase ID tokens are ordinary RS256 JWTs signed
 * with keys Google publishes, so jose can check them directly.
 */
const JWKS_URL = new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com");

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

export interface VerifiedIdToken {
  uid: string;
  email?: string;
  /** Firebase's email_verified claim: true after an emailed link or a one-time code. */
  emailVerified: boolean;
  /** firebase.sign_in_provider, e.g. "password", "emailLink" or "anonymous". */
  signInProvider?: string;
  /** firebase.tenant: the Identity Platform tenant the account belongs to; absent for the shared account pool. */
  tenant?: string;
  /** auth_time: when this sign-in happened (seconds). Token refreshes keep it. */
  authTime: number;
  /** Two-step sign-in by email (src/lib/twoStep.ts): whether it is on, and whether this sign-in has passed it. */
  twoStep: TwoStepState;
}

export async function verifyFirebaseIdToken(token: string, projectId: string): Promise<VerifiedIdToken> {
  jwks ??= createRemoteJWKSet(JWKS_URL, { cooldownDuration: 30_000, cacheMaxAge: 6 * 60 * 60 * 1000 });
  const { payload } = await jwtVerify(token, jwks, {
    issuer: `https://securetoken.google.com/${projectId}`,
    audience: projectId,
    algorithms: ["RS256"],
  });
  const uid = typeof payload.sub === "string" ? payload.sub : "";
  if (!uid) throw new Error("Token has no subject");
  const authTime = typeof payload.auth_time === "number" ? payload.auth_time : 0;
  if (authTime > Math.floor(Date.now() / 1000) + 300) throw new Error("Token auth_time is in the future");
  const firebase = (payload.firebase ?? {}) as { sign_in_provider?: unknown; tenant?: unknown };
  return {
    uid,
    email: typeof payload.email === "string" ? payload.email : undefined,
    emailVerified: payload.email_verified === true,
    signInProvider: typeof firebase.sign_in_provider === "string" ? firebase.sign_in_provider : undefined,
    tenant: typeof firebase.tenant === "string" && firebase.tenant ? firebase.tenant : undefined,
    authTime,
    twoStep: twoStepFromClaims(payload as Record<string, unknown>, authTime),
  };
}
