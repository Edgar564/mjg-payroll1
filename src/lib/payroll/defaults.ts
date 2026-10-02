/**
 * Reference values used to SEED the statutory configuration tables and to run
 * automated tests. The engine never imports this file — it only reads the
 * configuration rows stored in the database for the payroll period.
 *
 * Verify against the latest official issuance before relying on them.
 */
import { buildSSSBrackets } from "./statutory";
import type { BIRConfig, CompanyPolicy, PagIbigConfig, PayRateConfig, PhilHealthConfig, SSSConfig, StatutoryConfig } from "./types";

export const SSS_2025: SSSConfig = {
  effectiveFrom: "2025-01-01",
  eeRate: 0.05,
  erRate: 0.1,
  brackets: buildSSSBrackets({ minMsc: 5000, maxMsc: 35000, step: 500, regularCap: 20000, ecLow: 10, ecHigh: 30, ecThreshold: 15000 }),
  source: "SSS Circular No. 2024-006 (RA 11199) — 15% rate, MSC ₱5,000–₱35,000, effective January 2025",
};

export const PHILHEALTH_2024: PhilHealthConfig = {
  effectiveFrom: "2024-01-01",
  rate: 0.05,
  floor: 10000,
  ceiling: 100000,
  eeShare: 0.5,
  source: "RA 11223 (UHC Act) premium schedule; PhilHealth Advisory — 5%, ₱10,000 floor, ₱100,000 ceiling",
};

export const PAGIBIG_2024: PagIbigConfig = {
  effectiveFrom: "2024-02-01",
  maxFundSalary: 10000,
  tiers: [
    { upTo: 1500, eeRate: 0.01, erRate: 0.02 },
    { upTo: null, eeRate: 0.02, erRate: 0.02 },
  ],
  source: "RA 9679; HDMF Circular No. 460 — Maximum Fund Salary ₱10,000",
};

export const BIR_2023: BIRConfig = {
  effectiveFrom: "2023-01-01",
  otherBenefitsThreshold: 90000,
  tables: {
    daily: [
      { over: 0, fixed: 0, rate: 0 },
      { over: 685, fixed: 0, rate: 0.15 },
      { over: 1096, fixed: 61.65, rate: 0.2 },
      { over: 2192, fixed: 280.85, rate: 0.25 },
      { over: 5479, fixed: 1102.6, rate: 0.3 },
      { over: 21918, fixed: 6034.3, rate: 0.35 },
    ],
    weekly: [
      { over: 0, fixed: 0, rate: 0 },
      { over: 4808, fixed: 0, rate: 0.15 },
      { over: 7692, fixed: 432.6, rate: 0.2 },
      { over: 15385, fixed: 1971.2, rate: 0.25 },
      { over: 38462, fixed: 7740.45, rate: 0.3 },
      { over: 153846, fixed: 42355.65, rate: 0.35 },
    ],
    semi_monthly: [
      { over: 0, fixed: 0, rate: 0 },
      { over: 10417, fixed: 0, rate: 0.15 },
      { over: 16667, fixed: 937.5, rate: 0.2 },
      { over: 33333, fixed: 4270.7, rate: 0.25 },
      { over: 83333, fixed: 16770.7, rate: 0.3 },
      { over: 333333, fixed: 91770.7, rate: 0.35 },
    ],
    monthly: [
      { over: 0, fixed: 0, rate: 0 },
      { over: 20833, fixed: 0, rate: 0.15 },
      { over: 33333, fixed: 1875, rate: 0.2 },
      { over: 66667, fixed: 8541.8, rate: 0.25 },
      { over: 166667, fixed: 33541.8, rate: 0.3 },
      { over: 666667, fixed: 183541.8, rate: 0.35 },
    ],
    annual: [
      { over: 0, fixed: 0, rate: 0 },
      { over: 250000, fixed: 0, rate: 0.15 },
      { over: 400000, fixed: 22500, rate: 0.2 },
      { over: 800000, fixed: 102500, rate: 0.25 },
      { over: 2000000, fixed: 402500, rate: 0.3 },
      { over: 8000000, fixed: 2202500, rate: 0.35 },
    ],
  },
  source: "RR 11-2018 Annex E — Revised Withholding Tax Table effective January 1, 2023; RA 10963 (TRAIN) — ₱90,000 13th month/other benefits exemption",
};

export const PAY_RATES_DOLE: PayRateConfig = {
  effectiveFrom: "2018-01-01",
  work: {
    ordinary: 1.0,
    rest_day: 1.3,
    special: 1.3,
    special_rest: 1.5,
    regular: 2.0,
    regular_rest: 2.6,
    double: 3.0,
    double_rest: 3.9,
  },
  ot: {
    ordinary: 1.25,
    rest_day: 1.69,
    special: 1.69,
    special_rest: 1.95,
    regular: 2.6,
    regular_rest: 3.38,
    double: 3.9,
    double_rest: 5.07,
  },
  nsdRate: 0.1,
  unworkedRegularHoliday: 1.0,
  source: "Labor Code Arts. 86, 87, 93, 94; DOLE Handbook on Workers' Statutory Monetary Benefits",
};

export const DEFAULT_POLICY: CompanyPolicy = {
  hoursPerDay: 8,
  workDaysPerYear: 313,
  contributionSchedule: "split_trueup",
  minimumNetPay: 0,
  excessiveDeductionRatio: 0.5,
  monthlyRatedPremiumOnly: true,
};

export const DEFAULT_CONFIG: StatutoryConfig = {
  sss: SSS_2025,
  philhealth: PHILHEALTH_2024,
  pagibig: PAGIBIG_2024,
  bir: BIR_2023,
  payRates: PAY_RATES_DOLE,
  policy: DEFAULT_POLICY,
};
