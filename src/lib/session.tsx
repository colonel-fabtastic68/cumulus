"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { FirebaseApp } from "firebase/app";
import type { User } from "firebase/auth";
import { getRuntimeConfig } from "@/lib/firebase-config";
import type { BusinessIntake, MemberRole, UserProfile, WorkspaceInvite, WorkspaceMembership } from "@/lib/types";
import { debugLog } from "@/lib/debug";
import { getFirebaseApp, getFirebaseAuth, readFirebaseConfig } from "@/lib/store/firestore";
import { acceptInvite as acceptInviteDoc, createInvite as createInviteDoc, createWorkspace as createWorkspaceDoc, hasMembership, loadOrCreateProfile, rememberWorkspace, removeWorkspaceFromProfile, revokeInvite as revokeInviteDoc, saveBusinessIntake, subscribeInvitesForEmail, subscribeProfile, subscribeWorkspaceInvites, updateWorkspaceName as updateWorkspaceNameDoc, type CreateWorkspaceOptions } from "@/lib/workspaces";

export type SessionStatus = "loading" | "signed-out" | "no-workspace" | "ready";

export interface SessionUser {
  uid: string;
  email: string;
  name: string;
  isAnonymous: boolean;
  emailVerified: boolean;
  /** When the Firebase account was created (ISO). */
  createdAt: string;
  /** Signs in with a password (as opposed to only emailed links). */
  passwordAccount: boolean;
}

/** Password accounts created from this moment confirm their email with a one-time code. Older accounts are left alone. */
export const EMAIL_CODES_FROM = "2026-09-15T00:00:00.000Z";
/** Accounts created from this moment see the short business intake once. */
export const INTAKE_FROM = "2026-09-16T00:00:00.000Z";

function toSessionUser(user: User): SessionUser {
  return {
    uid: user.uid,
    email: (user.email ?? "").toLowerCase(),
    name: user.displayName ?? "",
    isAnonymous: user.isAnonymous,
    emailVerified: user.emailVerified,
    createdAt: user.metadata.creationTime ? new Date(user.metadata.creationTime).toISOString() : "",
    passwordAccount: user.providerData.some((p) => p.providerId === "password"),
  };
}

export interface SessionValue {
  mode: "local" | "firestore";
  status: SessionStatus;
  /** The Firebase app in Firestore mode, for auth helpers. */
  app: FirebaseApp | null;
  /** The Firebase account, once auth state is known. */
  account: SessionUser | null;
  profile: UserProfile | null;
  /** Workspaces this account belongs to. */
  workspaces: WorkspaceMembership[];
  /** The workspace the app is showing, or null when the account has none. */
  workspaceId: string | null;
  workspace: WorkspaceMembership | null;
  pendingInvites: WorkspaceInvite[];
  /** Why the last profile load failed, if it did. */
  error: string | null;
  /** Something the hub should tell the person, e.g. that a workspace dropped them. Cleared when read. */
  notice: string | null;
  clearNotice: () => void;
  switchWorkspace: (id: string) => void;
  createWorkspace: (opts: CreateWorkspaceOptions) => Promise<WorkspaceMembership>;
  acceptInvite: (code: string) => Promise<WorkspaceMembership>;
  createInvite: (opts: { email: string; role: MemberRole }) => Promise<WorkspaceInvite>;
  revokeInvite: (id: string) => Promise<void>;
  subscribeWorkspaceInvites: (cb: (invites: WorkspaceInvite[]) => void) => () => void;
  /** Called when the open workspace's company name differs from what the profile remembers. */
  updateWorkspaceName: (id: string, name: string) => void;
  /**
   * The open workspace refused access. Confirms the member record is gone, then
   * drops the workspace from the profile. Resolves false when access still exists
   * (a transient failure), so the caller can retry instead.
   */
  forgetWorkspace: (id: string) => Promise<boolean>;
  /** A new password account that still has to enter the emailed one-time code. */
  needsEmailCode: boolean;
  /** A new account that has not answered (or skipped) the welcome intake yet. */
  needsIntake: boolean;
  /** Saves the welcome intake on the profile; the listener clears needsIntake. */
  saveIntake: (intake: Omit<BusinessIntake, "completedAt">) => Promise<void>;
  /** Reloads the Firebase account, e.g. after its email was verified. */
  refreshAccount: () => Promise<void>;
}

const LOCAL_SESSION: SessionValue = {
  mode: "local",
  status: "ready",
  app: null,
  account: null,
  profile: null,
  workspaces: [],
  workspaceId: "local",
  workspace: null,
  pendingInvites: [],
  error: null,
  notice: null,
  clearNotice: () => {},
  switchWorkspace: () => {},
  createWorkspace: () => Promise.reject(new Error("Local mode has a single workspace.")),
  acceptInvite: () => Promise.reject(new Error("Local mode has no invites.")),
  createInvite: () => Promise.reject(new Error("Local mode has no invites.")),
  revokeInvite: () => Promise.reject(new Error("Local mode has no invites.")),
  subscribeWorkspaceInvites: () => () => {},
  updateWorkspaceName: () => {},
  forgetWorkspace: () => Promise.resolve(false),
  needsEmailCode: false,
  needsIntake: false,
  saveIntake: () => Promise.resolve(),
  refreshAccount: () => Promise.resolve(),
};

