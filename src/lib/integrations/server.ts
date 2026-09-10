import { randomBytes, timingSafeEqual } from "node:crypto";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import type { Integration, IntegrationId, Member } from "@/lib/types";
import type { Actor } from "@/lib/inventory";
import { AdminFirestoreStore, adminApp, readServiceAccount, type ServiceAccount } from "@/lib/mcp/adminStore";
import { verifyFirebaseIdToken } from "./verifyIdToken";

/**
 * Shared plumbing for the integration and shipping API routes: the caller's
 * Firebase ID token and workspace membership are checked with the Admin SDK,
 * and platform credentials live in `workspaces/{ws}/secrets/{integration}`,
 * a subcollection the security rules keep off-limits to browsers.
 */

export class HttpError extends Error {
  /** The platform's own error code when it sent one (e.g. woocommerce_rest_cannot_view). */
  code?: string;
  constructor(
    public status: number,
    message: string,
    code?: string,
  ) {
    super(message);
    this.code = code;
  }
}

export interface ServerContext {
  sa: ServiceAccount;
  db: Firestore;
  workspaceId: string;
  store: AdminFirestoreStore;
  actor: Actor;
  /** Present for signed-in callers; absent for webhooks and cron. */
  member?: Member;
}

export const SYSTEM_ACTOR: Actor = { id: "system", name: "Cumulus sync" };

export function requireServiceAccount(): ServiceAccount {
  const sa = readServiceAccount();
  if (!sa) throw new HttpError(503, "Live connections need FIREBASE_SERVICE_ACCOUNT_JSON on the server. Add the Firebase service account to the deployment's environment.");
  return sa;
}

/** A context for background work (webhooks, cron) on one workspace. */
export function systemContext(workspaceId: string, sa = requireServiceAccount()): ServerContext {
  return { sa, db: getFirestore(adminApp(sa)), workspaceId, store: new AdminFirestoreStore(sa, workspaceId), actor: SYSTEM_ACTOR };
}

/** Verifies the bearer ID token and the caller's membership of the workspace named in `x-workspace-id`. */
export async function authenticate(req: Request, opts: { write?: boolean; manage?: boolean } = {}): Promise<ServerContext & { member: Member }> {
  const sa = requireServiceAccount();
  const header = req.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  if (!token) throw new HttpError(401, "Sign in first.");
  const workspaceId = req.headers.get("x-workspace-id")?.trim() ?? "";
  if (!workspaceId || !/^[A-Za-z0-9_-]{1,128}$/.test(workspaceId)) throw new HttpError(400, "Missing workspace.");
  let uid: string;
  try {
    uid = (await verifyFirebaseIdToken(token, sa.project_id)).uid;
  } catch {
    throw new HttpError(401, "Your session has expired. Sign in again.");
  }
  const db = getFirestore(adminApp(sa));
  const snap = await db.doc(`workspaces/${workspaceId}/members/${uid}`).get();
  if (!snap.exists) throw new HttpError(403, "You are not a member of this workspace.");
  const member = snap.data() as Member;
  if (opts.write && member.role === "viewer") throw new HttpError(403, "Viewers cannot do that.");
  if (opts.manage && member.role !== "owner" && member.role !== "admin") throw new HttpError(403, "Only owners and admins can manage connections.");
  return { sa, db, workspaceId, member, store: new AdminFirestoreStore(sa, workspaceId), actor: { id: member.id, name: member.name } };
}

// ---- secrets ----------------------------------------------------------------

export type Secrets = Record<string, string>;

function secretRef(db: Firestore, workspaceId: string, id: IntegrationId) {
  return db.doc(`workspaces/${workspaceId}/secrets/${id}`);
}

export async function readSecrets(ctx: Pick<ServerContext, "db" | "workspaceId">, id: IntegrationId): Promise<Secrets | null> {
  const snap = await secretRef(ctx.db, ctx.workspaceId, id).get();
  return snap.exists ? (snap.data() as Secrets) : null;
}

export async function writeSecrets(ctx: Pick<ServerContext, "db" | "workspaceId">, id: IntegrationId, secrets: Secrets): Promise<void> {
  await secretRef(ctx.db, ctx.workspaceId, id).set(secrets);
}

export async function deleteSecrets(ctx: Pick<ServerContext, "db" | "workspaceId">, id: IntegrationId): Promise<void> {
  await secretRef(ctx.db, ctx.workspaceId, id).delete();
}

