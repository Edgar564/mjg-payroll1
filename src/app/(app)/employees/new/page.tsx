import { requireRole } from "@/lib/data/session";
import { can } from "@/lib/roles";
import { PageHeader } from "@/components/ui";
import { EmployeeForm } from "../employee-form";

export default async function NewEmployeePage() {
  const { supabase, role } = await requireRole(can.writeEmployees);
  const [p, d, b] = await Promise.all([
    supabase.from("positions").select("id, name").eq("active", true).order("name"),
    supabase.from("departments").select("id, name").eq("active", true).order("name"),
    supabase.from("branches").select("id, name").eq("active", true).order("name"),
  ]);
  return (
    <>
      <PageHeader title="Add employee" />
      <EmployeeForm positions={p.data ?? []} departments={d.data ?? []} branches={b.data ?? []} canGov={can.readGovIds(role)} canEdit />
    </>
  );
}
