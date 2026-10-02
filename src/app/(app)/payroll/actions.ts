"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/data/session";
import { can } from "@/lib/roles";
import { friendlyError, num, str } from "@/lib/data/errors";
import { loadPeriodContext } from "@/lib/data/load";
import type { EncodedEntry } from "@/lib/data/entry";
import { persistItems } from "@/lib/data/persist";
import type { ActionResult } from "@/components/action-form";

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------
function lastDay(y: number, m: number) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export async function createPeriod(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const { supabase, user, role } = await getSession();
  if (!can.writePayroll(role)) return { error: "Only payroll admins can create payroll periods." };
  const preset = String(fd.get("preset") ?? "custom");
  let start = str(fd.get("period_start"));
  let end = str(fd.get("period_end"));
  let pay = str(fd.get("pay_date"));
  let frequency = String(fd.get("frequency") ?? "semi_monthly");
  let periodsInMonth = num(fd.get("periods_in_month")) ?? 2;
  let isLast = fd.get("is_last_of_month") === "on";
  let code = str(fd.get("code"));
  const month = str(fd.get("month")); // YYYY-MM

  if (preset === "semi_a" || preset === "semi_b" || preset === "monthly") {
    if (!month) return { error: "Choose the month." };
    const [y, m] = month.split("-").map(Number);
    const ld = lastDay(y, m);
    if (preset === "semi_a") {
      start = `${month}-01`; end = `${month}-15`; pay = pay ?? end; frequency = "semi_monthly"; periodsInMonth = 2; isLast = false; code = code ?? `${month}-A`;
    } else if (preset === "semi_b") {
      start = `${month}-16`; end = `${month}-${ld}`; pay = pay ?? end; frequency = "semi_monthly"; periodsInMonth = 2; isLast = true; code = code ?? `${month}-B`;
    } else {
      start = `${month}-01`; end = `${month}-${ld}`; pay = pay ?? end; frequency = "monthly"; periodsInMonth = 1; isLast = true; code = code ?? `${month}-M`;
    }
  }
  if (!start || !end || !pay) return { error: "Period start, end and pay date are required." };
  if (end < start) return { error: "Period end cannot be before period start." };
  if (frequency === "weekly" && !num(fd.get("periods_in_month"))) periodsInMonth = 4;
  code = code ?? `${start}_${end}`;

  // Overlap warning (same frequency, non-cancelled, regular payroll)
  const { data: overlaps } = await supabase
    .from("payroll_periods")
    .select("code")
    .eq("frequency", frequency)
    .eq("is_adjustment", false)
    .neq("status", "cancelled")
    .lte("period_start", end)
    .gte("period_end", start);
  const isAdjustment = fd.get("is_adjustment") === "on";
  if (overlaps?.length && !isAdjustment && fd.get("allow_overlap") !== "on") {
    return { error: `This period overlaps ${overlaps.map((o) => o.code).join(", ")}. Tick "allow overlap" only if this is intentional.` };
  }

  const { data, error } = await supabase
    .from("payroll_periods")
    .insert({
      code, period_start: start, period_end: end, pay_date: pay, frequency, periods_in_month: periodsInMonth,
      is_last_of_month: isLast, is_adjustment: isAdjustment, adjusts_period_id: str(fd.get("adjusts_period_id")),
      notes: str(fd.get("notes")), created_by: user.id, prepared_by: user.id,
    })
    .select("id")
    .single();
  if (error) return { error: friendlyError(error) };
  revalidatePath("/payroll");
  redirect(`/payroll/${data.id}`);
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------
export async function saveEntry(periodId: string, employeeId: string, encoded: EncodedEntry): Promise<{ error?: string; ok?: string }> {
  const { supabase, user, role } = await getSession();
  if (!can.writePayroll(role)) return { error: "Only payroll admins can encode payroll." };
  if (encoded.mode === "manual" && !encoded.manualReason?.trim()) return { error: "Enter the reason for manual encoding." };
  for (const [k, o] of Object.entries(encoded.overrides ?? {})) {
    if (encoded.mode === "hybrid" && !o.reason?.trim()) return { error: `Enter the reason for the manual adjustment (${k}).` };
  }
  const ctx = await loadPeriodContext(supabase, periodId, employeeId);
  if (!ctx) return { error: "Payroll period not found." };
  if (!["draft", "encoding"].includes(ctx.period.status)) return { error: `Payroll is ${ctx.period.status} and cannot be edited. Create a payroll adjustment instead.` };
  const { errors } = await persistItems(supabase, user.id, ctx, [{ employeeId, encoded }]);
  revalidatePath(`/payroll/${periodId}`);
  return errors.length ? { error: errors.join(" ") } : { ok: "Saved." };
}

export async function saveGrid(periodId: string, rows: { employeeId: string; encoded: EncodedEntry }[]): Promise<{ error?: string; ok?: string }> {
  const { supabase, user, role } = await getSession();
  if (!can.writePayroll(role)) return { error: "Only payroll admins can encode payroll." };
  const ctx = await loadPeriodContext(supabase, periodId);
  if (!ctx) return { error: "Payroll period not found." };
  if (!["draft", "encoding"].includes(ctx.period.status)) return { error: `Payroll is ${ctx.period.status} and cannot be edited.` };
  const { saved, errors } = await persistItems(supabase, user.id, ctx, rows);
  revalidatePath(`/payroll/${periodId}`);
  return errors.length ? { error: `Saved ${saved}. ${errors.join(" ")}` } : { ok: `Saved ${saved} employee(s).` };
}

/** Add every eligible employee who is not yet in this payroll, using default encoding. */
export async function addAllEmployees(fd: FormData) {
  const periodId = String(fd.get("period_id"));
  const { supabase, user, role } = await getSession();
  if (!can.writePayroll(role)) return;
  const ctx = await loadPeriodContext(supabase, periodId);
  if (!ctx || !["draft", "encoding"].includes(ctx.period.status)) return;
  await persistItems(
    supabase,
    user.id,
    ctx,
    ctx.employees.filter((e) => !e.item).map((e) => ({ employeeId: e.profile.id, encoded: e.defaultEncoded }))
  );
  revalidatePath(`/payroll/${periodId}`);
}

/** Recalculate every saved item with current configuration, loans and month-to-date data. */
export async function recalcAll(fd: FormData) {
  const periodId = String(fd.get("period_id"));
  const { supabase, user, role } = await getSession();
  if (!can.writePayroll(role)) return;
  const ctx = await loadPeriodContext(supabase, periodId);
  if (!ctx || !["draft", "encoding"].includes(ctx.period.status)) return;
  await persistItems(supabase, user.id, ctx, ctx.employees.filter((e) => e.item).map((e) => ({ employeeId: e.profile.id, encoded: e.item!.encoded })));
  revalidatePath(`/payroll/${periodId}`);
}

export async function removeItem(fd: FormData) {
  const { supabase, role } = await getSession();
  if (!can.writePayroll(role)) return;
  const periodId = String(fd.get("period_id"));
  await supabase.from("payroll_items").delete().eq("period_id", periodId).eq("employee_id", String(fd.get("employee_id")));
  revalidatePath(`/payroll/${periodId}`);
}

// ---------------------------------------------------------------------------
// Workflow
// ---------------------------------------------------------------------------
export async function transition(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const { supabase } = await getSession();
  const periodId = String(fd.get("period_id"));
  const to = String(fd.get("to"));
  const reason = str(fd.get("reason"));
  const { error } = await supabase.rpc("transition_payroll", { p_period: periodId, p_to: to, p_reason: reason });
  if (error) return { error: friendlyError(error) };
  revalidatePath("/payroll");
  redirect(`/payroll/${periodId}?moved=${to}`);
}

export async function reversePosting(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const { supabase } = await getSession();
  const periodId = String(fd.get("period_id"));
  const { error } = await supabase.rpc("reverse_posting", { p_period: periodId, p_reason: str(fd.get("reason")) });
  if (error) return { error: friendlyError(error) };
  redirect(`/payroll/${periodId}?moved=reversed`);
}

export async function updatePayment(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const { supabase, user, role } = await getSession();
  if (!can.pay(role)) return { error: "Your role cannot record payments." };
  const ids = fd.getAll("payment_id").map(String);
  if (!ids.length) return { error: "Select at least one employee." };
  const status = String(fd.get("status") ?? "paid");
  const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
  if (status === "paid") {
    patch.payment_date = str(fd.get("payment_date")) ?? new Date().toISOString().slice(0, 10);
    patch.paid_by = user.id;
  }
  const ref = str(fd.get("reference_no"));
  if (ref) patch.reference_no = ref;
  const method = str(fd.get("payment_method"));
  if (method) patch.payment_method = method;
  const { error } = await supabase.from("payroll_payments").update(patch).in("id", ids);
  if (error) return { error: friendlyError(error) };
  revalidatePath(`/payroll/${fd.get("period_id")}`);
  return { ok: `${ids.length} payment(s) updated.` };
}
