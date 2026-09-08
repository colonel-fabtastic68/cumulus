/**
 * Accounts, workspaces and invites in Firestore mode. These documents live
 * outside a workspace (users/{uid}, workspaces/{id}, invites/{code}), so they
 * are handled here with the Firebase SDK rather than through the Store.
 */
import type { FirebaseApp } from "firebase/app";
import type { User } from "firebase/auth";
import { collection, deleteField, doc, getDoc, onSnapshot, query, setDoc, updateDoc, where, writeBatch, type Firestore } from "firebase/firestore";
import { getRuntimeConfig } from "@/lib/firebase-config";
import { sendMagicLink } from "@/lib/auth-link";
import { getDb } from "@/lib/store/firestore";
import { buildSeed, freshWorkspace, seedSettings } from "@/lib/seed";
import { COLLECTIONS, type ActivityEvent, type Member, type MemberRole, type UserProfile, type WorkspaceDoc, type WorkspaceInvite, type WorkspaceMembership, type WorkspaceSettings, type WorkspaceSnapshot } from "@/lib/types";
import { newId, nowIso } from "@/lib/utils";

const AVATAR_COLORS = ["#1f5f8b", "#7a3e9d", "#2e7d4f", "#b5541c", "#8b1f4f", "#3e6b9d", "#5c7a1f"];
/** Firestore batches take 500 writes; leave headroom. */
const BATCH_SIZE = 450;

export class WorkspaceError extends Error {}

/** Firestore rejects `undefined` values; drop them. */
function clean<T extends object>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function db(app: FirebaseApp): Firestore {
  return getDb(app);
}

export function avatarColor(seed: string): string {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length]!;
}

export function displayNameFor(user: User, preferred?: string | null): string {
  const fromForm = preferred?.trim();
  if (fromForm) return fromForm;
  if (user.displayName?.trim()) return user.displayName.trim();
  if (user.isAnonymous) return `Guest ${user.uid.slice(0, 4).toUpperCase()}`;
  return user.email?.split("@")[0] || "Teammate";
}

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

/**
 * The account's profile, created on first sign-in. Accounts that were members of
 * the pre-account workspace (CUMULUS_WORKSPACE) are carried over so nobody loses
 * access when accounts arrive.
 */
export async function loadOrCreateProfile(app: FirebaseApp, user: User, preferredName?: string | null): Promise<UserProfile> {
  const ref = doc(db(app), "users", user.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) return snap.data() as UserProfile;

  const now = nowIso();
  const profile: UserProfile = {
    id: user.uid,
    email: (user.email ?? "").toLowerCase(),
    name: displayNameFor(user, preferredName),
    guest: user.isAnonymous || undefined,
    workspaces: {},
    createdAt: now,
    updatedAt: now,
  };

  const legacy = getRuntimeConfig().workspaceId;
  try {
    const member = await getDoc(doc(db(app), "workspaces", legacy, "members", user.uid));
    if (member.exists()) {
      const m = member.data() as Member;
      const settings = await getDoc(doc(db(app), "workspaces", legacy, "settings", "default"));
      const name = (settings.data() as WorkspaceSettings | undefined)?.companyName?.trim() || "Workspace";
      profile.workspaces[legacy] = { id: legacy, name, role: m.role, joinedAt: m.createdAt || now };
      profile.lastWorkspaceId = legacy;
      if (m.name && !preferredName) profile.name = m.name;
    }
  } catch {
    // Not a member of the legacy workspace (or no rules access): start with none.
  }

  await setDoc(ref, clean(profile));
  return profile;
}

export function subscribeProfile(app: FirebaseApp, uid: string, cb: (profile: UserProfile | null) => void): () => void {
  return onSnapshot(doc(db(app), "users", uid), (snap) => cb(snap.exists() ? (snap.data() as UserProfile) : null));
}

export async function rememberWorkspace(app: FirebaseApp, uid: string, workspaceId: string): Promise<void> {
  await updateDoc(doc(db(app), "users", uid), { lastWorkspaceId: workspaceId, updatedAt: nowIso() }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Invites
// ---------------------------------------------------------------------------

export function subscribeInvitesForEmail(app: FirebaseApp, email: string, cb: (invites: WorkspaceInvite[]) => void): () => void {
  const q = query(collection(db(app), "invites"), where("email", "==", email.toLowerCase()), where("status", "==", "pending"));
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => d.data() as WorkspaceInvite)), () => cb([]));
}

