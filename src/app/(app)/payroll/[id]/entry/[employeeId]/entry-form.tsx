"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { calculatePayroll } from "@/lib/payroll/engine";
import { peso } from "@/lib/payroll/money";
import { DAY_TYPE_LABELS, type DayType, type EarningLine, type PayrollMode, type PayrollResult } from "@/lib/payroll/types";
import { DAY_TYPES, buildInput, premiumFor, type EmployeeContext, type EncodedEntry, type PeriodContext } from "@/lib/data/entry";
import { saveEntry } from "../../../actions";

type EarningType = { code: string; label: string; category: EarningLine["category"]; tax_treatment: EarningLine["taxTreatment"]; include_in_sss: boolean; include_in_pagibig: boolean };

const COMPONENTS: { key: string; label: string; get: (r: PayrollResult) => number; group: "earn" | "ded" | "er"; negative?: boolean }[] = [
  { key: "basic_pay", label: "Basic pay", get: (r) => r.earnings.basicPay, group: "earn" },
  { key: "absence_deduction", label: "Less: absences", get: (r) => r.earnings.absenceDeduction, group: "earn", negative: true },
  { key: "tardiness_deduction", label: "Less: late / undertime", get: (r) => r.earnings.tardinessDeduction, group: "earn", negative: true },
  { key: "ot_pay", label: "Overtime pay", get: (r) => r.earnings.otPay, group: "earn" },
  { key: "holiday_pay", label: "Holiday pay (worked)", get: (r) => r.earnings.holidayPay, group: "earn" },
  { key: "rest_day_pay", label: "Rest day pay", get: (r) => r.earnings.restDayPay, group: "earn" },
  { key: "nsd_pay", label: "Night differential", get: (r) => r.earnings.nsdPay, group: "earn" },
  { key: "sss_ee", label: "SSS (employee)", get: (r) => r.statutory.sssEE, group: "ded" },
  { key: "sss_mpf_ee", label: "SSS MPF (employee)", get: (r) => r.statutory.sssMpfEE, group: "ded" },
  { key: "philhealth_ee", label: "PhilHealth (employee)", get: (r) => r.statutory.philhealthEE, group: "ded" },
  { key: "pagibig_ee", label: "Pag-IBIG (employee)", get: (r) => r.statutory.pagibigEE, group: "ded" },
  { key: "withholding_tax", label: "Withholding tax", get: (r) => r.tax.withholdingTax, group: "ded" },
  { key: "sss_er", label: "SSS (employer)", get: (r) => r.statutory.sssER, group: "er" },
  { key: "sss_mpf_er", label: "SSS MPF (employer)", get: (r) => r.statutory.sssMpfER, group: "er" },
  { key: "sss_ec", label: "SSS EC (employer)", get: (r) => r.statutory.sssEC, group: "er" },
  { key: "philhealth_er", label: "PhilHealth (employer)", get: (r) => r.statutory.philhealthER, group: "er" },
  { key: "pagibig_er", label: "Pag-IBIG (employer)", get: (r) => r.statutory.pagibigER, group: "er" },
];

function NumInput({ value, onChange, disabled, className = "" }: { value: number; onChange: (n: number) => void; disabled?: boolean; className?: string }) {
  const [text, setText] = useState(value ? String(value) : "");
  const [focused, setFocused] = useState(false);
  const shown = focused ? text : value ? String(value) : "";
  return (
    <input
      className={`input text-right tabular-nums ${className}`}
      inputMode="decimal"
      value={shown}
      placeholder="0"
      disabled={disabled}
      onFocus={(e) => { setFocused(true); setText(value ? String(value) : ""); e.target.select(); }}
      onBlur={() => setFocused(false)}
      onChange={(e) => {
        setText(e.target.value);
        const v = Number(e.target.value.replace(/[₱,\s]/g, ""));
        if (e.target.value === "") onChange(0);
        else if (Number.isFinite(v) && v >= 0) onChange(v);
      }}
    />
  );
}

