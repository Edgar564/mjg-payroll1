import Link from "next/link";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/data/session";
import { can } from "@/lib/roles";
import { fullName } from "@/lib/data/load";
import { peso } from "@/lib/payroll/money";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Empty, Notice, PageHeader, StatusBadge, TestBadge, fmtDate, fmtDateTime, label } from "@/components/ui";
import { EmployeeForm } from "../employee-form";
import { addAllowance, addDeduction, deactivateLine, softDeleteEmployee } from "../actions";

export default async function EmployeePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase, role } = await getSession();
  const canGov = can.readGovIds(role);
  const { data: emp } = await supabase
    .from("employees")
    .select(`*${canGov ? ", employee_government_ids(*)" : ""}`)
    .eq("id", id)
    .maybeSingle<Record<string, any>>(); // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!emp) notFound();
  if (Array.isArray(emp.employee_government_ids)) emp.employee_government_ids = emp.employee_government_ids[0] ?? null;

  const [p, d, b, earningTypes, allowances, deductions, loans, items, history] = await Promise.all([
    supabase.from("positions").select("id, name").order("name"),
    supabase.from("departments").select("id, name").order("name"),
    supabase.from("branches").select("id, name").order("name"),
    supabase.from("earning_types").select("code, label, tax_treatment").eq("active", true).eq("category", "allowance").order("label"),
    supabase.from("employee_allowances").select("*, earning_types(label, tax_treatment)").eq("employee_id", id).eq("active", true),
    supabase.from("employee_deductions").select("*").eq("employee_id", id).eq("active", true),
    supabase.from("loan_accounts").select("*").eq("employee_id", id).order("created_at", { ascending: false }),
    supabase.from("payroll_items").select("id, gross_pay, total_deductions, net_pay, payroll_periods(code, period_start, period_end, status)").eq("employee_id", id).order("created_at", { ascending: false }).limit(24),
    supabase.from("employee_salary_history").select("*").eq("employee_id", id).order("changed_at", { ascending: false }),
  ]);
  const canPay = can.writePayroll(role);

  return (
    <>
      <PageHeader
        title={fullName(emp as never)}
        subtitle={<span>{emp.employee_no} · <StatusBadge status={emp.employment_status} />{emp.is_test_data && <TestBadge />}</span>}
        actions={
          can.writeEmployees(role) && (
            <form action={softDeleteEmployee}>
              <input type="hidden" name="id" value={id} />
              <button className="btn-danger">Archive</button>
            </form>
          )
        }
      />
      {sp.saved && <Notice tone="success" title="Employee created." />}
      <EmployeeForm employee={emp} positions={p.data ?? []} departments={d.data ?? []} branches={b.data ?? []} canGov={canGov} canEdit={can.writeEmployees(role)} />

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card p-4">
          <h2 className="mb-3 text-sm font-semibold">Recurring allowances</h2>
          <table className="table">
            <thead><tr><th>Type</th><th>Tax</th><th className="num">Amount</th><th>Basis</th><th>From</th><th /></tr></thead>
            <tbody>
              {(allowances.data ?? []).map((a) => (
                <tr key={a.id}>
                  <td>{a.earning_types?.label}</td>
                  <td>{label(a.earning_types?.tax_treatment)}</td>
                  <td className="num">{peso(a.amount)}</td>
                  <td>{a.per_period ? "Per payroll" : "Per month"}</td>
                  <td>{fmtDate(a.effective_from)}</td>
                  <td>{canPay && (
                    <form action={deactivateLine}>
                      <input type="hidden" name="id" value={a.id} /><input type="hidden" name="table" value="allowance" /><input type="hidden" name="employee_id" value={id} />
                      <button className="text-xs text-red-700 hover:underline">End</button>
                    </form>)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!allowances.data?.length && <Empty>No recurring allowances.</Empty>}
          {canPay && (
            <ActionForm action={addAllowance} resetOnSuccess className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <input type="hidden" name="employee_id" value={id} />
              <select name="earning_code" className="input col-span-2">
                {(earningTypes.data ?? []).map((t) => <option key={t.code} value={t.code}>{t.label} ({label(t.tax_treatment)})</option>)}
              </select>
              <input name="amount" className="input" placeholder="Amount ₱" inputMode="decimal" required />
              <select name="per_period" className="input"><option value="period">Per payroll</option><option value="month">Per month</option></select>
              <input name="effective_from" type="date" className="input col-span-2" />
              <div className="col-span-2"><SubmitButton variant="secondary">Add allowance</SubmitButton></div>
            </ActionForm>
          )}
        </section>

        <section className="card p-4">
          <h2 className="mb-3 text-sm font-semibold">Authorized deductions</h2>
          <table className="table">
            <thead><tr><th>Deduction</th><th className="num">Amount</th><th>Type</th><th>Authorization</th><th /></tr></thead>
            <tbody>
              {(deductions.data ?? []).map((x) => (
                <tr key={x.id}>
                  <td>{x.label}<div className="text-[11px] text-slate-500">{fmtDate(x.start_date)} – {x.end_date ? fmtDate(x.end_date) : "open"}</div></td>
                  <td className="num">{peso(x.amount)}</td>
                  <td>{x.recurring ? "Every payroll" : x.applied_period_id ? "One-time (applied)" : "One-time"}</td>
                  <td className="text-xs">{x.authorization_ref}</td>
                  <td>{canPay && (
                    <form action={deactivateLine}>
                      <input type="hidden" name="id" value={x.id} /><input type="hidden" name="table" value="deduction" /><input type="hidden" name="employee_id" value={id} />
                      <button className="text-xs text-red-700 hover:underline">End</button>
                    </form>)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!deductions.data?.length && <Empty>No deductions set up.</Empty>}
          {canPay && (
            <ActionForm action={addDeduction} resetOnSuccess className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <input type="hidden" name="employee_id" value={id} />
              <select name="code" className="input">
                <option value="UNIFORM">Uniform</option><option value="DAMAGE">Damage / loss</option><option value="OTHER">Other</option>
              </select>
              <input name="label" className="input" placeholder="Description" />
              <input name="amount" className="input" placeholder="Amount ₱" inputMode="decimal" required />
              <select name="recurring" className="input"><option value="no">One-time</option><option value="yes">Every payroll</option></select>
              <input name="authorization_ref" className="input col-span-2" placeholder="Signed authorization / reference *" required />
              <input name="start_date" type="date" className="input" />
              <input name="end_date" type="date" className="input" />
              <div className="col-span-2"><SubmitButton variant="secondary">Add deduction</SubmitButton></div>
            </ActionForm>
          )}
          <p className="mt-2 text-[11px] text-slate-500">Deductions for loss or damage are subject to DOLE rules on wage deductions. Keep the signed authorization on file.</p>
        </section>

        <section className="card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Loans &amp; advances</h2>
            <Link href={`/loans?employee=${id}`} className="text-xs text-brand-700 hover:underline">Manage</Link>
          </div>
          <table className="table">
            <thead><tr><th>Type</th><th className="num">Principal</th><th className="num">Installment</th><th className="num">Balance</th><th>Status</th></tr></thead>
            <tbody>
              {(loans.data ?? []).map((l) => (
                <tr key={l.id}><td>{label(l.loan_type)}</td><td className="num">{peso(l.total_payable)}</td><td className="num">{peso(l.installment_amount)}</td><td className="num">{peso(l.balance)}</td><td><StatusBadge status={l.status} /></td></tr>
              ))}
            </tbody>
          </table>
          {!loans.data?.length && <Empty>No loans.</Empty>}
        </section>

        <section className="card p-4">
          <h2 className="mb-3 text-sm font-semibold">Payroll history</h2>
          <table className="table">
            <thead><tr><th>Period</th><th>Status</th><th className="num">Gross</th><th className="num">Net</th><th /></tr></thead>
            <tbody>
              {(items.data ?? []).map((i) => {
                const pp = (Array.isArray(i.payroll_periods) ? i.payroll_periods[0] : i.payroll_periods) as { code: string; status: string } | null;
                return (
                  <tr key={i.id}><td>{pp?.code}</td><td>{pp && <StatusBadge status={pp.status} />}</td><td className="num">{peso(i.gross_pay)}</td><td className="num">{peso(i.net_pay)}</td>
                    <td><Link href={`/payslips/${i.id}`} className="text-xs text-brand-700 hover:underline">Payslip</Link></td></tr>
                );
              })}
            </tbody>
          </table>
          {!items.data?.length && <Empty>No payroll yet.</Empty>}
        </section>

        <section className="card p-4 lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold">Salary history</h2>
          <table className="table">
            <thead><tr><th>Changed</th><th>Type</th><th className="num">Monthly</th><th className="num">Daily</th><th className="num">Hourly</th></tr></thead>
            <tbody>
              {(history.data ?? []).map((h) => (
                <tr key={h.id}><td>{fmtDateTime(h.changed_at)}</td><td>{label(h.salary_type)}</td><td className="num">{h.monthly_rate ? peso(h.monthly_rate) : "—"}</td><td className="num">{h.daily_rate ? peso(h.daily_rate) : "—"}</td><td className="num">{h.hourly_rate ? peso(h.hourly_rate) : "—"}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </>
  );
}
