import type { FirebaseApp } from "firebase/app";
import { getFirebaseAuth } from "@/lib/store/firestore";

export class AccountApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Calls an account-level API route (email codes, billing, creating a workspace)
 * as the signed-in account: sends the Firebase ID token, no workspace id.
 */
export async function accountFetch<T = unknown>(app: FirebaseApp, path: string, body?: unknown, init: { method?: string } = {}): Promise<T> {
  const user = getFirebaseAuth(app).currentUser;
  if (!user) throw new AccountApiError(401, "Sign in first.");
  const token = await user.getIdToken();
  const res = await fetch(path, {
    method: init.method ?? (body === undefined ? "GET" : "POST"),
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) throw new AccountApiError(res.status, (data as { error?: string } | null)?.error ?? `Request failed (${res.status})`);
  return data as T;
}
