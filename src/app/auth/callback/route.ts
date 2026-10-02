import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Landing URL for Supabase email links (sign-up confirmation, password reset).
 * Exchanges the one-time code for a session cookie, then continues to `next`.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/";
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";
  const errorDesc = url.searchParams.get("error_description");
  if (errorDesc) return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(errorDesc)}`, url.origin));
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(safeNext, url.origin));
  }
  return NextResponse.redirect(new URL("/login?error=" + encodeURIComponent("The link is invalid or has expired. Please try again."), url.origin));
}
