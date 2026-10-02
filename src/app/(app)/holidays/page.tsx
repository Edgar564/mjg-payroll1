import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/data/session";
import { can } from "@/lib/roles";
import { friendlyError, str } from "@/lib/data/errors";
import { ActionForm, SubmitButton, type ActionResult } from "@/components/action-form";
import { Empty, PageHeader, StatusBadge, fmtDate, label } from "@/components/ui";

async function addHoliday(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  "use server";
  const { supabase, role } = await getSession();
  if (!can.editReference(role)) return { error: "Your role cannot edit the holiday calendar." };
  const date = str(fd.get("holiday_date"));
  const name = str(fd.get("name"));
  const source = str(fd.get("source"));
  if (!date || !name) return { error: "Date and name are required." };
  if (!source) return { error: "Enter the source (proclamation / reference)." };
  const { error } = await supabase.from("holidays").insert({ holiday_date: date, name, holiday_type: String(fd.get("holiday_type")), region: str(fd.get("region")), source });
  if (error) return { error: friendlyError(error) };
  revalidatePath("/holidays");
  return { ok: "Holiday added. Recalculate open payrolls that cover this date." };
}

async function toggleHoliday(fd: FormData) {
  "use server";
  const { supabase, role } = await getSession();
  if (!can.editReference(role)) return;
  await supabase.from("holidays").update({ status: fd.get("status") }).eq("id", String(fd.get("id")));
  revalidatePath("/holidays");
}

export default async function HolidaysPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const sp = await searchParams;
  const year = sp.year ?? String(new Date().getFullYear());
  const { supabase, role } = await getSession();
  const { data } = await supabase.from("holidays").select("*").gte("holiday_date", `${year}-01-01`).lte("holiday_date", `${year}-12-31`).order("holiday_date");
  const multiplier: Record<string, string> = { regular: "200% if worked · 100% if unworked", special_non_working: "130% if worked · no work, no pay", special_working: "Ordinary day", local: "Treated as special day", company: "Per company policy" };
  return (
    <>
      <PageHeader title="Holiday calendar" subtitle="Payroll identifies holidays from the employee's work dates. Multipliers come from the Pay Rates configuration." />
      {can.editReference(role) && (
        <ActionForm action={addHoliday} resetOnSuccess className="card mb-4 grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-6">
          <label><span className="label">Date</span><input type="date" name="holiday_date" className="input" required /></label>
          <label className="lg:col-span-2"><span className="label">Name</span><input name="name" className="input" required /></label>
          <label><span className="label">Type</span><select name="holiday_type" className="input"><option value="regular">Regular holiday</option><option value="special_non_working">Special non-working</option><option value="special_working">Special working</option><option value="local">Local holiday</option><option value="company">Company holiday</option></select></label>
          <label><span className="label">Region (blank = nationwide)</span><input name="region" className="input" placeholder="e.g. IV-A" /></label>
          <label className="lg:col-span-4"><span className="label">Source / reference *</span><input name="source" className="input" placeholder="e.g. Proclamation No. ___, s. 2026" required /></label>
          <div className="flex items-end"><SubmitButton>Add holiday</SubmitButton></div>
        </ActionForm>
      )}
      <form className="mb-3 flex items-end gap-2">
        <label><span className="label">Year</span><input name="year" defaultValue={year} className="input w-28" inputMode="numeric" /></label>
        <button className="btn-secondary">Show</button>
      </form>
      <div className="card overflow-x-auto">
        <table className="table">
          <thead><tr><th>Date</th><th>Holiday</th><th>Type</th><th>Pay rule (default)</th><th>Region</th><th>Source</th><th>Status</th><th /></tr></thead>
          <tbody>
            {(data ?? []).map((h) => (
              <tr key={h.id} className={h.status === "cancelled" ? "opacity-50" : ""}>
                <td className="whitespace-nowrap">{fmtDate(h.holiday_date)} <span className="text-xs text-slate-500">{new Date(h.holiday_date + "T00:00:00").toLocaleDateString("en", { weekday: "short" })}</span></td>
                <td>{h.name}</td><td>{label(h.holiday_type)}</td><td className="text-xs">{multiplier[h.holiday_type]}</td><td>{h.region ?? "Nationwide"}</td><td className="text-xs">{h.source}</td>
                <td><StatusBadge status={h.status === "active" ? "active" : "cancelled"} /></td>
                <td>{can.editReference(role) && (
                  <form action={toggleHoliday}><input type="hidden" name="id" value={h.id} /><input type="hidden" name="status" value={h.status === "active" ? "cancelled" : "active"} /><button className="text-xs text-brand-700 hover:underline">{h.status === "active" ? "Cancel" : "Restore"}</button></form>
                )}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data?.length && <Empty>No holidays recorded for {year}.</Empty>}
      </div>
      <p className="mt-2 text-xs text-slate-500">Eid&apos;l Fitr and Eid&apos;l Adha are proclaimed separately each year — add them when their proclamations are issued.</p>
    </>
  );
}
