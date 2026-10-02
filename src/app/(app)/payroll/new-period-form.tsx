"use client";
import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { createPeriod } from "./actions";

export function NewPeriodForm({ periods }: { periods: { id: string; code: string; status: string }[] }) {
  const [preset, setPreset] = useState("semi_a");
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const custom = preset === "custom";
  return (
    <details className="card mb-4 p-4" open={periods.length === 0}>
      <summary className="cursor-pointer text-sm font-semibold text-brand-700">+ New payroll period</summary>
      <ActionForm action={createPeriod} className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label>
          <span className="label">Type</span>
          <select name="preset" className="input" value={preset} onChange={(e) => setPreset(e.target.value)}>
            <option value="semi_a">Semi-monthly — 1st to 15th</option>
            <option value="semi_b">Semi-monthly — 16th to end of month</option>
            <option value="monthly">Monthly</option>
            <option value="custom">Custom / weekly</option>
          </select>
        </label>
        {!custom && (
          <label>
            <span className="label">Month</span>
            <input type="month" name="month" defaultValue={month} className="input" required />
          </label>
        )}
        {custom && (
          <>
            <label><span className="label">Period start</span><input type="date" name="period_start" className="input" required /></label>
            <label><span className="label">Period end</span><input type="date" name="period_end" className="input" required /></label>
            <label>
              <span className="label">Frequency</span>
              <select name="frequency" className="input" defaultValue="weekly">
                <option value="weekly">Weekly</option><option value="semi_monthly">Semi-monthly</option><option value="monthly">Monthly</option><option value="daily">Daily</option>
              </select>
            </label>
            <label><span className="label">Payrolls in this month</span><input name="periods_in_month" className="input" inputMode="numeric" placeholder="e.g. 4 for weekly" /></label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_last_of_month" className="accent-brand-600" /> Last payroll of the month (contributions true-up)</label>
          </>
        )}
        <label><span className="label">Pay date</span><input type="date" name="pay_date" className="input" required={custom} /></label>
        <label><span className="label">Code (optional)</span><input name="code" className="input" placeholder="Auto e.g. 2026-10-A" /></label>
        <label className="sm:col-span-2"><span className="label">Notes</span><input name="notes" className="input" /></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_adjustment" className="accent-brand-600" /> Adjustment / off-cycle payroll</label>
        <label>
          <span className="label">Adjusts period (optional)</span>
          <select name="adjusts_period_id" className="input" defaultValue="">
            <option value="">—</option>
            {periods.filter((p) => p.status === "locked" || p.status === "paid").map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="allow_overlap" className="accent-brand-600" /> Allow overlap</label>
        <div className="flex items-end"><SubmitButton>Create payroll</SubmitButton></div>
      </ActionForm>
    </details>
  );
}
