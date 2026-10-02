import Link from "next/link";

export default async function SetupPage({ searchParams }: { searchParams: Promise<{ db?: string }> }) {
  const { db } = await searchParams;
  const envMissing = !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <h1 className="text-xl font-semibold">Finish connecting the payroll system</h1>
      {db === "missing" && !envMissing && (
        <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Connected to Supabase, but the payroll tables are not there yet. Run <code>supabase/SETUP_ALL_IN_ONE.sql</code> in the Supabase SQL Editor, then reload this page.
        </div>
      )}
      {envMissing && (
        <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          The Supabase URL and anon key are not set for this deployment.
        </div>
      )}
      <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-slate-700">
        <li>Create a Supabase project.</li>
        <li>SQL Editor → New query → paste all of <code>supabase/SETUP_ALL_IN_ONE.sql</code> → Run.</li>
        <li>
          Set <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> (Supabase → Project Settings → API) in Netlify → Site configuration → Environment variables, then
          redeploy (or in <code>.env.local</code> when running on your computer). Never use the service_role key.
        </li>
        <li>Supabase → Authentication → URL Configuration: set Site URL to your Netlify address and add <code>https://YOUR-SITE.netlify.app/**</code> to Redirect URLs.</li>
        <li>Open the site and create the first account — it becomes Super Admin.</li>
      </ol>
      <Link href="/" className="btn-primary mt-6">Reload</Link>
    </div>
  );
}
