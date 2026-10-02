import { revalidatePath } from "next/cache";
import { requireRole, getSession } from "@/lib/data/session";
import { can } from "@/lib/roles";
import { fullName } from "@/lib/data/load";
import { friendlyError, num, str } from "@/lib/data/errors";
import { peso } from "@/lib/payroll/money";
import { ActionForm, SubmitButton, type ActionResult } from "@/components/action-form";
import { Empty, Notice, PageHeader, StatusBadge, fmtDateTime, label } from "@/components/ui";

async function requestAdjustment(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  "use server";
  const { supabase, user, role } = await getSession();
  if (!can.writePayroll(role)) return { error: "Only payroll admins can request adjustments." };
  const amount = num(fd.get("amount"));
  const reason = str(fd.get("reason"));
  const [periodId, employeeId, itemId] = String(fd.get("target") ?? "").split("|");
  if (!periodId || !employeeId) return { error: "Choose the original payroll and employee." };
  if (!amount || amount <= 0) return { error: "Enter an amount greater than zero." };
  if (!reason) return { error: "A reason is required." };
  const type = String(fd.get("adjustment_type"));
  const { error } = await supabase.from("payroll_adjustments").insert({
    original_period_id: periodId,
    original_item_id: itemId || null,
    employee_id: employeeId,
    adjustment_type: type,
    amount,
    taxable: fd.get("taxable") === "yes",
    reason,
    requested_by: user.id,
  });
  if (error) return { error: friendlyError(error) };
  revalidatePath("/adjustments");
  return { ok: "Adjustment requested. A Payroll Approver must approve it." };
}

async function decide(fd: FormData) {
  "use server";
  const { supabase } = await getSession();
  await supabase.rpc("decide_adjustment", { p_id: String(fd.get("id")), p_approve: fd.get("approve") === "yes" });
  revalidatePath("/adjustments");
}

export default async function AdjustmentsPage() {
  const { supabase, role } = await requireRole(can.readPayroll);
  const [{ data: rows }, { data: items }] = await Promise.all([
    supabase.from("payroll_adjustments").select("*, employees(first_name, middle_name, last_name, suffix), original:payroll_periods!payroll_adjustments_original_period_id_fkey(code), applied:payroll_periods!payroll_adjustments_applied_period_id_fkey(code)").order("requested_at", { ascending: false }),
    supabase.from("payroll_items").select("id, employee_id, net_pay, employees(first_name, middle_name, last_name, suffix), payroll_periods!inner(id, code, status)").in("payroll_periods.status", ["posted", "paid", "locked"]).limit(500),
  ]);
  return (
    <>
      <PageHeader title="Payroll adjustments" subtitle="Corrections to posted, paid or locked payroll. Finalized payroll is never edited." />
      <Notice tone="info">
        Approved adjustments are added automatically to the employee&apos;s next open payroll (regular or an adjustment payroll you create under Payroll Periods), and marked
        Applied when that payroll is posted.
      </Notice>
      {can.writePayroll(role) && (
        <ActionForm action={requestAdjustment} resetOnSuccess className="card mb-4 grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="sm:col-span-2"><span className="label">Original payroll / employee</span>
            <select name="target" className="input" required>
              <option value="">Choose…</option>
              {(items ?? []).map((i) => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const p = i.payroll_periods as any;
                return <option key={i.id} value={`${p.id}|${i.employee_id}|${i.id}`}>{p.code} — {fullName(i.employees as never)} (net {peso(i.net_pay)})</option>;
              })}
            </select>
          </label>
          <label><span className="label">Type</span>
            <select name="adjustment_type" className="input">
              <option value="earning">Additional earning (underpaid)</option>
              <option value="deduction">Deduction (overpaid)</option>
              <option value="statutory_correction">Statutory correction (earning)</option>
              <option value="tax_correction">Tax refund (earning)</option>
            </select>
          </label>
          <label><span className="label">Amount (₱)</span><input name="amount" className="input" inputMode="decimal" required /></label>
          <label><span className="label">Taxable?</span><select name="taxable" className="input"><option value="yes">Taxable</option><option value="no">Non-taxable</option></select></label>
          <label className="sm:col-span-2"><span className="label">Reason *</span><input name="reason" className="input" required placeholder="e.g. Unpaid OT 4 hrs on Oct 10" /></label>
          <div className="flex items-end"><SubmitButton>Request adjustment</SubmitButton></div>
        </ActionForm>
      )}
      <div className="card overflow-x-auto">
        <table className="table">
          <thead><tr><th>Requested</th><th>Employee</th><th>Original payroll</th><th>Type</th><th className="num">Amount</th><th>Reason</th><th>Status</th><th>Applied in</th><th /></tr></thead>
          <tbody>
            {(rows ?? []).map((a) => (
              <tr key={a.id}>
                <td className="text-xs">{fmtDateTime(a.requested_at)}</td>
                <td>{fullName(a.employees)}</td>
                <td>{a.original?.code}</td>
                <td>{label(a.adjustment_type)}{!a.taxable && " (non-taxable)"}</td>
                <td className={`num ${a.adjustment_type === "deduction" ? "text-red-700" : ""}`}>{a.adjustment_type === "deduction" ? "-" : ""}{peso(a.amount)}</td>
                <td className="max-w-64">{a.reason}</td>
                <td><StatusBadge status={a.status} /></td>
                <td>{a.applied?.code ?? "—"}</td>
                <td>
                  {a.status === "pending" && can.approve(role) && (
                    <div className="flex gap-1">
                      <form action={decide}><input type="hidden" name="id" value={a.id} /><input type="hidden" name="approve" value="yes" /><button className="btn-primary text-xs">Approve</button></form>
                      <form action={decide}><input type="hidden" name="id" value={a.id} /><input type="hidden" name="approve" value="no" /><button className="btn-danger text-xs">Reject</button></form>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows?.length && <Empty>No adjustments.</Empty>}
      </div>
    </>
  );
}
