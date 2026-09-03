"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Member } from "@/lib/types";
import { newId, nowIso } from "@/lib/utils";
import { useCollection, useStoreContext } from "@/lib/store/provider";
import { getFirebaseApp, readFirebaseConfig } from "@/lib/store/firestore";

const LOCAL_USER_KEY = "cumulus:currentUser";
const PRESENCE_INTERVAL_MS = 45_000;
export const ONLINE_WINDOW_MS = 2 * 60_000;

interface AuthContextValue {
  /** Current member, or null when signed out (Firestore mode only). */
  user: Member | null;
  /** Firestore mode: a Firebase account is signed in (the member record may still be loading). */
  signedIn: boolean;
  /** True while resolving auth state. */
  loading: boolean;
  mode: "local" | "firestore";
  /** Sign-in failure, e.g. Google provider not enabled. */
  authError: string | null;
  /** Local mode: switch the simulated user. */
  switchUser: (memberId: string) => void;
  /** Firestore mode: Google sign-in. */
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const AVATAR_COLORS = ["#1f5f8b", "#7a3e9d", "#2e7d4f", "#b5541c", "#8b1f4f", "#3e6b9d", "#5c7a1f"];

export function AuthProvider({ children }: { children: ReactNode }) {
  const { store, ready } = useStoreContext();
  const members = useCollection("members");
  const mode = store.kind;
  const [savedLocalUserId, setSavedLocalUserId] = useState<string | null>(() => (typeof localStorage !== "undefined" ? localStorage.getItem(LOCAL_USER_KEY) : null));
  const [firebaseUid, setFirebaseUid] = useState<string | null | undefined>(undefined);
  const [authError, setAuthError] = useState<string | null>(null);

  // ---- Local mode: saved member, else the owner, else the first member
  const localUserId = useMemo(() => {
    if (members.some((m) => m.id === savedLocalUserId)) return savedLocalUserId;
    return (members.find((m) => m.role === "owner") ?? members[0])?.id ?? null;
  }, [members, savedLocalUserId]);

  // ---- Firestore mode: Firebase Auth
  useEffect(() => {
    if (mode !== "firestore") return;
    let unsub = () => {};
    (async () => {
      const cfg = readFirebaseConfig();
      if (!cfg) return;
      const { getAuth, onAuthStateChanged } = await import("firebase/auth");
      const auth = getAuth(getFirebaseApp(cfg));
      unsub = onAuthStateChanged(auth, async (u) => {
        if (!u) {
          setFirebaseUid(null);
          return;
        }
        // Ensure a member record exists for this account.
        const existing = await store.get("members", u.uid);
        if (!existing) {
          const all = await store.list("members");
          const member: Member = {
            id: u.uid,
            name: u.displayName ?? u.email ?? "Teammate",
            email: u.email ?? "",
            role: all.length === 0 ? "owner" : "member",
            color: AVATAR_COLORS[all.length % AVATAR_COLORS.length]!,
            status: "active",
            lastSeenAt: nowIso(),
            createdAt: nowIso(),
          };
          await store.put("members", member);
          await store.put("activity", {
            id: newId("act"),
            type: "member.joined",
            message: `${member.name} joined the workspace`,
            actorId: member.id,
            actorName: member.name,
            entityType: "member",
            entityId: member.id,
            createdAt: nowIso(),
          });
        }
        setFirebaseUid(u.uid);
      });
    })();
    return () => unsub();
  }, [mode, store]);

  const userId = mode === "local" ? localUserId : firebaseUid ?? null;
  const user = useMemo(() => members.find((m) => m.id === userId) ?? null, [members, userId]);
  const signedIn = mode === "local" ? true : !!firebaseUid;
  // In Firestore mode the store only initialises after sign-in, so auth state resolves first.
  const loading = mode === "firestore" ? firebaseUid === undefined : !ready;

  // ---- Presence heartbeat
  useEffect(() => {
    if (!user) return;
    const beat = () => {
      store.patch("members", user.id, { lastSeenAt: nowIso(), status: "active" }).catch(() => {});
    };
    beat();
    const t = setInterval(beat, PRESENCE_INTERVAL_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, store]);

  const switchUser = useCallback((memberId: string) => {
    localStorage.setItem(LOCAL_USER_KEY, memberId);
    setSavedLocalUserId(memberId);
  }, []);

  const signIn = useCallback(async () => {
    const cfg = readFirebaseConfig();
    if (!cfg) return;
    setAuthError(null);
    try {
      const { getAuth, GoogleAuthProvider, signInWithPopup } = await import("firebase/auth");
      await signInWithPopup(getAuth(getFirebaseApp(cfg)), new GoogleAuthProvider());
    } catch (e) {
      const code = (e as { code?: string })?.code ?? "";
      if (code.includes("operation-not-allowed")) setAuthError("Google sign-in is not enabled for this Firebase project. Enable it under Authentication → Sign-in method.");
      else if (code.includes("unauthorized-domain")) setAuthError("This domain is not authorised for sign-in. Add localhost under Authentication → Settings → Authorized domains.");
      else if (code.includes("popup-closed-by-user") || code.includes("cancelled-popup-request")) setAuthError(null);
      else setAuthError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const signOut = useCallback(async () => {
    const cfg = readFirebaseConfig();
    if (!cfg) return;
    const { getAuth, signOut: fbSignOut } = await import("firebase/auth");
    await fbSignOut(getAuth(getFirebaseApp(cfg)));
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, signedIn, loading, mode, authError, switchUser, signIn, signOut }),
    [user, signedIn, loading, mode, authError, switchUser, signIn, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

/** The signed-in member. Throws if called while signed out — guard with useAuth().user first. */
export function useCurrentUser(): Member {
  const { user } = useAuth();
  if (!user) {
    return {
      id: "anonymous",
      name: "Guest",
      email: "",
      role: "viewer",
      color: "#8a8a8a",
      status: "active",
      createdAt: nowIso(),
    };
  }
  return user;
}

export function isOnline(member: Member): boolean {
  if (!member.lastSeenAt) return false;
  return Date.now() - new Date(member.lastSeenAt).getTime() < ONLINE_WINDOW_MS;
}

/** Simple role gate. Viewers cannot write. */
export function canWrite(member: Member): boolean {
  return member.role !== "viewer";
}
