"use client";
import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { StatusBadge, fmtDate } from "@/components/ui";
import { peso } from "@/lib/payroll/money";
import { updatePayment } from "../actions";

export type PaymentRow = { id: string; name: string; net_pay: number; status: string; payment_method: string; reference_no: string | null; payment_date: string | null; bank: string | null };

export function Payments({ periodId, payments, canPay }: { periodId: string; payments: PaymentRow[]; canPay: boolean }) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const open = payments.filter((p) => p.status !== "paid" && p.status !== "cancelled");
  return (
    <section className="card mb-4 p-4">
      <h2 className="mb-3 text-sm font-semibold">Payments</h2>
      <ActionForm action={updatePayment}>
        <input type="hidden" name="period_id" value={periodId} />
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                {canPay && <th><input type="checkbox" aria-label="Select all" checked={sel.size > 0 && sel.size === open.length} onChange={(e) => setSel(e.target.checked ? new Set(open.map((p) => p.id)) : new Set())} /></th>}
                <th>Employee</th><th className="num">Net pay</th><th>Method</th><th>Bank</th><th>Reference</th><th>Date</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id}>
                  {canPay && <td>{p.status !== "paid" && p.status !== "cancelled" && <input type="checkbox" name="payment_id" value={p.id} checked={sel.has(p.id)} onChange={() => toggle(p.id)} />}</td>}
                  <td>{p.name}</td><td className="num">{peso(p.net_pay)}</td><td>{p.payment_method.replace("_", " ")}</td><td>{p.bank ?? "—"}</td><td>{p.reference_no ?? "—"}</td><td>{fmtDate(p.payment_date)}</td><td><StatusBadge status={p.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {canPay && open.length > 0 && (
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
            <select name="status" className="input"><option value="paid">Mark paid</option><option value="scheduled">Scheduled</option><option value="failed">Failed</option></select>
            <select name="payment_method" className="input" defaultValue=""><option value="">Keep method</option><option value="cash">Cash</option><option value="bank_transfer">Bank transfer</option><option value="gcash">GCash</option><option value="other">Other</option></select>
            <input name="payment_date" type="date" className="input" />
            <input name="reference_no" className="input" placeholder="Reference no." />
            <SubmitButton>Update selected ({sel.size})</SubmitButton>
          </div>
        )}
      </ActionForm>
    </section>
  );
}
