import { revalidatePath } from "next/cache";
import { requireRole, getSession } from "@/lib/data/session";
import { can } from "@/lib/roles";
import { fullName, loadPeriodContext } from "@/lib/data/load";
import { persistItems } from "@/lib/data/persist";
import { friendlyError, num, str } from "@/lib/data/errors";
import { calculate13thMonth } from "@/lib/payroll/engine";
import { peso, sum } from "@/lib/payroll/money";
import { ActionForm, SubmitButton, type ActionResult } from "@/components/action-form";
import { ExportButtons } from "@/components/export-buttons";
import { Empty, Notice, PageHeader, StatusBadge, label } from "@/components/ui";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

async function computeYear(sb: Awaited<ReturnType<typeof getSession>>["supabase"], year: number) {
  const [{ data: items }, { data: emps }, { data: records }] = await Promise.all([
    sb.from("payroll_items").select("employee_id, thirteenth_month_basis, payroll_periods!inner(period_end, status)").gte("payroll_periods.period_end", `${year}-01-01`).lte("payroll_periods.period_end", `${year}-12-31`).neq("payroll_periods.status", "cancelled"),
    sb.from("employees").select("id, employee_no, first_name, middle_name, last_name, suffix, date_hired, separation_date, employment_status, thirteenth_month_eligible").is("deleted_at", null).order("last_name"),
    sb.from("thirteenth_month_records").select("*").eq("year", year),
  ]);
  return (emps ?? [])
    .filter((e) => e.thirteenth_month_eligible)
    .map((e) => {
      const months = Array(12).fill(0);
      for (const i of (items ?? []).filter((x) => x.employee_id === e.id)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const m = Number(((i.payroll_periods as any).period_end as string).slice(5, 7)) - 1;
        months[m] += Number(i.thirteenth_month_basis);
      }
      const rec = (records ?? []).find((r) => r.employee_id === e.id);
      const calc = calculate13thMonth({ monthlyBasic: months, adjustment: rec ? Number(rec.adjustment) : 0 });
      const type = e.separation_date && e.separation_date.startsWith(String(year)) ? "separated" : e.date_hired && e.date_hired > `${year}-01-01` ? "pro_rated" : "full_year";
      return { e, months: calc.months, total: calc.totalBasic, computed: calc.computed, rec, type, amount: calc.thirteenthMonth };
    })
    .filter((r) => r.total > 0 || r.rec);
}

async function finalize(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  "use server";
  const { supabase, user, role } = await getSession();
  if (!can.writePayroll(role)) return { error: "Only payroll admins can finalize 13th month pay." };
  const year = Number(fd.get("year"));
  const rows = await computeYear(supabase, year);
  const adjEmp = str(fd.get("adj_employee"));
  const adj = num(fd.get("adj_amount"));
  const adjReason = str(fd.get("adj_reason"));
  if (adjEmp && adj !== null && !adjReason) return { error: "Enter the reason for the manual adjustment." };
  for (const r of rows) {
    if (r.rec?.status === "paid") continue;
    const adjustment = r.e.id === adjEmp && adj !== null ? adj : Number(r.rec?.adjustment ?? 0);
    const calc = calculate13thMonth({ monthlyBasic: r.months, adjustment });
    const { error } = await supabase.from("thirteenth_month_records").upsert(
      {
        year, employee_id: r.e.id, months: calc.months, total_basic: calc.totalBasic, computed: calc.computed, adjustment,
        adjustment_reason: r.e.id === adjEmp ? adjReason : r.rec?.adjustment_reason ?? null, amount: calc.thirteenthMonth,
        computation_type: r.type, status: "final", created_by: user.id,
      },
      { onConflict: "year,employee_id" }
    );
    if (error) return { error: friendlyError(error) };
  }
  revalidatePath("/thirteenth-month");
  return { ok: "13th month computation saved as Final." };
}

async function addToPayroll(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  "use server";
  const { supabase, user, role } = await getSession();
  if (!can.writePayroll(role)) return { error: "Only payroll admins can do this." };
  const year = Number(fd.get("year"));
  const periodId = String(fd.get("period_id"));
  const ctx = await loadPeriodContext(supabase, periodId);
  if (!ctx || !["draft", "encoding"].includes(ctx.period.status)) return { error: "Choose a payroll in Draft or Encoding." };
  const { data: recs } = await supabase.from("thirteenth_month_records").select("*").eq("year", year).eq("status", "final");
  const rows = [];
  for (const rec of recs ?? []) {
    const emp = ctx.employees.find((e) => e.profile.id === rec.employee_id);
    if (!emp) continue;
    const enc = structuredClone(emp.item?.encoded ?? emp.defaultEncoded);
    enc.extraEarnings = enc.extraEarnings.filter((l) => l.code !== `THIRTEENTH:${year}`);
    enc.extraEarnings.push({ code: `THIRTEENTH:${year}`, label: `13th month pay ${year}`, category: "bonus", amount: Number(rec.amount), taxTreatment: "other_benefit", includeInSSS: false, includeInPagibig: false });
    rows.push({ employeeId: emp.profile.id, encoded: enc });
  }
  if (!rows.length) return { error: "No finalized 13th month records match employees in that payroll." };
  const { saved, errors } = await persistItems(supabase, user.id, ctx, rows);
  await supabase.from("thirteenth_month_records").update({ paid_period_id: periodId }).eq("year", year).eq("status", "final");
  revalidatePath("/thirteenth-month");
  return errors.length ? { error: errors.join(" ") } : { ok: `13th month added to ${saved} employee(s) in ${ctx.period.code}. Amounts above the annual exemption are taxed automatically.` };
}

