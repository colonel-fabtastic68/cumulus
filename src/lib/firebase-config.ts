/**
 * Firebase web config and workspace id, read from plain server-side
 * environment variables (FIREBASE_*, CUMULUS_WORKSPACE). The (app) layout reads
 * them on the server at request time and hands them to the client through
 * Providers, so nothing needs the NEXT_PUBLIC_ prefix and changes on Vercel take
 * effect on the next deploy regardless of build cache.
 *
 * The Firebase web API key identifies the project rather than authorising
 * access (security comes from Firestore rules and Auth), so sending it to the
 * browser is expected.
 */
export interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId: string;
}

export interface RuntimeConfig {
  firebase: FirebaseConfig | null;
  workspaceId: string;
}

/** Env names in the order they are consulted; the NEXT_PUBLIC_ ones are legacy. */
export const ENV_NAMES = {
  apiKey: ["FIREBASE_API_KEY", "NEXT_PUBLIC_FIREBASE_API_KEY"],
  projectId: ["FIREBASE_PROJECT_ID", "NEXT_PUBLIC_FIREBASE_PROJECT_ID"],
  appId: ["FIREBASE_APP_ID", "NEXT_PUBLIC_FIREBASE_APP_ID"],
  authDomain: ["FIREBASE_AUTH_DOMAIN", "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN"],
  storageBucket: ["FIREBASE_STORAGE_BUCKET", "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET"],
  messagingSenderId: ["FIREBASE_MESSAGING_SENDER_ID", "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID"],
  workspaceId: ["CUMULUS_WORKSPACE", "NEXT_PUBLIC_CUMULUS_WORKSPACE"],
} as const;

/** Values pasted straight out of the Firebase JS config arrive as `"AIza…",` — strip the syntax. */
export function cleanEnv(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const v = value
    .trim()
    .replace(/[,;]\s*$/, "")
    .replace(/^["']/, "")
    .replace(/["'],?\s*$/, "")
    .trim();
  return v || undefined;
}

function pick(env: Record<string, string | undefined>, names: readonly string[]): string | undefined {
  for (const n of names) {
    const v = cleanEnv(env[n]);
    if (v) return v;
  }
  return undefined;
}

export function parseFirebaseConfig(env: Record<string, string | undefined>): FirebaseConfig | null {
  const apiKey = pick(env, ENV_NAMES.apiKey);
  const projectId = pick(env, ENV_NAMES.projectId);
  const appId = pick(env, ENV_NAMES.appId);
  if (!apiKey || !projectId || !appId) return null;
  return {
    apiKey,
    projectId,
    appId,
    authDomain: pick(env, ENV_NAMES.authDomain) ?? `${projectId}.firebaseapp.com`,
    storageBucket: pick(env, ENV_NAMES.storageBucket),
    messagingSenderId: pick(env, ENV_NAMES.messagingSenderId),
  };
}

/** Server-side: read the runtime config from the process environment (at request time). */
export function runtimeConfigFromEnv(): RuntimeConfig {
  return {
    firebase: parseFirebaseConfig(process.env),
    workspaceId: pick(process.env, ENV_NAMES.workspaceId) ?? "default",
  };
}

let injected: RuntimeConfig | null = null;

/** Client-side: called by Providers with the config the server rendered. */
export function setRuntimeConfig(config: RuntimeConfig) {
  injected = config;
}

/** The active runtime config. Local mode until the server has injected one. */
export function getRuntimeConfig(): RuntimeConfig {
  return injected ?? { firebase: null, workspaceId: "default" };
}
