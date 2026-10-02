"use server";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/data/session";
import { can } from "@/lib/roles";
import { friendlyError } from "@/lib/data/errors";
import { DEFAULT_POLICY } from "@/lib/data/load";
import { DEFAULT_ATTENDANCE_RULES, computeAttendance, type AttendanceRules } from "@/lib/payroll/attendance";

export interface AttendanceInputRow {
  employee_id: string;
  work_date: string;
  time_in: string | null;
  time_out: string | null;
  break_minutes: number;
  absent: boolean;
  leave_type: string | null;
  leave_paid: boolean;
  rest_day: boolean;
  day_type_override: string | null;
  notes: string | null;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{1,2}:\d{2}$/;

export async function saveAttendance(rows: AttendanceInputRow[]): Promise<{ error?: string; ok?: string }> {
  const { supabase, user, role } = await getSession();
  if (!can.writePayroll(role)) return { error: "Only payroll admins can encode attendance." };
  const { data: s } = await supabase.from("company_settings").select("policy, attendance_rules").eq("id", 1).maybeSingle();
  const rules: AttendanceRules = {
    ...DEFAULT_ATTENDANCE_RULES,
    ...(s?.attendance_rules ?? {}),
    hoursPerDay: (s?.policy as { hoursPerDay?: number })?.hoursPerDay ?? DEFAULT_POLICY.hoursPerDay,
  };
  const errors: string[] = [];
  const upserts = [];
  const deletes: { employee_id: string; work_date: string }[] = [];
  for (const r of rows) {
    if (!DATE.test(r.work_date)) { errors.push(`Invalid date ${r.work_date}.`); continue; }
    const hasTimes = r.time_in && r.time_out;
    if ((r.time_in && !TIME.test(r.time_in)) || (r.time_out && !TIME.test(r.time_out))) { errors.push(`${r.work_date}: invalid time.`); continue; }
    if (!hasTimes && !r.absent && !r.leave_type) { deletes.push({ employee_id: r.employee_id, work_date: r.work_date }); continue; }
    if (r.break_minutes < 0 || r.break_minutes > 600) { errors.push(`${r.work_date}: break minutes must be 0–600.`); continue; }
    const c = hasTimes && !r.absent && !r.leave_type ? computeAttendance(r.time_in!, r.time_out!, r.break_minutes, rules) : null;
    upserts.push({
      ...r,
      regular_hours: c?.regularHours ?? 0,
      ot_hours: c?.otHours ?? 0,
      night_hours: c?.nightHours ?? 0,
      night_ot_hours: c?.nightOtHours ?? 0,
      late_minutes: c?.lateMinutes ?? 0,
      undertime_minutes: c?.undertimeMinutes ?? 0,
      created_by: user.id,
    });
  }
  if (errors.length) return { error: `Nothing saved. ${errors.slice(0, 5).join(" ")}` };
  if (upserts.length) {
    const { error } = await supabase.from("attendance").upsert(upserts, { onConflict: "employee_id,work_date" });
    if (error) return { error: friendlyError(error) };
  }
  for (const d of deletes) await supabase.from("attendance").delete().eq("employee_id", d.employee_id).eq("work_date", d.work_date);
  revalidatePath("/attendance");
  return { ok: `Saved ${upserts.length} day(s). Open the payroll and Recalculate (or re-open the employee) to apply attendance.` };
}
