import { HttpError, authenticateAccount, jsonError, readJson } from "@/lib/integrations/server";
import { isBillingExempt, isUsableCredit } from "@/lib/server/billingRules";
import { workspaceBilling, type SubscriptionRecord } from "@/lib/server/stripe";
import { avatarColor } from "@/lib/colors";
import { buildSeed, freshWorkspace, seedSettings } from "@/lib/seed";
import { newId, nowIso } from "@/lib/utils";
import { COLLECTIONS, type Member, type UserProfile, type WorkspaceMembership, type WorkspaceSettings, type WorkspaceSnapshot } from "@/lib/types";

const clean = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const BATCH_SIZE = 450;

/**
 * Creates a workspace for the signed-in account. Only accounts holding a paid
 * subscription that isn't attached to a workspace yet (or an exempt, verified
 * address) get one. The starting data (empty, or the Halcyon Audio sample) is
 * written first; the workspace itself and the subscription claim follow in
 * one transaction, so a payment is never spent on a workspace that failed to
 * fill, and the browser never has to write anything.
 */
export async function POST(req: Request) {
  try {
    const ctx = await authenticateAccount(req);
    const body = await readJson<{ name?: unknown; currency?: unknown; sample?: unknown }>(req);
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
    const currency = typeof body.currency === "string" && /^[A-Z]{3}$/.test(body.currency) ? body.currency : "";
    const sample = body.sample === true;
    if (!name) throw new HttpError(400, "Give the company a name.");
    if (!currency) throw new HttpError(400, "Pick a currency.");

    const profileSnap = await ctx.db.doc(`users/${ctx.uid}`).get();
    if (!profileSnap.exists) throw new HttpError(409, "Your account is still being set up. Reload and try again.");
    const profile = profileSnap.data() as UserProfile;
    const exempt = isBillingExempt(ctx.email, ctx.emailVerified, process.env.BILLING_EXEMPT_EMAILS);

    const id = newId("ws");
    const now = nowIso();
    const owner: Member = { id: ctx.uid, name: profile.name, email: profile.email, role: "owner", color: avatarColor(ctx.uid), status: "active", guest: profile.guest, lastSeenAt: now, createdAt: now };
    const membership: WorkspaceMembership = { id, name, role: "owner", joinedAt: now };

    // Starting data goes in before anything is claimed; nothing points at it until the transaction below succeeds.
    const snapshot: WorkspaceSnapshot = sample ? buildSeed() : freshWorkspace({ companyName: name, currency });
    const settings: WorkspaceSettings = { ...(snapshot.settings[0] ?? seedSettings()), id: "default", companyName: name, currency };
    snapshot.activity.push({ id: newId("act"), type: "settings.updated", message: `${profile.name} created ${name}`, actorId: ctx.uid, actorName: profile.name, createdAt: now });
    const seeded: Array<{ collection: string; id: string }> = [];
    for (const col of COLLECTIONS) {
      if (col === "members" || col === "settings") continue;
      for (const row of snapshot[col] as Array<{ id: string }>) seeded.push({ collection: col, id: row.id });
    }
    const rows = COLLECTIONS.filter((c) => c !== "members" && c !== "settings").flatMap((col) => (snapshot[col] as Array<{ id: string }>).map((row) => ({ col, row })));
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = ctx.db.batch();
      for (const { col, row } of rows.slice(i, i + BATCH_SIZE)) batch.set(ctx.db.doc(`workspaces/${id}/${col}/${row.id}`), clean(row));
      await batch.commit();
    }

    try {
      await ctx.db.runTransaction(async (tx) => {
      let credit: SubscriptionRecord | null = null;
      if (!exempt) {
        const subs = await tx.get(ctx.db.collection("subscriptions").where("uid", "==", ctx.uid));
        credit = subs.docs.map((d) => d.data() as SubscriptionRecord).filter(isUsableCredit).sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0] ?? null;
        if (!credit) throw new HttpError(402, "Creating a workspace needs an active subscription.");
      }
      const finalSettings: WorkspaceSettings = { ...settings, id: "default", companyName: name, currency, updatedAt: now, ...(credit ? { billing: workspaceBilling({ ...credit, workspaceId: id }) } : {}) };
      tx.set(ctx.db.doc(`workspaces/${id}`), { id, name, ownerId: ctx.uid, createdAt: now });
      tx.set(ctx.db.doc(`workspaces/${id}/members/${ctx.uid}`), clean(owner));
      tx.set(ctx.db.doc(`workspaces/${id}/settings/default`), clean(finalSettings));
      tx.set(ctx.db.doc(`users/${ctx.uid}`), { workspaces: { [id]: membership }, lastWorkspaceId: id, updatedAt: now }, { merge: true });
      if (credit) tx.update(ctx.db.doc(`subscriptions/${credit.id}`), { workspaceId: id, updatedAt: now });
      });
    } catch (e) {
      // Best effort: the data written above belongs to a workspace that never came to be.
      for (let i = 0; i < seeded.length; i += BATCH_SIZE) {
        const batch = ctx.db.batch();
        for (const { collection, id: docId } of seeded.slice(i, i + BATCH_SIZE)) batch.delete(ctx.db.doc(`workspaces/${id}/${collection}/${docId}`));
        await batch.commit().catch(() => {});
      }
      throw e;
    }
    return Response.json({ membership });
  } catch (e) {
    return jsonError(e);
  }
}
