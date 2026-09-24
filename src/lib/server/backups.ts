import type { Firestore } from "firebase-admin/firestore";
import { COLLECTIONS, type CollectionName, type Member, type WorkspaceSnapshot } from "@/lib/types";
import { activityOp } from "@/lib/inventory";
import { HttpError, type ServerContext } from "@/lib/integrations/server";
import { newId, nowIso } from "@/lib/utils";

/**
 * Time Machine: whole-workspace snapshots stored under
 * `workspaces/{ws}/backups/{id}` (metadata) with the JSON split across
 * `.../chunks/{n}` so no document nears Firestore's size limit. Only the
 * server reads or writes them; the security rules never match this path.
 */

export type BackupKind = "manual" | "auto" | "pre-restore";

export interface BackupMeta {
  id: string;
  kind: BackupKind;
  label?: string;
  createdAt: string;
  createdById: string;
  createdByName: string;
  /** Documents across every collection. */
  docs: number;
  /** Size of the JSON snapshot. */
  bytes: number;
  chunks: number;
  counts: Partial<Record<CollectionName, number>>;
}

/** Characters per chunk document; well under the 1 MiB document limit. */
const CHUNK_CHARS = 700_000;
/** Chunk documents per write batch; keeps each batch under Firestore's payload limit. */
const CHUNKS_PER_BATCH = 8;
/** Automatic backups kept per workspace. Manual ones are kept until deleted, up to the overall cap. */
export const AUTO_KEEP = 14;
export const MAX_BACKUPS = 40;

const backupsCol = (db: Firestore, ws: string) => db.collection(`workspaces/${ws}/backups`);
const metaRef = (db: Firestore, ws: string, id: string) => backupsCol(db, ws).doc(id);

