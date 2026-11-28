"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { FirebaseApp } from "firebase/app";
import type { User } from "firebase/auth";
import { currentInstance, getRuntimeConfig } from "@/lib/firebase-config";
import type { BusinessIntake, MemberRole, UserProfile, WorkspaceInvite, WorkspaceMembership } from "@/lib/types";
import { debugLog } from "@/lib/debug";
import { getFirebaseApp, getFirebaseAuth, readFirebaseConfig } from "@/lib/store/firestore";
import { SIGN_IN_CODE_EVENT } from "@/lib/server/signInCodeRules";
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
  /** How this session signed in ("password", "emailLink", "anonymous"), from the ID token. Null when the token could not be read. */
  signInProvider: string | null;
  /** The ID token's auth_time: the same through refreshes, new with every sign-in. Null when the token could not be read. */
  authTime: string | null;
}

/** Password accounts created from this moment confirm their email with a one-time code. Older accounts are left alone. */
export const EMAIL_CODES_FROM = "2026-09-15T00:00:00.000Z";
/** Accounts created from this moment see the short business intake once. */
export const INTAKE_FROM = "2026-09-16T00:00:00.000Z";

function toSessionUser(user: User, token: SessionToken): SessionUser {
  return {
    uid: user.uid,
    email: (user.email ?? "").toLowerCase(),
    name: user.displayName ?? "",
    isAnonymous: user.isAnonymous,
    emailVerified: user.emailVerified,
    createdAt: user.metadata.creationTime ? new Date(user.metadata.creationTime).toISOString() : "",
    passwordAccount: user.providerData.some((p) => p.providerId === "password"),
    signInProvider: token.signInProvider,
    authTime: token.authTime,
  };
}

type SessionToken = Pick<SessionUser, "signInProvider" | "authTime">;

/** Reads how and when this session signed in from its ID token. Offline with an expired token, both come back null. */
async function readSessionToken(user: User): Promise<SessionToken> {
  try {
    const result = await user.getIdTokenResult();
    const authTime = result.claims.auth_time;
    return { signInProvider: result.signInProvider ?? null, authTime: typeof authTime === "string" || typeof authTime === "number" ? String(authTime) : null };
  } catch {
    return { signInProvider: null, authTime: null };
  }
}

/** The session on this device that has entered its sign-in code. The server keeps the list that counts; this only saves asking it on every page load. */
function signInCodeKey(uid: string) {
  return `cumulus:signInCode:${uid}`;
}

