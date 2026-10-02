import type {
  BIRConfig,
  PagIbigConfig,
  PayFrequency,
  PhilHealthConfig,
  SSSBracket,
  SSSConfig,
  TaxBracket,
} from "./types";
import { r2 } from "./money";

// ---------------------------------------------------------------------------
// SSS
// ---------------------------------------------------------------------------

export interface SSSMonthly {
  bracket: SSSBracket | null;
  msc: number;
  mscRegular: number;
  mscMpf: number;
  ee: number;
  mpfEE: number;
  er: number;
  mpfER: number;
  ec: number;
}

export function findSSSBracket(monthlyCompensation: number, cfg: SSSConfig): SSSBracket | null {
  const sorted = [...cfg.brackets].sort((a, b) => a.rangeFrom - b.rangeFrom);
  for (const b of sorted) {
    if (monthlyCompensation >= b.rangeFrom && (b.rangeTo === null || monthlyCompensation <= b.rangeTo)) return b;
  }
  // below the first bracket's lower bound (e.g. 0 compensation) → first bracket
  if (sorted.length && monthlyCompensation < sorted[0].rangeFrom) return sorted[0];
  // gap between brackets (e.g. 5249.995) → nearest lower bracket
  const lower = sorted.filter((b) => b.rangeFrom <= monthlyCompensation);
  return lower.length ? lower[lower.length - 1] : null;
}

/** Full-month SSS contribution for a given monthly compensation. */
export function calculateSSS(monthlyCompensation: number, cfg: SSSConfig): SSSMonthly {
  if (monthlyCompensation <= 0) {
    return { bracket: null, msc: 0, mscRegular: 0, mscMpf: 0, ee: 0, mpfEE: 0, er: 0, mpfER: 0, ec: 0 };
  }
  const b = findSSSBracket(monthlyCompensation, cfg);
  if (!b) return { bracket: null, msc: 0, mscRegular: 0, mscMpf: 0, ee: 0, mpfEE: 0, er: 0, mpfER: 0, ec: 0 };
  return {
    bracket: b,
    msc: b.mscRegular + b.mscMpf,
    mscRegular: b.mscRegular,
    mscMpf: b.mscMpf,
    ee: r2(b.mscRegular * cfg.eeRate),
    mpfEE: r2(b.mscMpf * cfg.eeRate),
    er: r2(b.mscRegular * cfg.erRate),
    mpfER: r2(b.mscMpf * cfg.erRate),
    ec: b.ec,
  };
}

/**
 * Build the SSS bracket list from the parameters of the official schedule.
 * Used only to generate seed rows; the engine reads the stored brackets.
 */
export function buildSSSBrackets(p: {
  minMsc: number;
  maxMsc: number;
  step: number;
  regularCap: number; // MSC above this goes to MPF
  ecLow: number;
  ecHigh: number;
  ecThreshold: number; // MSC at/above which ecHigh applies
}): SSSBracket[] {
  const out: SSSBracket[] = [];
  for (let msc = p.minMsc; msc <= p.maxMsc; msc += p.step) {
    const half = p.step / 2;
    out.push({
      rangeFrom: msc === p.minMsc ? 0 : msc - half,
      rangeTo: msc === p.maxMsc ? null : r2(msc + half - 0.01),
      mscRegular: Math.min(msc, p.regularCap),
      mscMpf: Math.max(0, msc - p.regularCap),
      ec: msc >= p.ecThreshold ? p.ecHigh : p.ecLow,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// PhilHealth
// ---------------------------------------------------------------------------

export interface PhilHealthMonthly {
  basis: number;
  premium: number;
  ee: number;
  er: number;
}

export function calculatePhilHealth(monthlyBasicSalary: number, cfg: PhilHealthConfig): PhilHealthMonthly {
  if (monthlyBasicSalary <= 0) return { basis: 0, premium: 0, ee: 0, er: 0 };
  const basis = Math.min(Math.max(monthlyBasicSalary, cfg.floor), cfg.ceiling);
  const premium = r2(basis * cfg.rate);
  const ee = r2(premium * cfg.eeShare);
  return { basis, premium, ee, er: r2(premium - ee) };
}

// ---------------------------------------------------------------------------
// Pag-IBIG / HDMF
// ---------------------------------------------------------------------------

export interface PagIbigMonthly {
  basis: number;
  fundSalary: number;
  eeRate: number;
  erRate: number;
  ee: number;
  er: number;
}

export function calculatePagIBIG(monthlyCompensation: number, cfg: PagIbigConfig): PagIbigMonthly {
  if (monthlyCompensation <= 0) return { basis: 0, fundSalary: 0, eeRate: 0, erRate: 0, ee: 0, er: 0 };
  const tiers = [...cfg.tiers].sort((a, b) => (a.upTo ?? Infinity) - (b.upTo ?? Infinity));
  const tier = tiers.find((t) => t.upTo === null || monthlyCompensation <= t.upTo) ?? tiers[tiers.length - 1];
  const fundSalary = Math.min(monthlyCompensation, cfg.maxFundSalary);
  return {
    basis: monthlyCompensation,
    fundSalary,
    eeRate: tier.eeRate,
    erRate: tier.erRate,
    ee: r2(fundSalary * tier.eeRate),
    er: r2(fundSalary * tier.erRate),
  };
}

// ---------------------------------------------------------------------------
// BIR withholding tax
// ---------------------------------------------------------------------------

export function findTaxBracket(amount: number, table: TaxBracket[]): TaxBracket {
  const sorted = [...table].sort((a, b) => a.over - b.over);
  let chosen = sorted[0];
  for (const b of sorted) if (amount >= b.over) chosen = b;
  return chosen;
}

export function taxFromTable(amount: number, table: TaxBracket[]): number {
  if (amount <= 0 || !table.length) return 0;
  const b = findTaxBracket(amount, table);
  return r2(Math.max(0, b.fixed + (amount - b.over) * b.rate));
}

export function calculateWithholdingTax(netTaxable: number, frequency: PayFrequency, cfg: BIRConfig): number {
  return taxFromTable(netTaxable, cfg.tables[frequency]);
}

export function calculateAnnualTax(annualNetTaxable: number, cfg: BIRConfig): number {
  return taxFromTable(annualNetTaxable, cfg.tables.annual);
}

/**
 * Year-end adjustment: annual tax due on actual annual taxable compensation
 * versus tax already withheld. Positive = additional tax to withhold,
 * negative = refund to employee.
 */
export function yearEndAdjustment(annualNetTaxable: number, ytdWithheld: number, cfg: BIRConfig, isMWE = false) {
  const annualTax = isMWE ? 0 : calculateAnnualTax(annualNetTaxable, cfg);
  const adjustment = r2(annualTax - ytdWithheld);
  return { annualNetTaxable: r2(annualNetTaxable), annualTax, ytdWithheld: r2(ytdWithheld), adjustment };
}

/** Portion of an "other benefit" (13th month, bonuses) that is taxable after the annual threshold. */
export function otherBenefitsTaxablePortion(ytdOtherBenefits: number, thisAmount: number, threshold: number): number {
  const before = Math.max(0, ytdOtherBenefits - threshold);
  const after = Math.max(0, ytdOtherBenefits + thisAmount - threshold);
  return r2(after - before);
}
