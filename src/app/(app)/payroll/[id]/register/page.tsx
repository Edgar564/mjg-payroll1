import { notFound } from "next/navigation";
import { requireRole } from "@/lib/data/session";
import { can } from "@/lib/roles";
import { fullName } from "@/lib/data/load";
import { num, peso, sum } from "@/lib/payroll/money";
import { PageHeader, StatusBadge, fmtDate } from "@/components/ui";
import { ExportButtons } from "@/components/export-buttons";

const COLS: [string, string][] = [
  ["basic_pay", "Basic"], ["ot_pay", "OT"], ["holiday_pay", "Holiday"], ["rest_day_pay", "Rest day"], ["nsd_pay", "NSD"],
  ["commission", "Commission"], ["allowances", "Allowances"], ["bonus", "Bonus"], ["other_earnings", "Other earn."], ["gross_pay", "Gross pay"],
  ["sss_ee", "SSS"], ["philhealth_ee", "PhilHealth"], ["pagibig_ee", "Pag-IBIG"], ["withholding_tax", "W/Tax"],
  ["loans", "Loans"], ["advances", "Advances"], ["other_deductions", "Other ded."], ["total_deductions", "Total ded."], ["net_pay", "Net pay"],
];

export default async function RegisterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireRole(can.readPayroll);
  const [{ data: period }, { data: items }, { data: company }] = await Promise.all([
    supabase.from("payroll_periods").select("*").eq("id", id).maybeSingle(),
    supabase.from("payroll_items").select("*, employees(employee_no, first_name, middle_name, last_name, suffix, is_test_data, positions(name), departments(name))").eq("period_id", id),
    supabase.from("company_settings").select("company_name, business_address").eq("id", 1).maybeSingle(),
  ]);
  if (!period) notFound();
  const rows = (items ?? [])
    .map((i) => ({ ...i, name: fullName(i.employees), no: i.employees.employee_no }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const total = (k: string) => sum(rows.map((r) => Number(r[k])));
  const csv = [
    ["Employee ID", "Employee name", "Department", "Position", ...COLS.map(([, l]) => l)],
    ...rows.map((r) => [r.no, r.name, r.employees.departments?.name ?? "", r.employees.positions?.name ?? "", ...COLS.map(([k]) => num(r[k]))]),
    ["", "TOTAL", "", "", ...COLS.map(([k]) => num(total(k)))],
  ];
  const er = (k: string) => total(k);

  return (
    <>
      <div className="no-print">
        <PageHeader title={`Payroll register — ${period.code}`} actions={<ExportButtons filename={`payroll-register-${period.code}`} rows={csv} />} />
      </div>
      <div className="card print-area overflow-x-auto p-4">
        <div className="mb-3">
          <div className="text-lg font-bold">{company?.company_name ?? "MJGarcia Trading"}</div>
          {company?.business_address && <div className="text-xs text-slate-500">{company.business_address}</div>}
          <div className="text-sm">PAYROLL REGISTER · {period.code} · {fmtDate(period.period_start)} – {fmtDate(period.period_end)} · Pay date {fmtDate(period.pay_date)} · <StatusBadge status={period.status} /></div>
        </div>
        <table className="w-full border-collapse text-[11px]">
          <thead>
            <tr className="border-y border-slate-400 bg-slate-50">
              <th className="px-1.5 py-1 text-left">ID</th><th className="px-1.5 py-1 text-left">Employee</th><th className="px-1.5 py-1 text-left">Dept / Position</th>
              {COLS.map(([k, l]) => <th key={k} className="px-1.5 py-1 text-right">{l}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-slate-200">
                <td className="px-1.5 py-1 font-mono">{r.no}</td>
                <td className="px-1.5 py-1">{r.name}{r.employees.is_test_data && <b className="ml-1 text-orange-600">TEST</b>}</td>
                <td className="px-1.5 py-1">{r.employees.departments?.name ?? "—"} / {r.employees.positions?.name ?? "—"}</td>
                {COLS.map(([k]) => <td key={k} className={`num px-1.5 py-1 ${k === "net_pay" || k === "gross_pay" ? "font-semibold" : ""}`}>{peso(r[k])}</td>)}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-y-2 border-slate-500 font-bold">
              <td className="px-1.5 py-1" colSpan={3}>TOTAL ({rows.length} employees)</td>
              {COLS.map(([k]) => <td key={k} className="num px-1.5 py-1">{peso(total(k))}</td>)}
            </tr>
          </tfoot>
        </table>
        <div className="mt-4 grid max-w-xl grid-cols-2 gap-x-6 text-xs">
          <div className="col-span-2 mb-1 font-semibold">Employer contributions (not deducted from employees)</div>
          <div>SSS employer (incl. MPF)</div><div className="num">{peso(er("sss_er"))}</div>
          <div>SSS EC</div><div className="num">{peso(er("sss_ec"))}</div>
          <div>PhilHealth employer</div><div className="num">{peso(er("philhealth_er"))}</div>
          <div>Pag-IBIG employer</div><div className="num">{peso(er("pagibig_er"))}</div>
          <div className="font-semibold">Total employer cost</div><div className="num font-semibold">{peso(er("employer_cost"))}</div>
        </div>
        <div className="mt-10 grid grid-cols-3 gap-8 text-xs">
          {["Prepared by", "Reviewed by", "Approved by"].map((s) => (
            <div key={s}><div className="h-8 border-b border-slate-400" /><div className="mt-1 text-slate-500">{s}</div></div>
          ))}
        </div>
      </div>
    </>
  );
}
