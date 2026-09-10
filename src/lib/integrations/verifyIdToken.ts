import { createRemoteJWKSet, jwtVerify } from "jose";

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
  return { uid, email: typeof payload.email === "string" ? payload.email : undefined };
}
