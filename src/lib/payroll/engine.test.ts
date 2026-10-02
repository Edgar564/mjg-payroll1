import { describe, expect, it } from "vitest";
import { calculatePayroll, calculate13thMonth, hasBlockingIssues } from "./engine";
import { calculatePagIBIG, calculatePhilHealth, calculateSSS, otherBenefitsTaxablePortion, yearEndAdjustment } from "./statutory";
import { DEFAULT_CONFIG, SSS_2025, PHILHEALTH_2024, PAGIBIG_2024, BIR_2023 } from "./defaults";
import { r2 } from "./money";
import type { DayTypeHours, PayrollInput } from "./types";

const noTime = { regularDays: 0, regularHours: 0, absentDays: 0, lateMinutes: 0, undertimeMinutes: 0, paidLeaveDays: 0, unworkedRegularHolidays: 0, premium: [] as DayTypeHours[] };
const prem = (p: Partial<DayTypeHours> & { dayType: DayTypeHours["dayType"] }): DayTypeHours => ({ hours: 0, otHours: 0, nsdHours: 0, nsdOtHours: 0, ...p });

function juan(over: Partial<PayrollInput> = {}): PayrollInput {
  return {
    employee: { id: "juan", name: "Juan Dela Cruz (TEST)", salaryType: "daily", dailyRate: 700, isMinimumWageEarner: false, otEligible: true, nsdEligible: true, holidayPayEligible: true },
    period: { start: "2026-10-01", end: "2026-10-15", payDate: "2026-10-15", frequency: "semi_monthly", periodsInMonth: 2, isLastPeriodOfMonth: false },
    mode: "auto",
    time: { ...noTime, regularDays: 12 },
    earnings: [],
    loans: [],
    otherDeductions: [],
    overrides: {},
    config: DEFAULT_CONFIG,
    ...over,
  };
}

function monthly30k(over: Partial<PayrollInput> = {}): PayrollInput {
  return juan({
    employee: { id: "ana", salaryType: "monthly", monthlyRate: 30000, isMinimumWageEarner: false, otEligible: true, nsdEligible: true, holidayPayEligible: true },
    period: { start: "2026-10-01", end: "2026-10-31", payDate: "2026-10-31", frequency: "monthly", periodsInMonth: 1, isLastPeriodOfMonth: true },
    time: { ...noTime },
    ...over,
  });
}

describe("statutory tables", () => {
  it("SSS: bracket lookup, MPF split and EC", () => {
    expect(calculateSSS(3000, SSS_2025)).toMatchObject({ msc: 5000, ee: 250, er: 500, ec: 10 });
    expect(calculateSSS(5249.99, SSS_2025).msc).toBe(5000);
    expect(calculateSSS(5250, SSS_2025).msc).toBe(5500);
    expect(calculateSSS(14800, SSS_2025)).toMatchObject({ msc: 15000, ec: 30 });
    expect(calculateSSS(30000, SSS_2025)).toMatchObject({ mscRegular: 20000, mscMpf: 10000, ee: 1000, mpfEE: 500, er: 2000, mpfER: 1000, ec: 30 });
    expect(calculateSSS(99999, SSS_2025).msc).toBe(35000);
    expect(SSS_2025.brackets).toHaveLength(61);
  });
  it("PhilHealth: floor, ceiling, 50/50", () => {
    expect(calculatePhilHealth(8000, PHILHEALTH_2024)).toMatchObject({ basis: 10000, premium: 500, ee: 250, er: 250 });
    expect(calculatePhilHealth(25000, PHILHEALTH_2024)).toMatchObject({ premium: 1250, ee: 625, er: 625 });
    expect(calculatePhilHealth(150000, PHILHEALTH_2024)).toMatchObject({ premium: 5000, ee: 2500 });
  });
  it("Pag-IBIG: 1%/2% tier and ₱10,000 MFS", () => {
    expect(calculatePagIBIG(1500, PAGIBIG_2024)).toMatchObject({ ee: 15, er: 30 });
    expect(calculatePagIBIG(6500, PAGIBIG_2024)).toMatchObject({ ee: 130, er: 130 });
    expect(calculatePagIBIG(30000, PAGIBIG_2024)).toMatchObject({ ee: 200, er: 200 });
  });
  it("BIR annual tax and year-end adjustment", () => {
    expect(yearEndAdjustment(500000, 20000, BIR_2023)).toMatchObject({ annualTax: 42500, adjustment: 22500 });
    expect(yearEndAdjustment(240000, 1000, BIR_2023)).toMatchObject({ annualTax: 0, adjustment: -1000 });
    expect(yearEndAdjustment(500000, 0, BIR_2023, true).annualTax).toBe(0);
  });
  it("13th month / other benefits ₱90,000 threshold", () => {
    expect(otherBenefitsTaxablePortion(85000, 10000, 90000)).toBe(5000);
    expect(otherBenefitsTaxablePortion(0, 18200, 90000)).toBe(0);
    expect(otherBenefitsTaxablePortion(95000, 1000, 90000)).toBe(1000);
  });
});

