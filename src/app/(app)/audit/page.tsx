import { requireRole } from "@/lib/data/session";
import { can } from "@/lib/roles";
import { Empty, PageHeader, fmtDateTime } from "@/components/ui";

const ENTITIES = ["payroll_periods", "payroll_items", "payroll_payments", "payroll_adjustments", "employees", "employee_government_ids", "loan_accounts", "loan_transactions", "statutory_configurations", "holidays", "minimum_wage_rates", "thirteenth_month_records", "profiles", "company_settings"];

function diff(oldV: Record<string, unknown> | null, newV: Record<string, unknown> | null) {
  if (!oldV || !newV) return null;
  const skip = new Set(["updated_at", "result", "input"]);
  return Object.keys(newV)
    .filter((k) => !skip.has(k) && JSON.stringify(oldV[k]) !== JSON.stringify(newV[k]))
    .map((k) => ({ k, from: oldV[k], to: newV[k] }));
}
const show = (v: unknown) => (v === null || v === undefined ? "—" : typeof v === "object" ? JSON.stringify(v).slice(0, 80) : String(v));

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ entity?: string; action?: string; page?: string }> }) {
  const sp = await searchParams;
  const { supabase } = await requireRole(can.readAudit);
  const page = Math.max(0, Number(sp.page ?? 0));
  let q = supabase.from("audit_logs").select("*").order("at", { ascending: false }).range(page * 100, page * 100 + 99);
  if (sp.entity) q = q.eq("entity", sp.entity);
  if (sp.action) q = q.ilike("action", `${sp.action}%`);
  const { data: logs } = await q;
  return (
    <>
      <PageHeader title="Audit trail" subtitle="Append-only. Every create, edit, override, approval, posting, lock, reversal and payment is recorded." />
      <form className="card mb-4 flex flex-wrap items-end gap-3 p-3">
        <label><span className="label">Record type</span><select name="entity" defaultValue={sp.entity ?? ""} className="input"><option value="">All</option>{ENTITIES.map((e) => <option key={e} value={e}>{e.replace(/_/g, " ")}</option>)}</select></label>
        <label><span className="label">Action</span><select name="action" defaultValue={sp.action ?? ""} className="input"><option value="">All</option><option value="create">Create</option><option value="update">Update</option><option value="delete">Delete</option><option value="status">Status change</option><option value="manual_override">Manual override</option><option value="reverse">Reversal</option></select></label>
        <button className="btn-secondary">Filter</button>
      </form>
      <div className="card overflow-x-auto">
        <table className="table">
          <thead><tr><th>When</th><th>User</th><th>Action</th><th>Record</th><th>Changes</th><th>Reason</th><th>IP / device</th></tr></thead>
          <tbody>
            {(logs ?? []).map((l) => {
              const d = diff(l.old_value, l.new_value);
              return (
                <tr key={l.id}>
                  <td className="whitespace-nowrap text-xs">{fmtDateTime(l.at)}</td>
                  <td className="text-xs">{l.user_email ?? "system"}</td>
                  <td className="text-xs font-medium">{l.action}</td>
                  <td className="text-xs">{l.entity.replace(/_/g, " ")}<div className="font-mono text-[10px] text-slate-400">{l.entity_id}</div></td>
                  <td className="max-w-md text-xs">
                    {d && d.length > 0 ? (
                      <ul>{d.slice(0, 8).map((c) => <li key={c.k}><b>{c.k}</b>: {show(c.from)} → {show(c.to)}</li>)}</ul>
                    ) : l.action === "manual_override" ? (
                      <ul>{(l.new_value?.overrides ?? []).map((o: { key: string; automatic: number; manual: number; variance: number }, i: number) => <li key={i}><b>{o.key}</b>: auto {o.automatic} → manual {o.manual} (variance {o.variance})</li>)}</ul>
                    ) : (
                      <span className="text-slate-400">{l.action === "create" ? "New record" : l.action === "delete" ? "Deleted" : ""}</span>
                    )}
                  </td>
                  <td className="max-w-xs text-xs">{l.reason ?? ""}</td>
                  <td className="max-w-40 truncate text-[10px] text-slate-500" title={l.user_agent ?? ""}>{l.ip ?? ""} {l.user_agent ? "· " + l.user_agent.slice(0, 30) : ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!logs?.length && <Empty>No audit entries.</Empty>}
      </div>
      <div className="mt-3 flex gap-2">
        {page > 0 && <a className="btn-secondary" href={`?entity=${sp.entity ?? ""}&action=${sp.action ?? ""}&page=${page - 1}`}>Newer</a>}
        {logs?.length === 100 && <a className="btn-secondary" href={`?entity=${sp.entity ?? ""}&action=${sp.action ?? ""}&page=${page + 1}`}>Older</a>}
      </div>
    </>
  );
}
