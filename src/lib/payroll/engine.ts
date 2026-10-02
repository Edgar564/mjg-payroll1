import { r2, sum, peso } from "./money";
import {
  calculatePagIBIG,
  calculatePhilHealth,
  calculateSSS,
  calculateWithholdingTax,
  otherBenefitsTaxablePortion,
} from "./statutory";
import type {
  DayType,
  EarningLine,
  MonthToDate,
  OverrideRecord,
  PayFrequency,
  PayrollInput,
  PayrollResult,
  TraceLine,
  ValidationIssue,
} from "./types";
import { DAY_TYPE_LABELS } from "./types";

const HOLIDAY_TYPES: DayType[] = ["special", "special_rest", "regular", "regular_rest", "double", "double_rest"];
/** Day types whose unworked pay is already inside a monthly salary. */
const PAID_IN_MONTHLY: DayType[] = ["regular", "regular_rest", "double", "double_rest"];

export const EMPTY_MTD: MonthToDate = {
  sssCompensation: 0,
  philhealthBasic: 0,
  pagibigCompensation: 0,
  sssEE: 0,
  sssER: 0,
  sssEC: 0,
  sssMpfEE: 0,
  sssMpfER: 0,
  philhealthEE: 0,
  philhealthER: 0,
  pagibigEE: 0,
  pagibigER: 0,
};

// ---------------------------------------------------------------------------
// Rates
// ---------------------------------------------------------------------------

export function calculateRates(input: Pick<PayrollInput, "employee" | "config">) {
  const { employee: e, config } = input;
  const { hoursPerDay, workDaysPerYear } = config.policy;
  let monthly = 0,
    daily = 0,
    hourly = 0;
  if (e.salaryType === "monthly") {
    monthly = e.monthlyRate ?? 0;
    daily = (monthly * 12) / workDaysPerYear;
    hourly = daily / hoursPerDay;
  } else if (e.salaryType === "daily") {
    daily = e.dailyRate ?? 0;
    monthly = (daily * workDaysPerYear) / 12;
    hourly = daily / hoursPerDay;
  } else {
    hourly = e.hourlyRate ?? 0;
    daily = hourly * hoursPerDay;
    monthly = (daily * workDaysPerYear) / 12;
  }
  return { monthly, daily, hourly };
}

export function periodBasicForMonthly(monthly: number, frequency: PayFrequency, workDaysPerYear: number): number {
  switch (frequency) {
    case "monthly":
      return monthly;
    case "semi_monthly":
      return monthly / 2;
    case "weekly":
      return (monthly * 12) / 52;
    case "daily":
      return (monthly * 12) / workDaysPerYear;
  }
}

// ---------------------------------------------------------------------------
// Main calculation
// ---------------------------------------------------------------------------

