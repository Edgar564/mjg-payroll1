/** Time-in / time-out → hours, late, undertime, OT, night hours, using company attendance rules. */
export interface AttendanceRules {
  shiftStart: string; // "08:00"
  hoursPerDay: number;
  gracePeriodMinutes: number;
  lateRule: "per_minute" | "none";
  undertimeRule: "per_minute" | "none";
  otRoundingMinutes: number; // round OT DOWN to this block (0 = exact)
  nsdStart: string; // "22:00"
  nsdEnd: string; // "06:00"
}

export const DEFAULT_ATTENDANCE_RULES: AttendanceRules = {
  shiftStart: "08:00",
  hoursPerDay: 8,
  gracePeriodMinutes: 0,
  lateRule: "per_minute",
  undertimeRule: "per_minute",
  otRoundingMinutes: 0,
  nsdStart: "22:00",
  nsdEnd: "06:00",
};

const toMin = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
};

/** Minutes of [a,b) that fall within the night window (handles windows crossing midnight). */
function nightMinutes(a: number, b: number, nsdStart: number, nsdEnd: number) {
  let total = 0;
  // examine two consecutive days to handle shifts crossing midnight
  for (const dayOffset of [-1440, 0, 1440]) {
    const s = nsdStart + dayOffset;
    const e = (nsdEnd <= nsdStart ? nsdEnd + 1440 : nsdEnd) + dayOffset;
    total += Math.max(0, Math.min(b, e) - Math.max(a, s));
  }
  return total;
}

export function computeAttendance(timeIn: string, timeOut: string, breakMinutes: number, rules: AttendanceRules) {
  const start = toMin(rules.shiftStart);
  let inM = toMin(timeIn);
  // time-in shortly after midnight for a late-evening shift belongs to the next day
  if (inM < start - 720) inM += 1440;
  let outM = toMin(timeOut);
  while (outM <= inM) outM += 1440; // overnight shift
  const worked = Math.max(0, outM - inM - Math.max(0, breakMinutes));
  const scheduled = rules.hoursPerDay * 60;

  let late = Math.max(0, inM - start);
  if (late <= rules.gracePeriodMinutes) late = 0;
  if (rules.lateRule === "none") late = 0;

  // Regular hours are capped at the scheduled day; anything beyond is OT (subject to approval in practice)
  const regular = Math.min(worked, scheduled);
  let undertime = Math.max(0, scheduled - worked - late);
  if (rules.undertimeRule === "none") undertime = 0;
  let ot = Math.max(0, worked - scheduled);
  if (rules.otRoundingMinutes > 0) ot = Math.floor(ot / rules.otRoundingMinutes) * rules.otRoundingMinutes;

  // Night hours: split between the regular part and the OT part (OT assumed at the end of the shift)
  // The break is assumed to fall outside the night window; edit night hours on the record if not.
  const nsdS = toMin(rules.nsdStart);
  const nsdE = toMin(rules.nsdEnd);
  const otStart = outM - ot;
  const nightTotal = nightMinutes(inM, outM, nsdS, nsdE);
  const nightOt = ot > 0 ? nightMinutes(otStart, outM, nsdS, nsdE) : 0;
  const nightRegular = Math.max(0, Math.min(nightTotal - nightOt, regular));

  const h = (m: number) => Math.round((m / 60) * 100) / 100;
  return {
    regularHours: h(regular),
    otHours: h(ot),
    nightHours: h(nightRegular),
    nightOtHours: h(nightOt),
    lateMinutes: late,
    undertimeMinutes: undertime,
  };
}
