import Link from "next/link";
import { requireRole } from "@/lib/data/session";
import { can } from "@/lib/roles";
import { fullName, loadConfig } from "@/lib/data/load";
import { yearEndAdjustment } from "@/lib/payroll/statutory";
import { num, peso, sum } from "@/lib/payroll/money";
import { ExportButtons } from "@/components/export-buttons";
import { Empty, PageHeader } from "@/components/ui";

const REPORTS = [
  { id: "statutory", label: "Statutory remittance (SSS / PhilHealth / Pag-IBIG / BIR)" },
  { id: "group", label: "Payroll by department / branch" },
  { id: "management", label: "Management cost report" },
  { id: "annual", label: "Annual compensation & tax summary" },
  { id: "history", label: "Employee payroll history" },
];

type Item = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ r?: string; month?: string; year?: string; by?: string; posted?: string; employee?: string }> }) {
  const sp = await searchParams;
  const { supabase } = await requireRole(can.readPayroll);
  const r = sp.r ?? "statutory";
  const now = new Date();
  const month = sp.month ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const year = Number(sp.year ?? now.getFullYear());
  const postedOnly = sp.posted !== "0";
  const statuses = postedOnly ? ["posted", "paid", "locked"] : ["draft", "encoding", "for_review", "approved", "posted", "paid", "locked"];

  const [from, to] = r === "statutory" ? [`${month}-01`, `${month}-31`] : [`${year}-01-01`, `${year}-12-31`];
  const { data } = await supabase
    .from("payroll_items")
    .select("*, employees(employee_no, first_name, middle_name, last_name, suffix, departments(name), branches(name), employee_government_ids(sss_no, philhealth_no, pagibig_no, tin)), payroll_periods!inner(code, period_end, pay_date, status)")
    .gte("payroll_periods.period_end", from)
    .lte("payroll_periods.period_end", to)
    .in("payroll_periods.status", statuses);
  const items = (data ?? []) as Item[];
  const byEmp = new Map<string, Item[]>();
  for (const i of items) byEmp.set(i.employee_id, [...(byEmp.get(i.employee_id) ?? []), i]);
  const s = (list: Item[], k: string) => sum(list.map((i) => Number(i[k])));
  const gov = (i: Item) => (Array.isArray(i.employees.employee_government_ids) ? i.employees.employee_government_ids[0] : i.employees.employee_government_ids) ?? {};

  let title = "";
  let header: string[] = [];
  let rows: (string | number)[][] = [];
  let moneyFrom = 0; // index from which columns are money

  if (r === "statutory") {
    title = `Statutory remittance — ${month}`;
    header = ["Employee No", "Employee", "SSS No", "PhilHealth No", "Pag-IBIG No", "TIN", "SSS EE", "SSS ER", "SSS EC", "SSS total", "PHIC EE", "PHIC ER", "PHIC total", "HDMF EE", "HDMF ER", "HDMF total", "Taxable comp.", "Tax withheld"];
    moneyFrom = 6;
    rows = [...byEmp.values()].map((l) => {
      const i = l[0];
      return [i.employees.employee_no, fullName(i.employees), gov(i).sss_no ?? "", gov(i).philhealth_no ?? "", gov(i).pagibig_no ?? "", gov(i).tin ?? "",
        s(l, "sss_ee"), s(l, "sss_er"), s(l, "sss_ec"), s(l, "sss_ee") + s(l, "sss_er") + s(l, "sss_ec"),
        s(l, "philhealth_ee"), s(l, "philhealth_er"), s(l, "philhealth_ee") + s(l, "philhealth_er"),
        s(l, "pagibig_ee"), s(l, "pagibig_er"), s(l, "pagibig_ee") + s(l, "pagibig_er"),
        s(l, "taxable_compensation"), s(l, "withholding_tax")];
    });
  } else if (r === "group") {
    const by = sp.by === "branch" ? "branch" : "department";
    title = `Payroll by ${by} — ${year}`;
    header = [by === "branch" ? "Branch" : "Department", "Employees", "Gross", "OT", "Employee deductions", "Net pay", "Employer contributions", "Employer cost"];
    moneyFrom = 2;
    const groups = new Map<string, Item[]>();
    for (const i of items) {
      const k = (by === "branch" ? i.employees.branches?.name : i.employees.departments?.name) ?? "Unassigned";
      groups.set(k, [...(groups.get(k) ?? []), i]);
    }
    rows = [...groups.entries()].map(([k, l]) => [k, new Set(l.map((i) => i.employee_id)).size, s(l, "gross_pay"), s(l, "ot_pay"), s(l, "total_deductions"), s(l, "net_pay"), s(l, "sss_er") + s(l, "sss_ec") + s(l, "philhealth_er") + s(l, "pagibig_er"), s(l, "employer_cost")]);
  } else if (r === "management") {
    title = `Management cost report — ${year}`;
    header = ["Month", "Gross", "Basic", "Overtime", "Holiday + rest day", "NSD", "Allowances", "Commission", "Bonus", "Employer contributions", "Total employer cost", "Net pay"];
    moneyFrom = 1;
    const months = new Map<string, Item[]>();
    for (const i of items) {
      const m = i.payroll_periods.period_end.slice(0, 7);
      months.set(m, [...(months.get(m) ?? []), i]);
    }
    rows = [...months.entries()].sort().map(([m, l]) => [m, s(l, "gross_pay"), s(l, "basic_pay"), s(l, "ot_pay"), s(l, "holiday_pay") + s(l, "rest_day_pay"), s(l, "nsd_pay"), s(l, "allowances"), s(l, "commission"), s(l, "bonus"), s(l, "sss_er") + s(l, "sss_ec") + s(l, "philhealth_er") + s(l, "pagibig_er"), s(l, "employer_cost"), s(l, "net_pay")]);
  } else if (r === "annual") {
    title = `Annual compensation & tax summary — ${year}`;
    const { config } = await loadConfig(supabase, `${year}-12-31`);
    header = ["Employee No", "Employee", "TIN", "Gross compensation", "Non-taxable / exempt", "Employee contributions", "Net taxable", "Tax due (annual)", "Tax withheld", "Year-end adjustment"];
    moneyFrom = 3;
    rows = [...byEmp.values()].map((l) => {
      const i = l[0];
      const taxable = s(l, "taxable_compensation");
      const withheld = s(l, "withholding_tax");
      const mwe = l.every((x) => x.result?.tax?.mweExempt > 0);
      const adj = config.bir ? yearEndAdjustment(taxable, withheld, config.bir, mwe) : { annualTax: 0, adjustment: 0 };
      return [i.employees.employee_no, fullName(i.employees), gov(i).tin ?? "", s(l, "gross_pay"), s(l, "non_taxable_compensation"), s(l, "sss_ee") + s(l, "philhealth_ee") + s(l, "pagibig_ee"), taxable, adj.annualTax, withheld, adj.adjustment];
    });
  } else {
    title = `Employee payroll history — ${year}`;
    header = ["Employee", "Payroll", "Pay date", "Gross", "Statutory", "Tax", "Loans/adv.", "Other ded.", "Net pay"];
    moneyFrom = 3;
    const list = sp.employee ? items.filter((i) => i.employee_id === sp.employee) : items;
    rows = list
      .sort((a, b) => fullName(a.employees).localeCompare(fullName(b.employees)) || a.payroll_periods.pay_date.localeCompare(b.payroll_periods.pay_date))
      .map((i) => [fullName(i.employees), i.payroll_periods.code, i.payroll_periods.pay_date, Number(i.gross_pay), Number(i.sss_ee) + Number(i.philhealth_ee) + Number(i.pagibig_ee), Number(i.withholding_tax), Number(i.loans) + Number(i.advances), Number(i.other_deductions), Number(i.net_pay)]);
  }
  const totals = header.map((_, c) => (c >= moneyFrom && !(r === "group" && c === 1) ? sum(rows.map((row) => Number(row[c]))) : null));
  const csv = [header, ...rows.map((row) => row.map((v, c) => (c >= moneyFrom && typeof v === "number" ? num(v) : v))), ["TOTAL", ...totals.slice(1).map((t) => (t === null ? "" : num(t)))]];
  const emps = r === "history" ? [...byEmp.values()].map((l) => ({ id: l[0].employee_id, name: fullName(l[0].employees) })) : [];

  return (
    <>
      <div className="no-print">
        <PageHeader title="Reports" actions={<ExportButtons filename={title.replace(/[^\w-]+/g, "-").toLowerCase()} rows={csv} />} />
        <div className="mb-3 flex flex-wrap gap-2">
          {REPORTS.map((x) => (
            <Link key={x.id} href={`/reports?r=${x.id}`} className={`rounded-full px-3 py-1 text-xs ${r === x.id ? "bg-brand-600 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"}`}>{x.label}</Link>
          ))}
        </div>
        <form className="card mb-4 flex flex-wrap items-end gap-3 p-3">
          <input type="hidden" name="r" value={r} />
          {r === "statutory" ? (
            <label><span className="label">Month</span><input type="month" name="month" defaultValue={month} className="input" /></label>
          ) : (
            <label><span className="label">Year</span><input name="year" defaultValue={year} className="input w-28" /></label>
          )}
          {r === "group" && <label><span className="label">Group by</span><select name="by" defaultValue={sp.by ?? "department"} className="input"><option value="department">Department</option><option value="branch">Branch</option></select></label>}
          {r === "history" && <label><span className="label">Employee</span><select name="employee" defaultValue={sp.employee ?? ""} className="input"><option value="">All</option>{emps.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>}
          <label><span className="label">Include</span><select name="posted" defaultValue={postedOnly ? "1" : "0"} className="input"><option value="1">Posted / paid / locked only</option><option value="0">All non-cancelled (incl. drafts)</option></select></label>
          <button className="btn-secondary">Run report</button>
        </form>
      </div>
      <div className="card print-area overflow-x-auto p-4">
        <div className="mb-2 font-semibold">MJGarcia Trading — {title}</div>
        <table className="w-full text-xs">
          <thead><tr className="border-y border-slate-300 bg-slate-50">{header.map((h, c) => <th key={h} className={`px-2 py-1.5 ${c >= moneyFrom ? "text-right" : "text-left"}`}>{h}</th>)}</tr></thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-b border-slate-100">
                {row.map((v, c) => <td key={c} className={`px-2 py-1 ${c >= moneyFrom ? "num" : ""}`}>{c >= moneyFrom && typeof v === "number" && !(r === "group" && c === 1) ? peso(v) : String(v)}</td>)}
              </tr>
            ))}
          </tbody>
          {rows.length > 0 && (
            <tfoot><tr className="border-t-2 border-slate-400 font-semibold">{totals.map((t, c) => <td key={c} className={`px-2 py-1.5 ${c >= moneyFrom ? "num" : ""}`}>{c === 0 ? "TOTAL" : t === null ? "" : peso(t)}</td>)}</tr></tfoot>
          )}
        </table>
        {!rows.length && <Empty>No payroll data for this selection.</Empty>}
        {r === "annual" && <p className="mt-3 text-xs text-slate-500">Year-end adjustment: positive = additional tax to withhold in the last payroll; negative = refund due to the employee. Verify against BIR Form 2316 before filing.</p>}
        {r === "statutory" && <p className="mt-3 text-xs text-slate-500">Use with the official SSS, PhilHealth (RF-1), Pag-IBIG (MCRF) and BIR 1601-C remittance forms. Amounts are by payroll period end date.</p>}
      </div>
    </>
  );
}
