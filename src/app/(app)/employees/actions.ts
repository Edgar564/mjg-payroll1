"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/data/session";
import { can } from "@/lib/roles";
import { bool, friendlyError, num, str } from "@/lib/data/errors";
import type { ActionResult } from "@/components/action-form";

const STATUSES = ["applicant", "probationary", "regular", "contractual", "casual", "part_time", "resigned", "terminated", "inactive"];

export async function saveEmployee(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const { supabase, user, role } = await getSession();
  if (!can.writeEmployees(role)) return { error: "Your role is not allowed to edit employees." };
  const id = str(fd.get("id"));
  const salaryType = String(fd.get("salary_type") ?? "daily");
  const row = {
    employee_no: str(fd.get("employee_no")),
    first_name: str(fd.get("first_name")),
    middle_name: str(fd.get("middle_name")),
    last_name: str(fd.get("last_name")),
    suffix: str(fd.get("suffix")),
    nickname: str(fd.get("nickname")),
    birth_date: str(fd.get("birth_date")),
    gender: str(fd.get("gender")),
    civil_status: str(fd.get("civil_status")),
    address: str(fd.get("address")),
    barangay: str(fd.get("barangay")),
    city: str(fd.get("city")),
    province: str(fd.get("province")),
    region: str(fd.get("region")),
    zip_code: str(fd.get("zip_code")),
    contact_no: str(fd.get("contact_no")),
    email: str(fd.get("email")),
    emergency_contact: str(fd.get("emergency_contact")),
    emergency_contact_no: str(fd.get("emergency_contact_no")),
    position_id: str(fd.get("position_id")),
    department_id: str(fd.get("department_id")),
    branch_id: str(fd.get("branch_id")),
    employment_status: String(fd.get("employment_status") ?? "probationary"),
    employment_type: str(fd.get("employment_type")),
    date_hired: str(fd.get("date_hired")),
    regularization_date: str(fd.get("regularization_date")),
    separation_date: str(fd.get("separation_date")),
    separation_reason: str(fd.get("separation_reason")),
    pay_frequency: String(fd.get("pay_frequency") ?? "semi_monthly"),
    salary_type: salaryType,
    monthly_rate: num(fd.get("monthly_rate")),
    daily_rate: num(fd.get("daily_rate")),
    hourly_rate: num(fd.get("hourly_rate")),
    is_minimum_wage_earner: bool(fd.get("is_minimum_wage_earner")),
    commission_eligible: bool(fd.get("commission_eligible")),
    ot_eligible: bool(fd.get("ot_eligible")),
    nsd_eligible: bool(fd.get("nsd_eligible")),
    holiday_pay_eligible: bool(fd.get("holiday_pay_eligible")),
    thirteenth_month_eligible: bool(fd.get("thirteenth_month_eligible")),
    sss_covered: bool(fd.get("sss_covered")),
    philhealth_covered: bool(fd.get("philhealth_covered")),
    pagibig_covered: bool(fd.get("pagibig_covered")),
    work_region: str(fd.get("work_region")),
    work_province: str(fd.get("work_province")),
    work_city: str(fd.get("work_city")),
    wage_classification: String(fd.get("wage_classification") ?? "non_agriculture"),
    minimum_wage_override: num(fd.get("minimum_wage_override")),
    is_test_data: bool(fd.get("is_test_data")),
  };

  // Validation with clear messages
  if (!row.employee_no || !row.first_name || !row.last_name) return { error: "Employee number, first name and last name are required." };
  if (!STATUSES.includes(row.employment_status)) return { error: "Choose a valid employment status." };
  const rate = salaryType === "monthly" ? row.monthly_rate : salaryType === "daily" ? row.daily_rate : row.hourly_rate;
  if (!rate || rate <= 0) return { error: `Enter the ${salaryType} rate — payroll cannot be calculated without a salary.` };
  for (const k of ["monthly_rate", "daily_rate", "hourly_rate", "minimum_wage_override"] as const) {
    if (row[k] !== null && row[k]! < 0) return { error: "Rates cannot be negative." };
  }
  if ((row.employment_status === "resigned" || row.employment_status === "terminated") && !row.separation_date) {
    return { error: "Enter the separation date for resigned or terminated employees." };
  }
  if (row.separation_date && row.date_hired && row.separation_date < row.date_hired) return { error: "Separation date cannot be before the date hired." };

  let empId = id;
  if (id) {
    const { error } = await supabase.from("employees").update({ ...row, updated_by: user.id }).eq("id", id);
    if (error) return { error: friendlyError(error) };
  } else {
    const { data, error } = await supabase.from("employees").insert({ ...row, created_by: user.id, updated_by: user.id }).select("id").single();
    if (error) return { error: friendlyError(error) };
    empId = data.id;
  }

  // Government IDs (only roles that may read them see / submit these fields)
  if (fd.has("sss_no")) {
    const gov = {
      employee_id: empId,
      sss_no: str(fd.get("sss_no")),
      philhealth_no: str(fd.get("philhealth_no")),
      pagibig_no: str(fd.get("pagibig_no")),
      tin: str(fd.get("tin")),
      bir_status: str(fd.get("bir_status")),
      payment_method: String(fd.get("payment_method") ?? "cash"),
      bank_name: str(fd.get("bank_name")),
      bank_account_no: str(fd.get("bank_account_no")),
      gcash_no: str(fd.get("gcash_no")),
      updated_by: user.id,
    };
    const { error } = await supabase.from("employee_government_ids").upsert(gov);
    if (error) return { error: "Employee saved, but government IDs were not: " + friendlyError(error) };
  }

  revalidatePath("/employees");
  if (!id) redirect(`/employees/${empId}?saved=1`);
  return { ok: "Employee saved." };
}

