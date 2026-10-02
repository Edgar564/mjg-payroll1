import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/data/session";
import { can } from "@/lib/roles";
import { loadPeriodContext } from "@/lib/data/load";
import { peso, sum } from "@/lib/payroll/money";
import { COMPLIANCE_NOTE, Notice, PageHeader, StatCard, StatusBadge, fmtDate, label } from "@/components/ui";
import { PayrollGrid } from "./payroll-grid";
import { Workflow } from "./workflow";
import { Payments, type PaymentRow } from "./payments";
import { addAllEmployees, recalcAll, removeItem } from "../actions";

export default async function PeriodPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ moved?: string }> }) {
  const { id } = await params;
  const { moved } = await searchParams;
  const { supabase, role } = await requireRole(can.readPayroll);
  const ctx = await loadPeriodContext(supabase, id);
  if (!ctx) notFound();
  const p = ctx.period;
  const editable = can.writePayroll(role) && ["draft", "encoding"].includes(p.status);

  const { data: items } = await supabase.from("payroll_items").select("*").eq("period_id", id);
  const I = items ?? [];
  const t = (k: string) => sum(I.map((i) => Number(i[k])));
  const eeStat = sum([t("sss_ee"), t("philhealth_ee"), t("pagibig_ee")]);
  const erStat = sum([t("sss_er"), t("sss_ec"), t("philhealth_er"), t("pagibig_er")]);
  const blocking = I.filter((i) => i.has_errors).length;
  const notAdded = ctx.employees.filter((e) => !e.item);

  let payments: PaymentRow[] = [];
  if (["posted", "paid", "locked"].includes(p.status)) {
    const { data } = await supabase.from("payroll_payments").select("*").eq("period_id", id);
    payments = (data ?? []).map((x) => ({ ...x, name: ctx.employees.find((e) => e.profile.id === x.employee_id)?.summary.name ?? "—" }));
  }

  return (
    <>
      <PageHeader
        title={`Payroll ${p.code}`}
        subtitle={<span>{fmtDate(p.period_start)} – {fmtDate(p.period_end)} · Pay date {fmtDate(p.pay_date)} · {label(p.frequency)} · <StatusBadge status={p.status} />{p.is_adjustment && " · Adjustment payroll"}</span>}
        actions={
          <>
            <Link className="btn-secondary" href={`/payroll/${id}/register`}>Payroll register</Link>
            <Link className="btn-secondary" href={`/payslips?period=${id}`}>Payslips</Link>
          </>
        }
      />
      {moved && <Notice tone="success" title={moved === "reversed" ? "Posting reversed. Payroll is back to Approved." : `Payroll moved to ${label(moved)}.`} />}
      <Notice tone="info">{COMPLIANCE_NOTE}</Notice>
      {ctx.missingConfig.length > 0 && (
        <Notice tone="error" title="⚠ STATUTORY CONFIGURATION WARNING">
          The {ctx.missingConfig.map((m) => m.replace("_", " ").toUpperCase()).join(", ")} configuration for this payroll period is expired or unavailable.
          Payroll cannot be finalized until an authorized administrator activates a valid configuration under Statutory Tables.
        </Notice>
      )}

      <Workflow
        periodId={id}
        status={p.status}
        blocking={blocking}
        perms={{ write: can.writePayroll(role), review: can.review(role), approve: can.approve(role), post: can.post(role), pay: can.pay(role) }}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Gross payroll" value={t("gross_pay")} hint={`${I.length} employee(s)`} />
        <StatCard label="Employee deductions" value={t("total_deductions")} hint={`Statutory ${peso(eeStat)} · Tax ${peso(t("withholding_tax"))}`} />
        <StatCard label="Employer contributions" value={erStat} hint="Not deducted from employees" />
        <StatCard label="Net pay" value={t("net_pay")} tone="brand" />
        <StatCard label="Total employer cost" value={t("employer_cost")} hint="Gross + employer contributions" />
      </div>

      <details className="card mb-4 p-4">
        <summary className="cursor-pointer text-sm font-semibold">Statutory breakdown</summary>
        <table className="table mt-3 max-w-xl">
          <thead><tr><th>Contribution</th><th className="num">Employee</th><th className="num">Employer</th><th className="num">Total</th></tr></thead>
          <tbody>
            <tr><td>SSS (incl. MPF)</td><td className="num">{peso(t("sss_ee"))}</td><td className="num">{peso(t("sss_er"))}</td><td className="num">{peso(t("sss_ee") + t("sss_er"))}</td></tr>
            <tr><td>SSS EC</td><td className="num">—</td><td className="num">{peso(t("sss_ec"))}</td><td className="num">{peso(t("sss_ec"))}</td></tr>
            <tr><td>PhilHealth</td><td className="num">{peso(t("philhealth_ee"))}</td><td className="num">{peso(t("philhealth_er"))}</td><td className="num">{peso(t("philhealth_ee") + t("philhealth_er"))}</td></tr>
            <tr><td>Pag-IBIG</td><td className="num">{peso(t("pagibig_ee"))}</td><td className="num">{peso(t("pagibig_er"))}</td><td className="num">{peso(t("pagibig_ee") + t("pagibig_er"))}</td></tr>
            <tr><td>Withholding tax</td><td className="num">{peso(t("withholding_tax"))}</td><td className="num">—</td><td className="num">{peso(t("withholding_tax"))}</td></tr>
            <tr><td>Loans / advances / other</td><td className="num">{peso(t("loans") + t("advances") + t("other_deductions"))}</td><td className="num">—</td><td /></tr>
          </tbody>
        </table>
      </details>

      {editable && (
        <div className="no-print mb-4 flex flex-wrap items-center gap-2">
          {notAdded.length > 0 && (
            <form action={addAllEmployees}>
              <input type="hidden" name="period_id" value={id} />
              <button className="btn-primary">Add all eligible employees ({notAdded.length})</button>
            </form>
          )}
          {I.length > 0 && (
            <form action={recalcAll}>
              <input type="hidden" name="period_id" value={id} />
              <button className="btn-secondary" title="Re-applies current statutory tables, loans and month-to-date data">Recalculate all</button>
            </form>
          )}
          {notAdded.length > 0 && (
            <details className="relative">
              <summary className="btn-secondary cursor-pointer list-none">Add one employee…</summary>
              <div className="absolute z-20 mt-1 max-h-72 w-72 overflow-y-auto rounded-md border border-slate-200 bg-white p-1 shadow-lg">
                {notAdded.map((e) => (
                  <Link key={e.profile.id} href={`/payroll/${id}/entry/${e.profile.id}`} className="block rounded px-2 py-1.5 text-sm hover:bg-slate-50">
                    {e.summary.name} <span className="text-xs text-slate-500">{e.summary.employee_no}</span>
                  </Link>
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      {ctx.employees.some((e) => e.item) ? (
        <PayrollGrid key={ctx.employees.filter((e) => e.item).map((e) => e.item!.id).join(",")} ctx={ctx} editable={editable} />
      ) : (
        <div className="card mb-4 p-8 text-center text-sm text-slate-500">No employees in this payroll yet.{editable && " Use “Add all eligible employees” to start."}</div>
      )}

      {editable && I.length > 0 && (
        <details className="no-print mb-4 text-sm">
          <summary className="cursor-pointer text-slate-500">Remove an employee from this payroll</summary>
          <div className="mt-2 flex flex-wrap gap-2">
            {ctx.employees.filter((e) => e.item).map((e) => (
              <form key={e.profile.id} action={removeItem}>
                <input type="hidden" name="period_id" value={id} />
                <input type="hidden" name="employee_id" value={e.profile.id} />
                <button className="btn-danger text-xs">Remove {e.summary.name}</button>
              </form>
            ))}
          </div>
        </details>
      )}

      {payments.length > 0 && <Payments periodId={id} payments={payments} canPay={can.pay(role) && p.status === "posted"} />}
    </>
  );
}