const SessionContext = createContext<SessionValue>(LOCAL_SESSION);

/** The name typed on the sign-up form, read once when the profile is first created. */
let pendingSignUpName: string | null = null;
export function setPendingSignUpName(name: string | null) {
  pendingSignUpName = name?.trim() || null;
}

function savedWorkspaceKey(uid: string) {
  return `cumulus:workspace:${uid}`;
}

function readSavedWorkspace(uid: string): string | null {
  try {
    return localStorage.getItem(savedWorkspaceKey(uid));
  } catch {
    return null;
  }
}

/**
 * Firestore mode: who is signed in, which workspaces they belong to and which
 * one the app should open. Local mode is a single workspace with no accounts.
 */
const SERVER_SESSION: SessionValue = { ...LOCAL_SESSION, mode: "firestore", status: "loading", workspaceId: null };

export function SessionProvider({ children }: { children: ReactNode }) {
  const cfg = readFirebaseConfig();
  if (!cfg) return <SessionContext.Provider value={LOCAL_SESSION}>{children}</SessionContext.Provider>;
  // The server has no signed-in account; render the same loading state the client starts from.
  if (typeof window === "undefined") return <SessionContext.Provider value={SERVER_SESSION}>{children}</SessionContext.Provider>;
  return <FirestoreSession app={getFirebaseApp(cfg)}>{children}</FirestoreSession>;
}