export async function addAllowance(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const { supabase, role } = await getSession();
  if (!can.writePayroll(role)) return { error: "Only payroll admins can assign allowances." };
  const amount = num(fd.get("amount"));
  if (!amount || amount <= 0) return { error: "Enter an amount greater than zero." };
  const { error } = await supabase.from("employee_allowances").insert({
    employee_id: fd.get("employee_id"),
    earning_code: fd.get("earning_code"),
    amount,
    per_period: fd.get("per_period") === "period",
    recurring: true,
    effective_from: str(fd.get("effective_from")) ?? new Date().toISOString().slice(0, 10),
    effective_to: str(fd.get("effective_to")),
    notes: str(fd.get("notes")),
  });
  if (error) return { error: friendlyError(error) };
  revalidatePath(`/employees/${fd.get("employee_id")}`);
  return { ok: "Allowance added." };
}

export async function addDeduction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const { supabase, user, role } = await getSession();
  if (!can.writePayroll(role)) return { error: "Only payroll admins can set up deductions." };
  const amount = num(fd.get("amount"));
  const auth = str(fd.get("authorization_ref"));
  if (!amount || amount <= 0) return { error: "Enter an amount greater than zero." };
  if (!auth) return { error: "Record the employee's written authorization or reference. Deductions without authorization are not allowed." };
  const { error } = await supabase.from("employee_deductions").insert({
    employee_id: fd.get("employee_id"),
    code: String(fd.get("code") ?? "OTHER"),
    label: str(fd.get("label")) ?? ({ UNIFORM: "Uniform", DAMAGE: "Damage / loss", OTHER: "Other deduction" } as Record<string, string>)[String(fd.get("code"))] ?? "Deduction",
    amount,
    recurring: fd.get("recurring") === "yes",
    start_date: str(fd.get("start_date")) ?? new Date().toISOString().slice(0, 10),
    end_date: str(fd.get("end_date")),
    authorization_ref: auth,
    notes: str(fd.get("notes")),
    created_by: user.id,
  });
  if (error) return { error: friendlyError(error) };
  revalidatePath(`/employees/${fd.get("employee_id")}`);
  return { ok: "Deduction added." };
}

export async function deactivateLine(fd: FormData) {
  const { supabase, role } = await getSession();
  if (!can.writePayroll(role)) return;
  const table = fd.get("table") === "allowance" ? "employee_allowances" : "employee_deductions";
  await supabase.from(table).update({ active: false }).eq("id", String(fd.get("id")));
  revalidatePath(`/employees/${fd.get("employee_id")}`);
}

export async function softDeleteEmployee(fd: FormData) {
  const { supabase, role } = await getSession();
  if (!can.writeEmployees(role)) return;
  await supabase.from("employees").update({ deleted_at: new Date().toISOString(), employment_status: "inactive" }).eq("id", String(fd.get("id")));
  revalidatePath("/employees");
  redirect("/employees");
}
