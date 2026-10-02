/**
 * Pure helpers shared by the server (authoritative save) and the browser
 * (instant preview). No database access here.
 */
import type {
  ComponentOverride,
  DayType,
  DayTypeHours,
  EarningLine,
  EmployeePayProfile,
  LoanLine,
  MonthToDate,
  OtherDeductionLine,
  PayrollInput,
  PayrollMode,
  PayrollResult,
  PeriodInfo,
  StatutoryConfig,
  TimeInput,
  ValidationIssue,
  YearToDate,
} from "@/lib/payroll/types";

export interface EncodedEntry {
  mode: PayrollMode;
  manualReason?: string;
  time: TimeInput;
  extraEarnings: EarningLine[];
  extraDeductions: OtherDeductionLine[];
  overrides: Record<string, ComponentOverride>;
  /** Recurring items the user turned off for this period. */
  skipLoanIds?: string[];
  skipRecurringCodes?: string[];
}

export interface EmployeeSummary {
  id: string;
  employee_no: string;
  name: string;
  position: string | null;
  department: string | null;
  branch: string | null;
  is_test_data: boolean;
}

export interface AdjustmentLine {
  id: string;
  adjustment_type: string;
  amount: number;
  taxable: boolean;
  reason: string;
}

export interface EmployeeContext {
  summary: EmployeeSummary;
  profile: EmployeePayProfile;
  recurringEarnings: EarningLine[];
  commissions: EarningLine[];
  loans: LoanLine[];
  deductions: OtherDeductionLine[];
  adjustments: AdjustmentLine[];
  monthToDate?: MonthToDate;
  yearToDate: YearToDate;
  minimumDailyWage: number | null;
  contextIssues: ValidationIssue[];
  defaultEncoded: EncodedEntry;
  item: { id: string; encoded: EncodedEntry; netPay: number; hasErrors: boolean } | null;
}

export interface PeriodContext {
  period: PeriodRow;
  periodInfo: PeriodInfo;
  config: StatutoryConfig;
  configIds: Record<string, string>;
  missingConfig: string[];
  employees: EmployeeContext[];
}

export interface PeriodRow {
  id: string;
  code: string;
  period_start: string;
  period_end: string;
  pay_date: string;
  frequency: PeriodInfo["frequency"];
  periods_in_month: number;
  is_last_of_month: boolean;
  status: string;
  is_adjustment: boolean;
  notes: string | null;
  approved_at?: string | null;
  posted_at?: string | null;
  locked_at?: string | null;
}

export const DAY_TYPES: DayType[] = ["ordinary", "rest_day", "special", "special_rest", "regular", "regular_rest", "double", "double_rest"];

export function emptyTime(): TimeInput {
  return {
    regularDays: 0,
    regularHours: 0,
    absentDays: 0,
    lateMinutes: 0,
    undertimeMinutes: 0,
    paidLeaveDays: 0,
    unworkedRegularHolidays: 0,
    premium: DAY_TYPES.map((d) => ({ dayType: d, hours: 0, otHours: 0, nsdHours: 0, nsdOtHours: 0 })),
  };
}

export function premiumFor(time: TimeInput, dayType: DayType): DayTypeHours {
  let row = time.premium.find((p) => p.dayType === dayType);
  if (!row) {
    row = { dayType, hours: 0, otHours: 0, nsdHours: 0, nsdOtHours: 0 };
    time.premium.push(row);
  }
  return row;
}

export const ADJ_CODE = "ADJ:";
export const DED_CODE = "DED:";

