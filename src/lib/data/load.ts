import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  BIRConfig,
  CompanyPolicy,
  DayType,
  EarningLine,
  EmployeePayProfile,
  LoanLine,
  MonthToDate,
  OtherDeductionLine,
  PagIbigConfig,
  PayRateConfig,
  PayrollResult,
  PeriodInfo,
  PhilHealthConfig,
  SSSConfig,
  StatutoryConfig,
  ValidationIssue,
} from "@/lib/payroll/types";
import {
  DED_CODE,
  emptyTime,
  premiumFor,
  type AdjustmentLine,
  type EmployeeContext,
  type EncodedEntry,
  type PeriodContext,
  type PeriodRow,
} from "./entry";

type SB = SupabaseClient;

export const DEFAULT_POLICY: CompanyPolicy = {
  hoursPerDay: 8,
  workDaysPerYear: 313,
  contributionSchedule: "split_trueup",
  minimumNetPay: 0,
  excessiveDeductionRatio: 0.5,
  monthlyRatedPremiumOnly: true,
};

const n = (v: unknown) => (v === null || v === undefined || v === "" ? 0 : Number(v));

export function fullName(e: { first_name: string; middle_name?: string | null; last_name: string; suffix?: string | null }) {
  return [e.last_name + ",", e.first_name, e.middle_name ? e.middle_name[0] + "." : "", e.suffix ?? ""].filter(Boolean).join(" ").trim();
}

// ---------------------------------------------------------------------------
// Statutory configuration for a date
// ---------------------------------------------------------------------------
export async function loadConfig(sb: SB, date: string) {
  const [{ data: rows }, { data: settings }] = await Promise.all([
    sb
      .from("statutory_configurations")
      .select("id, kind, name, effective_from, effective_to, payload, source")
      .eq("status", "active")
      .lte("effective_from", date)
      .or(`effective_to.is.null,effective_to.gte.${date}`)
      .order("effective_from", { ascending: false }),
    sb.from("company_settings").select("policy").eq("id", 1).maybeSingle(),
  ]);
  const pick = (kind: string) => (rows ?? []).find((r) => r.kind === kind);
  const configIds: Record<string, string> = {};
  const wrap = <T,>(kind: string): T | null => {
    const r = pick(kind);
    if (!r) return null;
    configIds[kind] = r.id;
    return { ...(r.payload as object), configId: r.id, effectiveFrom: r.effective_from, source: r.source } as T;
  };
  const config: StatutoryConfig = {
    sss: wrap<SSSConfig>("sss"),
    philhealth: wrap<PhilHealthConfig>("philhealth"),
    pagibig: wrap<PagIbigConfig>("pagibig"),
    bir: wrap<BIRConfig>("bir"),
    payRates: wrap<PayRateConfig>("pay_rates"),
    policy: { ...DEFAULT_POLICY, ...((settings?.policy as Partial<CompanyPolicy>) ?? {}) },
  };
  const missing = (["sss", "philhealth", "pagibig", "bir", "pay_rates"] as const).filter((k) => !configIds[k]);
  return { config, configIds, missing };
}

