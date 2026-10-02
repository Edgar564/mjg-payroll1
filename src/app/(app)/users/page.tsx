import { revalidatePath } from "next/cache";
import { requireRole, getSession } from "@/lib/data/session";
import { ROLE_LABELS, can, type AppRole } from "@/lib/roles";
import { fullName } from "@/lib/data/load";
import { friendlyError, str } from "@/lib/data/errors";
import { ActionForm, SubmitButton, type ActionResult } from "@/components/action-form";
import { PageHeader, fmtDateTime } from "@/components/ui";

async function updateUser(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  "use server";
  const { supabase, user, role } = await getSession();
  if (!can.manageUsers(role)) return { error: "Only a Super Admin can manage users." };
  const id = String(fd.get("id"));
  const newRole = String(fd.get("role")) as AppRole;
  const active = fd.get("active") === "on";
  if (id === user.id && (newRole !== "super_admin" || !active)) return { error: "You cannot remove your own Super Admin access." };
  const { error } = await supabase.from("profiles").update({ role: newRole, active, employee_id: str(fd.get("employee_id")), updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return { error: friendlyError(error) };
  revalidatePath("/users");
  return { ok: "User updated." };
}

const DESCRIPTIONS: Record<AppRole, string> = {
  super_admin: "Everything, including statutory tables and user roles",
  payroll_admin: "Employees, attendance, payroll preparation, loans, posting",
  payroll_reviewer: "Review payroll; can return it for correction",
  payroll_approver: "Approve, reopen, lock payroll; approve adjustments",
  hr: "Employee records and government IDs",
  accounting: "Payroll reports, statutory summaries, posting, payments",
  viewer: "Read-only payroll and employees (no government IDs)",
  employee: "Own payslips only",
};

export default async function UsersPage() {
  const { supabase } = await requireRole(can.manageUsers);
  const [{ data: users }, { data: emps }] = await Promise.all([
    supabase.from("profiles").select("*").order("created_at"),
    supabase.from("employees").select("id, employee_no, first_name, middle_name, last_name, suffix").is("deleted_at", null).order("last_name"),
  ]);
  return (
    <>
      <PageHeader title="Users & roles" subtitle="People create their own account on the sign-in page; assign their role here. New accounts start as Viewer." />
      <div className="card mb-4 overflow-x-auto p-4">
        <table className="table">
          <thead><tr><th>Role</th><th>Can do</th></tr></thead>
          <tbody>{(Object.keys(ROLE_LABELS) as AppRole[]).map((r) => <tr key={r}><td className="font-medium">{ROLE_LABELS[r]}</td><td className="text-xs">{DESCRIPTIONS[r]}</td></tr>)}</tbody>
        </table>
      </div>
      <div className="space-y-2">
        {(users ?? []).map((u) => (
          <ActionForm key={u.id} action={updateUser} className="card grid grid-cols-1 items-end gap-3 p-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1.5fr_auto_auto]">
            <input type="hidden" name="id" value={u.id} />
            <div><div className="font-medium">{u.full_name ?? u.email}</div><div className="text-xs text-slate-500">{u.email} · joined {fmtDateTime(u.created_at)}</div></div>
            <label><span className="label">Role</span><select name="role" defaultValue={u.role} className="input">{(Object.keys(ROLE_LABELS) as AppRole[]).map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</select></label>
            <label><span className="label">Linked employee (for self-service)</span><select name="employee_id" defaultValue={u.employee_id ?? ""} className="input"><option value="">—</option>{(emps ?? []).map((e) => <option key={e.id} value={e.id}>{fullName(e)}</option>)}</select></label>
            <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" name="active" defaultChecked={u.active} className="accent-brand-600" /> Active</label>
            <SubmitButton variant="secondary">Save</SubmitButton>
          </ActionForm>
        ))}
      </div>
    </>
  );
}
