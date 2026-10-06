"use client";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { Spinner, useCleanPath } from "./ui";
import { Landing, LoginScreen, SetPasswordScreen } from "./LoginScreens";

// Routes that render with no session and no shell. AppShell imports THIS list
// rather than keeping its own copy, so the gate and the shell cannot disagree
// about what is public. Adding a route here makes it reachable by anyone.
export const PUBLIC_ROUTES = ["/request", "/status", "/assign"];

// Staff sign in with their ID number. It maps to an address on a domain that
// does not exist and never receives mail — so there is no reset email and no
// self-service sign-up; an administrator sets passwords in User Management.
export const INTERNAL_DOMAIN = "tomypak.internal";
export const idToEmail = (id) => `${String(id).trim()}@${INTERNAL_DOMAIN}`;

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [recovery, setRecovery] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
      if (event === "SIGNED_IN") {
        // NOT awaited and wrapped. A PostgREST builder has no .catch(); calling
        // one threw inside this callback and showed users a failed login on a
        // correct password. setTimeout because calling Supabase synchronously
        // inside onAuthStateChange can deadlock on the auth lock. Duplicate
        // SIGNED_IN events (tab refocus) are absorbed by the unique index on
        // audit_event.session_id.
        setTimeout(() => {
          try { supabase.rpc("log_login").then(() => {}, () => {}); } catch { /* best effort */ }
        }, 0);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const value = useMemo(() => {
    const user = session?.user ?? null;
    const role = user?.app_metadata?.role ?? null;
    // These flags filter the nav and hide buttons. That is ALL they do: every
    // rule is enforced by RLS or a trigger, because the anon key is a valid JWT
    // and anyone can hand-craft a PostgREST request.
    return {
      session,
      user,
      idNumber: user?.email ? user.email.split("@")[0] : null,
      fullName: user?.user_metadata?.full_name ?? null,
      role,
      isSuperAdmin: role === "super_admin",
      isAdmin: role === "admin" || role === "super_admin",
      isApprover: role === "approver" || role === "super_admin",
      isViewer: role === "viewer",
      loading,
      recovery,
      clearRecovery: () => setRecovery(false),
      signOut: async () => {
        // Await BEFORE signOut(): afterwards there is no JWT left for the
        // database to read auth.uid() from.
        try { await supabase.rpc("log_logout"); } catch { /* best effort */ }
        // APPROVER_LANDED_KEY and BRIEFED_KEY in AppShell: once per sign-in each.
        try { ["itrack-approver-landed", "itrack-briefed"].forEach((k) => sessionStorage.removeItem(k)); } catch { /* private mode */ }
        await supabase.auth.signOut();
      },
    };
  }, [session, loading, recovery]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function AuthGate({ children }) {
  const path = useCleanPath();
  const { session, loading, recovery } = useAuth();
  const [screen, setScreen] = useState("landing");

  if (PUBLIC_ROUTES.includes(path)) return children;
  if (loading) {
    return <div className="flex min-h-screen items-center justify-center"><Spinner /></div>;
  }
  if (recovery) return <SetPasswordScreen />;
  if (!session) {
    return screen === "login"
      ? <LoginScreen onBack={() => setScreen("landing")} />
      : <Landing onSignIn={() => setScreen("login")} />;
  }
  return children;
}
