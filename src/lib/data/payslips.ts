import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PayslipData } from "@/components/payslip";
import type { PayrollResult } from "@/lib/payroll/types";
import { fullName } from "./load";

export async function loadPayslips(sb: SupabaseClient, filter: { itemId?: string; periodId?: string }): Promise<PayslipData[]> {
  let q = sb
    .from("payroll_items")
    .select("id, result, employees(employee_no, first_name, middle_name, last_name, suffix, is_test_data, positions(name), departments(name)), payroll_periods(code, period_start, period_end, pay_date, status)");
  if (filter.itemId) q = q.eq("id", filter.itemId);
  if (filter.periodId) q = q.eq("period_id", filter.periodId);
  const [{ data }, { data: company }] = await Promise.all([q, sb.from("company_settings").select("company_name, business_address").eq("id", 1).maybeSingle()]);
  return (data ?? [])
    .map((i) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const e = i.employees as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const p = i.payroll_periods as any;
      return {
        company: { company_name: company?.company_name ?? "MJGarcia Trading", business_address: company?.business_address ?? null },
        employee: { employee_no: e.employee_no, name: fullName(e), position: e.positions?.name ?? null, department: e.departments?.name ?? null, is_test_data: e.is_test_data },
        period: p,
        result: i.result as PayrollResult,
      };
    })
    .sort((a, b) => a.employee.name.localeCompare(b.employee.name));
}