export default async function ThirteenthPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const sp = await searchParams;
  const year = Number(sp.year ?? new Date().getFullYear());
  const { supabase, role } = await requireRole(can.readPayroll);
  const rows = await computeYear(supabase, year);
  const { data: open } = await supabase.from("payroll_periods").select("id, code").in("status", ["draft", "encoding"]).order("period_start", { ascending: false });
  const csv = [["Employee", ...MONTHS, "Total basic", "Computed", "Adjustment", "13th month", "Type"], ...rows.map((r) => [fullName(r.e), ...r.months.map((m) => m.toFixed(2)), r.total.toFixed(2), r.computed.toFixed(2), Number(r.rec?.adjustment ?? 0).toFixed(2), r.amount.toFixed(2), r.type])];
  return (
    <>
      <PageHeader title={`13th month pay — ${year}`} subtitle="Total basic salary actually earned in the calendar year ÷ 12. OT, premiums, NSD, holiday pay and allowances are excluded." actions={<ExportButtons filename={`13th-month-${year}`} rows={csv} />} />
      <Notice tone="info">Due on or before December 24 under PD 851. The basis per payroll is “basic pay net of absences/tardiness + paid leave”. Employees separated during the year get a pro-rated amount through their last payroll.</Notice>
      <form className="no-print mb-3 flex items-end gap-2"><label><span className="label">Year</span><input name="year" defaultValue={year} className="input w-28" /></label><button className="btn-secondary">Show</button></form>
      <div className="card mb-4 overflow-x-auto">
        <table className="table min-w-[1200px]">
          <thead><tr><th>Employee</th>{MONTHS.map((m) => <th key={m} className="num">{m}</th>)}<th className="num">Total basic</th><th className="num">13th month</th><th>Type</th><th>Status</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.e.id}>
                <td>{fullName(r.e)}</td>
                {r.months.map((m, i) => <td key={i} className="num text-xs">{m ? peso(m) : "—"}</td>)}
                <td className="num">{peso(r.total)}</td>
                <td className="num font-semibold">{peso(r.amount)}{r.rec && Number(r.rec.adjustment) !== 0 && <div className="text-[10px] font-normal text-amber-700" title={r.rec.adjustment_reason ?? ""}>adj {peso(Number(r.rec.adjustment))}</div>}</td>
                <td>{label(r.type)}</td>
                <td>{r.rec ? <StatusBadge status={r.rec.paid_period_id ? "paid" : r.rec.status === "final" ? "approved" : "draft"} /> : <StatusBadge status="draft" />}</td>
              </tr>
            ))}
          </tbody>
          {rows.length > 0 && <tfoot><tr className="font-semibold"><td className="px-3 py-2">Total</td>{MONTHS.map((m) => <td key={m} />)}<td className="num px-3">{peso(sum(rows.map((r) => r.total)))}</td><td className="num px-3">{peso(sum(rows.map((r) => r.amount)))}</td><td colSpan={2} /></tr></tfoot>}
        </table>
        {!rows.length && <Empty>No payroll data for {year}.</Empty>}
      </div>
      {can.writePayroll(role) && rows.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          <ActionForm action={finalize} className="card space-y-2 p-4">
            <input type="hidden" name="year" value={year} />
            <div className="text-sm font-semibold">Finalize computation</div>
            <div className="text-xs text-slate-500">Optional manual adjustment for one employee (requires a reason; it is logged):</div>
            <select name="adj_employee" className="input"><option value="">No adjustment</option>{rows.map((r) => <option key={r.e.id} value={r.e.id}>{fullName(r.e)}</option>)}</select>
            <div className="grid grid-cols-2 gap-2"><input name="adj_amount" className="input" placeholder="Adjustment ₱ (+/−)" /><input name="adj_reason" className="input" placeholder="Reason" /></div>
            <SubmitButton>Save as final</SubmitButton>
          </ActionForm>
          <ActionForm action={addToPayroll} className="card space-y-2 p-4">
            <input type="hidden" name="year" value={year} />
            <div className="text-sm font-semibold">Pay through payroll</div>
            <div className="text-xs text-slate-500">Adds each finalized amount as “13th month pay” to the chosen open payroll.</div>
            <select name="period_id" className="input" required>{(open ?? []).map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}</select>
            <SubmitButton variant="secondary">Add to payroll</SubmitButton>
          </ActionForm>
        </div>
      )}
    </>
  );
}
