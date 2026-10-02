"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Mode = "signin" | "signup" | "forgot";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [msg, setMsg] = useState<{ tone: "error" | "ok"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const err = new URLSearchParams(window.location.search).get("error");
    if (err) setMsg({ tone: "error", text: err });
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const sb = createClient();
    const origin = window.location.origin;
    try {
      if (mode === "signin") {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) {
          setMsg({
            tone: "error",
            text: /invalid login/i.test(error.message)
              ? "Email or password is incorrect."
              : /not confirmed/i.test(error.message)
                ? "Please confirm your email first — check your inbox for the link."
                : error.message,
          });
        } else {
          router.replace("/");
          router.refresh();
        }
      } else if (mode === "signup") {
        const { error, data } = await sb.auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName }, emailRedirectTo: `${origin}/auth/callback` },
        });
        if (error) setMsg({ tone: "error", text: error.message });
        else if (!data.session) setMsg({ tone: "ok", text: "Account created. Check your email and tap the confirmation link, then sign in." });
        else {
          router.replace("/");
          router.refresh();
        }
      } else {
        const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: `${origin}/auth/callback?next=/reset-password` });
        if (error) setMsg({ tone: "error", text: error.message });
        else setMsg({ tone: "ok", text: "If that email has an account, a password reset link is on its way." });
      }
    } catch {
      setMsg({ tone: "error", text: "Cannot reach the server. Check your internet connection and try again." });
    }
    setBusy(false);
  }

  const title = mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Reset password";
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-8">
      <form onSubmit={submit} className="card w-full max-w-sm p-6">
        <div className="mb-5 flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/icon-192.png" alt="" width={40} height={40} className="rounded-lg" />
          <div>
            <div className="text-lg font-bold text-brand-900">MJGarcia Trading</div>
            <div className="text-sm text-slate-500">Payroll System — {title}</div>
          </div>
        </div>
        {mode === "signup" && (
          <label className="mb-3 block">
            <span className="label">Full name</span>
            <input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} required autoComplete="name" />
          </label>
        )}
        <label className="mb-3 block">
          <span className="label">Email</span>
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" inputMode="email" />
        </label>
        {mode !== "forgot" && (
          <label className="mb-4 block">
            <span className="label">Password</span>
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete={mode === "signin" ? "current-password" : "new-password"} />
          </label>
        )}
        {msg && <div className={`mb-3 rounded-md px-3 py-2 text-sm ${msg.tone === "error" ? "bg-red-50 text-red-800" : "bg-emerald-50 text-emerald-800"}`}>{msg.text}</div>}
        <button className="btn-primary w-full" disabled={busy}>
          {busy ? "Please wait…" : mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Send reset link"}
        </button>
        <div className="mt-3 flex justify-between text-xs">
          {mode !== "signin" ? (
            <button type="button" className="text-brand-700 hover:underline" onClick={() => { setMode("signin"); setMsg(null); }}>Back to sign in</button>
          ) : (
            <button type="button" className="text-brand-700 hover:underline" onClick={() => { setMode("signup"); setMsg(null); }}>Create an account</button>
          )}
          {mode === "signin" && (
            <button type="button" className="text-brand-700 hover:underline" onClick={() => { setMode("forgot"); setMsg(null); }}>Forgot password?</button>
          )}
        </div>
        <p className="mt-4 text-[11px] leading-relaxed text-slate-500">
          The first account created becomes Super Admin. Later accounts start as Viewer until a Super Admin assigns a role.
        </p>
      </form>
    </div>
  );
}
