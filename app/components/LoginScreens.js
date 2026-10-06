"use client";
// Pre-login screens. They live outside AppShell, so each carries its own theme
// toggle: someone who prefers dark must not be forced through a white login.
import { useState } from "react";
import { ArrowLeft, ClipboardList, KeyRound, LogIn, Search } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { idToEmail, useAuth } from "./AuthProvider";
import { BrandLogo, Card, ThemeToggle, toast } from "./ui";
import { APP_VERSION } from "../version";

const input = "w-full rounded-xl border border-border bg-surface px-3 py-2.5 outline-none focus:border-brand focus:ring-1 focus:ring-brand";
const primary = "flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 py-2.5 font-medium text-brand-fg disabled:opacity-50";

function Frame({ children }) {
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center px-4 py-10"
      style={{ paddingTop: "max(2.5rem, env(safe-area-inset-top))" }}>
      <ThemeToggle className="absolute right-3 top-3" />
      <BrandLogo size={44} withText className="mb-6" />
      <div className="w-full max-w-sm">{children}</div>
      <p className="mt-8 text-xs text-muted">ITrack v{APP_VERSION} · Tomypak Flexible Packaging Sdn Bhd</p>
    </main>
  );
}

export function Landing({ onSignIn }) {
  const choice = "flex w-full items-center gap-4 rounded-2xl border border-border bg-surface p-5 text-left hover:border-brand";
  return (
    <Frame>
      <h1 className="mb-4 text-center text-xl font-semibold">IT Asset Management</h1>
      <div className="space-y-3">
        <button onClick={onSignIn} className={choice}>
          <span className="rounded-xl bg-brand/10 p-3 text-brand"><LogIn className="h-6 w-6" /></span>
          <span><span className="block font-medium">IT Department</span>
            <span className="text-sm text-muted">Sign in with your ID number</span></span>
        </button>
        <a href="/request/" className={choice}>
          <span className="rounded-xl bg-ok/10 p-3 text-ok"><ClipboardList className="h-6 w-6" /></span>
          <span><span className="block font-medium">I Need Equipment</span>
            <span className="text-sm text-muted">Request hardware — no login needed</span></span>
        </a>
        <a href="/status/" className="flex items-center justify-center gap-1.5 pt-1 text-sm text-muted hover:text-brand">
          <Search className="h-4 w-4" /> Track an existing request
        </a>
      </div>
    </Frame>
  );
}

export function LoginScreen({ onBack }) {
  const [id, setId] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { error } = await supabase.auth.signInWithPassword({ email: idToEmail(id), password });
    setBusy(false);
    if (error) {
      setError(/banned/i.test(error.message)
        ? "This account is disabled. Please contact the IT department."
        : "ID number or password is incorrect.");
    }
  }

  return (
    <Frame>
      <Card className="p-6">
        <button onClick={onBack} className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <h1 className="mb-4 text-lg font-semibold">Sign in</h1>
        <form onSubmit={submit} className="space-y-3">
          <label className="block text-sm">
            <span className="mb-1 block text-muted">ID number</span>
            <input className={input} value={id} onChange={(e) => setId(e.target.value)} required
              autoComplete="username" autoCapitalize="none" autoFocus />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-muted">Password</span>
            <input className={input} type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              required autoComplete="current-password" />
          </label>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <button className={primary} disabled={busy || !id || !password}>
            <LogIn className="h-4 w-4" />{busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <p className="mt-4 text-xs text-muted">
          Forgot your password? There is no reset email — ask an ITrack administrator to set a new one for you.
        </p>
      </Card>
    </Frame>
  );
}

export function SetPasswordScreen() {
  const { clearRecovery } = useAuth();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (pw.length < 8) return toast.error("Use at least 8 characters.");
    if (pw !== pw2) return toast.error("The two passwords do not match.");
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Password updated.");
    clearRecovery();
  }

  return (
    <Frame>
      <Card className="p-6">
        <h1 className="mb-4 flex items-center gap-2 text-lg font-semibold"><KeyRound className="h-5 w-5" /> Set a new password</h1>
        <form onSubmit={submit} className="space-y-3">
          <input className={input} type="password" placeholder="New password" value={pw}
            onChange={(e) => setPw(e.target.value)} autoComplete="new-password" required />
          <input className={input} type="password" placeholder="Repeat new password" value={pw2}
            onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" required />
          <button className={primary} disabled={busy}>{busy ? "Saving…" : "Save password"}</button>
        </form>
      </Card>
    </Frame>
  );
}