function readSignInCodeDone(uid: string): string | null {
  try {
    return localStorage.getItem(signInCodeKey(uid));
  } catch {
    return null;
  }
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
  updateWorkspaceName: (id: string, name: string, icon?: string | null) => void;
  /**
   * The open workspace refused access. Confirms the member record is gone, then
   * drops the workspace from the profile. Resolves false when access still exists
   * (a transient failure), so the caller can retry instead.
   */
  forgetWorkspace: (id: string) => Promise<boolean>;
  /** The account owes an emailed one-time code: a new password account confirming its address, or a password session finishing sign-in. */
  needsEmailCode: boolean;
  /** Which of the two it is, for the wording on the code page. */
  emailCodeReason: "new-account" | "sign-in" | null;
  /** Called once the server has accepted this session's code (or says none is owed). */
  confirmEmailCode: () => Promise<void>;
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
  emailCodeReason: null,
  confirmEmailCode: () => Promise.resolve(),
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
  /** The auth_time whose sign-in code this device knows was entered. */
  const [codeDone, setCodeDone] = useState<string | null>(null);

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
          setCodeDone(null);
          return;
        }
        const token = await readSessionToken(user);
        if (cancelled || getFirebaseAuth(app).currentUser?.uid !== user.uid) return;
        setCodeDone(readSignInCodeDone(user.uid));
        setAccount(toSessionUser(user, token));
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

  // A bespoke instance has one workspace and no invites: the operator creates every account.
  const instance = currentInstance();

  // Invites addressed to this email, live.
  const email = profile?.email ?? "";
  useEffect(() => {
    if (!email || instance) return;
    return subscribeInvitesForEmail(app, email, (invites) => setInviteFeed({ email, invites }));
  }, [app, email, instance]);
  const pendingInvites = useMemo(() => (email && inviteFeed.email === email ? inviteFeed.invites : []), [email, inviteFeed]);

  const workspaces = useMemo(() => Object.values(profile?.workspaces ?? {}).sort((a, b) => a.name.localeCompare(b.name)), [profile]);

  const workspaceId = useMemo(() => {
    if (!profile) return null;
    const has = (id: string | null | undefined): id is string => !!id && !!profile.workspaces[id];
    // On an instance only its own workspace can open; without that membership the account has no access here.
    if (instance) return has(instance.workspaceId) ? instance.workspaceId : null;
    if (has(chosen)) return chosen;
    const saved = readSavedWorkspace(profile.id);
    if (has(saved)) return saved;
    if (has(profile.lastWorkspaceId)) return profile.lastWorkspaceId;
    return workspaces[0]?.id ?? null;
  }, [profile, chosen, workspaces, instance]);

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
      if (instance) throw new Error("This site has a single workspace.");
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
    [app, profile, switchWorkspace, instance],
  );

  const acceptInvite = useCallback(
    async (code: string) => {
      if (!profile) throw new Error("Sign in first.");
      if (instance) throw new Error("Accounts on this site are added by your administrator.");
      const membership = await acceptInviteDoc(app, profile, code);
      setProfile((p) => (p ? { ...p, workspaces: { ...p.workspaces, [membership.id]: membership }, lastWorkspaceId: membership.id } : p));
      try {
        localStorage.setItem(savedWorkspaceKey(profile.id), membership.id);
      } catch {}
      setChosen(membership.id);
      return membership;
    },
    [app, profile, instance],
  );

  const createInvite = useCallback(
    (opts: { email: string; role: MemberRole }) => {
      if (instance) return Promise.reject(new Error("Accounts on this site are added by your administrator."));
      const ws = workspaceId ? profile?.workspaces[workspaceId] : undefined;
      if (!profile || !ws) return Promise.reject(new Error("Open a workspace first."));
      return createInviteDoc(app, { id: profile.id, name: profile.name }, { id: ws.id, name: ws.name }, opts);
    },
    [app, profile, workspaceId, instance],
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
    const current = getFirebaseAuth(app).currentUser ?? user;
    setAccount(toSessionUser(current, await readSessionToken(current)));
  }, [app]);

  const confirmEmailCode = useCallback(async () => {
    const user = getFirebaseAuth(app).currentUser;
    if (!user) return;
    const { authTime } = await readSessionToken(user);
    if (!authTime) return;
    try {
      localStorage.setItem(signInCodeKey(user.uid), authTime);
    } catch {
      // Private browsing: the server still knows, so the code page passes straight through next time.
    }
    setCodeDone(authTime);
  }, [app]);

  // A route refused this session for want of its sign-in code, although this device thought it was entered: forget that and ask again.
  useEffect(() => {
    const reopen = () => {
      const uid = getFirebaseAuth(app).currentUser?.uid;
      if (!uid) return;
      try {
        localStorage.removeItem(signInCodeKey(uid));
      } catch {}
      setCodeDone(null);
    };
    window.addEventListener(SIGN_IN_CODE_EVENT, reopen);
    return () => window.removeEventListener(SIGN_IN_CODE_EVENT, reopen);
  }, [app]);

  const needsAddressCode = !!(getRuntimeConfig().emailCodes && account && !account.isAnonymous && account.passwordAccount && !account.emailVerified && account.createdAt >= EMAIL_CODES_FROM);
  // Every password sign-in is finished with an emailed code. The server refuses the session until then; this sends the person to the page that asks for it.
  const needsSignInCode = !!(getRuntimeConfig().signInCodes && account && !account.isAnonymous && account.email && account.signInProvider === "password" && account.authTime && codeDone !== account.authTime);
  const needsEmailCode = needsAddressCode || needsSignInCode;
  const emailCodeReason = needsAddressCode ? "new-account" : needsSignInCode ? "sign-in" : null;
  // Once the email is confirmed, a new account answers the intake before the app opens; the answer lives on the profile.
  const needsIntake = !!(!instance && account && !account.isAnonymous && !needsEmailCode && profile && !profile.guest && !profile.business && account.createdAt >= INTAKE_FROM);
  const saveIntake = useCallback(
    async (intake: Omit<BusinessIntake, "completedAt">) => {
      if (!account) return;
      await saveBusinessIntake(app, account.uid, intake);
    },
    [app, account],
  );

  const updateWorkspaceName = useCallback(
    (id: string, name: string, icon?: string | null) => {
      const current = profile?.workspaces[id];
      if (!current || !name.trim()) return;
      const nextIcon = icon ?? undefined;
      if (current.name === name && (current.icon ?? undefined) === nextIcon) return;
      setProfile((p) => (p && p.workspaces[id] ? { ...p, workspaces: { ...p.workspaces, [id]: { ...p.workspaces[id]!, name, ...(nextIcon ? { icon: nextIcon } : {}) } } } : p));
      void updateWorkspaceNameDoc(app, profile.id, id, name, nextIcon ?? null).catch(() => {});
    },
    [app, profile],
  );

  const subscribeInvites = useCallback(
    (cb: (invites: WorkspaceInvite[]) => void) => {
      if (!workspaceId || instance) {
        cb([]);
        return () => {};
      }
      return subscribeWorkspaceInvites(app, workspaceId, cb);
    },
    [app, workspaceId, instance],
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
      emailCodeReason,
      confirmEmailCode,
      needsIntake,
      saveIntake,
      refreshAccount,
    }),
    [app, status, account, profile, workspaces, workspaceId, pendingInvites, error, notice, clearNotice, switchWorkspace, createWorkspace, acceptInvite, createInvite, revokeInvite, subscribeInvites, updateWorkspaceName, forgetWorkspace, needsEmailCode, emailCodeReason, confirmEmailCode, needsIntake, saveIntake, refreshAccount],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  return useContext(SessionContext);
}
