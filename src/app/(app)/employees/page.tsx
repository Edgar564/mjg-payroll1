import Link from "next/link";
import { getSession } from "@/lib/data/session";
import { can } from "@/lib/roles";
import { fullName } from "@/lib/data/load";
import { peso } from "@/lib/payroll/money";
import { EmployeeImport } from "./import";
import { Empty, LinkButton, PageHeader, StatusBadge, TestBadge, label } from "@/components/ui";

export default async function EmployeesPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; dept?: string }> }) {
  const sp = await searchParams;
  const { supabase, role } = await getSession();
  const canGov = can.readGovIds(role);
  let query = supabase
    .from("employees")
    .select(`id, employee_no, first_name, middle_name, last_name, suffix, employment_status, salary_type, monthly_rate, daily_rate, hourly_rate, pay_frequency, is_test_data, positions(name), departments(name)${canGov ? ", employee_government_ids(sss_no, tin)" : ""}`)
    .is("deleted_at", null)
    .order("last_name");
  if (sp.status) query = query.eq("employment_status", sp.status);
  if (sp.dept) query = query.eq("department_id", sp.dept);
  if (sp.q) {
    const q = sp.q.replace(/[%,()]/g, "");
    query = query.or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,employee_no.ilike.%${q}%`);
  }
  const [{ data: rows, error }, { data: depts }] = await Promise.all([query, supabase.from("departments").select("id, name").order("name")]);
  const mask = (v?: string | null) => (v ? "•".repeat(Math.max(0, v.length - 4)) + v.slice(-4) : "—");
  type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

  return (
    <>
      <PageHeader
        title="Employees"
        subtitle={`${rows?.length ?? 0} employee(s)`}
        actions={can.writeEmployees(role) && <LinkButton href="/employees/new" variant="primary">Add employee</LinkButton>}
      />
      {can.writeEmployees(role) && <EmployeeImport existingNos={((rows ?? []) as Row[]).map((r) => r.employee_no)} />}
      <form className="card mb-4 flex flex-wrap items-end gap-3 p-3">
        <label className="min-w-48 flex-1">
          <span className="label">Search</span>
          <input name="q" defaultValue={sp.q} className="input" placeholder="Name or employee number" />
        </label>
        <label>
          <span className="label">Status</span>
          <select name="status" defaultValue={sp.status ?? ""} className="input">
            <option value="">All</option>
            {["probationary", "regular", "contractual", "casual", "part_time", "resigned", "terminated", "inactive", "applicant"].map((s) => (
              <option key={s} value={s}>{label(s)}</option>
            ))}
          </select>
        </label>
        <label>
          <span className="label">Department</span>
          <select name="dept" defaultValue={sp.dept ?? ""} className="input">
            <option value="">All</option>
            {(depts ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
        <button className="btn-secondary">Filter</button>
      </form>
      {error && <div className="mb-3 text-sm text-red-700">Could not load employees. Check your connection and role.</div>}
      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>No.</th><th>Name</th><th>Position</th><th>Department</th><th>Status</th><th className="num">Rate</th><th>Frequency</th>
              {canGov && <><th>SSS</th><th>TIN</th></>}
            </tr>
          </thead>
          <tbody>
            {((rows ?? []) as Row[]).map((e) => {
              const gov = Array.isArray(e.employee_government_ids) ? e.employee_government_ids[0] : e.employee_government_ids;
              const rate = e.salary_type === "monthly" ? `${peso(e.monthly_rate)}/mo` : e.salary_type === "daily" ? `${peso(e.daily_rate)}/day` : `${peso(e.hourly_rate)}/hr`;
              return (
                <tr key={e.id}>
                  <td className="font-mono text-xs">{e.employee_no}</td>
                  <td>
                    <Link className="font-medium text-brand-700 hover:underline" href={`/employees/${e.id}`}>{fullName(e as never)}</Link>
                    {e.is_test_data && <TestBadge />}
                  </td>
                  <td>{e.positions?.name ?? "—"}</td>
                  <td>{e.departments?.name ?? "—"}</td>
                  <td><StatusBadge status={e.employment_status} /></td>
                  <td className="num">{rate}</td>
                  <td>{label(e.pay_frequency)}</td>
                  {canGov && <><td className="font-mono text-xs">{mask(gov?.sss_no)}</td><td className="font-mono text-xs">{mask(gov?.tin)}</td></>}
                </tr>
              );
            })}
          </tbody>
        </table>
        {!rows?.length && <Empty>No employees found.</Empty>}
      </div>
    </>
  );
}
