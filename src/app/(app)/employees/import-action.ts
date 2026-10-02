"use server";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/data/session";
import { can } from "@/lib/roles";
import { friendlyError } from "@/lib/data/errors";

export interface ImportEmployee {
  employee_no: string; last_name: string; first_name: string; middle_name: string; employment_status: string; date_hired: string;
  pay_frequency: string; salary_type: string; monthly_rate: string; daily_rate: string; hourly_rate: string; work_region: string;
  sss_no: string; philhealth_no: string; pagibig_no: string; tin: string;
}

export async function importEmployees(rows: ImportEmployee[]): Promise<{ error?: string; ok?: string }> {
  const { supabase, user, role } = await getSession();
  if (!can.writeEmployees(role)) return { error: "Your role cannot import employees." };
  const v = (s: string) => (s?.trim() ? s.trim() : null);
  const n = (s: string) => (s?.trim() ? Number(s) : null);
  // Server re-validates the essentials; nothing is inserted if any row fails.
  for (const r of rows) {
    if (!r.employee_no || !r.last_name || !r.first_name || !["monthly", "daily", "hourly"].includes(r.salary_type)) return { error: `Row ${r.employee_no || "?"} is invalid. Nothing was imported.` };
    if (!(Number(r[`${r.salary_type}_rate` as keyof ImportEmployee]) > 0)) return { error: `Row ${r.employee_no}: missing ${r.salary_type} rate. Nothing was imported.` };
  }
  const { data, error } = await supabase
    .from("employees")
    .insert(rows.map((r) => ({
      employee_no: r.employee_no, last_name: r.last_name, first_name: r.first_name, middle_name: v(r.middle_name),
      employment_status: v(r.employment_status) ?? "probationary", date_hired: v(r.date_hired), pay_frequency: v(r.pay_frequency) ?? "semi_monthly",
      salary_type: r.salary_type, monthly_rate: n(r.monthly_rate), daily_rate: n(r.daily_rate), hourly_rate: n(r.hourly_rate),
      work_region: v(r.work_region), created_by: user.id, updated_by: user.id,
    })))
    .select("id, employee_no");
  if (error) return { error: `Nothing was imported: ${friendlyError(error)}` };
  if (can.readGovIds(role)) {
    const byNo = new Map((data ?? []).map((d) => [d.employee_no, d.id]));
    const gov = rows.filter((r) => r.sss_no || r.philhealth_no || r.pagibig_no || r.tin).map((r) => ({ employee_id: byNo.get(r.employee_no), sss_no: v(r.sss_no), philhealth_no: v(r.philhealth_no), pagibig_no: v(r.pagibig_no), tin: v(r.tin), updated_by: user.id }));
    if (gov.length) await supabase.from("employee_government_ids").upsert(gov);
  }
  revalidatePath("/employees");
  return { ok: `Imported ${data?.length ?? 0} employee(s).` };
}