function FirestoreSession({ app, children }: { app: FirebaseApp; children: ReactNode }) {
  const [account, setAccount] = useState<SessionUser | null | undefined>(undefined);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [inviteFeed, setInviteFeed] = useState<{ email: string; invites: WorkspaceInvite[] }>({ email: "", invites: [] });

  // Auth state → profile (created on first sign-in), kept live afterwards.
  useEffect(() => {
    let unsubProfile = () => {};
    let cancelled = false;
    let unsubAuth = () => {};
    (async () => {
      const { onAuthStateChanged } = await import("firebase/auth");
      if (cancelled) return;
      unsubAuth = onAuthStateChanged(getFirebaseAuth(app), async (user) => {
        debugLog(user ? "auth: signed in" : "auth: signed out");
        unsubProfile();
        unsubProfile = () => {};
        if (!user) {
          setAccount(null);
          setProfile(null);
          setChosen(null);
          return;
        }
        setAccount(toSessionUser(user));
        try {
          const loaded = await loadOrCreateProfile(app, user, pendingSignUpName);
          debugLog(`profile: loaded (${Object.keys(loaded.workspaces).length} workspaces)`);
          pendingSignUpName = null;
          setProfile(loaded);
          setError(null);
          unsubProfile = subscribeProfile(app, user.uid, (p) => {
            if (p) setProfile(p);
          });
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
          setProfile({ id: user.uid, email: (user.email ?? "").toLowerCase(), name: user.displayName ?? "Teammate", workspaces: {}, createdAt: "", updatedAt: "" });
        }
      });
    })();
    return () => {
      cancelled = true;
      unsubAuth();
      unsubProfile();
    };
  }, [app]);

  // Invites addressed to this email, live.
  const email = profile?.email ?? "";
  useEffect(() => {
    if (!email) return;
    return subscribeInvitesForEmail(app, email, (invites) => setInviteFeed({ email, invites }));
  }, [app, email]);
  const pendingInvites = useMemo(() => (email && inviteFeed.email === email ? inviteFeed.invites : []), [email, inviteFeed]);

  const workspaces = useMemo(() => Object.values(profile?.workspaces ?? {}).sort((a, b) => a.name.localeCompare(b.name)), [profile]);

  const workspaceId = useMemo(() => {
    if (!profile) return null;
    const has = (id: string | null | undefined): id is string => !!id && !!profile.workspaces[id];
    if (has(chosen)) return chosen;
    const saved = readSavedWorkspace(profile.id);
    if (has(saved)) return saved;
    if (has(profile.lastWorkspaceId)) return profile.lastWorkspaceId;
    return workspaces[0]?.id ?? null;
  }, [profile, chosen, workspaces]);

  const switchWorkspace = useCallback(
    (id: string) => {
      if (!profile?.workspaces[id]) return;
      try {
        localStorage.setItem(savedWorkspaceKey(profile.id), id);
      } catch {
        // Private browsing: the choice just does not persist.
      }
      setChosen(id);
      void rememberWorkspace(app, profile.id, id);
    },
    [app, profile],
  );

  const createWorkspace = useCallback(
    async (opts: CreateWorkspaceOptions) => {
      if (!profile) throw new Error("Sign in first.");
      const membership = await createWorkspaceDoc(app, profile, opts);
      // The profile snapshot follows shortly; make the switch immediate.
      setProfile((p) => (p ? { ...p, workspaces: { ...p.workspaces, [membership.id]: membership }, lastWorkspaceId: membership.id } : p));
      switchWorkspace(membership.id);
      try {
        localStorage.setItem(savedWorkspaceKey(profile.id), membership.id);
      } catch {}
      setChosen(membership.id);
      return membership;
    },
    [app, profile, switchWorkspace],
  );

  const acceptInvite = useCallback(
    async (code: string) => {
      if (!profile) throw new Error("Sign in first.");
      const membership = await acceptInviteDoc(app, profile, code);
      setProfile((p) => (p ? { ...p, workspaces: { ...p.workspaces, [membership.id]: membership }, lastWorkspaceId: membership.id } : p));
      try {
        localStorage.setItem(savedWorkspaceKey(profile.id), membership.id);
      } catch {}
      setChosen(membership.id);
      return membership;
    },
    [app, profile],
  );

  const createInvite = useCallback(
    (opts: { email: string; role: MemberRole }) => {
      const ws = workspaceId ? profile?.workspaces[workspaceId] : undefined;
      if (!profile || !ws) return Promise.reject(new Error("Open a workspace first."));
      return createInviteDoc(app, { id: profile.id, name: profile.name }, { id: ws.id, name: ws.name }, opts);
    },
    [app, profile, workspaceId],
  );

  const revokeInvite = useCallback((id: string) => revokeInviteDoc(app, id), [app]);

  const forgetWorkspace = useCallback(
    async (id: string) => {
      if (!profile?.workspaces[id]) return false;
      if (await hasMembership(app, profile.id, id)) return false;
      const name = profile.workspaces[id]!.name;
      setNotice(`You no longer have access to ${name}. Open another workspace, create one, or ask an owner to invite you again.`);
      setProfile((p) => {
        if (!p) return p;
        const rest = { ...p.workspaces };
        delete rest[id];
        return { ...p, workspaces: rest, lastWorkspaceId: p.lastWorkspaceId === id ? undefined : p.lastWorkspaceId };
      });
      try {
        if (readSavedWorkspace(profile.id) === id) localStorage.removeItem(savedWorkspaceKey(profile.id));
      } catch {}
      setChosen(null);
      await removeWorkspaceFromProfile(app, profile, id).catch(() => {});
      return true;
    },
    [app, profile],
  );

  const clearNotice = useCallback(() => setNotice(null), []);

  const refreshAccount = useCallback(async () => {
    const user = getFirebaseAuth(app).currentUser;
    if (!user) return;
    await user.reload();
    await user.getIdToken(true);
    setAccount(toSessionUser(getFirebaseAuth(app).currentUser ?? user));
  }, [app]);

  const needsEmailCode = !!(getRuntimeConfig().emailCodes && account && !account.isAnonymous && account.passwordAccount && !account.emailVerified && account.createdAt >= EMAIL_CODES_FROM);
  // Once the email is confirmed, a new account answers the intake before the app opens; the answer lives on the profile.
  const needsIntake = !!(account && !account.isAnonymous && !needsEmailCode && profile && !profile.guest && !profile.business && account.createdAt >= INTAKE_FROM);
  const saveIntake = useCallback(
    async (intake: Omit<BusinessIntake, "completedAt">) => {
      if (!account) return;
      await saveBusinessIntake(app, account.uid, intake);
    },
    [app, account],
  );

  const updateWorkspaceName = useCallback(
    (id: string, name: string) => {
      if (!profile?.workspaces[id] || !name.trim() || profile.workspaces[id].name === name) return;
      setProfile((p) => (p && p.workspaces[id] ? { ...p, workspaces: { ...p.workspaces, [id]: { ...p.workspaces[id]!, name } } } : p));
      void updateWorkspaceNameDoc(app, profile.id, id, name).catch(() => {});
    },
    [app, profile],
  );

  const subscribeInvites = useCallback(
    (cb: (invites: WorkspaceInvite[]) => void) => {
      if (!workspaceId) {
        cb([]);
        return () => {};
      }
      return subscribeWorkspaceInvites(app, workspaceId, cb);
    },
    [app, workspaceId],
  );

  const status: SessionStatus = account === undefined ? "loading" : account === null ? "signed-out" : !profile ? "loading" : workspaceId ? "ready" : "no-workspace";

  const value = useMemo<SessionValue>(
    () => ({
      mode: "firestore",
      status,
      app,
      account: account ?? null,
      profile,
      workspaces,
      workspaceId,
      workspace: workspaceId ? (profile?.workspaces[workspaceId] ?? null) : null,
      pendingInvites,
      error,
      notice,
      clearNotice,
      switchWorkspace,
      createWorkspace,
      acceptInvite,
      createInvite,
      revokeInvite,
      subscribeWorkspaceInvites: subscribeInvites,
      updateWorkspaceName,
      forgetWorkspace,
      needsEmailCode,
      needsIntake,
      saveIntake,
      refreshAccount,
    }),
    [app, status, account, profile, workspaces, workspaceId, pendingInvites, error, notice, clearNotice, switchWorkspace, createWorkspace, acceptInvite, createInvite, revokeInvite, subscribeInvites, updateWorkspaceName, forgetWorkspace, needsEmailCode, needsIntake, saveIntake, refreshAccount],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  return useContext(SessionContext);
}
