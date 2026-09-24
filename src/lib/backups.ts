"use client";

import { useCallback, useMemo } from "react";
import { useApi } from "@/lib/api-client";
import { useSession } from "@/lib/session";
import { useStore } from "@/lib/store/provider";
import { useCurrentUser } from "@/lib/auth";
import type { BackupKind, BackupMeta } from "@/lib/server/backups";
import { COLLECTIONS, type CollectionName, type WorkspaceSnapshot } from "@/lib/types";
import { newId, nowIso } from "@/lib/utils";

export type { BackupKind, BackupMeta };

/**
 * Time Machine from the browser. Hosted workspaces go through the backups
 * API (Admin SDK, chunked storage); local mode keeps a handful of snapshots
 * in this browser so the feature works the same way without a server.
 */

const LOCAL_KEY = "cumulus:backups:v1";
const LOCAL_KEEP = 10;

interface LocalBackup {
  meta: BackupMeta;
  data: string;
}

function readLocal(): LocalBackup[] {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    return raw ? (JSON.parse(raw) as LocalBackup[]) : [];
  } catch {
    return [];
  }
}

function writeLocal(list: LocalBackup[]) {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(list.slice(0, LOCAL_KEEP)));
}

export interface BackupsApi {
  list: () => Promise<BackupMeta[]>;
  create: (label?: string) => Promise<BackupMeta>;
  restore: (id: string) => Promise<{ restored: BackupMeta; safety: BackupMeta }>;
  remove: (id: string) => Promise<void>;
  /** Where the backups live, for the section's explanatory text. */
  where: "server" | "browser";
}

export function useBackups(): BackupsApi {
  const { mode } = useSession();
  const api = useApi();
  const store = useStore();
  const user = useCurrentUser();

  const local = useCallback((): BackupsApi => {
    const snapshotMeta = (snapshot: WorkspaceSnapshot, json: string, kind: BackupKind, label?: string): BackupMeta => {
      const counts: Partial<Record<CollectionName, number>> = {};
      let docs = 0;
      for (const name of COLLECTIONS) {
        counts[name] = (snapshot[name] as unknown[]).length;
        docs += counts[name]!;
      }
      return { id: newId("bak"), kind, label: label?.trim() || undefined, createdAt: nowIso(), createdById: user.id, createdByName: user.name, docs, bytes: json.length, chunks: 1, counts };
    };
    const take = async (kind: BackupKind, label?: string) => {
      const snapshot = await store.snapshot();
      const data = JSON.stringify(snapshot);
      const meta = snapshotMeta(snapshot, data, kind, label);
      writeLocal([{ meta, data }, ...readLocal()]);
      return meta;
    };
    return {
      where: "browser",
      list: async () => readLocal().map((b) => b.meta),
      create: (label) => take("manual", label),
      restore: async (id) => {
        const found = readLocal().find((b) => b.meta.id === id);
        if (!found) throw new Error("That backup no longer exists.");
        const safety = await take("pre-restore", `Before restoring ${found.meta.label ?? found.meta.createdAt.slice(0, 16).replace("T", " ")}`);
        const members = await store.list("members");
        const snapshot = JSON.parse(found.data) as WorkspaceSnapshot;
        await store.replaceAll({ ...snapshot, members: members.length ? members : snapshot.members });
        return { restored: found.meta, safety };
      },
      remove: async (id) => writeLocal(readLocal().filter((b) => b.meta.id !== id)),
    };
  }, [store, user.id, user.name]);

  const hosted = useCallback(
    (): BackupsApi => ({
      where: "server",
      list: async () => (await api<{ backups: BackupMeta[] }>("/api/backups", undefined, { method: "GET" })).backups,
      create: async (label) => (await api<{ backup: BackupMeta }>("/api/backups", { label })).backup,
      restore: (id) => api<{ restored: BackupMeta; safety: BackupMeta }>(`/api/backups/${encodeURIComponent(id)}/restore`, {}),
      remove: async (id) => {
        await api(`/api/backups/${encodeURIComponent(id)}`, undefined, { method: "DELETE" });
      },
    }),
    [api],
  );

  return useMemo(() => (mode === "firestore" ? hosted() : local()), [mode, hosted, local]);
}
