import type { Firestore } from "firebase-admin/firestore";
import type { UserProfile, WorkspaceDoc } from "@/lib/types";
import { HttpError } from "@/lib/integrations/server";
import { adminApp, type ServiceAccount } from "@/lib/mcp/adminStore";
import { newId, nowIso } from "@/lib/utils";

/**
 * Destructive admin actions. Each one is refused when it would silently take
 * something away from other people, and every run is written to the
 * server-only `adminActions` collection.
 */

export interface OwnedWorkspace {
  id: string;
  name: string;
  members: number;
}

export interface DeleteUserResult {
  uid: string;
  email: string;
  membershipsRemoved: number;
  workspacesDeleted: OwnedWorkspace[];
  authDeleted: boolean;
  /** Stripe subscriptions on the account, which are not touched here. */
  subscriptions: string[];
}

/** Workspaces this account owns, with how many members each has. */
export async function ownedWorkspaces(db: Firestore, uid: string): Promise<OwnedWorkspace[]> {
  const snap = await db.collection("workspaces").where("ownerId", "==", uid).get();
  return Promise.all(
    snap.docs.map(async (d) => {
      const w = d.data() as WorkspaceDoc;
      const members = await db.collection(`workspaces/${d.id}/members`).count().get();
      return { id: d.id, name: w.name ?? d.id, members: members.data().count };
    }),
  );
}

/**
 * Removes an account: memberships, profile, pending email code, the Firebase
 * Auth user, and (only when asked) the workspaces it owns with everything in
 * them. Subscriptions are left for the admin to cancel in Stripe.
 */
export async function deleteUser(db: Firestore, sa: ServiceAccount, opts: { uid: string; actorUid: string; actorEmail: string; deleteOwnedWorkspaces: boolean }): Promise<DeleteUserResult> {
  const { uid } = opts;
  if (uid === opts.actorUid) throw new HttpError(400, "You cannot delete the account you are signed in with.");
  const profileSnap = await db.doc(`users/${uid}`).get();
  const profile = profileSnap.exists ? (profileSnap.data() as UserProfile) : null;
  const owned = await ownedWorkspaces(db, uid);
  if (owned.length && !opts.deleteOwnedWorkspaces) {
    throw new HttpError(409, `This account owns ${owned.length} workspace${owned.length === 1 ? "" : "s"} (${owned.map((w) => `${w.name}, ${w.members} member${w.members === 1 ? "" : "s"}`).join("; ")}). Confirm deleting them too, or leave the account.`, "owns_workspaces");
  }

  // Memberships in workspaces owned by others.
  const ownedIds = new Set(owned.map((w) => w.id));
  const memberOf = Object.keys(profile?.workspaces ?? {}).filter((id) => !ownedIds.has(id));
  let membershipsRemoved = 0;
  for (const wsId of memberOf) {
    const ref = db.doc(`workspaces/${wsId}/members/${uid}`);
    if ((await ref.get()).exists) {
      await ref.delete();
      membershipsRemoved++;
    }
  }

  // Owned workspaces go with everything under them (items, orders, secrets, activity…).
  for (const w of owned) await db.recursiveDelete(db.doc(`workspaces/${w.id}`));

  const subs = await db.collection("subscriptions").where("uid", "==", uid).get();
  await db.doc(`emailCodes/${uid}`).delete().catch(() => {});
  await db.doc(`users/${uid}`).delete().catch(() => {});

  let authDeleted = false;
  const credential = adminApp(sa).options.credential;
  if (credential) {
    const { access_token } = await credential.getAccessToken();
    const res = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(sa.project_id)}/accounts:delete`, {
      method: "POST",
      headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ localId: uid }),
    });
    authDeleted = res.ok;
    if (!res.ok) console.error("[admin] accounts:delete failed", res.status, (await res.text().catch(() => "")).slice(0, 300));
  }

  const result: DeleteUserResult = { uid, email: profile?.email ?? "", membershipsRemoved, workspacesDeleted: owned, authDeleted, subscriptions: subs.docs.map((d) => d.id) };
  await db.doc(`adminActions/${newId("adm")}`).set({ action: "user.delete", actorUid: opts.actorUid, actorEmail: opts.actorEmail, target: uid, targetEmail: result.email, result, at: nowIso() });
  return result;
}
