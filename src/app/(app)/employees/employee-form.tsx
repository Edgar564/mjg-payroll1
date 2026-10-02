"use client";
import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { saveEmployee } from "./actions";

type Opt = { id: string; name: string };
type Emp = Record<string, unknown> & { employee_government_ids?: Record<string, unknown> | null };

const STATUSES = ["applicant", "probationary", "regular", "contractual", "casual", "part_time", "resigned", "terminated", "inactive"];
const lbl = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="card mb-4 p-4">
      <legend className="px-1 text-sm font-semibold text-slate-800">{title}</legend>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">{children}</div>
    </fieldset>
  );
}

export function EmployeeForm({
  employee,
  positions,
  departments,
  branches,
  canGov,
  canEdit,
}: {
  employee?: Emp | null;
  positions: Opt[];
  departments: Opt[];
  branches: Opt[];
  canGov: boolean;
  canEdit: boolean;
}) {
  const e = employee ?? {};
  const g = (employee?.employee_government_ids ?? {}) as Record<string, unknown>;
  const [salaryType, setSalaryType] = useState(String(e.salary_type ?? "daily"));
  const v = (k: string) => (e[k] === null || e[k] === undefined ? "" : String(e[k]));
  const chk = (k: string, dflt = true) => (e[k] === undefined ? dflt : Boolean(e[k]));
  const T = (name: string, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="block">
      <span className="label">{label}</span>
      <input className="input" name={name} defaultValue={v(name)} disabled={!canEdit} {...props} />
    </label>
  );
  const Sel = (name: string, label: string, options: { value: string; label: string }[], dflt = "") => (
    <label className="block">
      <span className="label">{label}</span>
      <select className="input" name={name} defaultValue={v(name) || dflt} disabled={!canEdit}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
  const Chk = (name: string, label: string, dflt = true) => (
    <label className="flex items-center gap-2 text-sm text-slate-700">
      <input type="checkbox" name={name} defaultChecked={chk(name, dflt)} disabled={!canEdit} className="h-4 w-4 accent-brand-600" />
      {label}
    </label>
  );
  const opts = (list: Opt[]) => [{ value: "", label: "—" }, ...list.map((o) => ({ value: o.id, label: o.name }))];

  return (
    <ActionForm action={saveEmployee}>
      {employee?.id ? <input type="hidden" name="id" value={String(employee.id)} /> : null}
      <Section title="Personal information">
        {T("employee_no", "Employee number *", { required: true })}
        {T("last_name", "Last name *", { required: true })}
        {T("first_name", "First name *", { required: true })}
        {T("middle_name", "Middle name")}
        {T("suffix", "Suffix")}
        {T("nickname", "Nickname")}
        {T("birth_date", "Birth date", { type: "date" })}
        {Sel("gender", "Gender", [{ value: "", label: "—" }, { value: "male", label: "Male" }, { value: "female", label: "Female" }])}
        {Sel("civil_status", "Civil status", ["", "single", "married", "widowed", "separated"].map((s) => ({ value: s, label: s ? lbl(s) : "—" })))}
        {T("contact_no", "Contact number")}
        {T("email", "Email", { type: "email" })}
        {T("address", "Address (house/street)")}
        {T("barangay", "Barangay")}
        {T("city", "City / Municipality")}
        {T("province", "Province")}
        {T("region", "Region")}
        {T("zip_code", "ZIP code")}
        {T("emergency_contact", "Emergency contact")}
        {T("emergency_contact_no", "Emergency contact number")}
      </Section>

      <Section title="Employment">
        {Sel("position_id", "Position", opts(positions))}
        {Sel("department_id", "Department", opts(departments))}
        {Sel("branch_id", "Branch", opts(branches))}
        {Sel("employment_status", "Employment status", STATUSES.map((s) => ({ value: s, label: lbl(s) })), "probationary")}
        {T("employment_type", "Employment type", { placeholder: "e.g. Full-time, Field" })}
        {T("date_hired", "Date hired", { type: "date" })}
        {T("regularization_date", "Regularization date", { type: "date" })}
        {T("separation_date", "Separation date", { type: "date" })}
        {T("separation_reason", "Separation reason")}
      </Section>

      <Section title="Pay">
        {Sel("pay_frequency", "Pay frequency", [
          { value: "semi_monthly", label: "Semi-monthly" },
          { value: "weekly", label: "Weekly" },
          { value: "monthly", label: "Monthly" },
          { value: "daily", label: "Daily" },
        ], "semi_monthly")}
        <label className="block">
          <span className="label">Salary type</span>
          <select className="input" name="salary_type" value={salaryType} onChange={(ev) => setSalaryType(ev.target.value)} disabled={!canEdit}>
            <option value="daily">Daily rate</option>
            <option value="monthly">Monthly salary</option>
            <option value="hourly">Hourly rate</option>
          </select>
        </label>
        {salaryType === "monthly" && T("monthly_rate", "Monthly basic salary (₱) *", { inputMode: "decimal", required: true })}
        {salaryType === "daily" && T("daily_rate", "Daily rate (₱) *", { inputMode: "decimal", required: true })}
        {salaryType === "hourly" && T("hourly_rate", "Hourly rate (₱) *", { inputMode: "decimal", required: true })}
        <div className="flex flex-col justify-end gap-1.5 sm:col-span-2 lg:col-span-1">
          {Chk("is_minimum_wage_earner", "Minimum wage earner (tax-exempt SMW)", false)}
        </div>
      </Section>

      <Section title="Eligibility & coverage">
        {Chk("ot_eligible", "Overtime eligible")}
        {Chk("nsd_eligible", "Night differential eligible")}
        {Chk("holiday_pay_eligible", "Holiday pay eligible")}
        {Chk("thirteenth_month_eligible", "13th month eligible")}
        {Chk("commission_eligible", "Commission eligible", false)}
        {Chk("sss_covered", "SSS covered")}
        {Chk("philhealth_covered", "PhilHealth covered")}
        {Chk("pagibig_covered", "Pag-IBIG covered")}
      </Section>

      <Section title="Work location (minimum wage)">
        {T("work_region", "Work region", { placeholder: "e.g. IV-A, NCR, III" })}
        {T("work_province", "Work province")}
        {T("work_city", "Work city / municipality")}
        {Sel("wage_classification", "Wage sector", [
          { value: "non_agriculture", label: "Non-agriculture" },
          { value: "retail_service", label: "Retail/service (≤10 workers)" },
          { value: "agriculture", label: "Agriculture" },
          { value: "other", label: "Other" },
        ], "non_agriculture")}
        {T("minimum_wage_override", "Minimum wage override (₱/day)", { inputMode: "decimal", placeholder: "Leave blank to use wage table" })}
      </Section>

      {canGov && (
        <Section title="Government IDs & payment">
          {T("sss_no", "SSS number", { defaultValue: String(g.sss_no ?? "") })}
          {T("philhealth_no", "PhilHealth number", { defaultValue: String(g.philhealth_no ?? "") })}
          {T("pagibig_no", "Pag-IBIG MID number", { defaultValue: String(g.pagibig_no ?? "") })}
          {T("tin", "TIN", { defaultValue: String(g.tin ?? "") })}
          {T("bir_status", "BIR status / category", { defaultValue: String(g.bir_status ?? ""), placeholder: "e.g. MWE, Regular" })}
          <label className="block">
            <span className="label">Payment method</span>
            <select className="input" name="payment_method" defaultValue={String(g.payment_method ?? "cash")} disabled={!canEdit}>
              <option value="cash">Cash</option>
              <option value="bank_transfer">Bank transfer</option>
              <option value="gcash">GCash</option>
              <option value="other">Other</option>
            </select>
          </label>
          {T("bank_name", "Bank", { defaultValue: String(g.bank_name ?? "") })}
          {T("bank_account_no", "Bank account number", { defaultValue: String(g.bank_account_no ?? "") })}
          {T("gcash_no", "GCash number", { defaultValue: String(g.gcash_no ?? "") })}
        </Section>
      )}

      <div className="mb-6 flex items-center gap-4">
        {canEdit && <SubmitButton>Save employee</SubmitButton>}
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <input type="checkbox" name="is_test_data" defaultChecked={chk("is_test_data", false)} disabled={!canEdit} className="accent-orange-600" />
          Mark as TEST DATA
        </label>
      </div>
    </ActionForm>
  );
}
