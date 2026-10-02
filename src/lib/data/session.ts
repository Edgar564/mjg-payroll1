import { redirect } from "next/navigation";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { AppRole } from "@/lib/roles";

export interface Profile {
  id: string;
  email: string | null;
  full_name: string | null;
  role: AppRole;
  employee_id: string | null;
  active: boolean;
}

export const getSession = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");
  const { data: profile, error } = await supabase.from("profiles").select("*").eq("id", data.user.id).maybeSingle<Profile>();
  // Tables missing = the SQL setup has not been run on this Supabase project yet
  if (error && (error.code === "PGRST205" || error.code === "42P01" || /does not exist|schema cache/i.test(error.message))) redirect("/setup?db=missing");
  return { supabase, user: data.user, profile: profile ?? null, role: (profile?.active ? profile.role : null) as AppRole | null };
});

/** Redirects to the dashboard with a message if the role check fails. */
export async function requireRole(check: (r?: AppRole | null) => boolean) {
  const s = await getSession();
  if (!check(s.role)) redirect("/?denied=1");
  return s;
}
