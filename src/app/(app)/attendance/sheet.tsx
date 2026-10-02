"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { parseCsv } from "@/lib/csv";
import { saveAttendance, type AttendanceInputRow } from "./actions";

type Existing = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function dates(from: string, to: string) {
  const out: string[] = [];
  const d = new Date(from + "T00:00:00Z");
  const e = new Date(to + "T00:00:00Z");
  while (d <= e && out.length < 62) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export function AttendanceSheet({
  employeeId, from, to, existing, holidays, editable, employees,
}: {
  employeeId: string; from: string; to: string; existing: Existing[]; holidays: { holiday_date: string; name: string; holiday_type: string }[]; editable: boolean; employees: { id: string; no: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [rows, setRows] = useState<AttendanceInputRow[]>(() =>
    dates(from, to).map((d) => {
      const x = existing.find((r) => r.work_date === d);
      const sunday = new Date(d + "T00:00:00Z").getUTCDay() === 0;
      return {
        employee_id: employeeId, work_date: d,
        time_in: x?.time_in?.slice(0, 5) ?? null, time_out: x?.time_out?.slice(0, 5) ?? null,
        break_minutes: x?.break_minutes ?? 60, absent: x?.absent ?? false,
        leave_type: x?.leave_type ?? null, leave_paid: x?.leave_paid ?? false,
        rest_day: x?.rest_day ?? sunday, day_type_override: x?.day_type_override ?? null, notes: x?.notes ?? null,
      };
    })
  );
  const computed = new Map(existing.map((x) => [x.work_date, x]));
  const set = (i: number, patch: Partial<AttendanceInputRow>) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));

  function save(list = rows) {
    start(async () => {
      const res = await saveAttendance(list);
      setMsg(res.error ? { tone: "error", text: res.error } : { tone: "ok", text: res.ok ?? "Saved." });
      if (!res.error) router.refresh();
    });
  }

  async function importCsv(file: File) {
    const t = parseCsv(await file.text());
    const h = t[0]?.map((x) => x.trim().toLowerCase()) ?? [];
    const col = (n: string) => h.indexOf(n);
    if (col("employee_no") < 0 || col("date") < 0) return setMsg({ tone: "error", text: "CSV needs columns: employee_no, date, time_in, time_out, break_minutes, absent, leave_type, leave_paid, rest_day" });
    const bad: string[] = [];
    const out: AttendanceInputRow[] = [];
    t.slice(1).forEach((r, i) => {
      if (!r.some((c) => c.trim())) return;
      const emp = employees.find((e) => e.no === r[col("employee_no")]?.trim());
      const date = r[col("date")]?.trim();
      if (!emp) return bad.push(`Row ${i + 2}: unknown employee_no.`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) return bad.push(`Row ${i + 2}: date must be YYYY-MM-DD.`);
      const yes = (v?: string) => /^(1|y|yes|true)$/i.test((v ?? "").trim());
      out.push({
        employee_id: emp.id, work_date: date!, time_in: r[col("time_in")]?.trim() || null, time_out: r[col("time_out")]?.trim() || null,
        break_minutes: Number(r[col("break_minutes")] || 60), absent: yes(r[col("absent")]), leave_type: r[col("leave_type")]?.trim() || null,
        leave_paid: yes(r[col("leave_paid")]), rest_day: yes(r[col("rest_day")]), day_type_override: null, notes: "Imported",
      });
    });
    if (bad.length) return setMsg({ tone: "error", text: `Import stopped — fix these rows first: ${bad.slice(0, 6).join(" ")}` });
    if (confirm(`Import ${out.length} attendance row(s)?`)) save(out);
  }

  return (
    <section className="card">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-3">
        <span className="mr-auto text-sm font-semibold">Daily time record</span>
        {editable && (
          <label className="btn-secondary cursor-pointer">Import CSV<input type="file" accept=".csv" className="hidden" onChange={(e) => e.target.files?.[0] && importCsv(e.target.files[0])} /></label>
        )}
        {editable && <button className="btn-primary" onClick={() => save()} disabled={pending}>{pending ? "Saving…" : "Save"}</button>}
      </div>
      {msg && <div className={`m-3 rounded-md px-3 py-2 text-sm ${msg.tone === "error" ? "bg-red-50 text-red-800" : "bg-emerald-50 text-emerald-800"}`}>{msg.text}</div>}
      <div className="overflow-x-auto">
        <table className="table min-w-[1100px]">
          <thead><tr><th>Date</th><th>In</th><th>Out</th><th>Break (min)</th><th>Absent</th><th>Leave</th><th>Rest day</th><th>Holiday / override</th><th className="num">Reg hrs</th><th className="num">OT</th><th className="num">Night</th><th className="num">Late</th><th className="num">UT</th></tr></thead>
          <tbody>
            {rows.map((r, i) => {
              const hol = holidays.filter((h) => h.holiday_date === r.work_date);
              const c = computed.get(r.work_date);
              const off = !editable;
              return (
                <tr key={r.work_date} className={r.rest_day ? "bg-slate-50" : ""}>
                  <td className="whitespace-nowrap text-xs">{new Date(r.work_date + "T00:00:00").toLocaleDateString("en-PH", { weekday: "short", month: "short", day: "numeric" })}</td>
                  <td><input type="time" className="input w-28" value={r.time_in ?? ""} disabled={off || r.absent} onChange={(e) => set(i, { time_in: e.target.value || null })} /></td>
                  <td><input type="time" className="input w-28" value={r.time_out ?? ""} disabled={off || r.absent} onChange={(e) => set(i, { time_out: e.target.value || null })} /></td>
                  <td><input className="input w-16 text-right" inputMode="numeric" value={r.break_minutes} disabled={off} onChange={(e) => set(i, { break_minutes: Number(e.target.value) || 0 })} /></td>
                  <td className="text-center"><input type="checkbox" checked={r.absent} disabled={off} onChange={(e) => set(i, { absent: e.target.checked, time_in: null, time_out: null })} /></td>
                  <td>
                    <select className="input w-32" disabled={off} value={r.leave_type ? `${r.leave_type}|${r.leave_paid ? 1 : 0}` : ""} onChange={(e) => { const [t, p] = e.target.value.split("|"); set(i, { leave_type: t || null, leave_paid: p === "1" }); }}>
                      <option value="">—</option><option value="SIL|1">Paid leave</option><option value="SL|1">Sick (paid)</option><option value="LWOP|0">Leave w/o pay</option>
                    </select>
                  </td>
                  <td className="text-center"><input type="checkbox" checked={r.rest_day} disabled={off} onChange={(e) => set(i, { rest_day: e.target.checked })} /></td>
                  <td className="text-xs">
                    {hol.map((h) => <div key={h.name} className="text-amber-800">{h.name}</div>)}
                    <select className="input mt-0.5 w-36 text-xs" disabled={off} value={r.day_type_override ?? ""} onChange={(e) => set(i, { day_type_override: e.target.value || null })}>
                      <option value="">Auto</option><option value="ordinary">Ordinary</option><option value="special">Special day</option><option value="regular">Regular holiday</option><option value="rest_day">Rest day</option>
                    </select>
                  </td>
                  <td className="num">{c?.regular_hours ?? ""}</td><td className="num">{c?.ot_hours || ""}</td><td className="num">{Number(c?.night_hours ?? 0) + Number(c?.night_ot_hours ?? 0) || ""}</td><td className="num">{c?.late_minutes || ""}</td><td className="num">{c?.undertime_minutes || ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="px-3 py-2 text-[11px] text-slate-500">Computed columns update after saving. Rows without times, absence or leave are not stored.</p>
    </section>
  );
}