export function subscribeWorkspaceInvites(app: FirebaseApp, workspaceId: string, cb: (invites: WorkspaceInvite[]) => void): () => void {
  const q = query(collection(db(app), "invites"), where("workspaceId", "==", workspaceId), where("status", "==", "pending"));
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => d.data() as WorkspaceInvite)), () => cb([]));
}

export async function createInvite(app: FirebaseApp, actor: { id: string; name: string }, workspace: { id: string; name: string }, opts: { email: string; role: MemberRole }): Promise<WorkspaceInvite> {
  const email = opts.email.trim().toLowerCase();
  if (!email) throw new WorkspaceError("Enter the teammate's email address.");
  const invite: WorkspaceInvite = {
    id: newId("inv"),
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    email,
    role: opts.role,
    invitedById: actor.id,
    invitedByName: actor.name,
    status: "pending",
    createdAt: nowIso(),
  };
  await setDoc(doc(db(app), "invites", invite.id), clean(invite));
  return invite;
}

export async function revokeInvite(app: FirebaseApp, id: string): Promise<void> {
  await updateDoc(doc(db(app), "invites", id), { status: "revoked" });
}

/** Anyone with the link can read an invite (ids are unguessable); the join page shows who invited whom before sign-in. */
export async function getInvite(app: FirebaseApp, id: string): Promise<WorkspaceInvite | null> {
  const snap = await getDoc(doc(db(app), "invites", id));
  return snap.exists() ? (snap.data() as WorkspaceInvite) : null;
}

export function joinPath(id: string): string {
  return `/join/${encodeURIComponent(id)}`;
}

/** The link a teammate opens to join: it signs them in (creating the account if needed) and lands them in the workspace. */
export function inviteLink(id: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}${joinPath(id)}`;
}

/** Mail the invite as a Firebase sign-in link that returns to the join page. */
export async function sendInviteEmail(app: FirebaseApp, invite: WorkspaceInvite): Promise<void> {
  if (!invite.email) throw new WorkspaceError("This invite has no email address.");
  await sendMagicLink(app, invite.email, joinPath(invite.id));
}

/** True when this account still has a member record in the workspace (false on any refusal). */
export async function hasMembership(app: FirebaseApp, uid: string, workspaceId: string): Promise<boolean> {
  try {
    const snap = await getDoc(doc(db(app), "workspaces", workspaceId, "members", uid));
    return snap.exists();
  } catch {
    return false;
  }
}

/** Drop a workspace the account was removed from, so the app stops trying to open it. */
export async function removeWorkspaceFromProfile(app: FirebaseApp, profile: UserProfile, workspaceId: string): Promise<void> {
  const patch: Record<string, unknown> = { [`workspaces.${workspaceId}`]: deleteField(), updatedAt: nowIso() };
  if (profile.lastWorkspaceId === workspaceId) patch.lastWorkspaceId = deleteField();
  await updateDoc(doc(db(app), "users", profile.id), patch);
}

/** Keep the workspace name on the profile in step with the company name in settings. */
export async function updateWorkspaceName(app: FirebaseApp, uid: string, workspaceId: string, name: string): Promise<void> {
  await updateDoc(doc(db(app), "users", uid), { [`workspaces.${workspaceId}.name`]: name, updatedAt: nowIso() });
}

/**
 * Redeem an invite code for the signed-in account: creates the member record,
 * marks the invite accepted and adds the workspace to the profile, atomically.
 */
export async function acceptInvite(app: FirebaseApp, profile: UserProfile, rawCode: string): Promise<WorkspaceMembership> {
  const code = rawCode.trim();
  if (!code) throw new WorkspaceError("Enter an invite code.");
  const inviteSnap = await getDoc(doc(db(app), "invites", code)).catch(() => null);
  if (!inviteSnap?.exists()) throw new WorkspaceError("That invite code doesn't match anything. Check it with whoever sent it.");
  const invite = inviteSnap.data() as WorkspaceInvite;
  if (invite.status !== "pending") throw new WorkspaceError(invite.status === "accepted" ? "That invite has already been used." : "That invite was revoked.");
  if (invite.email && invite.email !== profile.email) {
    throw new WorkspaceError(profile.email ? `That invite was sent to ${invite.email}. Sign in with that address to use it.` : `That invite was sent to ${invite.email}. Create an account with that address to use it.`);
  }
  if (profile.workspaces[invite.workspaceId]) throw new WorkspaceError(`You're already a member of ${invite.workspaceName}.`);

  const now = nowIso();
  const member: Member = {
    id: profile.id,
    name: profile.name,
    email: profile.email,
    role: invite.role,
    color: avatarColor(profile.id),
    status: "active",
    guest: profile.guest,
    inviteId: invite.id,
    lastSeenAt: now,
    createdAt: now,
  };
  const membership: WorkspaceMembership = { id: invite.workspaceId, name: invite.workspaceName, role: invite.role, joinedAt: now };
  const activity: ActivityEvent = {
    id: newId("act"),
    type: "member.joined",
    message: `${profile.name} joined the workspace`,
    actorId: profile.id,
    actorName: profile.name,
    entityType: "member",
    entityId: profile.id,
    createdAt: now,
  };

  const batch = writeBatch(db(app));
  batch.set(doc(db(app), "workspaces", invite.workspaceId, "members", profile.id), clean(member));
  batch.update(doc(db(app), "invites", invite.id), { status: "accepted", acceptedById: profile.id, acceptedByName: profile.name, acceptedAt: now });
  batch.update(doc(db(app), "users", profile.id), { [`workspaces.${invite.workspaceId}`]: membership, lastWorkspaceId: invite.workspaceId, updatedAt: now });
  batch.set(doc(db(app), "workspaces", invite.workspaceId, "activity", activity.id), clean(activity));
  await batch.commit();
  return membership;
}

