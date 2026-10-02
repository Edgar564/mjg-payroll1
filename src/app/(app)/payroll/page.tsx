import Link from "next/link";
import { requireRole } from "@/lib/data/session";
import { can } from "@/lib/roles";
import { peso } from "@/lib/payroll/money";
import { Empty, PageHeader, StatusBadge, fmtDate, label } from "@/components/ui";
import { NewPeriodForm } from "./new-period-form";

export default async function PayrollPeriodsPage() {
  const { supabase, role } = await requireRole(can.readPayroll);
  const { data: periods } = await supabase
    .from("payroll_periods")
    .select("*, payroll_items(gross_pay, net_pay, employer_cost)")
    .order("period_start", { ascending: false })
    .limit(60);
  return (
    <>
      <PageHeader title="Payroll periods" subtitle="Draft → Encoding → For Review → Approved → Posted → Paid → Locked" />
      {can.writePayroll(role) && <NewPeriodForm periods={(periods ?? []).map((p) => ({ id: p.id, code: p.code, status: p.status }))} />}
      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr><th>Code</th><th>Period</th><th>Pay date</th><th>Frequency</th><th>Status</th><th className="num">Employees</th><th className="num">Gross</th><th className="num">Net</th><th className="num">Employer cost</th></tr>
          </thead>
          <tbody>
            {(periods ?? []).map((p) => {
              const items = (p.payroll_items ?? []) as { gross_pay: number; net_pay: number; employer_cost: number }[];
              const s = (k: "gross_pay" | "net_pay" | "employer_cost") => items.reduce((a, i) => a + Number(i[k]), 0);
              return (
                <tr key={p.id}>
                  <td><Link href={`/payroll/${p.id}`} className="font-medium text-brand-700 hover:underline">{p.code}</Link>{p.is_adjustment && <span className="ml-1 text-[10px] font-semibold uppercase text-violet-700">Adjustment</span>}</td>
                  <td>{fmtDate(p.period_start)} – {fmtDate(p.period_end)}</td>
                  <td>{fmtDate(p.pay_date)}</td>
                  <td>{label(p.frequency)}</td>
                  <td><StatusBadge status={p.status} /></td>
                  <td className="num">{items.length}</td>
                  <td className="num">{peso(s("gross_pay"))}</td>
                  <td className="num">{peso(s("net_pay"))}</td>
                  <td className="num">{peso(s("employer_cost"))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!periods?.length && <Empty>No payroll periods yet. Create the first one above.</Empty>}
      </div>
    </>
  );
}