export function calculatePayroll(input: PayrollInput): PayrollResult {
  const issues: ValidationIssue[] = [];
  const trace: TraceLine[] = [];
  const overrides: OverrideRecord[] = [];
  const { employee: emp, period, config, time, mode } = input;
  const policy = config.policy;
  const mtd = input.monthToDate ?? EMPTY_MTD;
  const ytd = input.yearToDate ?? { taxableCompensation: 0, taxWithheld: 0, otherBenefits: 0 };
  const isMonthlyRated = emp.salaryType === "monthly";

  const t = (step: string, label: string, detail: string, amount?: number) =>
    trace.push({ step, label, detail, amount: amount === undefined ? undefined : r2(amount) });

  if (mode === "manual" && !input.manualReason?.trim()) {
    issues.push({ level: "error", code: "MANUAL_REASON_REQUIRED", message: "Manual encoding requires a reason." });
  }

  /** Apply an override (hybrid/manual) to an automatically computed value. */
  const ov = (key: string, automatic: number): number => {
    const auto = r2(automatic);
    const o = input.overrides[key];
    if (mode === "auto") {
      if (o) issues.push({ level: "warning", code: "OVERRIDE_IGNORED", message: `Override for ${key} ignored in Auto mode.` });
      return auto;
    }
    if (!o) {
      if (mode === "manual" && !key.startsWith("loan:")) return auto; // UI pre-fills manual values with automatic ones
      return auto;
    }
    const reason = (o.reason || (mode === "manual" ? input.manualReason : "") || "").trim();
    const manual = r2(o.amount);
    if (!Number.isFinite(o.amount) || manual < 0) {
      issues.push({ level: "error", code: "INVALID_OVERRIDE", message: `Manual amount for ${key} must be zero or more.` });
      return auto;
    }
    if (manual !== auto) {
      if (!reason) {
        issues.push({ level: "error", code: "OVERRIDE_REASON_REQUIRED", message: `Reason for manual adjustment is required (${key}).` });
      }
      overrides.push({ key, automatic: auto, manual, variance: r2(manual - auto), reason });
      t("Override", key, `Automatic ${peso(auto)} → manual ${peso(manual)} (variance ${peso(manual - auto)}). Reason: ${reason || "—"}`, manual);
    }
    return manual;
  };

  // ---- STEP 1 Salary basis -------------------------------------------------
  const rates = calculateRates(input);
  const rateMissing =
    (emp.salaryType === "monthly" && !(emp.monthlyRate! > 0)) ||
    (emp.salaryType === "daily" && !(emp.dailyRate! > 0)) ||
    (emp.salaryType === "hourly" && !(emp.hourlyRate! > 0));
  if (rateMissing && mode !== "manual") {
    issues.push({
      level: "error",
      code: "MISSING_SALARY",
      message: "Payroll cannot be calculated because the employee has no salary rate configured.",
    });
  }
  t(
    "1 Salary basis",
    `${emp.salaryType} rated`,
    `Monthly ${peso(rates.monthly)} · Daily ${peso(rates.daily)} · Hourly ${peso(rates.hourly)} (factor ${policy.workDaysPerYear} days/yr, ${policy.hoursPerDay} hrs/day)`
  );

  if (input.minimumDailyWage && rates.daily > 0 && rates.daily + 0.005 < input.minimumDailyWage) {
    issues.push({
      level: "warning",
      code: "BELOW_MINIMUM_WAGE",
      message: `Daily rate ${peso(rates.daily)} is below the applicable minimum wage ${peso(input.minimumDailyWage)}.`,
    });
  }
  for (const [k, v] of Object.entries(time)) {
    if (typeof v === "number" && v < 0) issues.push({ level: "error", code: "NEGATIVE_INPUT", message: `${k} cannot be negative.` });
  }

  // ---- STEP 2 Basic pay ----------------------------------------------------
  let autoBasic = 0;
  if (isMonthlyRated) {
    autoBasic = periodBasicForMonthly(rates.monthly, period.frequency, policy.workDaysPerYear);
    t("2 Basic pay", "Monthly-rated", `${peso(rates.monthly)} for a ${period.frequency.replace("_", "-")} period`, autoBasic);
  } else if (emp.salaryType === "daily") {
    autoBasic = rates.daily * time.regularDays;
    t("2 Basic pay", "Daily-rated", `${peso(rates.daily)} × ${time.regularDays} day(s)`, autoBasic);
  } else {
    autoBasic = rates.hourly * time.regularHours;
    t("2 Basic pay", "Hourly-rated", `${peso(rates.hourly)} × ${time.regularHours} hour(s)`, autoBasic);
  }
  const basicPay = ov("basic_pay", autoBasic);

  let paidLeavePay = 0;
  if (!isMonthlyRated && time.paidLeaveDays > 0) {
    paidLeavePay = r2(rates.daily * time.paidLeaveDays);
    t("2 Basic pay", "Paid leave", `${peso(rates.daily)} × ${time.paidLeaveDays} day(s)`, paidLeavePay);
  }
  let unworkedHolidayPay = 0;
  if (!isMonthlyRated && time.unworkedRegularHolidays > 0) {
    if (emp.holidayPayEligible && config.payRates) {
      unworkedHolidayPay = r2(rates.daily * config.payRates.unworkedRegularHoliday * time.unworkedRegularHolidays);
      t(
        "5 Holiday pay",
        "Unworked regular holiday",
        `${peso(rates.daily)} × ${config.payRates.unworkedRegularHoliday * 100}% × ${time.unworkedRegularHolidays} day(s)`,
        unworkedHolidayPay
      );
    } else if (!emp.holidayPayEligible) {
      issues.push({ level: "warning", code: "HOLIDAY_NOT_ELIGIBLE", message: "Unworked holidays entered but employee is not holiday-pay eligible." });
    }
  }

  // ---- STEP 3 Attendance deductions --------------------------------------
  let autoAbsence = 0;
  if (isMonthlyRated && time.absentDays > 0) {
    autoAbsence = rates.daily * time.absentDays;
    t("3 Attendance", "Absences", `${peso(rates.daily)} × ${time.absentDays} day(s)`, -autoAbsence);
  }
  const absenceDeduction = ov("absence_deduction", autoAbsence);
  let autoTardy = 0;
  const tardyMinutes = (time.lateMinutes || 0) + (time.undertimeMinutes || 0);
  if (emp.salaryType !== "hourly" && tardyMinutes > 0) {
    autoTardy = (rates.hourly * tardyMinutes) / 60;
    t("3 Attendance", "Late + undertime", `${peso(rates.hourly)} × ${tardyMinutes} min ÷ 60`, -autoTardy);
  }
  const tardinessDeduction = ov("tardiness_deduction", autoTardy);
  const netBasicPay = r2(basicPay - absenceDeduction - tardinessDeduction);
  if (netBasicPay < 0) {
    issues.push({ level: "error", code: "NEGATIVE_BASIC", message: "Absence and tardiness deductions exceed basic pay." });
  }

  // ---- STEPS 4–7 OT, holiday, rest day, NSD -------------------------------
  let autoOT = 0,
    autoHoliday = 0,
    autoRest = 0,
    autoNSD = 0;
  const pr = config.payRates;
  const hasPremiumHours = time.premium.some((p) => p.hours || p.otHours || p.nsdHours || p.nsdOtHours);
  if (hasPremiumHours && !pr) {
    issues.push({ level: "error", code: "MISSING_PAY_RATE_CONFIG", message: "No pay rate (OT/holiday) configuration covers this period." });
  }
  if (pr) {
    for (const p of time.premium) {
      const label = DAY_TYPE_LABELS[p.dayType];
      const isHoliday = HOLIDAY_TYPES.includes(p.dayType);
      let workMult = pr.work[p.dayType];
      let otMult = pr.ot[p.dayType];
      if (isHoliday && !emp.holidayPayEligible) {
        const fallback: DayType = p.dayType.endsWith("rest") ? "rest_day" : "ordinary";
        workMult = pr.work[fallback];
        otMult = pr.ot[fallback];
      }
      // Normal hours on a non-ordinary day
      if (p.dayType !== "ordinary" && p.hours > 0) {
        const premiumOnly = isMonthlyRated && policy.monthlyRatedPremiumOnly && PAID_IN_MONTHLY.includes(p.dayType);
        const mult = premiumOnly ? workMult - 1 : workMult;
        const amt = rates.hourly * mult * p.hours;
        if (isHoliday) autoHoliday += amt;
        else autoRest += amt;
        t(
          isHoliday ? "5 Holiday pay" : "6 Rest day",
          `${label} worked`,
          `${peso(rates.hourly)} × ${mult.toFixed(2)}${premiumOnly ? " (premium only; base in monthly salary)" : ""} × ${p.hours} hr`,
          amt
        );
      }
      if (p.otHours > 0) {
        if (!emp.otEligible) {
          issues.push({ level: "warning", code: "OT_NOT_ELIGIBLE", message: `OT hours on ${label} ignored: employee is not OT-eligible.` });
        } else {
          const amt = rates.hourly * otMult * p.otHours;
          autoOT += amt;
          t("4 Overtime", `${label} OT`, `${peso(rates.hourly)} × ${otMult.toFixed(4).replace(/0+$/, "").replace(/\.$/, "")} × ${p.otHours} hr`, amt);
        }
      }
      if (p.nsdHours > 0 || p.nsdOtHours > 0) {
        if (!emp.nsdEligible) {
          issues.push({ level: "warning", code: "NSD_NOT_ELIGIBLE", message: `Night hours on ${label} ignored: employee is not NSD-eligible.` });
        } else {
          if (p.nsdHours > 0) {
            const amt = rates.hourly * workMult * pr.nsdRate * p.nsdHours;
            autoNSD += amt;
            t("7 Night differential", `${label} night hours`, `${peso(rates.hourly)} × ${workMult} × ${pr.nsdRate * 100}% × ${p.nsdHours} hr`, amt);
          }
          if (p.nsdOtHours > 0 && emp.otEligible) {
            const amt = rates.hourly * otMult * pr.nsdRate * p.nsdOtHours;
            autoNSD += amt;
            t("7 Night differential", `${label} night OT hours`, `${peso(rates.hourly)} × ${otMult} × ${pr.nsdRate * 100}% × ${p.nsdOtHours} hr`, amt);
          }
        }
      }
    }
  }
  const otPay = ov("ot_pay", autoOT);
  const holidayPay = ov("holiday_pay", autoHoliday);
  const restDayPay = ov("rest_day_pay", autoRest);
  const nsdPay = ov("nsd_pay", autoNSD);

  // ---- STEPS 8–10 Commission, allowances, bonuses -------------------------
  const lines: EarningLine[] = input.earnings.filter((l) => Number.isFinite(l.amount) && l.amount !== 0);
  for (const l of lines) {
    if (l.amount < 0) issues.push({ level: "error", code: "NEGATIVE_EARNING", message: `${l.label} cannot be negative.` });
  }
  const byCat = (c: EarningLine["category"]) => sum(lines.filter((l) => l.category === c).map((l) => l.amount));
  const commission = byCat("commission");
  const allowances = byCat("allowance");
  const bonus = sum([byCat("bonus"), byCat("incentive")]);
  const otherEarnings = byCat("other");
  for (const l of lines) t(l.category === "commission" ? "8 Commission" : l.category === "allowance" ? "9 Allowances" : "10 Bonus / other", l.label, l.taxTreatment.replace("_", " "), l.amount);

  // ---- STEP 11 Gross -------------------------------------------------------
  const grossPay = sum([netBasicPay, paidLeavePay, unworkedHolidayPay, otPay, holidayPay, restDayPay, nsdPay, commission, allowances, bonus, otherEarnings]);
  t("11 Gross", "Gross pay", "Net basic + leave + holiday + OT + rest day + NSD + commission + allowances + bonus + other", grossPay);

  // ---- STEP 12 Employee statutory deductions ------------------------------
  const compensationCore = sum([netBasicPay, paidLeavePay, unworkedHolidayPay, otPay, holidayPay, restDayPay, nsdPay]);
  const sssBasisPeriod = sum([compensationCore, ...lines.filter((l) => l.includeInSSS).map((l) => l.amount)]);
  const phBasisPeriod = isMonthlyRated ? rates.monthly : sum([netBasicPay, paidLeavePay]);
  const piBasisPeriod = sum([netBasicPay, paidLeavePay, ...lines.filter((l) => l.includeInPagibig).map((l) => l.amount)]);

  const n = Math.max(1, period.periodsInMonth);
  const isLast = period.isLastPeriodOfMonth || n === 1;
  const schedule = policy.contributionSchedule;
  if (n > 1 && isLast && !input.monthToDate) {
    issues.push({
      level: "warning",
      code: "NO_MONTH_TO_DATE",
      message: "Earlier payroll periods of this month were not found; contributions computed on this period only.",
    });
  }

  /** Monthly basis for a contribution: actual month total on the last period, projection otherwise. */
  const monthlyBasis = (periodBasis: number, mtdBasis: number, fixedMonthly?: number) => {
    if (fixedMonthly !== undefined) return fixedMonthly;
    if (isLast) return mtdBasis + periodBasis;
    return periodBasis * n;
  };
  /** This period's share of a full-month amount. */
  const periodShare = (full: number, alreadyDeducted: number, key: string) => {
    if (n === 1) return full;
    if (schedule === "last_period") return isLast ? Math.max(0, full - alreadyDeducted) : 0;
    if (!isLast) return r2(full / n);
    const share = full - alreadyDeducted;
    if (share < 0) {
      issues.push({ level: "warning", code: "CONTRIBUTION_OVER_DEDUCTED", message: `${key}: earlier periods deducted ${peso(-share)} more than the month requires. Review manually.` });
      return 0;
    }
    return share;
  };

  let sssEE = 0, sssMpfEE = 0, sssER = 0, sssMpfER = 0, sssEC = 0, sssMsc = 0, sssBasis = 0;
  if (emp.sssCovered !== false) {
    if (!config.sss) {
      issues.push({ level: "error", code: "MISSING_SSS_CONFIG", message: "The SSS configuration for this payroll period is expired or unavailable." });
    } else {
      sssBasis = r2(monthlyBasis(sssBasisPeriod, mtd.sssCompensation));
      const m = calculateSSS(sssBasis, config.sss);
      sssMsc = m.msc;
      t("12 SSS", "Monthly compensation basis", `${isLast ? "Month-to-date actual" : `Projected (${peso(sssBasisPeriod)} × ${n})`} = ${peso(sssBasis)} → MSC ${peso(m.msc)} (regular ${peso(m.mscRegular)}, MPF ${peso(m.mscMpf)})`);
      t("12 SSS", "Full-month shares", `EE ${peso(m.ee)} + MPF EE ${peso(m.mpfEE)} · ER ${peso(m.er)} + MPF ER ${peso(m.mpfER)} + EC ${peso(m.ec)}`);
      sssEE = ov("sss_ee", periodShare(m.ee, mtd.sssEE, "SSS EE"));
      sssMpfEE = ov("sss_mpf_ee", periodShare(m.mpfEE, mtd.sssMpfEE, "SSS MPF EE"));
      sssER = ov("sss_er", periodShare(m.er, mtd.sssER, "SSS ER"));
      sssMpfER = ov("sss_mpf_er", periodShare(m.mpfER, mtd.sssMpfER, "SSS MPF ER"));
      sssEC = ov("sss_ec", periodShare(m.ec, mtd.sssEC, "SSS EC"));
      t("12 SSS", "This period", `Employee ${peso(sssEE + sssMpfEE)} · Employer ${peso(sssER + sssMpfER + sssEC)}`, sssEE + sssMpfEE);
    }
  }

  let phEE = 0, phER = 0, phBasis = 0;
  if (emp.philhealthCovered !== false) {
    if (!config.philhealth) {
      issues.push({ level: "error", code: "MISSING_PHILHEALTH_CONFIG", message: "The PhilHealth configuration for this payroll period is expired or unavailable." });
    } else {
      phBasis = r2(monthlyBasis(phBasisPeriod, mtd.philhealthBasic, isMonthlyRated ? rates.monthly : undefined));
      const m = calculatePhilHealth(phBasis, config.philhealth);
      t("12 PhilHealth", "Monthly basic salary basis", `${peso(phBasis)} → applied ${peso(m.basis)} (floor ${peso(config.philhealth.floor)}, ceiling ${peso(config.philhealth.ceiling)}) × ${config.philhealth.rate * 100}% = premium ${peso(m.premium)}`);
      phEE = ov("philhealth_ee", periodShare(m.ee, mtd.philhealthEE, "PhilHealth EE"));
      phER = ov("philhealth_er", periodShare(m.er, mtd.philhealthER, "PhilHealth ER"));
      t("12 PhilHealth", "This period", `Employee ${peso(phEE)} · Employer ${peso(phER)}`, phEE);
    }
  }

  let piEE = 0, piER = 0, piBasis = 0;
  if (emp.pagibigCovered !== false) {
    if (!config.pagibig) {
      issues.push({ level: "error", code: "MISSING_PAGIBIG_CONFIG", message: "The Pag-IBIG configuration for this payroll period is expired or unavailable." });
    } else {
      piBasis = r2(monthlyBasis(piBasisPeriod, mtd.pagibigCompensation));
      const m = calculatePagIBIG(piBasis, config.pagibig);
      t("12 Pag-IBIG", "Monthly compensation basis", `${peso(piBasis)} → fund salary ${peso(m.fundSalary)} × EE ${m.eeRate * 100}% / ER ${m.erRate * 100}%`);
      piEE = ov("pagibig_ee", periodShare(m.ee, mtd.pagibigEE, "Pag-IBIG EE"));
      piER = ov("pagibig_er", periodShare(m.er, mtd.pagibigER, "Pag-IBIG ER"));
      t("12 Pag-IBIG", "This period", `Employee ${peso(piEE)} · Employer ${peso(piER)}`, piEE);
    }
  }
  const totalEE = sum([sssEE, sssMpfEE, phEE, piEE]);
  const totalER = sum([sssER, sssMpfER, sssEC, phER, piER]);

  // ---- STEP 13 Taxable compensation ---------------------------------------
  const smwComponents = sum([netBasicPay, paidLeavePay, unworkedHolidayPay, otPay, holidayPay, restDayPay, nsdPay]);
  let taxableOther = 0,
    nonTaxable = 0,
    otherBenefitsTaxable = 0;
  let ytdOther = ytd.otherBenefits;
  const threshold = config.bir?.otherBenefitsThreshold ?? 0;
  for (const l of lines) {
    if (l.taxTreatment === "taxable") taxableOther += l.amount;
    else if (l.taxTreatment === "other_benefit") {
      const tp = otherBenefitsTaxablePortion(ytdOther, l.amount, threshold);
      otherBenefitsTaxable += tp;
      nonTaxable += l.amount - tp;
      ytdOther += l.amount;
    } else nonTaxable += l.amount;
  }
  taxableOther = r2(taxableOther);
  otherBenefitsTaxable = r2(otherBenefitsTaxable);
  nonTaxable = r2(nonTaxable);

  let mweExempt = 0;
  let netTaxable: number;
  if (emp.isMinimumWageEarner) {
    mweExempt = smwComponents;
    netTaxable = r2(Math.max(0, taxableOther + otherBenefitsTaxable));
    t("13 Taxable", "Minimum wage earner", `Basic, holiday, OT, NSD exempt (${peso(mweExempt)}). Other taxable compensation ${peso(netTaxable)}`, netTaxable);
  } else {
    netTaxable = r2(Math.max(0, smwComponents + taxableOther + otherBenefitsTaxable - totalEE));
    t("13 Taxable", "Net taxable compensation", `${peso(smwComponents)} + taxable earnings ${peso(taxableOther + otherBenefitsTaxable)} − employee contributions ${peso(totalEE)}`, netTaxable);
  }
  if (nonTaxable > 0) t("13 Taxable", "Non-taxable compensation", "De minimis / exempt / other benefits within threshold", nonTaxable);

  // ---- STEP 14 Withholding tax --------------------------------------------
  let autoTax = 0;
  if (!config.bir) {
    if (netTaxable > 0) issues.push({ level: "error", code: "MISSING_BIR_CONFIG", message: "No BIR withholding tax table covers this period." });
  } else {
    autoTax = calculateWithholdingTax(netTaxable, period.frequency, config.bir);
    t("14 Withholding tax", `${period.frequency.replace("_", "-")} table`, `Tax on ${peso(netTaxable)}`, autoTax);
  }
  const withholdingTax = ov("withholding_tax", autoTax);

  // ---- STEP 15 Loans & other deductions -----------------------------------
  const loanRows = input.loans.map((l) => {
    const auto = Math.max(0, Math.min(l.scheduledAmount, l.balance));
    const amt = ov(`loan:${l.loanId}`, auto);
    if (amt > l.balance + 0.005) {
      issues.push({ level: "error", code: "LOAN_EXCEEDS_BALANCE", message: `${l.label}: deduction ${peso(amt)} exceeds balance ${peso(l.balance)}.` });
    }
    return { loanId: l.loanId, label: l.label, loanType: l.loanType, scheduled: r2(auto), deducted: amt, deferred: 0, priority: l.priority ?? 0 };
  });
  const otherRows = input.otherDeductions
    .filter((d) => d.amount)
    .map((d) => {
      if (d.amount < 0) issues.push({ level: "error", code: "NEGATIVE_DEDUCTION", message: `${d.label} cannot be negative.` });
      if (!d.reference?.trim()) issues.push({ level: "warning", code: "DEDUCTION_NO_AUTHORIZATION", message: `${d.label} has no employee authorization/reference.` });
      return { ...d, amount: r2(d.amount), deducted: r2(d.amount), deferred: 0 };
    });

  // Net pay protection: defer non-statutory deductions if net would fall below the policy minimum.
  const preNet = r2(grossPay - totalEE - withholdingTax - sum(loanRows.map((l) => l.deducted)) - sum(otherRows.map((d) => d.deducted)));
  if (preNet < policy.minimumNetPay) {
    let shortfall = r2(policy.minimumNetPay - preNet);
    const deferrable = [
      ...otherRows.slice().reverse(),
      ...loanRows.slice().sort((a, b) => b.priority - a.priority),
    ];
    for (const row of deferrable) {
      if (shortfall <= 0) break;
      const cut = Math.min(row.deducted, shortfall);
      row.deducted = r2(row.deducted - cut);
      row.deferred = r2(row.deferred + cut);
      shortfall = r2(shortfall - cut);
      issues.push({ level: "warning", code: "DEDUCTION_DEFERRED", message: `${row.label}: ${peso(cut)} deferred to protect net pay.` });
      t("15 Deductions", "Deferred", `${row.label} reduced by ${peso(cut)} (net pay protection)`, -cut);
    }
  }
  for (const l of loanRows) if (l.deducted) t("15 Deductions", l.label, `Installment ${peso(l.scheduled)}`, l.deducted);
  for (const d of otherRows) if (d.deducted) t("15 Deductions", d.label, d.reference ? `Ref: ${d.reference}` : "No reference", d.deducted);

  const totalLoans = sum(loanRows.map((l) => l.deducted));
  const totalOtherDeductions = sum(otherRows.map((d) => d.deducted));

  // ---- STEPS 16–18 Totals --------------------------------------------------
  const totalDeductions = sum([totalEE, withholdingTax, totalLoans, totalOtherDeductions]);
  const netPay = r2(grossPay - totalDeductions);
  const employerCost = sum([grossPay, totalER]);
  t("16 Total deductions", "Employee deductions", "Statutory + tax + loans + other", totalDeductions);
  t("17 Net pay", "Net pay", `${peso(grossPay)} − ${peso(totalDeductions)}`, netPay);
  t("18 Employer", "Employer contributions (not deducted from employee)", `SSS ${peso(sssER + sssMpfER)} + EC ${peso(sssEC)} + PhilHealth ${peso(phER)} + Pag-IBIG ${peso(piER)}`, totalER);

  if (netPay < 0) {
    issues.push({ level: "error", code: "NEGATIVE_NET_PAY", message: `Net pay is negative (${peso(netPay)}) even after deferring loans and other deductions.` });
  } else if (netPay < policy.minimumNetPay) {
    issues.push({ level: "warning", code: "LOW_NET_PAY", message: `Net pay ${peso(netPay)} is below the policy minimum ${peso(policy.minimumNetPay)}.` });
  }
  if (grossPay > 0 && totalDeductions / grossPay > policy.excessiveDeductionRatio) {
    issues.push({
      level: "warning",
      code: "EXCESSIVE_DEDUCTIONS",
      message: `Deductions are ${Math.round((totalDeductions / grossPay) * 100)}% of gross pay.`,
    });
  }
  if (overrides.length) {
    issues.push({ level: "warning", code: "MANUAL_OVERRIDE", message: `${overrides.length} component(s) manually overridden.` });
  }

  const thirteenthMonthBasis = r2(netBasicPay + paidLeavePay);

  return {
    rates: { monthly: r2(rates.monthly), daily: r2(rates.daily), hourly: r2(rates.hourly) },
    earnings: {
      basicPay,
      absenceDeduction,
      tardinessDeduction,
      netBasicPay,
      paidLeavePay,
      unworkedHolidayPay,
      otPay,
      holidayPay,
      restDayPay,
      nsdPay,
      commission,
      allowances,
      bonus,
      otherEarnings,
      lines,
    },
    grossPay,
    statutory: {
      sssPeriodBasis: sssBasisPeriod,
      philhealthPeriodBasis: r2(phBasisPeriod),
      pagibigPeriodBasis: piBasisPeriod,
      sssBasis,
      sssMsc,
      sssEE,
      sssMpfEE,
      sssER,
      sssMpfER,
      sssEC,
      philhealthBasis: phBasis,
      philhealthEE: phEE,
      philhealthER: phER,
      pagibigBasis: piBasis,
      pagibigEE: piEE,
      pagibigER: piER,
      totalEE,
      totalER,
    },
    tax: {
      taxableEarnings: r2(smwComponents + taxableOther + otherBenefitsTaxable),
      nonTaxableEarnings: nonTaxable,
      otherBenefitsTaxablePortion: otherBenefitsTaxable,
      mweExempt,
      netTaxable,
      withholdingTax,
      ytdTaxable: r2(ytd.taxableCompensation + netTaxable),
      ytdWithheld: r2(ytd.taxWithheld + withholdingTax),
    },
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    loans: loanRows.map(({ priority: _p, ...rest }) => rest),
    otherDeductions: otherRows,
    totalLoans,
    totalOtherDeductions,
    totalDeductions,
    netPay,
    employerCost,
    thirteenthMonthBasis,
    overrides,
    issues,
    trace,
  };
}

/** Errors block approval; warnings must be reviewed. */
export function hasBlockingIssues(r: PayrollResult): boolean {
  return r.issues.some((i) => i.level === "error");
}

// ---------------------------------------------------------------------------
// 13th month
// ---------------------------------------------------------------------------

export interface ThirteenthMonthInput {
  monthlyBasic: number[]; // 12 values, Jan..Dec (basic salary actually earned)
  adjustment?: number;
  adjustmentReason?: string;
}

export function calculate13thMonth(input: ThirteenthMonthInput) {
  const months = Array.from({ length: 12 }, (_, i) => r2(input.monthlyBasic[i] ?? 0));
  const totalBasic = sum(months);
  const computed = r2(totalBasic / 12);
  const adjustment = r2(input.adjustment ?? 0);
  return { months, totalBasic, computed, adjustment, thirteenthMonth: r2(computed + adjustment) };
}
