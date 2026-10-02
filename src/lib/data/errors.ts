/** Translate database / network errors into messages a payroll user can act on. */
export function friendlyError(err: { message?: string; code?: string } | null | undefined, fallback = "Something went wrong. Please try again."): string {
  if (!err) return fallback;
  const m = err.message ?? "";
  if (err.code === "23505" || /duplicate key/i.test(m)) {
    if (/employee_no/.test(m)) return "That employee number is already used.";
    if (/payroll_periods_no_duplicate/.test(m)) return "A payroll for the same dates and frequency already exists.";
    if (/payroll_periods_code/.test(m)) return "That payroll code is already used.";
    return "This record already exists.";
  }
  if (err.code === "42501" || /row-level security|permission denied/i.test(m)) return "Your role is not allowed to make this change.";
  if (err.code === "23503") return "This record is linked to other records and cannot be changed that way.";
  if (err.code === "23514" || /violates check constraint/i.test(m)) return "One of the values is not allowed (check for negative amounts or invalid dates).";
  if (/fetch failed|failed to fetch|network/i.test(m)) return "Cannot reach the database. Check your internet connection and try again.";
  // Messages raised by our own SQL functions are already user-facing
  if (err.code === "P0001" || /^[A-Z]/.test(m)) return m.replace(/^ERROR:\s*/, "");
  return fallback;
}

export const num = (v: FormDataEntryValue | null): number | null => {
  if (v === null || v === "") return null;
  const n = Number(String(v).replace(/[₱,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};
export const str = (v: FormDataEntryValue | null): string | null => {
  const s = v === null ? "" : String(v).trim();
  return s === "" ? null : s;
};
export const bool = (v: FormDataEntryValue | null) => v === "on" || v === "true";