/** Assemble a full engine input from period context + what the user encoded. */
export function buildInput(ctx: Pick<PeriodContext, "periodInfo" | "config">, emp: EmployeeContext, enc: EncodedEntry): PayrollInput {
  const skipCodes = new Set(enc.skipRecurringCodes ?? []);
  const skipLoans = new Set(enc.skipLoanIds ?? []);
  const adjEarnings: EarningLine[] = emp.adjustments
    .filter((a) => a.adjustment_type !== "deduction")
    .map((a) => ({
      code: ADJ_CODE + a.id,
      label: `Adjustment: ${a.reason}`,
      category: "other",
      amount: a.amount,
      taxTreatment: a.taxable ? "taxable" : "non_taxable",
      includeInSSS: a.taxable,
      includeInPagibig: false,
    }));
  const adjDeductions: OtherDeductionLine[] = emp.adjustments
    .filter((a) => a.adjustment_type === "deduction")
    .map((a) => ({ code: ADJ_CODE + a.id, label: `Adjustment: ${a.reason}`, amount: a.amount, reference: "Approved payroll adjustment" }));
  return {
    employee: emp.profile,
    period: ctx.periodInfo,
    mode: enc.mode,
    manualReason: enc.manualReason,
    time: enc.time,
    earnings: [
      ...emp.recurringEarnings.filter((e) => !skipCodes.has(e.code)),
      ...emp.commissions.filter((e) => !skipCodes.has(e.code)),
      ...adjEarnings,
      ...enc.extraEarnings,
    ],
    loans: emp.loans.filter((l) => !skipLoans.has(l.loanId)),
    otherDeductions: [...emp.deductions.filter((d) => !skipCodes.has(d.code)), ...adjDeductions, ...enc.extraDeductions],
    overrides: enc.mode === "auto" ? {} : enc.overrides,
    monthToDate: emp.monthToDate,
    yearToDate: emp.yearToDate,
    minimumDailyWage: emp.minimumDailyWage,
    config: ctx.config,
  };
}

const ADVANCE_TYPES = new Set(["cash_advance", "emergency_advance"]);

/** Denormalized columns stored on payroll_items for reports. */
export function itemTotals(r: PayrollResult) {
  const advanceLoans = r.loans.filter((l) => ADVANCE_TYPES.has(l.loanType));
  const advanceExtra = r.otherDeductions.filter((d) => d.code === "ADVANCE");
  return {
    basic_pay: r.earnings.netBasicPay + r.earnings.paidLeavePay,
    ot_pay: r.earnings.otPay,
    holiday_pay: r.earnings.holidayPay + r.earnings.unworkedHolidayPay,
    rest_day_pay: r.earnings.restDayPay,
    nsd_pay: r.earnings.nsdPay,
    commission: r.earnings.commission,
    allowances: r.earnings.allowances,
    bonus: r.earnings.bonus,
    other_earnings: r.earnings.otherEarnings,
    gross_pay: r.grossPay,
    sss_ee: r.statutory.sssEE + r.statutory.sssMpfEE,
    sss_er: r.statutory.sssER + r.statutory.sssMpfER,
    sss_ec: r.statutory.sssEC,
    philhealth_ee: r.statutory.philhealthEE,
    philhealth_er: r.statutory.philhealthER,
    pagibig_ee: r.statutory.pagibigEE,
    pagibig_er: r.statutory.pagibigER,
    withholding_tax: r.tax.withholdingTax,
    taxable_compensation: r.tax.netTaxable,
    non_taxable_compensation: r.tax.nonTaxableEarnings + r.tax.mweExempt,
    loans: round(r.totalLoans - advanceLoans.reduce((a, l) => a + l.deducted, 0)),
    advances: round(advanceLoans.reduce((a, l) => a + l.deducted, 0) + advanceExtra.reduce((a, d) => a + d.deducted, 0)),
    other_deductions: round(r.totalOtherDeductions - advanceExtra.reduce((a, d) => a + d.deducted, 0)),
    total_deductions: r.totalDeductions,
    net_pay: r.netPay,
    employer_cost: r.employerCost,
    thirteenth_month_basis: r.thirteenthMonthBasis,
    has_errors: r.issues.some((i) => i.level === "error"),
    has_overrides: r.overrides.length > 0,
  };
}
const round = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// Bulk grid ↔ encoded entry
// ---------------------------------------------------------------------------

export const GRID_COLUMNS = [
  { key: "days", label: "Days", hint: "Regular days paid (daily) / hours (hourly)" },
  { key: "absent", label: "Absent", hint: "Absent days (monthly-rated)" },
  { key: "tardy", label: "Late/UT min", hint: "Late + undertime minutes" },
  { key: "ot", label: "OT hrs", hint: "Ordinary-day overtime hours" },
  { key: "nsd", label: "NSD hrs", hint: "Ordinary-day night hours (10PM–6AM)" },
  { key: "rest", label: "Rest day hrs", hint: "Hours worked on rest day" },
  { key: "regHol", label: "Reg hol hrs", hint: "Hours worked on a regular holiday" },
  { key: "spHol", label: "Spcl hrs", hint: "Hours worked on a special non-working day" },
  { key: "unworkedHol", label: "Unworked RH", hint: "Unworked regular holidays (paid)" },
  { key: "commission", label: "Commission", hint: "One-off commission (₱)" },
  { key: "allowance", label: "Allowance", hint: "One-off taxable allowance (₱)" },
  { key: "bonus", label: "Incentive", hint: "One-off taxable incentive (₱)" },
  { key: "advance", label: "Cash adv.", hint: "One-off cash advance deduction (₱)" },
  { key: "otherDed", label: "Other ded.", hint: "One-off other deduction (₱)" },
] as const;
export type GridKey = (typeof GRID_COLUMNS)[number]["key"];

