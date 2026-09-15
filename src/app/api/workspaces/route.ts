import { HttpError, authenticateAccount, jsonError, readJson } from "@/lib/integrations/server";
import { isBillingExempt, isUsableCredit } from "@/lib/server/billingRules";
import { workspaceBilling, type SubscriptionRecord } from "@/lib/server/stripe";
import { avatarColor } from "@/lib/colors";
import { newId, nowIso } from "@/lib/utils";
import type { Member, UserProfile, WorkspaceMembership, WorkspaceSettings } from "@/lib/types";

const clean = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/**
 * Creates a workspace for the signed-in account. Only accounts holding a paid
 * subscription that isn't attached to a workspace yet (or an exempt, verified
 * address) get one; the subscription is claimed in the same transaction. The
 * browser then writes the starting data as the new owner.
 */
export async function POST(req: Request) {
  try {
    const ctx = await authenticateAccount(req);
    const body = await readJson<{ name?: unknown; currency?: unknown; settings?: unknown }>(req);
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
    const currency = typeof body.currency === "string" && /^[A-Z]{3}$/.test(body.currency) ? body.currency : "";
    const settings = body.settings && typeof body.settings === "object" && !Array.isArray(body.settings) ? (body.settings as WorkspaceSettings) : null;
    if (!name) throw new HttpError(400, "Give the company a name.");
    if (!currency) throw new HttpError(400, "Pick a currency.");
    if (!settings) throw new HttpError(400, "Missing workspace settings.");

    const profileSnap = await ctx.db.doc(`users/${ctx.uid}`).get();
    if (!profileSnap.exists) throw new HttpError(409, "Your account is still being set up. Reload and try again.");
    const profile = profileSnap.data() as UserProfile;
    const exempt = isBillingExempt(ctx.email, ctx.emailVerified, process.env.BILLING_EXEMPT_EMAILS);

    const id = newId("ws");
    const now = nowIso();
    const owner: Member = { id: ctx.uid, name: profile.name, email: profile.email, role: "owner", color: avatarColor(ctx.uid), status: "active", guest: profile.guest, lastSeenAt: now, createdAt: now };
    const membership: WorkspaceMembership = { id, name, role: "owner", joinedAt: now };

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
    return Response.json({ membership });
  } catch (e) {
    return jsonError(e);
  }
}
