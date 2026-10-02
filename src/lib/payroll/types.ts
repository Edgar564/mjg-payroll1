/**
 * MJGarcia Trading payroll engine — shared types.
 *
 * The engine is pure TypeScript: no database, no UI. Every statutory number it
 * uses arrives through `StatutoryConfig`, which the app loads from dated
 * configuration rows (see supabase/migrations). Nothing here hard-codes a rate.
 */

export type PayFrequency = "daily" | "weekly" | "semi_monthly" | "monthly";
export type SalaryType = "monthly" | "daily" | "hourly";
export type PayrollMode = "auto" | "hybrid" | "manual";

/** Day classifications used for premium / OT / NSD multipliers. */
export type DayType =
  | "ordinary"
  | "rest_day"
  | "special"
  | "special_rest"
  | "regular"
  | "regular_rest"
  | "double"
  | "double_rest";

export const DAY_TYPE_LABELS: Record<DayType, string> = {
  ordinary: "Ordinary day",
  rest_day: "Rest day",
  special: "Special non-working day",
  special_rest: "Special day + rest day",
  regular: "Regular holiday",
  regular_rest: "Regular holiday + rest day",
  double: "Double regular holiday",
  double_rest: "Double holiday + rest day",
};

/** BIR treatment of an earning line. */
export type TaxTreatment =
  | "taxable" // regular/supplementary taxable compensation
  | "non_taxable" // exempt (e.g. de minimis within limits)
  | "de_minimis"
  | "other_benefit"; // 13th month & other benefits — taxable only above the annual threshold

// ---------------------------------------------------------------------------
// Configuration (loaded from statutory_configurations for the period date)
// ---------------------------------------------------------------------------

export interface SSSBracket {
  /** Monthly compensation lower bound (inclusive). */
  rangeFrom: number;
  /** Upper bound (inclusive); null = and above. */
  rangeTo: number | null;
  /** Regular Social Security MSC portion. */
  mscRegular: number;
  /** Mandatory Provident Fund (WISP) MSC portion. */
  mscMpf: number;
  ec: number;
}

export interface SSSConfig {
  configId?: string;
  effectiveFrom: string;
  eeRate: number; // e.g. 0.05
  erRate: number; // e.g. 0.10
  brackets: SSSBracket[];
  source?: string;
}

export interface PhilHealthConfig {
  configId?: string;
  effectiveFrom: string;
  rate: number; // total premium rate, e.g. 0.05
  floor: number; // monthly basic salary floor
  ceiling: number;
  eeShare: number; // fraction of premium paid by employee, e.g. 0.5
  source?: string;
}

export interface PagIbigTier {
  upTo: number | null; // monthly compensation upper bound inclusive (null = above)
  eeRate: number;
  erRate: number;
}

export interface PagIbigConfig {
  configId?: string;
  effectiveFrom: string;
  maxFundSalary: number;
  tiers: PagIbigTier[];
  source?: string;
}

export interface TaxBracket {
  over: number; // compensation level the bracket starts at
  fixed: number;
  rate: number; // applied to excess over `over`
}

export interface BIRConfig {
  configId?: string;
  effectiveFrom: string;
  tables: Record<PayFrequency | "annual", TaxBracket[]>;
  otherBenefitsThreshold: number; // 13th month & other benefits exemption (annual)
  source?: string;
}

export interface PayRateConfig {
  configId?: string;
  effectiveFrom: string;
  /** Multiplier applied to hourly rate for the first 8 hours worked on that day type. */
  work: Record<DayType, number>;
  /** Multiplier applied to hourly rate for overtime hours on that day type. */
  ot: Record<DayType, number>;
  nsdRate: number; // e.g. 0.10
  /** Multiplier for an UNWORKED regular holiday (typically 1.00). */
  unworkedRegularHoliday: number;
  source?: string;
}

export interface CompanyPolicy {
  hoursPerDay: number; // e.g. 8
  /** Days per year used to convert monthly → daily (313, 261, 365 …). */
  workDaysPerYear: number;
  /** How monthly contributions are spread across a semi-monthly / weekly month. */
  contributionSchedule: "split_trueup" | "last_period";
  /** Below this net pay, loans/other deductions are deferred automatically. */
  minimumNetPay: number;
  /** Warn when total deductions exceed this fraction of gross. */
  excessiveDeductionRatio: number;
  /** For monthly-rated staff: holiday/rest-day work paid as premium only (base already in salary). */
  monthlyRatedPremiumOnly: boolean;
}

