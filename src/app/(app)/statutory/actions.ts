"use server";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/data/session";
import { can } from "@/lib/roles";
import { friendlyError, num, str } from "@/lib/data/errors";
import { validatePayload, type ConfigKind } from "@/lib/payroll/schemas";
import type { ActionResult } from "@/components/action-form";

export async function addConfigVersion(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const { supabase, user, role } = await getSession();
  if (!can.editConfig(role)) return { error: "Only a Super Admin can change statutory tables." };
  const kind = String(fd.get("kind")) as ConfigKind;
  const effectiveFrom = str(fd.get("effective_from"));
  const source = str(fd.get("source"));
  const name = str(fd.get("name"));
  if (!effectiveFrom || !source || !name) return { error: "Name, effective date and official source are required." };
  let payload: unknown;
  try {
    payload = JSON.parse(String(fd.get("payload") ?? ""));
  } catch {
    return { error: "The table data is not valid JSON. Check for missing commas or brackets." };
  }
  const v = validatePayload(kind, payload);
  if (!v.ok) return { error: `Table data is invalid: ${v.error}` };
  const { error } = await supabase.from("statutory_configurations").insert({
    kind, name, effective_from: effectiveFrom, effective_to: str(fd.get("effective_to")), status: "draft", payload, source, notes: str(fd.get("notes")), created_by: user.id, updated_by: user.id,
  });
  if (error) return { error: friendlyError(error) };
  revalidatePath("/statutory");
  return { ok: "Saved as DRAFT. Review it, then click Activate." };
}

/** Activate a draft. The previous open-ended active version of the same kind is closed the day before. */
export async function activateConfig(fd: FormData) {
  const { supabase, user, role } = await getSession();
  if (!can.editConfig(role)) return;
  const id = String(fd.get("id"));
  const { data: cfg } = await supabase.from("statutory_configurations").select("*").eq("id", id).single();
  if (!cfg || cfg.status !== "draft") return;
  const dayBefore = new Date(new Date(cfg.effective_from + "T00:00:00Z").getTime() - 86400000).toISOString().slice(0, 10);
  await supabase
    .from("statutory_configurations")
    .update({ effective_to: dayBefore, updated_by: user.id })
    .eq("kind", cfg.kind)
    .eq("status", "active")
    .is("effective_to", null)
    .lt("effective_from", cfg.effective_from);
  await supabase.from("statutory_configurations").update({ status: "active", updated_by: user.id }).eq("id", id);
  revalidatePath("/statutory");
}

export async function retireConfig(fd: FormData) {
  const { supabase, user, role } = await getSession();
  if (!can.editConfig(role)) return;
  await supabase.from("statutory_configurations").update({ status: "retired", updated_by: user.id }).eq("id", String(fd.get("id")));
  revalidatePath("/statutory");
}

export async function deleteDraft(fd: FormData) {
  const { supabase, role } = await getSession();
  if (!can.editConfig(role)) return;
  await supabase.from("statutory_configurations").delete().eq("id", String(fd.get("id"))).eq("status", "draft");
  revalidatePath("/statutory");
}

export async function addMinimumWage(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const { supabase, user, role } = await getSession();
  if (!can.editReference(role)) return { error: "Your role cannot edit minimum wage tables." };
  const rate = num(fd.get("daily_rate"));
  if (!rate || rate <= 0) return { error: "Enter the daily minimum wage." };
  if (!str(fd.get("region")) || !str(fd.get("wage_order")) || !str(fd.get("effective_from"))) return { error: "Region, wage order and effective date are required." };
  const { error } = await supabase.from("minimum_wage_rates").insert({
    region: str(fd.get("region")), province: str(fd.get("province")), city: str(fd.get("city")), area_classification: str(fd.get("area_classification")),
    sector: String(fd.get("sector")), wage_order: str(fd.get("wage_order")), effective_from: str(fd.get("effective_from")), effective_to: str(fd.get("effective_to")),
    daily_rate: rate, source: str(fd.get("source")), created_by: user.id,
  });
  if (error) return { error: friendlyError(error) };
  revalidatePath("/statutory");
  return { ok: "Minimum wage rate added." };
}
