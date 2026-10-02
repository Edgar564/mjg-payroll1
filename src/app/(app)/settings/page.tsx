import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/data/session";
import { can } from "@/lib/roles";
import { friendlyError, num, str } from "@/lib/data/errors";
import { DEFAULT_POLICY } from "@/lib/data/load";
import { ActionForm, SubmitButton, type ActionResult } from "@/components/action-form";
import { PageHeader } from "@/components/ui";

async function saveSettings(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  "use server";
  const { supabase, user, role } = await getSession();
  if (!can.editConfig(role)) return { error: "Only a Super Admin can change company settings." };
  const hours = num(fd.get("hoursPerDay"));
  const days = num(fd.get("workDaysPerYear"));
  if (!hours || hours <= 0 || hours > 24) return { error: "Standard hours per day must be between 1 and 24." };
  if (!days || days < 200 || days > 366) return { error: "Working days per year must be between 200 and 366 (common: 313, 261, 365)." };
  const policy = {
    hoursPerDay: hours,
    workDaysPerYear: days,
    contributionSchedule: fd.get("contributionSchedule") === "last_period" ? "last_period" : "split_trueup",
    minimumNetPay: num(fd.get("minimumNetPay")) ?? 0,
    excessiveDeductionRatio: (num(fd.get("excessiveDeductionPct")) ?? 50) / 100,
    monthlyRatedPremiumOnly: fd.get("monthlyRatedPremiumOnly") === "on",
  };
  const attendance_rules = {
    shiftStart: String(fd.get("shiftStart") ?? "08:00"),
    gracePeriodMinutes: num(fd.get("gracePeriodMinutes")) ?? 0,
    lateRule: String(fd.get("lateRule") ?? "per_minute"),
    undertimeRule: String(fd.get("undertimeRule") ?? "per_minute"),
    otRoundingMinutes: num(fd.get("otRoundingMinutes")) ?? 0,
    nsdStart: String(fd.get("nsdStart") ?? "22:00"),
    nsdEnd: String(fd.get("nsdEnd") ?? "06:00"),
  };
  const { error } = await supabase.from("company_settings").update({
    company_name: str(fd.get("company_name")) ?? "MJGarcia Trading",
    business_address: str(fd.get("business_address")), tin: str(fd.get("tin")), rdo: str(fd.get("rdo")),
    sss_employer_no: str(fd.get("sss_employer_no")), philhealth_employer_no: str(fd.get("philhealth_employer_no")), pagibig_employer_no: str(fd.get("pagibig_employer_no")),
    default_pay_frequency: String(fd.get("default_pay_frequency")), pay_days: str(fd.get("pay_days")), work_week: str(fd.get("work_week")),
    policy, attendance_rules, updated_by: user.id, updated_at: new Date().toISOString(),
  }).eq("id", 1);
  if (error) return { error: friendlyError(error) };
  revalidatePath("/settings");
  return { ok: "Settings saved. Use “Recalculate all” on open payrolls to apply policy changes." };
}

export default async function SettingsPage() {
  const { supabase, role } = await getSession();
  const { data: s } = await supabase.from("company_settings").select("*").eq("id", 1).maybeSingle();
  const p = { ...DEFAULT_POLICY, ...(s?.policy ?? {}) };
  const a = s?.attendance_rules ?? {};
  const ro = !can.editConfig(role);
  const I = (name: string, lbl: string, v: unknown, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="block"><span className="label">{lbl}</span><input name={name} defaultValue={v === null || v === undefined ? "" : String(v)} className="input" disabled={ro} {...props} /></label>
  );
  return (
    <>
      <PageHeader title="Company settings" subtitle={ro ? "Read-only for your role." : undefined} />
      <ActionForm action={saveSettings}>
        <fieldset className="card mb-4 grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <legend className="px-1 text-sm font-semibold">Company</legend>
          {I("company_name", "Company name", s?.company_name ?? "MJGarcia Trading")}
          <div className="lg:col-span-3">{I("business_address", "Business address", s?.business_address)}</div>
          {I("tin", "TIN", s?.tin)}
          {I("rdo", "RDO", s?.rdo)}
          {I("sss_employer_no", "SSS employer number", s?.sss_employer_no)}
          {I("philhealth_employer_no", "PhilHealth employer number", s?.philhealth_employer_no)}
          {I("pagibig_employer_no", "Pag-IBIG employer number", s?.pagibig_employer_no)}
          <label><span className="label">Default payroll frequency</span><select name="default_pay_frequency" defaultValue={s?.default_pay_frequency ?? "semi_monthly"} className="input" disabled={ro}><option value="semi_monthly">Semi-monthly</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label>
          {I("pay_days", "Pay days", s?.pay_days)}
          {I("work_week", "Work week", s?.work_week)}
        </fieldset>
        <fieldset className="card mb-4 grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <legend className="px-1 text-sm font-semibold">Payroll policy</legend>
          {I("hoursPerDay", "Standard working hours per day", p.hoursPerDay, { inputMode: "decimal" })}
          {I("workDaysPerYear", "Working days per year (rate factor)", p.workDaysPerYear, { inputMode: "numeric" })}
          <label><span className="label">Semi-monthly contributions</span>
            <select name="contributionSchedule" defaultValue={p.contributionSchedule} className="input" disabled={ro}>
              <option value="split_trueup">Split across cut-offs, true-up on last</option>
              <option value="last_period">Deduct in full on last cut-off</option>
            </select>
          </label>
          {I("minimumNetPay", "Protect minimum net pay (₱)", p.minimumNetPay, { inputMode: "decimal" })}
          {I("excessiveDeductionPct", "Warn when deductions exceed (% of gross)", Math.round(p.excessiveDeductionRatio * 100), { inputMode: "numeric" })}
          <label className="flex items-center gap-2 text-sm lg:col-span-3"><input type="checkbox" name="monthlyRatedPremiumOnly" defaultChecked={p.monthlyRatedPremiumOnly} disabled={ro} className="accent-brand-600" /> Monthly-rated staff: regular-holiday work pays the premium only (base already inside monthly salary)</label>
          <p className="text-xs text-slate-500 lg:col-span-4">313 = 6-day week (Mon–Sat) with regular holidays paid; 261 = 5-day week; 365 = paid every day including rest days. Use the factor your company actually applies.</p>
        </fieldset>
        <fieldset className="card mb-4 grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <legend className="px-1 text-sm font-semibold">Attendance rules</legend>
          {I("shiftStart", "Shift start (for late computation)", a.shiftStart ?? "08:00", { type: "time" })}
          {I("gracePeriodMinutes", "Grace period (minutes)", a.gracePeriodMinutes ?? 0, { inputMode: "numeric" })}
          <label><span className="label">Late deduction rule</span><select name="lateRule" defaultValue={a.lateRule ?? "per_minute"} className="input" disabled={ro}><option value="per_minute">Per minute late</option><option value="none">No deduction</option></select></label>
          <label><span className="label">Undertime deduction rule</span><select name="undertimeRule" defaultValue={a.undertimeRule ?? "per_minute"} className="input" disabled={ro}><option value="per_minute">Per minute</option><option value="none">No deduction</option></select></label>
          {I("otRoundingMinutes", "OT rounding (minutes, 0 = exact)", a.otRoundingMinutes ?? 0, { inputMode: "numeric" })}
          {I("nsdStart", "NSD start", a.nsdStart ?? "22:00", { type: "time" })}
          {I("nsdEnd", "NSD end", a.nsdEnd ?? "06:00", { type: "time" })}
        </fieldset>
        {!ro && <SubmitButton>Save settings</SubmitButton>}
      </ActionForm>
    </>
  );
}
