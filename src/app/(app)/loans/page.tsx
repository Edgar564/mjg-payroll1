import { requireRole } from "@/lib/data/session";
import { can } from "@/lib/roles";
import { fullName } from "@/lib/data/load";
import { peso, sum } from "@/lib/payroll/money";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Empty, PageHeader, StatCard, StatusBadge, fmtDate, label } from "@/components/ui";
import { createLoan, recordLoanPayment, setLoanStatus } from "./actions";

const TYPES = ["salary_loan", "cash_advance", "sss_loan", "pagibig_loan", "company_loan", "emergency_advance", "other"];

export default async function LoansPage({ searchParams }: { searchParams: Promise<{ employee?: string; status?: string }> }) {
  const sp = await searchParams;
  const { supabase, role } = await requireRole(can.readPayroll);
  let q = supabase.from("loan_accounts").select("*, employees(first_name, middle_name, last_name, suffix, employee_no), loan_transactions(id, kind, amount, txn_date, notes)").order("created_at", { ascending: false });
  if (sp.employee) q = q.eq("employee_id", sp.employee);
  if (sp.status) q = q.eq("status", sp.status);
  const [{ data: loans }, { data: emps }] = await Promise.all([
    q,
    supabase.from("employees").select("id, employee_no, first_name, middle_name, last_name, suffix").is("deleted_at", null).order("last_name"),
  ]);
  const active = (loans ?? []).filter((l) => l.status === "active");
  const canW = can.writePayroll(role);

  return (
    <>
      <PageHeader title="Loans & advances" subtitle="Deducted automatically each payroll until paid; balances update when payroll is posted." />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label="Active loans" value={String(active.length)} />
        <StatCard label="Outstanding balance" value={sum(active.map((l) => Number(l.balance)))} />
        <StatCard label="Scheduled per payroll" value={sum(active.map((l) => Math.min(Number(l.installment_amount), Number(l.balance))))} />
      </div>
      {canW && (
        <details className="card mb-4 p-4">
          <summary className="cursor-pointer text-sm font-semibold text-brand-700">+ New loan / advance</summary>
          <ActionForm action={createLoan} resetOnSuccess className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label><span className="label">Employee</span>
              <select name="employee_id" className="input" defaultValue={sp.employee ?? ""} required>
                <option value="">Choose…</option>
                {(emps ?? []).map((e) => <option key={e.id} value={e.id}>{fullName(e)} ({e.employee_no})</option>)}
              </select>
            </label>
            <label><span className="label">Loan type</span><select name="loan_type" className="input">{TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}</select></label>
            <label><span className="label">Reference no.</span><input name="reference_no" className="input" placeholder="e.g. SSS loan no." /></label>
            <label><span className="label">Principal (₱)</span><input name="principal" className="input" inputMode="decimal" required /></label>
            <label><span className="label">Interest (₱)</span><input name="interest" className="input" inputMode="decimal" placeholder="0" /></label>
            <label><span className="label">No. of installments</span><input name="installments" className="input" inputMode="numeric" required /></label>
            <label><span className="label">Installment per payroll (₱)</span><input name="installment_amount" className="input" inputMode="decimal" placeholder="Auto = total ÷ installments" /></label>
            <label><span className="label">Date released</span><input type="date" name="date_released" className="input" /></label>
            <label><span className="label">Start deduction</span><input type="date" name="start_deduction" className="input" /></label>
            <label><span className="label">End deduction (optional)</span><input type="date" name="end_deduction" className="input" /></label>
            <label><span className="label">Deferral priority</span><input name="priority" className="input" inputMode="numeric" placeholder="0 = deferred last" /></label>
            <label><span className="label">Notes</span><input name="notes" className="input" /></label>
            <div className="flex items-end"><SubmitButton>Create loan</SubmitButton></div>
          </ActionForm>
        </details>
      )}
      <form className="card mb-4 flex items-end gap-3 p-3">
        <label className="flex-1"><span className="label">Employee</span>
          <select name="employee" defaultValue={sp.employee ?? ""} className="input"><option value="">All</option>{(emps ?? []).map((e) => <option key={e.id} value={e.id}>{fullName(e)}</option>)}</select>
        </label>
        <label><span className="label">Status</span>
          <select name="status" defaultValue={sp.status ?? ""} className="input"><option value="">All</option><option value="active">Active</option><option value="paid">Paid</option><option value="on_hold">On hold</option><option value="cancelled">Cancelled</option></select>
        </label>
        <button className="btn-secondary">Filter</button>
      </form>
      <div className="space-y-3">
        {(loans ?? []).map((l) => {
          const paid = Number(l.total_payable) - Number(l.balance);
          return (
            <details key={l.id} className="card p-4">
              <summary className="flex cursor-pointer flex-wrap items-center gap-x-6 gap-y-1 text-sm">
                <span className="min-w-48 font-medium">{fullName(l.employees)}</span>
                <span>{label(l.loan_type)}{l.reference_no ? ` #${l.reference_no}` : ""}</span>
                <span className="num">Total {peso(l.total_payable)}</span>
                <span className="num">Installment {peso(l.installment_amount)}</span>
                <span className="num font-semibold">Balance {peso(l.balance)}</span>
                <StatusBadge status={l.status} />
                <span className="h-1.5 w-32 overflow-hidden rounded bg-slate-100"><span className="block h-full bg-brand-600" style={{ width: `${Math.min(100, (paid / Number(l.total_payable)) * 100)}%` }} /></span>
              </summary>
              <div className="mt-3 grid gap-4 lg:grid-cols-[1fr_320px]">
                <table className="table">
                  <thead><tr><th>Date</th><th>Type</th><th className="num">Amount</th><th>Notes</th></tr></thead>
                  <tbody>
                    <tr><td>{fmtDate(l.date_released)}</td><td>Released</td><td className="num">{peso(l.total_payable)}</td><td>{l.notes}</td></tr>
                    {(l.loan_transactions ?? []).map((t: { id: string; kind: string; amount: number; txn_date: string; notes: string | null }) => (
                      <tr key={t.id}><td>{fmtDate(t.txn_date)}</td><td>{label(t.kind)}</td><td className={`num ${Number(t.amount) < 0 ? "text-red-700" : ""}`}>{peso(-Number(t.amount))}</td><td>{t.notes}</td></tr>
                    ))}
                  </tbody>
                </table>
                {canW && l.status !== "cancelled" && (
                  <div>
                    {l.status === "active" && (
                      <ActionForm action={recordLoanPayment} resetOnSuccess className="mb-3 space-y-2">
                        <input type="hidden" name="loan_id" value={l.id} />
                        <div className="text-xs font-semibold">Record payment outside payroll</div>
                        <input name="amount" className="input" placeholder="Amount ₱" inputMode="decimal" required />
                        <input name="notes" className="input" placeholder="OR no. / reason" required />
                        <SubmitButton variant="secondary">Record payment</SubmitButton>
                      </ActionForm>
                    )}
                    <div className="flex gap-2">
                      {(l.status === "active" || l.status === "on_hold") && (
                        <form action={setLoanStatus}><input type="hidden" name="loan_id" value={l.id} /><input type="hidden" name="status" value={l.status === "active" ? "on_hold" : "active"} />
                          <button className="btn-secondary text-xs">{l.status === "active" ? "Put on hold" : "Resume deductions"}</button></form>
                      )}
                      {l.status !== "paid" && (
                        <form action={setLoanStatus}><input type="hidden" name="loan_id" value={l.id} /><input type="hidden" name="status" value="cancelled" /><button className="btn-danger text-xs">Cancel loan</button></form>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </details>
          );
        })}
        {!loans?.length && <div className="card"><Empty>No loans.</Empty></div>}
      </div>
    </>
  );
}