/** Loads a connected integration with its secrets, or throws a clear error. */
export async function loadConnected(ctx: ServerContext, id: IntegrationId): Promise<{ integration: Integration; secrets: Secrets }> {
  const integration = await ctx.store.get("integrations", id);
  if (!integration || integration.status === "not_connected") throw new HttpError(409, `${id} is not connected.`);
  const secrets = await readSecrets(ctx, id);
  if (!secrets) throw new HttpError(409, `${id} has no stored credentials; connect it again.`);
  return { integration, secrets };
}

// ---- helpers ------------------------------------------------------------------

export function newToken(bytes = 24): string {
  return randomBytes(bytes).toString("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Public base URL for webhooks: APP_URL when set, else the request's own origin. */
export function appUrl(req: Request): string {
  const configured = process.env.APP_URL?.trim().replace(/\/$/, "");
  if (configured) return configured;
  const origin = new URL(req.url).origin;
  const forwardedHost = req.headers.get("x-forwarded-host");
  const forwardedProto = req.headers.get("x-forwarded-proto") ?? "https";
  return forwardedHost ? `${forwardedProto}://${forwardedHost}` : origin;
}

export async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, "Invalid JSON body.");
  }
}

export function jsonError(e: unknown): Response {
  const status = e instanceof HttpError ? e.status : 500;
  const message = e instanceof Error ? e.message : String(e);
  if (status >= 500) console.error("[integrations]", e);
  return Response.json({ error: message }, { status });
}

export function isIntegrationId(id: string): id is IntegrationId {
  return ["shopify", "woocommerce", "quickbooks", "square", "shippo", "easypost"].includes(id);
}

export const USER_AGENT = "Cumulus/0.1 (+https://github.com/colonel-fabtastic68/cumulus)";

/**
 * Bounded fetch that expects JSON back. Non-2xx answers and non-JSON bodies
 * (a login page, a bot challenge, a "coming soon" screen) become readable
 * errors instead of leaking into callers as strings.
 */
export async function fetchJson<T>(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<{ data: T; headers: Headers; status: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? 25_000);
  const host = new URL(url).host;
  try {
    const headers = new Headers(init.headers);
    if (!headers.has("user-agent")) headers.set("User-Agent", USER_AGENT);
    if (!headers.has("accept")) headers.set("Accept", "application/json");
    const res = await fetch(url, { ...init, headers, signal: controller.signal });
    if (res.status >= 300 && res.status < 400) {
      throw new HttpError(502, `${host} redirected the API call to ${res.headers.get("location") ?? "another page"} instead of answering it. The REST API is not being served at that address.`);
    }
    const text = await res.text();
    let data: unknown = null;
    let isJson = false;
    try {
      data = text ? JSON.parse(text) : null;
      isJson = true;
    } catch {
      data = text;
    }
    if (!res.ok) {
      const detail = isJson ? describeApiError(data) : summarizeHtml(text);
      const code = isJson && data && typeof (data as { code?: unknown }).code === "string" ? (data as { code: string }).code : undefined;
      throw new HttpError(res.status === 401 || res.status === 403 ? 401 : 502, `${host} answered ${res.status}${detail ? `: ${detail}` : ""}`, code);
    }
    if (!isJson && text.trim()) {
      throw new HttpError(502, `${host} answered with a web page instead of API data${summarizeHtml(text) ? ` (${summarizeHtml(text)})` : ""}. A security plugin, bot protection, password protection or a "coming soon" mode is probably intercepting REST API requests.`);
    }
    return { data: data as T, headers: res.headers, status: res.status };
  } catch (e) {
    if (e instanceof HttpError) throw e;
    if ((e as Error).name === "AbortError") throw new HttpError(504, `${host} did not answer in time.`);
    throw new HttpError(502, `Could not reach ${host}: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    clearTimeout(timer);
  }
}

/** The <title> of an HTML answer, or its first words, for error messages. */
function summarizeHtml(text: string): string {
  const title = /<title[^>]*>([^<]{1,120})<\/title>/i.exec(text)?.[1]?.trim();
  if (title) return title;
  const words = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return words.slice(0, 80);
}

/** Guards list endpoints: anything but an array means the platform answered with something unexpected. */
export function expectArray<T>(data: unknown, what: string, host: string): T[] {
  if (Array.isArray(data)) return data as T[];
  throw new HttpError(502, `${host} did not return a list of ${what} (got ${data === null ? "nothing" : typeof data}).`);
}

function describeApiError(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const d = data as Record<string, unknown>;
  const candidates = [d.error, d.errors, d.message, d.detail, (d.error as Record<string, unknown> | undefined)?.message];
  for (const c of candidates) {
    if (typeof c === "string" && c) return c.slice(0, 300);
    if (c && typeof c === "object") return JSON.stringify(c).slice(0, 300);
  }
  return "";
}
