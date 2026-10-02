import { requireRole } from "@/lib/data/session";
import { can } from "@/lib/roles";
import { fullName } from "@/lib/data/load";
import { Notice, PageHeader } from "@/components/ui";
import { AttendanceSheet } from "./sheet";

export default async function AttendancePage({ searchParams }: { searchParams: Promise<{ employee?: string; from?: string; to?: string }> }) {
  const sp = await searchParams;
  const { supabase, role } = await requireRole((r) => can.readPayroll(r) || r === "hr");
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const firstHalf = now.getDate() <= 15;
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const from = sp.from ?? `${ym}-${firstHalf ? "01" : "16"}`;
  const to = sp.to ?? `${ym}-${firstHalf ? "15" : String(lastDay)}`;
  const { data: emps } = await supabase.from("employees").select("id, employee_no, first_name, middle_name, last_name, suffix").is("deleted_at", null).not("employment_status", "in", "(resigned,terminated,inactive,applicant)").order("last_name");
  const employeeId = sp.employee ?? emps?.[0]?.id;
  const [{ data: rows }, { data: holidays }] = await Promise.all([
    employeeId ? supabase.from("attendance").select("*").eq("employee_id", employeeId).gte("work_date", from).lte("work_date", to) : Promise.resolve({ data: [] }),
    supabase.from("holidays").select("holiday_date, name, holiday_type").eq("status", "active").gte("holiday_date", from).lte("holiday_date", to),
  ]);
  return (
    <>
      <PageHeader title="Attendance" subtitle="Optional. Payroll never depends on attendance — you can always encode days and hours directly in the payroll." />
      <Notice tone="info">Hours, late, undertime, overtime and night hours are computed from time-in/out using the rules in Settings. Saved attendance becomes the default encoding for that employee&apos;s payroll.</Notice>
      <form className="card mb-4 flex flex-wrap items-end gap-3 p-3">
        <label className="min-w-56 flex-1"><span className="label">Employee</span>
          <select name="employee" defaultValue={employeeId} className="input">{(emps ?? []).map((e) => <option key={e.id} value={e.id}>{fullName(e)} ({e.employee_no})</option>)}</select>
        </label>
        <label><span className="label">From</span><input type="date" name="from" defaultValue={from} className="input" /></label>
        <label><span className="label">To</span><input type="date" name="to" defaultValue={to} className="input" /></label>
        <button className="btn-secondary">Load</button>
      </form>
      {employeeId && (
        <AttendanceSheet
          key={`${employeeId}${from}${to}`}
          employeeId={employeeId}
          from={from}
          to={to}
          existing={rows ?? []}
          holidays={holidays ?? []}
          editable={can.writePayroll(role)}
          employees={(emps ?? []).map((e) => ({ id: e.id, no: e.employee_no }))}
        />
      )}
    </>
  );
}
