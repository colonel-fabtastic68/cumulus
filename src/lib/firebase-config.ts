/**
 * Firebase web config, read from NEXT_PUBLIC_FIREBASE_* environment variables.
 *
 * The (app) layout reads these on the server at request time and injects them
 * into the client (see Providers), so changing them on Vercel takes effect on
 * the next deploy even when the build cache is reused. The inlined
 * `process.env.NEXT_PUBLIC_*` values remain as a fallback.
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

export function parseFirebaseConfig(env: Record<string, string | undefined>): FirebaseConfig | null {
  const apiKey = cleanEnv(env.NEXT_PUBLIC_FIREBASE_API_KEY);
  const projectId = cleanEnv(env.NEXT_PUBLIC_FIREBASE_PROJECT_ID);
  const appId = cleanEnv(env.NEXT_PUBLIC_FIREBASE_APP_ID);
  if (!apiKey || !projectId || !appId) return null;
  return {
    apiKey,
    projectId,
    appId,
    authDomain: cleanEnv(env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN) ?? `${projectId}.firebaseapp.com`,
    storageBucket: cleanEnv(env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET),
    messagingSenderId: cleanEnv(env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID),
  };
}

/** Server-side: read the runtime config from the process environment. */
export function runtimeConfigFromEnv(): RuntimeConfig {
  return {
    firebase: parseFirebaseConfig(process.env),
    workspaceId: cleanEnv(process.env.NEXT_PUBLIC_CUMULUS_WORKSPACE) ?? "default",
  };
}

let injected: RuntimeConfig | null = null;

/** Client-side: called by Providers with the config the server rendered. */
export function setRuntimeConfig(config: RuntimeConfig) {
  injected = config;
}

/** The active runtime config: injected by the server, else build-time inlined values. */
export function getRuntimeConfig(): RuntimeConfig {
  if (injected) return injected;
  return {
    firebase: parseFirebaseConfig({
      NEXT_PUBLIC_FIREBASE_API_KEY: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
      NEXT_PUBLIC_FIREBASE_PROJECT_ID: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      NEXT_PUBLIC_FIREBASE_APP_ID: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
      NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
      NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
      NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    }),
    workspaceId: cleanEnv(process.env.NEXT_PUBLIC_CUMULUS_WORKSPACE) ?? "default",
  };
}
