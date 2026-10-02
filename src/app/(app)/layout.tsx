import { getSession } from "@/lib/data/session";
import { ROLE_LABELS, can } from "@/lib/roles";
import { Nav } from "./nav";
import { signOut } from "./actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, profile, role } = await getSession();
  const items = [
    { href: "/", label: "Dashboard", show: can.staff(role) },
    { href: "/employees", label: "Employees", show: can.staff(role) },
    { href: "/attendance", label: "Attendance", show: can.readPayroll(role) || role === "hr" },
    { href: "/payroll", label: "Payroll Periods", show: can.readPayroll(role) },
    { href: "/loans", label: "Loans & Advances", show: can.readPayroll(role) },
    { href: "/commissions", label: "Commissions", show: can.readPayroll(role) },
    { href: "/adjustments", label: "Adjustments", show: can.readPayroll(role) },
    { href: "/holidays", label: "Holidays", show: can.staff(role) },
    { href: "/thirteenth-month", label: "13th Month", show: can.readPayroll(role) },
    { href: "/statutory", label: "Statutory Tables", show: can.staff(role) },
    { href: "/reports", label: "Reports", show: can.readPayroll(role) },
    { href: "/payslips", label: role === "employee" ? "My Payslips" : "Payslips", show: true },
    { href: "/users", label: "Users & Roles", show: can.manageUsers(role) },
    { href: "/audit", label: "Audit Trail", show: can.readAudit(role) },
    { href: "/settings", label: "Settings", show: can.staff(role) },
  ].filter((i) => i.show);

  return (
    <div className="min-h-screen md:flex">
      <aside className="no-print border-b border-slate-200 bg-white md:sticky md:top-0 md:h-screen md:w-60 md:shrink-0 md:overflow-y-auto md:border-b-0 md:border-r">
        <div className="flex items-center justify-between px-4 py-4">
          <div>
            <div className="text-sm font-bold tracking-tight text-brand-900">MJGarcia Trading</div>
            <div className="text-xs text-slate-500">Payroll System</div>
          </div>
        </div>
        <Nav items={items} />
        <div className="hidden border-t border-slate-100 px-4 py-3 text-xs text-slate-500 md:block">
          <div className="truncate font-medium text-slate-700">{profile?.full_name ?? user.email}</div>
          <div>{role ? ROLE_LABELS[role] : "No role assigned"}</div>
          <form action={signOut}>
            <button className="mt-2 text-brand-700 hover:underline">Sign out</button>
          </form>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 md:px-8">
        {!role && (
          <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Your account has no active role yet. Ask a Super Admin to assign one under Users &amp; Roles.
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