describe("payroll engine", () => {
  it("1. monthly payroll — ₱30,000 monthly-rated", () => {
    const r = calculatePayroll(monthly30k());
    expect(r.grossPay).toBe(30000);
    expect(r.statutory).toMatchObject({ sssEE: 1000, sssMpfEE: 500, sssER: 2000, sssMpfER: 1000, sssEC: 30, philhealthEE: 750, philhealthER: 750, pagibigEE: 200, pagibigER: 200, totalEE: 2450 });
    expect(r.tax.netTaxable).toBe(27550);
    expect(r.tax.withholdingTax).toBe(1007.55);
    expect(r.netPay).toBe(26542.45);
    expect(r.employerCost).toBe(30000 + 3980);
    expect(hasBlockingIssues(r)).toBe(false);
  });

  it("2. semi-monthly payroll — monthly-rated first cut-off splits contributions", () => {
    const r = calculatePayroll(
      monthly30k({ period: { start: "2026-10-01", end: "2026-10-15", payDate: "2026-10-15", frequency: "semi_monthly", periodsInMonth: 2, isLastPeriodOfMonth: false } })
    );
    expect(r.earnings.basicPay).toBe(15000);
    expect(r.statutory.totalEE).toBe(1225);
    expect(r.tax.withholdingTax).toBe(503.7);
  });

  it("3 & 4. daily employee with overtime and a loan — Juan Dela Cruz TEST DATA", () => {
    const r = calculatePayroll(
      juan({
        time: { ...noTime, regularDays: 12, premium: [prem({ dayType: "ordinary", otHours: 4 })] },
        loans: [{ loanId: "L1", label: "Cash advance", loanType: "cash_advance", scheduledAmount: 500, balance: 1200 }],
      })
    );
    expect(r.rates.hourly).toBe(87.5);
    expect(r.earnings.basicPay).toBe(8400);
    expect(r.earnings.otPay).toBe(437.5);
    expect(r.grossPay).toBe(8837.5);
    expect(r.statutory).toMatchObject({ sssMsc: 17500, sssEE: 437.5, sssER: 875, sssEC: 15, philhealthEE: 210, philhealthER: 210, pagibigEE: 100, pagibigER: 100 });
    expect(r.tax.withholdingTax).toBe(0);
    expect(r.totalLoans).toBe(500);
    expect(r.netPay).toBe(7590);
    expect(r.employerCost).toBe(10037.5);
  });

  it("semi-monthly second cut-off trues up to the full-month contribution", () => {
    const r = calculatePayroll(
      juan({
        period: { start: "2026-10-16", end: "2026-10-31", payDate: "2026-10-31", frequency: "semi_monthly", periodsInMonth: 2, isLastPeriodOfMonth: true },
        time: { ...noTime, regularDays: 13 },
        monthToDate: { sssCompensation: 8837.5, philhealthBasic: 8400, pagibigCompensation: 8400, sssEE: 437.5, sssER: 875, sssEC: 15, sssMpfEE: 0, sssMpfER: 0, philhealthEE: 210, philhealthER: 210, pagibigEE: 100, pagibigER: 100 },
      })
    );
    expect(r.statutory).toMatchObject({ sssMsc: 18000, sssEE: 462.5, sssER: 925, sssEC: 15, philhealthEE: 227.5, pagibigEE: 100 });
    expect(r.statutory.totalEE).toBe(790);
  });

  it("5. holiday pay — worked regular, special, rest-day+regular OT, unworked regular", () => {
    const r = calculatePayroll(
      juan({
        time: {
          ...noTime,
          regularDays: 10,
          unworkedRegularHolidays: 1,
          premium: [prem({ dayType: "regular", hours: 8 }), prem({ dayType: "special", hours: 8 }), prem({ dayType: "regular_rest", otHours: 2 })],
        },
      })
    );
    expect(r.earnings.unworkedHolidayPay).toBe(700);
    expect(r.earnings.holidayPay).toBe(1400 + 910);
    expect(r.earnings.otPay).toBe(591.5);
  });

  it("holiday work by a non-eligible employee falls back to ordinary rate", () => {
    const base = juan();
    const r = calculatePayroll({ ...base, employee: { ...base.employee, holidayPayEligible: false }, time: { ...noTime, premium: [prem({ dayType: "regular", hours: 8 })] } });
    expect(r.earnings.holidayPay).toBe(700);
  });

  it("6. night shift differential", () => {
    const r = calculatePayroll(juan({ time: { ...noTime, regularDays: 12, premium: [prem({ dayType: "ordinary", nsdHours: 4, nsdOtHours: 2, otHours: 2 })] } }));
    expect(r.earnings.nsdPay).toBe(r2(35 + 87.5 * 1.25 * 0.1 * 2));
  });

  it("7 & 8. absence and tardiness for a monthly-rated employee", () => {
    const r = calculatePayroll(
      monthly30k({
        period: { start: "2026-10-01", end: "2026-10-15", payDate: "2026-10-15", frequency: "semi_monthly", periodsInMonth: 2, isLastPeriodOfMonth: false },
        time: { ...noTime, absentDays: 2, lateMinutes: 45, undertimeMinutes: 15 },
      })
    );
    expect(r.earnings.absenceDeduction).toBe(2300.32);
    expect(r.earnings.tardinessDeduction).toBe(143.77);
    expect(r.earnings.netBasicPay).toBe(r2(15000 - 2300.32 - 143.77));
    // PhilHealth stays on the monthly basic salary
    expect(r.statutory.philhealthEE).toBe(375);
  });

  it("minimum wage earner: basic/OT exempt, other compensation taxed", () => {
    const base = juan();
    const r = calculatePayroll({
      ...base,
      employee: { ...base.employee, dailyRate: 550, isMinimumWageEarner: true },
      earnings: [{ code: "COMM", label: "Sales commission", category: "commission", amount: 12000, taxTreatment: "taxable", includeInSSS: true, includeInPagibig: false }],
    });
    expect(r.tax.mweExempt).toBe(6600);
    expect(r.tax.netTaxable).toBe(12000);
    expect(r.tax.withholdingTax).toBe(237.45);
    expect(r.earnings.commission).toBe(12000);
  });

  it("non-taxable allowance stays out of tax and SSS when flagged", () => {
    const r = calculatePayroll(
      juan({ earnings: [{ code: "RICE", label: "Rice allowance", category: "allowance", amount: 1000, taxTreatment: "de_minimis", includeInSSS: false, includeInPagibig: false }] })
    );
    expect(r.grossPay).toBe(9400);
    expect(r.tax.nonTaxableEarnings).toBe(1000);
    expect(r.statutory.sssBasis).toBe(16800);
  });

  it("15. manual override requires a reason and records variance (hybrid)", () => {
    const ok = calculatePayroll(juan({ mode: "hybrid", overrides: { sss_ee: { amount: 300, reason: "Per SSS R-3 correction" } } }));
    expect(ok.statutory.sssEE).toBe(300);
    expect(ok.overrides[0]).toMatchObject({ key: "sss_ee", automatic: 425, manual: 300, variance: -125 });
    expect(hasBlockingIssues(ok)).toBe(false);

    const noReason = calculatePayroll(juan({ mode: "hybrid", overrides: { sss_ee: { amount: 300, reason: "" } } }));
    expect(noReason.issues.some((i) => i.code === "OVERRIDE_REASON_REQUIRED")).toBe(true);

    const auto = calculatePayroll(juan({ mode: "auto", overrides: { sss_ee: { amount: 300, reason: "x" } } }));
    expect(auto.statutory.sssEE).toBe(425);
  });

  it("manual mode: encoded basic pay flows into contributions and requires a reason", () => {
    const r = calculatePayroll(juan({ mode: "manual", manualReason: "Paper timesheet", overrides: { basic_pay: { amount: 5000, reason: "" } } }));
    expect(r.earnings.basicPay).toBe(5000);
    expect(r.statutory.sssBasis).toBe(10000);
    expect(r.overrides[0].reason).toBe("Paper timesheet");
    const missing = calculatePayroll(juan({ mode: "manual", overrides: {} }));
    expect(missing.issues.some((i) => i.code === "MANUAL_REASON_REQUIRED")).toBe(true);
  });

  it("16. negative net pay protection defers other deductions, then loans", () => {
    const r = calculatePayroll(
      juan({
        time: { ...noTime, regularDays: 2 },
        loans: [{ loanId: "L1", label: "Salary loan", loanType: "salary_loan", scheduledAmount: 2000, balance: 5000 }],
        otherDeductions: [{ code: "UNIFORM", label: "Uniform", amount: 500, reference: "Signed auth #12" }],
      })
    );
    expect(r.statutory.totalEE).toBe(278);
    expect(r.otherDeductions[0]).toMatchObject({ deducted: 0, deferred: 500 });
    expect(r.loans[0]).toMatchObject({ deducted: 1122, deferred: 878 });
    expect(r.netPay).toBe(0);
    expect(hasBlockingIssues(r)).toBe(false);
  });

  it("loan deduction never exceeds remaining balance", () => {
    const r = calculatePayroll(juan({ loans: [{ loanId: "L1", label: "Cash advance", loanType: "cash_advance", scheduledAmount: 500, balance: 120 }] }));
    expect(r.totalLoans).toBe(120);
  });

  it("missing configuration blocks the calculation", () => {
    const r = calculatePayroll(juan({ config: { ...DEFAULT_CONFIG, sss: null } }));
    expect(r.issues.find((i) => i.code === "MISSING_SSS_CONFIG")?.level).toBe("error");
  });

  it("missing salary blocks the calculation", () => {
    const base = juan();
    const r = calculatePayroll({ ...base, employee: { ...base.employee, dailyRate: 0 } });
    expect(r.issues.some((i) => i.code === "MISSING_SALARY")).toBe(true);
  });

  it("13. 13th month = total basic ÷ 12, with pro-rating and adjustment", () => {
    expect(calculate13thMonth({ monthlyBasic: Array(12).fill(18200) }).thirteenthMonth).toBe(18200);
    const separated = calculate13thMonth({ monthlyBasic: [18200, 18200, 18200, 9100], adjustment: 50 });
    expect(separated.computed).toBe(r2(63700 / 12));
    expect(separated.thirteenthMonth).toBe(r2(63700 / 12 + 50));
  });

  it("13th month paid in payroll: excess over ₱90,000 YTD becomes taxable", () => {
    const r = calculatePayroll(
      monthly30k({
        yearToDate: { taxableCompensation: 300000, taxWithheld: 10000, otherBenefits: 85000 },
        earnings: [{ code: "13TH", label: "13th month pay", category: "bonus", amount: 30000, taxTreatment: "other_benefit", includeInSSS: false, includeInPagibig: false }],
      })
    );
    expect(r.tax.otherBenefitsTaxablePortion).toBe(25000);
    expect(r.tax.netTaxable).toBe(27550 + 25000);
  });
});