export async function listBackups(db: Firestore, ws: string): Promise<BackupMeta[]> {
  const snap = await backupsCol(db, ws).get();
  return snap.docs.map((d) => d.data() as BackupMeta).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function createBackup(ctx: ServerContext, opts: { kind: BackupKind; label?: string }): Promise<BackupMeta> {
  const snapshot = await ctx.store.snapshot();
  const json = JSON.stringify(snapshot);
  const id = newId("bak");
  const chunks: string[] = [];
  for (let i = 0; i < json.length; i += CHUNK_CHARS) chunks.push(json.slice(i, i + CHUNK_CHARS));
  const counts: Partial<Record<CollectionName, number>> = {};
  let docs = 0;
  for (const name of COLLECTIONS) {
    const n = (snapshot[name] as unknown[]).length;
    counts[name] = n;
    docs += n;
  }
  const meta: BackupMeta = {
    id,
    kind: opts.kind,
    label: opts.label?.trim() || undefined,
    createdAt: nowIso(),
    createdById: ctx.actor.id,
    createdByName: ctx.actor.name,
    docs,
    bytes: Buffer.byteLength(json, "utf8"),
    chunks: chunks.length,
    counts,
  };
  const ref = metaRef(ctx.db, ctx.workspaceId, id);
  for (let i = 0; i < chunks.length; i += CHUNKS_PER_BATCH) {
    const batch = ctx.db.batch();
    chunks.slice(i, i + CHUNKS_PER_BATCH).forEach((data, j) => batch.set(ref.collection("chunks").doc(String(i + j).padStart(4, "0")), { n: i + j, data }));
    await batch.commit();
  }
  // Metadata last, so a half-written backup never lists.
  await ref.set(stripUndefined(meta));
  if (opts.kind !== "auto") await ctx.store.batch([activityOp(ctx.actor, "backup.created", `${ctx.actor.name} backed up the workspace${meta.label ? ` · ${meta.label}` : ""} (${docs} records)`, { meta: { backupId: id, kind: opts.kind, docs } })]);
  return meta;
}

function stripUndefined<T extends object>(o: T): T {
  return JSON.parse(JSON.stringify(o)) as T;
}

/** Every collection present as an array; unknown keys dropped, missing ones empty. */
export function normalizeSnapshot(raw: unknown): WorkspaceSnapshot {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out = {} as Record<CollectionName, unknown[]>;
  for (const name of COLLECTIONS) out[name] = Array.isArray(src[name]) ? (src[name] as unknown[]) : [];
  return out as unknown as WorkspaceSnapshot;
}

export async function readBackup(db: Firestore, ws: string, id: string): Promise<{ meta: BackupMeta; snapshot: WorkspaceSnapshot }> {
  const ref = metaRef(db, ws, id);
  const metaSnap = await ref.get();
  if (!metaSnap.exists) throw new HttpError(404, "That backup no longer exists.");
  const meta = metaSnap.data() as BackupMeta;
  const chunks = await ref.collection("chunks").orderBy("n").get();
  if (chunks.size !== meta.chunks) throw new HttpError(409, "That backup is incomplete and cannot be restored.");
  const json = chunks.docs.map((d) => (d.data() as { data: string }).data).join("");
  return { meta, snapshot: normalizeSnapshot(JSON.parse(json)) };
}

export async function deleteBackup(db: Firestore, ws: string, id: string): Promise<void> {
  const ref = metaRef(db, ws, id);
  const chunks = await ref.collection("chunks").get();
  for (let i = 0; i < chunks.docs.length; i += 400) {
    const batch = db.batch();
    for (const d of chunks.docs.slice(i, i + 400)) batch.delete(d.ref);
    await batch.commit();
  }
  await ref.delete();
}

/**
 * Puts the workspace back the way the backup has it. The current team stays
 * (people keep their access), and a safety backup is taken first so the
 * restore itself can be undone.
 */
export async function restoreBackup(ctx: ServerContext, id: string): Promise<{ restored: BackupMeta; safety: BackupMeta }> {
  const { meta, snapshot } = await readBackup(ctx.db, ctx.workspaceId, id);
  const safety = await createBackup(ctx, { kind: "pre-restore", label: `Before restoring ${meta.label ?? meta.createdAt.slice(0, 16).replace("T", " ")}` });
  const members = await ctx.store.list("members");
  const restored: WorkspaceSnapshot = { ...snapshot, members: members.length ? (members as Member[]) : snapshot.members };
  await ctx.store.replaceAll(restored);
  await ctx.store.batch([activityOp(ctx.actor, "backup.restored", `${ctx.actor.name} restored the workspace to ${meta.createdAt.slice(0, 16).replace("T", " ")}${meta.label ? ` (${meta.label})` : ""} · ${meta.docs} records`, { meta: { backupId: id, safetyBackupId: safety.id } })]);
  return { restored: meta, safety };
}

/** Keeps the newest automatic backups and caps the total; manual and safety backups go only when the cap forces it. */
export async function pruneBackups(db: Firestore, ws: string): Promise<number> {
  const all = await listBackups(db, ws);
  const doomed: BackupMeta[] = [];
  const autos = all.filter((b) => b.kind === "auto");
  doomed.push(...autos.slice(AUTO_KEEP));
  const remaining = all.filter((b) => !doomed.includes(b));
  if (remaining.length > MAX_BACKUPS) doomed.push(...remaining.slice(MAX_BACKUPS));
  for (const b of doomed) await deleteBackup(db, ws, b.id);
  return doomed.length;
}

/** The daily pass: a new automatic backup only when something changed since the last one. */
export async function autoBackup(ctx: ServerContext): Promise<string> {
  const backups = await listBackups(ctx.db, ctx.workspaceId);
  const last = backups[0];
  const latest = await ctx.db.collection(`workspaces/${ctx.workspaceId}/activity`).orderBy("createdAt", "desc").limit(1).get();
  const lastChange = latest.docs[0]?.get("createdAt") as string | undefined;
  if (last && lastChange && lastChange <= last.createdAt) return "unchanged";
  if (!lastChange && last) return "unchanged";
  const meta = await createBackup(ctx, { kind: "auto" });
  const pruned = await pruneBackups(ctx.db, ctx.workspaceId);
  return `backed up ${meta.docs} records${pruned ? `, ${pruned} old backup${pruned === 1 ? "" : "s"} removed` : ""}`;
}
