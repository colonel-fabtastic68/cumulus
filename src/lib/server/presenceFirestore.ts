import type { Firestore } from "firebase-admin/firestore";
import type { InstanceDef } from "@/lib/instances";
import { assertTokenPool, firestoreFor } from "@/lib/integrations/server";
import { verifyFirebaseIdToken } from "@/lib/integrations/verifyIdToken";
import type { ServiceAccount } from "@/lib/mcp/adminStore";
import { CLOSE } from "@/lib/presence";
import { twoStepPending } from "@/lib/twoStep";
import { PresenceHub, PresenceRefusal, type PresenceAuthenticator, type PresenceBackbone, type StoredPeer } from "./presence";

/**
 * Live presence wired to Firebase: sessions shared between function instances
 * in `presence/{workspace}/sessions/{session}` (server only; firestore.rules
 * refuses browsers), and the hello message checked like any API call: a valid
 * ID token from the right account pool, two-step sign-in finished, and a
 * member record in the workspace.
 */

export function firestoreBackbone(db: Firestore): PresenceBackbone {
  const sessions = (ws: string) => db.collection("presence").doc(ws).collection("sessions");
  return {
    async put(ws, peer) {
      await sessions(ws).doc(peer.sessionId).set(peer);
    },
    async remove(ws, id) {
      await sessions(ws).doc(id).delete();
    },
    watch(ws, onChange) {
      return sessions(ws).onSnapshot(
        (snap) => onChange(snap.docs.map((d) => d.data() as StoredPeer)),
        (e) => console.error("[presence] listener failed", e),
      );
    },
  };
}

export function firebaseAuthenticator(sa: ServiceAccount, instance: InstanceDef | null, db: Firestore): PresenceAuthenticator {
  return async (token, workspaceId) => {
    let t;
    try {
      t = await verifyFirebaseIdToken(token, sa.project_id);
    } catch {
      throw new PresenceRefusal(CLOSE.signIn, "Your session has expired. Sign in again.");
    }
    try {
      assertTokenPool(t, instance);
    } catch (e) {
      throw new PresenceRefusal(CLOSE.signIn, e instanceof Error ? e.message : "This account cannot sign in here.");
    }
    if (twoStepPending(t.twoStep)) throw new PresenceRefusal(CLOSE.signIn, "Enter the sign-in code we emailed you first.");
    if (instance && workspaceId !== instance.workspaceId) throw new PresenceRefusal(CLOSE.notMember, "You are not a member of this workspace.");
    const snap = await db.doc(`workspaces/${workspaceId}/members/${t.uid}`).get();
    if (!snap.exists) throw new PresenceRefusal(CLOSE.notMember, "You are not a member of this workspace.");
    return { memberId: t.uid, workspaceId };
  };
}

/** One hub per database for the life of the function instance. */
const hubs = new Map<string, PresenceHub>();

export function presenceHubFor(sa: ServiceAccount, instance: InstanceDef | null): PresenceHub {
  const key = instance?.databaseId ?? "(default)";
  let hub = hubs.get(key);
  if (!hub) {
    const db = firestoreFor(sa, instance);
    hub = new PresenceHub({ authenticate: firebaseAuthenticator(sa, instance, db), backbone: firestoreBackbone(db) });
    hubs.set(key, hub);
  }
  return hub;
}