export function periodInfo(p: PeriodRow): PeriodInfo {
  return {
    start: p.period_start,
    end: p.period_end,
    payDate: p.pay_date,
    frequency: p.frequency,
    periodsInMonth: p.periods_in_month,
    isLastPeriodOfMonth: p.is_last_of_month,
  };
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------
export function eachDate(start: string, end: string): string[] {
  const out: string[] = [];
  const d = new Date(start + "T00:00:00Z");
  const e = new Date(end + "T00:00:00Z");
  while (d <= e) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}
const weekday = (iso: string) => new Date(iso + "T00:00:00Z").getUTCDay(); // 0 = Sunday

interface HolidayRow { holiday_date: string; name: string; holiday_type: string; region: string | null }

export function dayTypeFor(date: string, holidays: HolidayRow[], isRestDay: boolean): DayType {
  const regs = holidays.filter((h) => h.holiday_date === date && h.holiday_type === "regular").length;
  const special = holidays.some((h) => h.holiday_date === date && (h.holiday_type === "special_non_working" || h.holiday_type === "local"));
  if (regs >= 2) return isRestDay ? "double_rest" : "double";
  if (regs === 1) return isRestDay ? "regular_rest" : "regular";
  if (special) return isRestDay ? "special_rest" : "special";
  return isRestDay ? "rest_day" : "ordinary";
}

interface AttendanceRow {
  work_date: string;
  regular_hours: number;
  ot_hours: number;
  night_hours: number;
  night_ot_hours?: number;
  late_minutes: number;
  undertime_minutes: number;
  absent: boolean;
  leave_paid: boolean;
  leave_type: string | null;
  rest_day: boolean;
  day_type_override: string | null;
}

/** Turn attendance rows into a TimeInput. */
export function summarizeAttendance(rows: AttendanceRow[], holidays: HolidayRow[], hoursPerDay: number) {
  const time = emptyTime();
  for (const a of rows) {
    const dt = (a.day_type_override as DayType) || dayTypeFor(a.work_date, holidays, a.rest_day);
    if (a.absent) {
      if (dt === "regular" || dt === "double") time.unworkedRegularHolidays += 1;
      else if (dt === "ordinary") time.absentDays += 1;
      continue;
    }
    if (a.leave_type) {
      if (a.leave_paid) time.paidLeaveDays += 1;
      continue;
    }
    time.lateMinutes += n(a.late_minutes);
    time.undertimeMinutes += n(a.undertime_minutes);
    const row = premiumFor(time, dt);
    if (dt === "ordinary") {
      time.regularDays += 1;
      time.regularHours += n(a.regular_hours) || hoursPerDay;
    } else {
      row.hours += n(a.regular_hours) || hoursPerDay;
    }
    row.otHours += n(a.ot_hours);
    row.nsdHours += n(a.night_hours);
    row.nsdOtHours += n(a.night_ot_hours);
  }
  return time;
}

// ---------------------------------------------------------------------------
// Period context: everything the engine needs for every employee in a period
// ---------------------------------------------------------------------------
export async function loadPeriodContext(sb: SB, periodId: string, onlyEmployeeId?: string): Promise<PeriodContext | null> {
  const { data: period } = await sb.from("payroll_periods").select("*").eq("id", periodId).maybeSingle<PeriodRow>();
  if (!period) return null;
  const info = periodInfo(period);
  const { config, configIds, missing } = await loadConfig(sb, period.period_end);

  const { data: existingItems } = await sb.from("payroll_items").select("id, employee_id, input, net_pay, has_errors").eq("period_id", periodId);
  const itemByEmp = new Map((existingItems ?? []).map((i) => [i.employee_id as string, i]));

  let empQuery = sb
    .from("employees")
    .select("*, positions(name), departments(name), branches(name), employee_government_ids(sss_no, philhealth_no, pagibig_no, tin)")
    .is("deleted_at", null)
    .order("last_name");
  if (onlyEmployeeId) empQuery = empQuery.eq("id", onlyEmployeeId);
  const { data: emps } = await empQuery;
  const inactive = new Set(["applicant", "inactive"]);
  const employees = (emps ?? []).filter((e) => {
    if (itemByEmp.has(e.id)) return true;
    if (onlyEmployeeId) return true;
    if (inactive.has(e.employment_status)) return false;
    if ((e.employment_status === "resigned" || e.employment_status === "terminated") && (!e.separation_date || e.separation_date < period.period_start)) return false;
    return period.is_adjustment || e.pay_frequency === period.frequency;
  });
  const ids = employees.map((e) => e.id);
  if (!ids.length) return { period, periodInfo: info, config, configIds, missingConfig: missing, employees: [] };

  const year = period.pay_date.slice(0, 4);
  const month = period.period_end.slice(0, 7);
  const [allowances, loans, deductions, commissions, adjustments, holidays, attendance, wages, history] = await Promise.all([
    sb.from("employee_allowances").select("*, earning_types(*)").in("employee_id", ids).eq("active", true).lte("effective_from", period.period_end),
    sb.from("loan_accounts").select("*").in("employee_id", ids).eq("status", "active").gt("balance", 0).lte("start_deduction", period.period_end),
    sb.from("employee_deductions").select("*").in("employee_id", ids).eq("active", true).lte("start_date", period.period_end),
    sb.from("commission_records").select("*").in("employee_id", ids).eq("period_id", periodId),
    sb.from("payroll_adjustments").select("*").in("employee_id", ids).eq("status", "approved").is("applied_period_id", null),
    sb.from("holidays").select("holiday_date, name, holiday_type, region").eq("status", "active").gte("holiday_date", period.period_start).lte("holiday_date", period.period_end),
    sb.from("attendance").select("*").in("employee_id", ids).gte("work_date", period.period_start).lte("work_date", period.period_end),
    sb.from("minimum_wage_rates").select("*").lte("effective_from", period.period_end).order("effective_from", { ascending: false }),
    sb
      .from("payroll_items")
      .select("employee_id, result, input, payroll_periods!inner(id, period_start, period_end, pay_date, status)")
      .in("employee_id", ids)
      .neq("period_id", periodId)
      .neq("payroll_periods.status", "cancelled")
      .gte("payroll_periods.pay_date", `${year}-01-01`)
      .lte("payroll_periods.pay_date", `${year}-12-31`),
  ]);

  const ctxEmployees: EmployeeContext[] = employees.map((e) => {
    const issues: ValidationIssue[] = [];
    const gov = (Array.isArray(e.employee_government_ids) ? e.employee_government_ids[0] : e.employee_government_ids) ?? {};
    const missingIds = [
      e.sss_covered && !gov.sss_no && "SSS",
      e.philhealth_covered && !gov.philhealth_no && "PhilHealth",
      e.pagibig_covered && !gov.pagibig_no && "Pag-IBIG",
      !gov.tin && "TIN",
    ].filter(Boolean);
    if (missingIds.length) issues.push({ level: "warning", code: "MISSING_GOV_ID", message: `Missing government number: ${missingIds.join(", ")}.` });
    if (e.pay_frequency !== period.frequency && !period.is_adjustment) {
      issues.push({ level: "warning", code: "FREQUENCY_MISMATCH", message: `Employee is paid ${e.pay_frequency.replace("_", "-")}, this payroll is ${period.frequency.replace("_", "-")}.` });
    }

    const profile: EmployeePayProfile = {
      id: e.id,
      name: fullName(e),
      salaryType: e.salary_type,
      monthlyRate: e.monthly_rate === null ? null : n(e.monthly_rate),
      dailyRate: e.daily_rate === null ? null : n(e.daily_rate),
      hourlyRate: e.hourly_rate === null ? null : n(e.hourly_rate),
      isMinimumWageEarner: e.is_minimum_wage_earner,
      otEligible: e.ot_eligible,
      nsdEligible: e.nsd_eligible,
      holidayPayEligible: e.holiday_pay_eligible,
      sssCovered: e.sss_covered,
      philhealthCovered: e.philhealth_covered,
      pagibigCovered: e.pagibig_covered,
    };

    const recurringEarnings: EarningLine[] = (allowances.data ?? [])
      .filter((a) => a.employee_id === e.id && (!a.effective_to || a.effective_to >= period.period_start) && a.earning_types)
      .map((a) => ({
        code: `ALW:${a.id}`,
        label: a.earning_types.label,
        category: a.earning_types.category,
        amount: a.per_period ? n(a.amount) : Math.round((n(a.amount) / Math.max(1, period.periods_in_month)) * 100) / 100,
        taxTreatment: a.earning_types.tax_treatment,
        includeInSSS: a.earning_types.include_in_sss,
        includeInPagibig: a.earning_types.include_in_pagibig,
      }));
    const commissionLines: EarningLine[] = (commissions.data ?? [])
      .filter((c) => c.employee_id === e.id)
      .map((c) => ({
        code: `COM:${c.id}`,
        label: `Commission${c.reference ? ` (${c.reference})` : ""}`,
        category: "commission",
        amount: n(c.amount),
        taxTreatment: "taxable",
        includeInSSS: true,
        includeInPagibig: false,
      }));
    const loanLines: LoanLine[] = (loans.data ?? [])
      .filter((l) => l.employee_id === e.id && (!l.end_deduction || l.end_deduction >= period.period_start))
      .map((l) => ({
        loanId: l.id,
        label: `${String(l.loan_type).replace(/_/g, " ").replace(/^\w/, (c: string) => c.toUpperCase())}${l.reference_no ? ` #${l.reference_no}` : ""}`,
        loanType: l.loan_type,
        scheduledAmount: n(l.installment_amount),
        balance: n(l.balance),
        priority: l.priority,
      }));
    const dedLines: OtherDeductionLine[] = (deductions.data ?? [])
      .filter((d) => d.employee_id === e.id && (!d.end_date || d.end_date >= period.period_start) && (d.recurring || !d.applied_period_id || d.applied_period_id === periodId))
      .map((d) => ({ code: DED_CODE + d.id, label: d.label, amount: n(d.amount), reference: d.authorization_ref }));
    const adjLines: AdjustmentLine[] = (adjustments.data ?? [])
      .filter((a) => a.employee_id === e.id)
      .map((a) => ({ id: a.id, adjustment_type: a.adjustment_type, amount: n(a.amount), taxable: a.taxable, reason: a.reason }));

    // month-to-date & year-to-date from other payrolls
    const mine = (history.data ?? []).filter((h) => h.employee_id === e.id);
    const pp = (h: (typeof mine)[number]) => (Array.isArray(h.payroll_periods) ? h.payroll_periods[0] : h.payroll_periods) as { period_start: string; period_end: string };
    const earlierThisMonth = mine.filter((h) => pp(h).period_end.slice(0, 7) === month && pp(h).period_end < period.period_start);
    let monthToDate: MonthToDate | undefined;
    if (period.periods_in_month > 1 && earlierThisMonth.length) {
      const s = (f: (r: PayrollResult) => number) => earlierThisMonth.reduce((a, h) => a + n(f(h.result as PayrollResult)), 0);
      monthToDate = {
        sssCompensation: s((r) => r.statutory.sssPeriodBasis),
        philhealthBasic: s((r) => r.statutory.philhealthPeriodBasis),
        pagibigCompensation: s((r) => r.statutory.pagibigPeriodBasis),
        sssEE: s((r) => r.statutory.sssEE),
        sssER: s((r) => r.statutory.sssER),
        sssEC: s((r) => r.statutory.sssEC),
        sssMpfEE: s((r) => r.statutory.sssMpfEE),
        sssMpfER: s((r) => r.statutory.sssMpfER),
        philhealthEE: s((r) => r.statutory.philhealthEE),
        philhealthER: s((r) => r.statutory.philhealthER),
        pagibigEE: s((r) => r.statutory.pagibigEE),
        pagibigER: s((r) => r.statutory.pagibigER),
      };
    } else if (period.periods_in_month > 1 && period.is_last_of_month) {
      monthToDate = undefined; // engine warns
    }
    const before = mine.filter((h) => pp(h).period_end < period.period_start);
    const yearToDate = {
      taxableCompensation: before.reduce((a, h) => a + n((h.result as PayrollResult).tax?.netTaxable), 0),
      taxWithheld: before.reduce((a, h) => a + n((h.result as PayrollResult).tax?.withholdingTax), 0),
      otherBenefits: before.reduce(
        (a, h) => a + ((h.result as PayrollResult).earnings?.lines ?? []).filter((l) => l.taxTreatment === "other_benefit").reduce((x, l) => x + n(l.amount), 0),
        0
      ),
    };

    // minimum wage for work location
    let minimumDailyWage: number | null = e.minimum_wage_override === null ? null : n(e.minimum_wage_override);
    if (minimumDailyWage === null) {
      const region = e.work_region ?? e.region;
      const candidates = (wages.data ?? []).filter(
        (w) =>
          w.region === region &&
          w.sector === (e.wage_classification ?? "non_agriculture") &&
          (!w.effective_to || w.effective_to >= period.period_end) &&
          (!w.province || w.province === e.work_province) &&
          (!w.city || w.city === e.work_city)
      );
      if (candidates.length) {
        // the most specific row wins; otherwise the highest rate for the region (conservative)
        const specific = candidates.find((w) => w.city) ?? candidates.find((w) => w.province);
        minimumDailyWage = specific ? n(specific.daily_rate) : Math.max(...candidates.map((w) => n(w.daily_rate)));
        if (!specific && new Set(candidates.map((w) => n(w.daily_rate))).size > 1) {
          issues.push({ level: "warning", code: "WAGE_AREA_UNSET", message: `Work city/province not matched to a wage area; compared against the highest ${region} rate.` });
        }
      } else {
        issues.push({ level: "warning", code: "NO_WAGE_CONFIG", message: "No minimum wage configuration for the employee's work location." });
      }
    }

    // default encoding
    const empHolidays = (holidays.data ?? []).filter((h) => !h.region || h.region === (e.work_region ?? e.region));
    const empAttendance = (attendance.data ?? []).filter((a) => a.employee_id === e.id);
    let time = emptyTime();
    if (empAttendance.length) {
      time = summarizeAttendance(empAttendance, empHolidays, config.policy.hoursPerDay);
    } else if (e.salary_type !== "monthly") {
      for (const d of eachDate(period.period_start, period.period_end)) {
        if (weekday(d) === 0) continue; // Sunday rest day (Mon–Sat work week)
        if (e.date_hired && d < e.date_hired) continue;
        if (e.separation_date && d > e.separation_date) continue;
        const dt = dayTypeFor(d, empHolidays, false);
        if (dt === "regular" || dt === "double") time.unworkedRegularHolidays += 1;
        else if (dt === "ordinary") time.regularDays += 1;
      }
      time.regularHours = time.regularDays * config.policy.hoursPerDay;
    }
    const defaultEncoded: EncodedEntry = { mode: "auto", time, extraEarnings: [], extraDeductions: [], overrides: {} };

    const item = itemByEmp.get(e.id);
    return {
      summary: {
        id: e.id,
        employee_no: e.employee_no,
        name: fullName(e),
        position: e.positions?.name ?? null,
        department: e.departments?.name ?? null,
        branch: e.branches?.name ?? null,
        is_test_data: e.is_test_data,
      },
      profile,
      recurringEarnings,
      commissions: commissionLines,
      loans: loanLines,
      deductions: dedLines,
      adjustments: adjLines,
      monthToDate,
      yearToDate,
      minimumDailyWage,
      contextIssues: issues,
      defaultEncoded,
      item: item ? { id: item.id, encoded: (item.input as { encoded: EncodedEntry }).encoded, netPay: n(item.net_pay), hasErrors: item.has_errors } : null,
    };
  });

  return { period, periodInfo: info, config, configIds, missingConfig: missing, employees: ctxEmployees };
}