export function EntryForm({ ctx, emp, editable, earningTypes }: { ctx: PeriodContext; emp: EmployeeContext; editable: boolean; earningTypes: EarningType[] }) {
  const router = useRouter();
  const [enc, setEnc] = useState<EncodedEntry>(() => structuredClone(emp.item?.encoded ?? emp.defaultEncoded));
  const [dirty, setDirty] = useState(!emp.item);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [showTrace, setShowTrace] = useState(false);
  const [pending, start] = useTransition();
  const update = (fn: (e: EncodedEntry) => void) => {
    setEnc((prev) => { const n = structuredClone(prev); fn(n); return n; });
    setDirty(true);
  };

  const autoResult = useMemo(() => calculatePayroll(buildInput(ctx, emp, { ...enc, mode: "auto", overrides: {} })), [ctx, emp, enc]);
  const result = useMemo(() => calculatePayroll(buildInput(ctx, emp, enc)), [ctx, emp, enc]);
  const issues = [...emp.contextIssues, ...result.issues];
  const mode = enc.mode;
  const salaryType = emp.profile.salaryType;

  function setMode(m: PayrollMode) {
    update((e) => {
      e.mode = m;
      if (m === "manual") {
        // prefill every component with the automatic value so the user edits from a known baseline
        for (const c of COMPONENTS) if (!e.overrides[c.key]) e.overrides[c.key] = { amount: c.get(autoResult), reason: "" };
        for (const l of autoResult.loans) if (!e.overrides[`loan:${l.loanId}`]) e.overrides[`loan:${l.loanId}`] = { amount: l.deducted, reason: "" };
      }
      if (m === "auto") e.overrides = {};
    });
  }

  function save() {
    start(async () => {
      const res = await saveEntry(ctx.period.id, emp.profile.id, enc);
      if (res.error) setMsg({ tone: "error", text: res.error });
      else {
        setMsg({ tone: "ok", text: "Saved." });
        setDirty(false);
        router.refresh();
      }
    });
  }

  const T = (label: string, field: keyof EncodedEntry["time"], hint?: string) => (
    <label className="block">
      <span className="label">{label}</span>
      <NumInput value={enc.time[field] as number} disabled={!editable} onChange={(v) => update((e) => { (e.time[field] as number) = v; })} />
      {hint && <span className="text-[11px] text-slate-500">{hint}</span>}
    </label>
  );

  const overrideRow = (key: string, label: string, auto: number, actual: number, negative = false) => {
    const o = enc.overrides[key];
    const on = mode !== "auto" && !!o;
    const variance = on ? Math.round((o.amount - auto) * 100) / 100 : 0;
    return (
      <tr key={key}>
        <td>{label}</td>
        <td className="num text-slate-500">{negative && auto ? "-" : ""}{peso(auto)}</td>
        <td className="text-center">
          {mode === "hybrid" && (
            <input
              type="checkbox"
              aria-label={`Override ${label}`}
              checked={on}
              disabled={!editable}
              onChange={(ev) => update((e) => { if (ev.target.checked) e.overrides[key] = { amount: auto, reason: "" }; else delete e.overrides[key]; })}
            />
          )}
          {mode === "manual" && <span className="text-[11px] text-slate-500">manual</span>}
        </td>
        <td className="w-32">
          {on ? (
            <NumInput value={o.amount} disabled={!editable} onChange={(v) => update((e) => { e.overrides[key] = { ...(e.overrides[key] ?? { reason: "" }), amount: v }; })} />
          ) : (
            <span className="num block">{negative && actual ? "-" : ""}{peso(actual)}</span>
          )}
        </td>
        <td className={`num ${variance ? (variance < 0 ? "text-red-700" : "text-emerald-700") : "text-slate-400"}`}>{variance ? peso(variance) : "—"}</td>
        <td className="min-w-48">
          {on && mode === "hybrid" && variance !== 0 && (
            <input
              className={`input ${!o.reason?.trim() ? "border-red-400" : ""}`}
              placeholder="Reason for manual adjustment *"
              value={o.reason}
              disabled={!editable}
              onChange={(ev) => update((e) => { e.overrides[key] = { ...e.overrides[key], reason: ev.target.value }; })}
            />
          )}
        </td>
      </tr>
    );
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
      <div className="min-w-0">
        {/* Mode */}
        <section className="card mb-4 p-4">
          <div className="flex flex-wrap items-center gap-4">
            <span className="text-sm font-semibold">Salary mode</span>
            {(["auto", "hybrid", "manual"] as const).map((m) => (
              <label key={m} className="flex items-center gap-1.5 text-sm">
                <input type="radio" name="mode" checked={mode === m} disabled={!editable} onChange={() => setMode(m)} className="accent-brand-600" />
                {m === "auto" ? "Auto calculate" : m === "hybrid" ? "Hybrid (auto + overrides)" : "Manual encoding"}
              </label>
            ))}
          </div>
          {mode === "manual" && (
            <label className="mt-3 block">
              <span className="label">Reason for manual encoding *</span>
              <input className={`input ${!enc.manualReason?.trim() ? "border-red-400" : ""}`} value={enc.manualReason ?? ""} disabled={!editable} onChange={(e) => update((x) => { x.manualReason = e.target.value; })} placeholder="e.g. Paper timesheet; payroll computed by accountant" />
            </label>
          )}
          <div className="mt-2 text-xs text-slate-500">
            Rates: monthly {peso(result.rates.monthly)} · daily {peso(result.rates.daily)} · hourly {peso(result.rates.hourly)} ({salaryType}-rated
            {emp.profile.isMinimumWageEarner ? ", minimum wage earner" : ""}){emp.minimumDailyWage ? ` · minimum wage ${peso(emp.minimumDailyWage)}/day` : ""}
          </div>
        </section>

        {/* Time */}
        <section className="card mb-4 p-4">
          <h2 className="mb-3 text-sm font-semibold">Attendance &amp; time</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {salaryType === "daily" && T("Regular days worked", "regularDays", "Exclude holiday/rest-day work below")}
            {salaryType === "hourly" && T("Regular hours worked", "regularHours")}
            {salaryType === "monthly" && T("Absent days (unpaid)", "absentDays")}
            {T("Late (minutes)", "lateMinutes")}
            {T("Undertime (minutes)", "undertimeMinutes")}
            {salaryType !== "monthly" && T("Paid leave days", "paidLeaveDays")}
            {salaryType !== "monthly" && T("Unworked regular holidays", "unworkedRegularHolidays", "Paid at 100% if eligible")}
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="table">
              <thead><tr><th>Day type</th><th className="num">Hours worked</th><th className="num">OT hours</th><th className="num">Night hours</th><th className="num">Night OT hours</th></tr></thead>
              <tbody>
                {DAY_TYPES.map((dt: DayType) => {
                  const p = enc.time.premium.find((x) => x.dayType === dt) ?? { hours: 0, otHours: 0, nsdHours: 0, nsdOtHours: 0 };
                  const set = (f: "hours" | "otHours" | "nsdHours" | "nsdOtHours") => (v: number) => update((e) => { premiumFor(e.time, dt)[f] = v; });
                  return (
                    <tr key={dt}>
                      <td>{DAY_TYPE_LABELS[dt]}</td>
                      <td className="w-28">{dt === "ordinary" ? <span className="block text-right text-xs text-slate-400">in regular days</span> : <NumInput value={p.hours} onChange={set("hours")} disabled={!editable} />}</td>
                      <td className="w-28"><NumInput value={p.otHours} onChange={set("otHours")} disabled={!editable} /></td>
                      <td className="w-28"><NumInput value={p.nsdHours} onChange={set("nsdHours")} disabled={!editable} /></td>
                      <td className="w-28"><NumInput value={p.nsdOtHours} onChange={set("nsdOtHours")} disabled={!editable} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* Recurring & linked items */}
        <section className="card mb-4 p-4">
          <h2 className="mb-3 text-sm font-semibold">Recurring allowances, commissions, loans &amp; deductions</h2>
          {[...emp.recurringEarnings, ...emp.commissions].map((l) => (
            <label key={l.code} className="flex items-center justify-between border-b border-slate-100 py-1.5 text-sm">
              <span className="flex items-center gap-2">
                <input type="checkbox" checked={!enc.skipRecurringCodes?.includes(l.code)} disabled={!editable} onChange={(ev) => update((e) => { const s = new Set(e.skipRecurringCodes ?? []); if (ev.target.checked) s.delete(l.code); else s.add(l.code); e.skipRecurringCodes = [...s]; })} />
                {l.label} <span className="text-xs text-slate-500">({l.taxTreatment.replace("_", " ")})</span>
              </span>
              <span className="num">{peso(l.amount)}</span>
            </label>
          ))}
          {emp.deductions.map((d) => (
            <label key={d.code} className="flex items-center justify-between border-b border-slate-100 py-1.5 text-sm">
              <span className="flex items-center gap-2">
                <input type="checkbox" checked={!enc.skipRecurringCodes?.includes(d.code)} disabled={!editable} onChange={(ev) => update((e) => { const s = new Set(e.skipRecurringCodes ?? []); if (ev.target.checked) s.delete(d.code); else s.add(d.code); e.skipRecurringCodes = [...s]; })} />
                Deduction: {d.label} <span className="text-xs text-slate-500">Ref: {d.reference}</span>
              </span>
              <span className="num text-red-700">-{peso(d.amount)}</span>
            </label>
          ))}
          {emp.adjustments.map((a) => (
            <div key={a.id} className="flex items-center justify-between border-b border-slate-100 py-1.5 text-sm">
              <span>Approved adjustment ({a.adjustment_type}): {a.reason}</span>
              <span className={`num ${a.adjustment_type === "deduction" ? "text-red-700" : ""}`}>{a.adjustment_type === "deduction" ? "-" : ""}{peso(a.amount)}</span>
            </div>
          ))}
          {emp.loans.map((l) => {
            const r = result.loans.find((x) => x.loanId === l.loanId);
            const key = `loan:${l.loanId}`;
            const o = enc.overrides[key];
            return (
              <div key={l.loanId} className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 py-1.5 text-sm">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={!enc.skipLoanIds?.includes(l.loanId)} disabled={!editable} onChange={(ev) => update((e) => { const s = new Set(e.skipLoanIds ?? []); if (ev.target.checked) s.delete(l.loanId); else s.add(l.loanId); e.skipLoanIds = [...s]; })} />
                  {l.label} <span className="text-xs text-slate-500">balance {peso(l.balance)} · installment {peso(l.scheduledAmount)}</span>
                </label>
                <span className="flex items-center gap-2">
                  {mode !== "auto" && !enc.skipLoanIds?.includes(l.loanId) && (
                    <>
                      <input type="checkbox" title="Override this installment" checked={!!o} disabled={!editable || mode === "manual"} onChange={(ev) => update((e) => { if (ev.target.checked) e.overrides[key] = { amount: Math.min(l.scheduledAmount, l.balance), reason: "" }; else delete e.overrides[key]; })} />
                      {o && <NumInput className="w-24" value={o.amount} disabled={!editable} onChange={(v) => update((e) => { e.overrides[key] = { ...e.overrides[key], amount: v }; })} />}
                      {o && mode === "hybrid" && <input className={`input w-44 ${!o.reason?.trim() ? "border-red-400" : ""}`} placeholder="Reason *" value={o.reason} disabled={!editable} onChange={(ev) => update((e) => { e.overrides[key] = { ...e.overrides[key], reason: ev.target.value }; })} />}
                    </>
                  )}
                  <span className="num text-red-700">-{peso(r?.deducted ?? 0)}</span>
                  {r && r.deferred > 0 && <span className="text-xs text-amber-700">({peso(r.deferred)} deferred)</span>}
                </span>
              </div>
            );
          })}
          {!emp.recurringEarnings.length && !emp.commissions.length && !emp.deductions.length && !emp.loans.length && !emp.adjustments.length && (
            <div className="text-sm text-slate-500">None for this employee.</div>
          )}
        </section>

        {/* One-off lines */}
        <section className="card mb-4 p-4">
          <h2 className="mb-3 text-sm font-semibold">This payroll only — earnings &amp; deductions</h2>
          {enc.extraEarnings.map((l, i) => (
            <div key={i} className="mb-2 grid grid-cols-[1fr_120px_auto] items-center gap-2">
              <span className="text-sm">{l.label} <span className="text-xs text-slate-500">({l.category}, {l.taxTreatment.replace("_", " ")})</span></span>
              <NumInput value={l.amount} disabled={!editable} onChange={(v) => update((e) => { e.extraEarnings[i].amount = v; })} />
              {editable && <button type="button" className="text-xs text-red-700" onClick={() => update((e) => { e.extraEarnings.splice(i, 1); })}>Remove</button>}
            </div>
          ))}
          {enc.extraDeductions.map((d, i) => (
            <div key={i} className="mb-2 grid grid-cols-[1fr_180px_120px_auto] items-center gap-2">
              <span className="text-sm">Deduction: {d.label}</span>
              <input className={`input ${!d.reference?.trim() ? "border-amber-400" : ""}`} placeholder="Authorization / reference" value={d.reference ?? ""} disabled={!editable} onChange={(ev) => update((e) => { e.extraDeductions[i].reference = ev.target.value; })} />
              <NumInput value={d.amount} disabled={!editable} onChange={(v) => update((e) => { e.extraDeductions[i].amount = v; })} />
              {editable && <button type="button" className="text-xs text-red-700" onClick={() => update((e) => { e.extraDeductions.splice(i, 1); })}>Remove</button>}
            </div>
          ))}
          {editable && (
            <div className="mt-2 flex flex-wrap gap-2">
              <select
                className="input w-64"
                value=""
                onChange={(ev) => {
                  const t = earningTypes.find((x) => x.code === ev.target.value);
                  if (t) update((e) => { e.extraEarnings.push({ code: `${t.code}:${Date.now()}`, label: t.label, category: t.category, amount: 0, taxTreatment: t.tax_treatment, includeInSSS: t.include_in_sss, includeInPagibig: t.include_in_pagibig }); });
                }}
              >
                <option value="">+ Add earning…</option>
                {earningTypes.map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}
              </select>
              <select
                className="input w-64"
                value=""
                onChange={(ev) => {
                  const [code, label] = ev.target.value.split("|");
                  if (code) update((e) => { e.extraDeductions.push({ code: code === "ADVANCE" ? "ADVANCE" : `${code}:${Date.now()}`, label, amount: 0, reference: "" }); });
                }}
              >
                <option value="">+ Add deduction…</option>
                <option value="ADVANCE|Cash advance">Cash advance</option>
                <option value="UNIFORM|Uniform">Uniform</option>
                <option value="DAMAGE|Damage / loss">Damage / loss</option>
                <option value="OTHER|Other deduction">Other</option>
              </select>
            </div>
          )}
        </section>

        {/* Components with override */}
        <section className="card mb-4 overflow-x-auto p-4">
          <h2 className="mb-1 text-sm font-semibold">Payroll components</h2>
          <p className="mb-3 text-xs text-slate-500">
            {mode === "auto" && "All values are calculated automatically. Switch to Hybrid to override individual components."}
            {mode === "hybrid" && "Tick a component to override it. Any change from the automatic value needs a reason and is logged."}
            {mode === "manual" && "Every component is manually encoded (pre-filled with the automatic value). The reason above applies to all changes."}
          </p>
          <table className="table">
            <thead><tr><th>Component</th><th className="num">Automatic</th><th className="text-center">Override</th><th className="num">Amount used</th><th className="num">Variance</th><th>Reason</th></tr></thead>
            <tbody>
              <tr><td colSpan={6} className="bg-slate-50 text-xs font-semibold uppercase text-slate-500">Earnings</td></tr>
              {COMPONENTS.filter((c) => c.group === "earn").map((c) => overrideRow(c.key, c.label, c.get(autoResult), c.get(result), c.negative))}
              <tr><td colSpan={6} className="bg-slate-50 text-xs font-semibold uppercase text-slate-500">Employee deductions</td></tr>
              {COMPONENTS.filter((c) => c.group === "ded").map((c) => overrideRow(c.key, c.label, c.get(autoResult), c.get(result)))}
              <tr><td colSpan={6} className="bg-slate-50 text-xs font-semibold uppercase text-slate-500">Employer contributions — not deducted from employee</td></tr>
              {COMPONENTS.filter((c) => c.group === "er").map((c) => overrideRow(c.key, c.label, c.get(autoResult), c.get(result)))}
            </tbody>
          </table>
        </section>

        <section className="card mb-4 p-4">
          <button type="button" className="text-sm font-semibold text-brand-700" onClick={() => setShowTrace((s) => !s)}>
            {showTrace ? "▾" : "▸"} View calculation
          </button>
          {showTrace && (
            <table className="table mt-3">
              <tbody>
                {result.trace.map((t, i) => (
                  <tr key={i}>
                    <td className="w-40 text-xs text-slate-500">{t.step}</td>
                    <td className="font-medium">{t.label}</td>
                    <td className="text-xs text-slate-600">{t.detail}</td>
                    <td className="num">{t.amount !== undefined ? peso(t.amount) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      {/* Summary sidebar */}
      <aside className="xl:sticky xl:top-4 xl:self-start">
        <section className="card mb-4 p-4">
          <h2 className="mb-3 text-sm font-semibold">Summary</h2>
          <dl className="space-y-1 text-sm">
            {[
              ["Basic pay (net of absences/late)", result.earnings.netBasicPay],
              ["Paid leave", result.earnings.paidLeavePay],
              ["Holiday pay", result.earnings.holidayPay + result.earnings.unworkedHolidayPay],
              ["Rest day", result.earnings.restDayPay],
              ["Overtime", result.earnings.otPay],
              ["Night differential", result.earnings.nsdPay],
              ["Commission", result.earnings.commission],
              ["Allowances", result.earnings.allowances],
              ["Bonus / incentive", result.earnings.bonus],
              ["Other earnings", result.earnings.otherEarnings],
            ].filter(([, v]) => v).map(([l, v]) => (
              <div key={l as string} className="flex justify-between"><dt className="text-slate-600">{l}</dt><dd className="num">{peso(v as number)}</dd></div>
            ))}
            <div className="flex justify-between border-t border-slate-200 pt-1 font-semibold"><dt>TOTAL GROSS</dt><dd className="num">{peso(result.grossPay)}</dd></div>
            {[
              ["SSS", result.statutory.sssEE + result.statutory.sssMpfEE],
              ["PhilHealth", result.statutory.philhealthEE],
              ["Pag-IBIG", result.statutory.pagibigEE],
              ["Withholding tax", result.tax.withholdingTax],
              ["Loans / advances", result.totalLoans],
              ["Other deductions", result.totalOtherDeductions],
            ].filter(([, v]) => v).map(([l, v]) => (
              <div key={l as string} className="flex justify-between"><dt className="text-slate-600">{l}</dt><dd className="num text-red-700">-{peso(v as number)}</dd></div>
            ))}
            <div className="flex justify-between border-t border-slate-200 pt-1 font-semibold"><dt>TOTAL DEDUCTIONS</dt><dd className="num">{peso(result.totalDeductions)}</dd></div>
            <div className={`mt-2 flex justify-between rounded-md px-2 py-2 text-base font-bold ${result.netPay < 0 ? "bg-red-50 text-red-800" : "bg-brand-50 text-brand-900"}`}><dt>NET PAY</dt><dd className="num">{peso(result.netPay)}</dd></div>
            <div className="mt-3 text-xs font-semibold uppercase text-slate-500">Employer contributions</div>
            <div className="flex justify-between text-xs"><dt>SSS + EC</dt><dd className="num">{peso(result.statutory.sssER + result.statutory.sssMpfER + result.statutory.sssEC)}</dd></div>
            <div className="flex justify-between text-xs"><dt>PhilHealth</dt><dd className="num">{peso(result.statutory.philhealthER)}</dd></div>
            <div className="flex justify-between text-xs"><dt>Pag-IBIG</dt><dd className="num">{peso(result.statutory.pagibigER)}</dd></div>
            <div className="flex justify-between text-xs font-semibold"><dt>Total employer cost</dt><dd className="num">{peso(result.employerCost)}</dd></div>
          </dl>
        </section>

        {issues.length > 0 && (
          <section className="card mb-4 p-4">
            <h2 className="mb-2 text-sm font-semibold">Validation</h2>
            <ul className="space-y-1 text-sm">
              {issues.map((i, k) => (
                <li key={k} className={i.level === "error" ? "text-red-700" : "text-amber-800"}>{i.level === "error" ? "⛔" : "⚠"} {i.message}</li>
              ))}
            </ul>
          </section>
        )}

        {msg && <div className={`mb-3 rounded-md px-3 py-2 text-sm ${msg.tone === "error" ? "bg-red-50 text-red-800" : "bg-emerald-50 text-emerald-800"}`}>{msg.text}</div>}
        {editable ? (
          <button className="btn-primary w-full" onClick={save} disabled={pending}>
            {pending ? "Saving…" : dirty ? (emp.item ? "Save changes" : "Add to payroll") : "Saved"}
          </button>
        ) : (
          <div className="rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-600">Read-only — this payroll is {ctx.period.status.replace("_", " ")}.</div>
        )}
        {emp.item && <a href={`/payslips/${emp.item.id}`} className="btn-secondary mt-2 w-full">Payslip</a>}
      </aside>
    </div>
  );
}