// ---------------------------------------------------------------------------
// Workspaces
// ---------------------------------------------------------------------------

export interface CreateWorkspaceOptions {
  name: string;
  currency: string;
  /** Start from the Halcyon Audio demo instead of an empty workspace. */
  sample?: boolean;
}

/**
 * Create a workspace owned by the signed-in account. The workspace document,
 * its settings, the owner's member record and the profile entry go in the
 * first batch (the rules need them before anything else), then the data.
 */
export async function createWorkspace(app: FirebaseApp, profile: UserProfile, opts: CreateWorkspaceOptions): Promise<WorkspaceMembership> {
  const name = opts.name.trim();
  if (!name) throw new WorkspaceError("Give the company a name.");
  const id = newId("ws");
  const now = nowIso();

  const owner: Member = {
    id: profile.id,
    name: profile.name,
    email: profile.email,
    role: "owner",
    color: avatarColor(profile.id),
    status: "active",
    guest: profile.guest,
    lastSeenAt: now,
    createdAt: now,
  };
  const snapshot: WorkspaceSnapshot = opts.sample ? buildSeed() : freshWorkspace({ companyName: name, currency: opts.currency });
  const settings: WorkspaceSettings = { ...(snapshot.settings[0] ?? seedSettings()), id: "default", companyName: name, currency: opts.currency };
  snapshot.settings = [settings];
  snapshot.members = [owner];
  snapshot.activity = [
    ...snapshot.activity,
    { id: newId("act"), type: "settings.updated", message: `${profile.name} created ${name}`, actorId: profile.id, actorName: profile.name, createdAt: now },
  ];
  const workspace: WorkspaceDoc = { id, name, ownerId: profile.id, createdAt: now };
  const membership: WorkspaceMembership = { id, name, role: "owner", joinedAt: now };

  const firestore = db(app);
  const first = writeBatch(firestore);
  first.set(doc(firestore, "workspaces", id), clean(workspace));
  first.set(doc(firestore, "workspaces", id, "members", owner.id), clean(owner));
  first.set(doc(firestore, "workspaces", id, "settings", "default"), clean(settings));
  first.update(doc(firestore, "users", profile.id), { [`workspaces.${id}`]: membership, lastWorkspaceId: id, updatedAt: now });
  await first.commit();

  const rest: Array<{ collection: string; row: { id: string } }> = [];
  for (const col of COLLECTIONS) {
    if (col === "members" || col === "settings") continue;
    for (const row of snapshot[col] as Array<{ id: string }>) rest.push({ collection: col, row });
  }
  for (let i = 0; i < rest.length; i += BATCH_SIZE) {
    const batch = writeBatch(firestore);
    for (const { collection: col, row } of rest.slice(i, i + BATCH_SIZE)) batch.set(doc(firestore, "workspaces", id, col, row.id), clean(row));
    await batch.commit();
  }
  return membership;
}

/** Plain-language messages for the Firestore errors people hit on these flows. */
export function describeWorkspaceError(e: unknown): string {
  if (e instanceof WorkspaceError) return e.message;
  const code = (e as { code?: string })?.code ?? "";
  if (code.includes("permission-denied")) return "Firestore refused the request. The project's security rules need the version in this repo's firestore.rules (accounts, workspaces and invites).";
  if (code.includes("unavailable")) return "Could not reach Firestore. Check your connection and try again.";
  return e instanceof Error ? e.message : String(e);
}
