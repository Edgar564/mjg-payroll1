/** Round to centavos (half away from zero). */
export function r2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const sign = n < 0 ? -1 : 1;
  // toPrecision(12) removes binary noise such as 417.815 → 41781.49999999999
  return (sign * Math.round(parseFloat((Math.abs(n) * 100).toPrecision(12)))) / 100;
}

const PHP = new Intl.NumberFormat("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** ₱25,000.00 — negative values as -₱300.00 */
export function peso(n: number | null | undefined): string {
  const v = Number.isFinite(n as number) ? (n as number) : 0;
  return (v < 0 ? "-₱" : "₱") + PHP.format(Math.abs(v));
}

/** Plain 25,000.00 for CSV/Excel cells. */
export function num(n: number | null | undefined): string {
  const v = Number.isFinite(n as number) ? (n as number) : 0;
  return v.toFixed(2);
}

export function sum(values: number[]): number {
  return r2(values.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0));
}