export interface StatutoryConfig {
  sss: SSSConfig | null;
  philhealth: PhilHealthConfig | null;
  pagibig: PagIbigConfig | null;
  bir: BIRConfig | null;
  payRates: PayRateConfig | null;
  policy: CompanyPolicy;
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface EmployeePayProfile {
  id: string;
  name?: string;
  salaryType: SalaryType;
  monthlyRate?: number | null;
  dailyRate?: number | null;
  hourlyRate?: number | null;
  isMinimumWageEarner: boolean;
  otEligible: boolean;
  nsdEligible: boolean;
  holidayPayEligible: boolean;
  /** Turn statutory contributions off for a specific employee (e.g. not yet registered). */
  sssCovered?: boolean;
  philhealthCovered?: boolean;
  pagibigCovered?: boolean;
}

export interface PeriodInfo {
  start: string; // ISO date
  end: string;
  payDate: string;
  frequency: PayFrequency;
  /** Number of payroll periods that make up the contribution month (2 for semi-monthly). */
  periodsInMonth: number;
  /** True if this is the last payroll period of the month (true-up happens here). */
  isLastPeriodOfMonth: boolean;
}

export interface DayTypeHours {
  dayType: DayType;
  /** Normal hours worked on this day type (not counted in regularDays). Ignored for "ordinary". */
  hours: number;
  otHours: number;
  nsdHours: number;
  nsdOtHours: number;
}

export interface TimeInput {
  /** Days paid at the basic daily rate (daily-rated). Excludes holiday/rest-day work entered in `premium`. */
  regularDays: number;
  /** Hours paid at the basic hourly rate (hourly-rated). */
  regularHours: number;
  absentDays: number;
  lateMinutes: number;
  undertimeMinutes: number;
  paidLeaveDays: number;
  /** Unworked regular holidays the employee is entitled to be paid for. */
  unworkedRegularHolidays: number;
  premium: DayTypeHours[];
}

export interface EarningLine {
  code: string; // e.g. ALLOW_TRANSPO, COMMISSION, BONUS
  label: string;
  category: "allowance" | "commission" | "bonus" | "incentive" | "other";
  amount: number;
  taxTreatment: TaxTreatment;
  includeInSSS: boolean;
  includeInPagibig: boolean;
}

export interface LoanLine {
  loanId: string;
  label: string;
  loanType: string;
  scheduledAmount: number; // installment
  balance: number;
  /** Lower number = deferred last when protecting net pay. */
  priority?: number;
}

export interface OtherDeductionLine {
  code: string;
  label: string;
  amount: number;
  reference?: string; // employee authorization / reference
}

export interface ComponentOverride {
  amount: number;
  reason: string;
}

/** Contribution activity already recorded in other payroll periods of the same month. */
export interface MonthToDate {
  sssCompensation: number;
  philhealthBasic: number;
  pagibigCompensation: number;
  sssEE: number;
  sssER: number;
  sssEC: number;
  sssMpfEE: number;
  sssMpfER: number;
  philhealthEE: number;
  philhealthER: number;
  pagibigEE: number;
  pagibigER: number;
}

export interface YearToDate {
  taxableCompensation: number;
  taxWithheld: number;
  otherBenefits: number; // 13th month & other benefits already paid this year
}

export interface PayrollInput {
  employee: EmployeePayProfile;
  period: PeriodInfo;
  mode: PayrollMode;
  time: TimeInput;
  earnings: EarningLine[];
  loans: LoanLine[];
  otherDeductions: OtherDeductionLine[];
  /** Keys: see OverrideKey. Required to carry a reason. */
  overrides: Partial<Record<string, ComponentOverride>>;
  /** Required when mode = "manual". */
  manualReason?: string;
  monthToDate?: MonthToDate;
  yearToDate?: YearToDate;
  /** Applicable daily minimum wage for the employee's work location, if known. */
  minimumDailyWage?: number | null;
  config: StatutoryConfig;
}

export const OVERRIDE_KEYS = [
  "basic_pay",
  "absence_deduction",
  "tardiness_deduction",
  "ot_pay",
  "holiday_pay",
  "rest_day_pay",
  "nsd_pay",
  "sss_ee",
  "sss_mpf_ee",
  "sss_er",
  "sss_mpf_er",
  "sss_ec",
  "philhealth_ee",
  "philhealth_er",
  "pagibig_ee",
  "pagibig_er",
  "withholding_tax",
] as const;
export type OverrideKey = (typeof OVERRIDE_KEYS)[number] | `loan:${string}`;

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export interface TraceLine {
  step: string;
  label: string;
  detail: string;
  amount?: number;
}

export interface OverrideRecord {
  key: string;
  automatic: number;
  manual: number;
  variance: number;
  reason: string;
}

export interface ValidationIssue {
  level: "error" | "warning";
  code: string;
  message: string;
}

export interface PayrollResult {
  rates: { monthly: number; daily: number; hourly: number };
  earnings: {
    basicPay: number;
    absenceDeduction: number;
    tardinessDeduction: number;
    netBasicPay: number;
    paidLeavePay: number;
    unworkedHolidayPay: number;
    otPay: number;
    holidayPay: number;
    restDayPay: number;
    nsdPay: number;
    commission: number;
    allowances: number;
    bonus: number;
    otherEarnings: number;
    lines: EarningLine[];
  };
  grossPay: number;
  statutory: {
    /** This period's own contribution bases (used as month-to-date by the next period). */
    sssPeriodBasis: number;
    philhealthPeriodBasis: number;
    pagibigPeriodBasis: number;
    sssBasis: number;
    sssMsc: number;
    sssEE: number;
    sssMpfEE: number;
    sssER: number;
    sssMpfER: number;
    sssEC: number;
    philhealthBasis: number;
    philhealthEE: number;
    philhealthER: number;
    pagibigBasis: number;
    pagibigEE: number;
    pagibigER: number;
    totalEE: number;
    totalER: number;
  };
  tax: {
    taxableEarnings: number;
    nonTaxableEarnings: number;
    otherBenefitsTaxablePortion: number;
    mweExempt: number;
    netTaxable: number;
    withholdingTax: number;
    ytdTaxable: number;
    ytdWithheld: number;
  };
  loans: { loanId: string; label: string; loanType: string; scheduled: number; deducted: number; deferred: number }[];
  otherDeductions: (OtherDeductionLine & { deducted: number; deferred: number })[];
  totalLoans: number;
  totalOtherDeductions: number;
  totalDeductions: number;
  netPay: number;
  employerCost: number;
  /** Basic salary actually earned this period that counts toward 13th month. */
  thirteenthMonthBasis: number;
  overrides: OverrideRecord[];
  issues: ValidationIssue[];
  trace: TraceLine[];
}
