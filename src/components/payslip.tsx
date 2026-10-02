import { peso } from "@/lib/payroll/money";
import type { PayrollResult } from "@/lib/payroll/types";
import { fmtDate } from "./ui";

export interface PayslipData {
  company: { company_name: string; business_address: string | null };
  employee: { employee_no: string; name: string; position: string | null; department: string | null; is_test_data: boolean };
  period: { code: string; period_start: string; period_end: string; pay_date: string; status: string };
  result: PayrollResult;
}

const Row = ({ l, v, neg }: { l: string; v: number; neg?: boolean }) =>
  v ? (
    <div className="flex justify-between py-0.5">
      <span>{l}</span>
      <span className="num">{neg ? "-" : ""}{peso(v)}</span>
    </div>
  ) : null;

export function Payslip({ d }: { d: PayslipData }) {
  const r = d.result;
  const e = r.earnings;
  const s = r.statutory;
  const advances = r.loans.filter((l) => l.loanType === "cash_advance" || l.loanType === "emergency_advance");
  const loans = r.loans.filter((l) => !advances.includes(l));
  const draft = !["approved", "posted", "paid", "locked"].includes(d.period.status);
  return (
    <div className="card print-area relative mx-auto mb-6 max-w-3xl break-inside-avoid p-6 text-sm print:mb-0 print:break-after-page">
      {draft && <div className="absolute right-4 top-4 rounded border border-amber-400 px-2 py-0.5 text-xs font-bold text-amber-700">DRAFT — NOT APPROVED</div>}
      {d.employee.is_test_data && <div className="absolute right-4 top-10 rounded border border-orange-400 px-2 py-0.5 text-xs font-bold text-orange-700">TEST DATA</div>}
      <div className="border-b border-slate-300 pb-3">
        <div className="text-lg font-bold">{d.company.company_name}</div>
        {d.company.business_address && <div className="text-xs text-slate-500">{d.company.business_address}</div>}
        <div className="mt-1 text-xs font-semibold tracking-widest text-slate-600">PAYSLIP</div>
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-0.5 border-b border-slate-200 py-3 text-xs">
        <div><span className="text-slate-500">Employee ID:</span> {d.employee.employee_no}</div>
        <div><span className="text-slate-500">Payroll period:</span> {fmtDate(d.period.period_start)} – {fmtDate(d.period.period_end)}</div>
        <div><span className="text-slate-500">Employee name:</span> <b>{d.employee.name}</b></div>
        <div><span className="text-slate-500">Pay date:</span> {fmtDate(d.period.pay_date)}</div>
        <div><span className="text-slate-500">Position:</span> {d.employee.position ?? "—"}</div>
        <div><span className="text-slate-500">Department:</span> {d.employee.department ?? "—"}</div>
      </div>
      <div className="grid gap-6 py-3 sm:grid-cols-2">
        <div>
          <div className="mb-1 text-xs font-semibold uppercase text-slate-500">Earnings</div>
          <Row l="Basic pay" v={e.basicPay} />
          <Row l="Less: absences" v={e.absenceDeduction} neg />
          <Row l="Less: late / undertime" v={e.tardinessDeduction} neg />
          <Row l="Paid leave" v={e.paidLeavePay} />
          <Row l="Overtime" v={e.otPay} />
          <Row l="Holiday pay" v={e.holidayPay + e.unworkedHolidayPay} />
          <Row l="Rest day" v={e.restDayPay} />
          <Row l="Night differential" v={e.nsdPay} />
          {e.lines.map((l, i) => <Row key={i} l={l.label} v={l.amount} />)}
          <div className="mt-1 flex justify-between border-t border-slate-300 pt-1 font-semibold"><span>GROSS PAY</span><span className="num">{peso(r.grossPay)}</span></div>
        </div>
        <div>
          <div className="mb-1 text-xs font-semibold uppercase text-slate-500">Deductions</div>
          <Row l="SSS" v={s.sssEE + s.sssMpfEE} />
          <Row l="PhilHealth" v={s.philhealthEE} />
          <Row l="Pag-IBIG" v={s.pagibigEE} />
          <Row l="Withholding tax" v={r.tax.withholdingTax} />
          {loans.map((l) => <Row key={l.loanId} l={l.label} v={l.deducted} />)}
          {advances.map((l) => <Row key={l.loanId} l={l.label} v={l.deducted} />)}
          {r.otherDeductions.map((x, i) => <Row key={i} l={x.label} v={x.deducted} />)}
          <div className="mt-1 flex justify-between border-t border-slate-300 pt-1 font-semibold"><span>TOTAL DEDUCTIONS</span><span className="num">{peso(r.totalDeductions)}</span></div>
        </div>
      </div>
      <div className="flex items-center justify-between rounded-md bg-slate-100 px-4 py-3 text-base font-bold print:border print:border-slate-400 print:bg-white">
        <span>NET PAY</span><span className="num">{peso(r.netPay)}</span>
      </div>
      <div className="mt-3 rounded-md border border-dashed border-slate-300 p-3 text-xs">
        <div className="mb-1 font-semibold">Employer contributions — paid by the company, NOT deducted from your pay</div>
        <div className="grid grid-cols-3 gap-2">
          <div>SSS (incl. EC): <span className="num">{peso(s.sssER + s.sssMpfER + s.sssEC)}</span></div>
          <div>PhilHealth: <span className="num">{peso(s.philhealthER)}</span></div>
          <div>Pag-IBIG: <span className="num">{peso(s.pagibigER)}</span></div>
        </div>
      </div>
      {r.loans.some((l) => l.deferred) || r.otherDeductions.some((x) => x.deferred) ? (
        <div className="mt-2 text-xs text-amber-700">Some deductions were deferred to a later payroll to protect net pay.</div>
      ) : null}
      <div className="mt-8 grid grid-cols-2 gap-8 text-xs">
        <div><div className="h-6 border-b border-slate-400" /><div className="mt-1 text-slate-500">Received by (signature / date)</div></div>
        <div><div className="h-6 border-b border-slate-400" /><div className="mt-1 text-slate-500">Released by</div></div>
      </div>
    </div>
  );
}
