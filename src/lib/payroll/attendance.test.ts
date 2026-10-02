import { describe, expect, it } from "vitest";
import { DEFAULT_ATTENDANCE_RULES as R, computeAttendance } from "./attendance";

describe("attendance computation", () => {
  it("regular day 8–5 with 1h break", () => {
    expect(computeAttendance("08:00", "17:00", 60, R)).toMatchObject({ regularHours: 8, otHours: 0, lateMinutes: 0, undertimeMinutes: 0, nightHours: 0 });
  });
  it("8. tardiness: 20 minutes late, leaves on time", () => {
    expect(computeAttendance("08:20", "17:00", 60, R)).toMatchObject({ lateMinutes: 20, undertimeMinutes: 0, regularHours: 7.67 });
  });
  it("grace period and late rule", () => {
    expect(computeAttendance("08:10", "17:10", 60, { ...R, gracePeriodMinutes: 10 }).lateMinutes).toBe(0);
    expect(computeAttendance("08:30", "17:00", 60, { ...R, lateRule: "none" }).lateMinutes).toBe(0);
  });
  it("undertime when leaving early", () => {
    expect(computeAttendance("08:00", "16:00", 60, R)).toMatchObject({ undertimeMinutes: 60, regularHours: 7 });
  });
  it("overtime with rounding down to 30-minute blocks", () => {
    expect(computeAttendance("08:00", "19:20", 60, R).otHours).toBe(2.33);
    expect(computeAttendance("08:00", "19:20", 60, { ...R, otRoundingMinutes: 30 }).otHours).toBe(2);
  });
  it("night shift crossing midnight gets NSD hours", () => {
    const r = computeAttendance("22:00", "07:00", 60, { ...R, shiftStart: "22:00" });
    expect(r.regularHours).toBe(8);
    expect(r.nightHours).toBe(8); // 22:00–06:00, capped at regular hours
    expect(computeAttendance("00:15", "08:00", 0, { ...R, shiftStart: "22:00" }).lateMinutes).toBe(135);
    expect(r.lateMinutes).toBe(0);
  });
});
