import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/data/session";
import { can } from "@/lib/roles";
import { loadPeriodContext } from "@/lib/data/load";
import { PageHeader, StatusBadge, TestBadge, fmtDate } from "@/components/ui";
import { EntryForm } from "./entry-form";

export default async function EntryPage({ params }: { params: Promise<{ id: string; employeeId: string }> }) {
  const { id, employeeId } = await params;
  const { supabase, role } = await requireRole(can.readPayroll);
  const [ctx, { data: earningTypes }] = await Promise.all([
    loadPeriodContext(supabase, id, employeeId),
    supabase.from("earning_types").select("*").eq("active", true).order("category").order("label"),
  ]);
  const emp = ctx?.employees[0];
  if (!ctx || !emp) notFound();
  const editable = can.writePayroll(role) && ["draft", "encoding"].includes(ctx.period.status);
  return (
    <>
      <PageHeader
        title={emp.summary.name}
        subtitle={
          <span>
            {emp.summary.employee_no} · {emp.summary.position ?? "No position"} · Payroll {ctx.period.code} ({fmtDate(ctx.period.period_start)} – {fmtDate(ctx.period.period_end)}) · <StatusBadge status={ctx.period.status} />
            {emp.summary.is_test_data && <TestBadge />}
          </span>
        }
        actions={<Link href={`/payroll/${id}`} className="btn-secondary">← Back to payroll</Link>}
      />
      <EntryForm ctx={{ ...ctx, employees: [emp] }} emp={emp} editable={editable} earningTypes={earningTypes ?? []} />
    </>
  );
}
