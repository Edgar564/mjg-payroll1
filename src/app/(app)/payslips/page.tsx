import Link from "next/link";
import { getSession } from "@/lib/data/session";
import { can } from "@/lib/roles";
import { loadPayslips } from "@/lib/data/payslips";
import { peso } from "@/lib/payroll/money";
import { Payslip } from "@/components/payslip";
import { PrintButton } from "@/components/print-button";
import { Empty, PageHeader, StatusBadge, fmtDate } from "@/components/ui";

export default async function PayslipsPage({ searchParams }: { searchParams: Promise<{ period?: string; all?: string }> }) {
  const sp = await searchParams;
  const { supabase, role, profile } = await getSession();

  // Employee self-service: own payslips from posted payrolls (RLS enforces this too)
  if (!can.readPayroll(role)) {
    if (!profile?.employee_id) return <PageHeader title="My payslips" subtitle="Your account is not linked to an employee record yet." />;
    const { data } = await supabase
      .from("payroll_items")
      .select("id, net_pay, gross_pay, payroll_periods(code, period_start, period_end, pay_date, status)")
      .eq("employee_id", profile.employee_id)
      .order("created_at", { ascending: false });
    return (
      <>
        <PageHeader title="My payslips" />
        <div className="card overflow-x-auto">
          <table className="table">
            <thead><tr><th>Period</th><th>Pay date</th><th className="num">Gross</th><th className="num">Net</th><th /></tr></thead>
            <tbody>
              {(data ?? []).map((i) => {
                const p = (Array.isArray(i.payroll_periods) ? i.payroll_periods[0] : i.payroll_periods) as { code: string; pay_date: string };
                return <tr key={i.id}><td>{p?.code}</td><td>{fmtDate(p?.pay_date)}</td><td className="num">{peso(i.gross_pay)}</td><td className="num">{peso(i.net_pay)}</td><td><Link className="text-brand-700 hover:underline" href={`/payslips/${i.id}`}>View</Link></td></tr>;
              })}
            </tbody>
          </table>
          {!data?.length && <Empty>No released payslips yet.</Empty>}
        </div>
      </>
    );
  }

  const { data: periods } = await supabase.from("payroll_periods").select("id, code, status, pay_date").neq("status", "cancelled").order("period_start", { ascending: false }).limit(36);
  const periodId = sp.period ?? periods?.[0]?.id;
  const slips = periodId ? await loadPayslips(supabase, { periodId }) : [];
  return (
    <>
      <div className="no-print">
        <PageHeader title="Payslips" actions={slips.length > 0 && <PrintButton label={`Print all (${slips.length})`} />} />
        <form className="card mb-4 flex items-end gap-3 p-3">
          <label className="flex-1">
            <span className="label">Payroll period</span>
            <select name="period" defaultValue={periodId} className="input">
              {(periods ?? []).map((p) => <option key={p.id} value={p.id}>{p.code} — {p.status}</option>)}
            </select>
          </label>
          <button className="btn-secondary">Show</button>
        </form>
        {periods?.find((p) => p.id === periodId) && (
          <p className="mb-3 text-sm text-slate-500">Status: <StatusBadge status={periods.find((p) => p.id === periodId)!.status} /> — payslips are marked DRAFT until the payroll is approved.</p>
        )}
      </div>
      {slips.map((d, i) => <Payslip key={i} d={d} />)}
      {!slips.length && <div className="card"><Empty>No payslips for this period.</Empty></div>}
    </>
  );
}
