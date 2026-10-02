import { revalidatePath } from "next/cache";
import { requireRole, getSession } from "@/lib/data/session";
import { can } from "@/lib/roles";
import { fullName } from "@/lib/data/load";
import { friendlyError, num, str } from "@/lib/data/errors";
import { peso, sum } from "@/lib/payroll/money";
import { ActionForm, SubmitButton, type ActionResult } from "@/components/action-form";
import { Empty, PageHeader, label } from "@/components/ui";

async function addCommission(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  "use server";
  const { supabase, user, role } = await getSession();
  if (!can.writePayroll(role)) return { error: "Only payroll admins can encode commissions." };
  const basis = num(fd.get("sales_basis"));
  const rate = num(fd.get("rate"));
  let amount = num(fd.get("amount"));
  if (amount === null && basis !== null && rate !== null) amount = Math.round(basis * (rate / 100) * 100) / 100;
  if (!amount || amount <= 0) return { error: "Enter the commission amount, or the sales basis and rate." };
  if (!str(fd.get("employee_id")) || !str(fd.get("period_id"))) return { error: "Choose the employee and payroll period." };
  const { data: period } = await supabase.from("payroll_periods").select("status").eq("id", String(fd.get("period_id"))).single();
  if (!period || !["draft", "encoding"].includes(period.status)) return { error: "Commissions can only be added to a payroll in Draft or Encoding." };
  const { error } = await supabase.from("commission_records").insert({
    employee_id: str(fd.get("employee_id")),
    period_id: str(fd.get("period_id")),
    commission_type: String(fd.get("commission_type") ?? "sales"),
    sales_basis: basis,
    rate: rate === null ? null : rate / 100,
    amount,
    reference: str(fd.get("reference")),
    notes: str(fd.get("notes")),
    created_by: user.id,
  });
  if (error) return { error: friendlyError(error) };
  revalidatePath("/commissions");
  return { ok: `Commission of ${peso(amount)} recorded. Open the payroll and click "Recalculate all" (or save the employee) to include it.` };
}

export default async function CommissionsPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const sp = await searchParams;
  const { supabase, role } = await requireRole(can.readPayroll);
  const [{ data: periods }, { data: emps }] = await Promise.all([
    supabase.from("payroll_periods").select("id, code, status").neq("status", "cancelled").order("period_start", { ascending: false }).limit(24),
    supabase.from("employees").select("id, employee_no, first_name, middle_name, last_name, suffix").is("deleted_at", null).order("last_name"),
  ]);
  const periodId = sp.period ?? periods?.[0]?.id;
  const { data: rows } = periodId
    ? await supabase.from("commission_records").select("*, employees(first_name, middle_name, last_name, suffix, employee_no)").eq("period_id", periodId).order("created_at")
    : { data: [] };
  const open = (periods ?? []).filter((p) => ["draft", "encoding"].includes(p.status));
  return (
    <>
      <PageHeader title="Commissions" subtitle="Commissions are taxable compensation and appear separately on the payslip." />
      {can.writePayroll(role) && (
        <ActionForm action={addCommission} resetOnSuccess className="card mb-4 grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <label><span className="label">Employee</span><select name="employee_id" className="input" required><option value="">Choose…</option>{(emps ?? []).map((e) => <option key={e.id} value={e.id}>{fullName(e)}</option>)}</select></label>
          <label><span className="label">Payroll period</span><select name="period_id" className="input" defaultValue={open.find((p) => p.id === periodId)?.id} required>{open.map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}</select></label>
          <label><span className="label">Type</span><select name="commission_type" className="input"><option value="sales">Sales</option><option value="delivery">Delivery / per-tank</option><option value="collection">Collection</option><option value="other">Other</option></select></label>
          <label><span className="label">Reference</span><input name="reference" className="input" placeholder="e.g. Sales report Oct 1–15" /></label>
          <label><span className="label">Sales basis (₱)</span><input name="sales_basis" className="input" inputMode="decimal" /></label>
          <label><span className="label">Rate (%)</span><input name="rate" className="input" inputMode="decimal" /></label>
          <label><span className="label">Amount (₱)</span><input name="amount" className="input" inputMode="decimal" placeholder="Auto = basis × rate" /></label>
          <div className="flex items-end"><SubmitButton>Add commission</SubmitButton></div>
        </ActionForm>
      )}
      <form className="card mb-4 flex items-end gap-3 p-3">
        <label className="flex-1"><span className="label">Payroll period</span><select name="period" defaultValue={periodId} className="input">{(periods ?? []).map((p) => <option key={p.id} value={p.id}>{p.code} — {p.status}</option>)}</select></label>
        <button className="btn-secondary">Show</button>
      </form>
      <div className="card overflow-x-auto">
        <table className="table">
          <thead><tr><th>Employee</th><th>Type</th><th className="num">Sales basis</th><th className="num">Rate</th><th className="num">Amount</th><th>Reference</th></tr></thead>
          <tbody>
            {(rows ?? []).map((r) => (
              <tr key={r.id}><td>{fullName(r.employees)}</td><td>{label(r.commission_type)}</td><td className="num">{r.sales_basis ? peso(r.sales_basis) : "—"}</td><td className="num">{r.rate ? `${(Number(r.rate) * 100).toFixed(2)}%` : "—"}</td><td className="num">{peso(r.amount)}</td><td>{r.reference ?? "—"}</td></tr>
            ))}
          </tbody>
          {!!rows?.length && <tfoot><tr className="font-semibold"><td colSpan={4} className="px-3 py-2">Total</td><td className="num px-3">{peso(sum(rows.map((r) => Number(r.amount))))}</td><td /></tr></tfoot>}
        </table>
        {!rows?.length && <Empty>No commissions for this period.</Empty>}
      </div>
    </>
  );
}
