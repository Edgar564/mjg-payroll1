"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [msg, setMsg] = useState<{ tone: "error" | "ok"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pw.length < 8) return setMsg({ tone: "error", text: "Use at least 8 characters." });
    if (pw !== pw2) return setMsg({ tone: "error", text: "The two passwords do not match." });
    setBusy(true);
    const { error } = await createClient().auth.updateUser({ password: pw });
    setBusy(false);
    if (error) return setMsg({ tone: "error", text: error.message });
    setMsg({ tone: "ok", text: "Password updated. Opening the dashboard…" });
    setTimeout(() => { router.replace("/"); router.refresh(); }, 1200);
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={submit} className="card w-full max-w-sm p-6">
        <div className="mb-4 text-lg font-bold text-brand-900">Set a new password</div>
        <label className="mb-3 block"><span className="label">New password</span><input className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" required /></label>
        <label className="mb-4 block"><span className="label">Repeat new password</span><input className="input" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" required /></label>
        {msg && <div className={`mb-3 rounded-md px-3 py-2 text-sm ${msg.tone === "error" ? "bg-red-50 text-red-800" : "bg-emerald-50 text-emerald-800"}`}>{msg.text}</div>}
        <button className="btn-primary w-full" disabled={busy}>{busy ? "Saving…" : "Save password"}</button>
      </form>
    </div>
  );
}
