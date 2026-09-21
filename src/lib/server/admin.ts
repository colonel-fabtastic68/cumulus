import type { Firestore } from "firebase-admin/firestore";
import type { BusinessIntake, Integration, Member, UserProfile, WorkspaceDoc } from "@/lib/types";
import type { SubscriptionRecord } from "@/lib/server/stripe";

/**
 * Read-only overview of every account, workspace and subscription for the
 * people listed in ADMIN_EMAILS. Uses the Admin SDK, so the security rules
 * (which keep members and subscriptions private) do not apply here.
 */

/** ADMIN_EMAILS: comma or space separated addresses allowed to open /admin. Only verified addresses count. */
export function isAdminEmail(email: string, emailVerified: boolean, raw: string | undefined): boolean {
  if (!emailVerified || !email) return false;
  const list = (raw ?? "").split(/[,\s]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
  return list.includes(email.toLowerCase());
}

export interface AdminAccount {
  id: string;
  email: string;
  name: string;
  guest: boolean;
  createdAt: string;
  workspaceIds: string[];
  business?: BusinessIntake;
}

export interface AdminWorkspace {
  id: string;
  name: string;
  ownerId: string;
  ownerEmail?: string;
  createdAt: string;
  members: Array<Pick<Member, "id" | "name" | "email" | "role" | "status" | "lastSeenAt">>;
  integrations: Array<Pick<Integration, "id" | "status" | "lastSyncAt" | "lastError">>;
  counts: { items: number; orders: number };
  subscription?: Pick<SubscriptionRecord, "id" | "status" | "plan" | "currentPeriodEnd" | "email">;
  lastActivityAt?: string;
}

export interface AdminSubscription extends Pick<SubscriptionRecord, "id" | "email" | "plan" | "status" | "currentPeriodEnd" | "workspaceId" | "createdAt"> {
  workspaceName?: string;
}

export interface AdminFeedback {
  id: string;
  email: string;
  kind: string;
  message: string;
  page?: string;
  workspaceId?: string;
  workspaceName?: string;
  createdAt: string;
}

export interface AdminSubscriber {
  email: string;
  subscribed: boolean;
  source: string;
  createdAt: string;
}

export interface AdminOverview {
  generatedAt: string;
  accounts: AdminAccount[];
  workspaces: AdminWorkspace[];
  subscriptions: AdminSubscription[];
  feedback: AdminFeedback[];
  mailingList: AdminSubscriber[];
}

async function countOf(db: Firestore, path: string): Promise<number> {
  try {
    const snap = await db.collection(path).count().get();
    return snap.data().count;
  } catch {
    return 0;
  }
}

export async function buildAdminOverview(db: Firestore): Promise<AdminOverview> {
  const [users, workspaces, subs, notes, list] = await Promise.all([db.collection("users").get(), db.collection("workspaces").get(), db.collection("subscriptions").get(), db.collection("feedback").orderBy("createdAt", "desc").limit(200).get(), db.collection("mailingList").orderBy("createdAt", "desc").limit(2000).get()]);

  const accounts: AdminAccount[] = users.docs
    .map((d) => d.data() as UserProfile)
    .map((p) => ({ id: p.id, email: p.email, name: p.name, guest: !!p.guest, createdAt: p.createdAt, workspaceIds: Object.keys(p.workspaces ?? {}), business: p.business }))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const emailById = new Map(accounts.map((a) => [a.id, a.email]));

  const subscriptions: AdminSubscription[] = subs.docs.map((d) => {
    const s = d.data() as SubscriptionRecord;
    return { id: s.id, email: s.email, plan: s.plan, status: s.status, currentPeriodEnd: s.currentPeriodEnd, workspaceId: s.workspaceId, createdAt: s.createdAt };
  });
  const subByWorkspace = new Map(subscriptions.filter((s) => s.workspaceId).map((s) => [s.workspaceId as string, s]));

  const out: AdminWorkspace[] = await Promise.all(
    workspaces.docs.map(async (d) => {
      const w = d.data() as WorkspaceDoc;
      const base = `workspaces/${d.id}`;
      const [members, integrations, items, orders, activity] = await Promise.all([
        db.collection(`${base}/members`).get(),
        db.collection(`${base}/integrations`).get(),
        countOf(db, `${base}/items`),
        countOf(db, `${base}/orders`),
        db.collection(`${base}/activity`).orderBy("createdAt", "desc").limit(1).get().catch(() => null),
      ]);
      const sub = subByWorkspace.get(d.id);
      return {
        id: d.id,
        name: w.name ?? d.id,
        ownerId: w.ownerId ?? "",
        ownerEmail: emailById.get(w.ownerId ?? ""),
        createdAt: w.createdAt ?? "",
        members: members.docs.map((m) => {
          const x = m.data() as Member;
          return { id: x.id ?? m.id, name: x.name, email: x.email, role: x.role, status: x.status, lastSeenAt: x.lastSeenAt };
        }),
        integrations: integrations.docs.map((i) => {
          const x = i.data() as Integration;
          return { id: x.id, status: x.status, lastSyncAt: x.lastSyncAt, lastError: x.lastError };
        }),
        counts: { items, orders },
        subscription: sub ? { id: sub.id, status: sub.status, plan: sub.plan, currentPeriodEnd: sub.currentPeriodEnd, email: sub.email } : undefined,
        lastActivityAt: (activity?.docs[0]?.data() as { createdAt?: string } | undefined)?.createdAt,
      };
    }),
  );
  out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const nameById = new Map(out.map((w) => [w.id, w.name]));
  for (const s of subscriptions) if (s.workspaceId) s.workspaceName = nameById.get(s.workspaceId);
  subscriptions.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const feedback: AdminFeedback[] = notes.docs.map((d) => {
    const f = d.data() as AdminFeedback;
    return { id: f.id ?? d.id, email: f.email, kind: f.kind, message: f.message, page: f.page, workspaceId: f.workspaceId, workspaceName: f.workspaceId ? nameById.get(f.workspaceId) : undefined, createdAt: f.createdAt };
  });

  const mailingList: AdminSubscriber[] = list.docs.map((d) => {
    const m = d.data() as AdminSubscriber;
    return { email: m.email, subscribed: m.subscribed !== false, source: m.source ?? "landing", createdAt: m.createdAt };
  });

  return { generatedAt: new Date().toISOString(), accounts, workspaces: out, subscriptions, feedback, mailingList };
}