const extraAmt = (lines: { code: string; amount: number }[], code: string) => lines.find((l) => l.code === code)?.amount ?? 0;

export function encodedToGrid(enc: EncodedEntry, salaryType: string): Record<GridKey, number> {
  const p = (d: DayType) => enc.time.premium.find((x) => x.dayType === d);
  return {
    days: salaryType === "hourly" ? enc.time.regularHours : enc.time.regularDays,
    absent: enc.time.absentDays,
    tardy: enc.time.lateMinutes + enc.time.undertimeMinutes,
    ot: p("ordinary")?.otHours ?? 0,
    nsd: p("ordinary")?.nsdHours ?? 0,
    rest: p("rest_day")?.hours ?? 0,
    regHol: p("regular")?.hours ?? 0,
    spHol: p("special")?.hours ?? 0,
    unworkedHol: enc.time.unworkedRegularHolidays,
    commission: extraAmt(enc.extraEarnings, "GRID_COMMISSION"),
    allowance: extraAmt(enc.extraEarnings, "GRID_ALLOWANCE"),
    bonus: extraAmt(enc.extraEarnings, "GRID_INCENTIVE"),
    advance: extraAmt(enc.extraDeductions, "ADVANCE"),
    otherDed: extraAmt(enc.extraDeductions, "GRID_OTHER"),
  };
}

function setExtra<T extends { code: string; amount: number }>(lines: T[], code: string, amount: number, make: () => T): T[] {
  const rest = lines.filter((l) => l.code !== code);
  return amount ? [...rest, { ...make(), amount }] : rest;
}

export function applyGrid(enc: EncodedEntry, salaryType: string, g: Record<GridKey, number>): EncodedEntry {
  const next: EncodedEntry = structuredClone(enc);
  if (salaryType === "hourly") next.time.regularHours = g.days;
  else next.time.regularDays = g.days;
  next.time.absentDays = g.absent;
  // keep the late/undertime split when the total did not change
  if (g.tardy !== enc.time.lateMinutes + enc.time.undertimeMinutes) {
    next.time.lateMinutes = g.tardy;
    next.time.undertimeMinutes = 0;
  }
  premiumFor(next.time, "ordinary").otHours = g.ot;
  premiumFor(next.time, "ordinary").nsdHours = g.nsd;
  premiumFor(next.time, "rest_day").hours = g.rest;
  premiumFor(next.time, "regular").hours = g.regHol;
  premiumFor(next.time, "special").hours = g.spHol;
  next.time.unworkedRegularHolidays = g.unworkedHol;
  const earn = (code: string, label: string, category: EarningLine["category"]) => (): EarningLine => ({
    code, label, category, amount: 0, taxTreatment: "taxable", includeInSSS: true, includeInPagibig: false,
  });
  next.extraEarnings = setExtra(next.extraEarnings, "GRID_COMMISSION", g.commission, earn("GRID_COMMISSION", "Commission", "commission"));
  next.extraEarnings = setExtra(next.extraEarnings, "GRID_ALLOWANCE", g.allowance, earn("GRID_ALLOWANCE", "Allowance", "allowance"));
  next.extraEarnings = setExtra(next.extraEarnings, "GRID_INCENTIVE", g.bonus, earn("GRID_INCENTIVE", "Incentive", "incentive"));
  next.extraDeductions = setExtra(next.extraDeductions, "ADVANCE", g.advance, () => ({ code: "ADVANCE", label: "Cash advance", amount: 0, reference: "Encoded in payroll grid" }));
  next.extraDeductions = setExtra(next.extraDeductions, "GRID_OTHER", g.otherDed, () => ({ code: "GRID_OTHER", label: "Other deduction", amount: 0, reference: "" })); // no reference → warning until authorization is recorded
  return next;
}
