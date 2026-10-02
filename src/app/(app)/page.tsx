import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/data/session";
import { can } from "@/lib/roles";
import { peso, sum } from "@/lib/payroll/money";
import { COMPLIANCE_NOTE, Notice, PageHeader, StatCard, StatusBadge, fmtDate } from "@/components/ui";

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const sp = await searchParams;
  const { supabase, role } = await getSession();
  if (role === "employee") redirect("/payslips");
  const today = new Date().toISOString().slice(0, 10);
  const year = today.slice(0, 4);

  const [periods, empCount, loans, configs, yearItems] = await Promise.all([
    supabase.from("payroll_periods").select("*").neq("status", "cancelled").order("period_start", { ascending: false }).limit(12),
    supabase.from("employees").select("id", { count: "exact", head: true }).is("deleted_at", null).not("employment_status", "in", "(resigned,terminated,inactive,applicant)"),
    can.readPayroll(role) ? supabase.from("loan_accounts").select("balance").eq("status", "active") : Promise.resolve({ data: [] as { balance: number }[] }),
    supabase.from("statutory_configurations").select("kind, effective_to").eq("status", "active").lte("effective_from", today),
    can.readPayroll(role)
      ? supabase.from("payroll_items").select("thirteenth_month_basis, gross_pay, net_pay, employer_cost, payroll_periods!inner(pay_date, status, code)").gte("payroll_periods.pay_date", `${year}-01-01`).neq("payroll_periods.status", "cancelled")
      : Promise.resolve({ data: [] as never[] }),
  ]);

  const list = periods.data ?? [];
  const current = list.find((p) => p.period_start <= today && p.period_end >= today) ?? list[0];
  const pending = list.filter((p) => p.status === "for_review" || p.status === "approved");
  const upcoming = list.filter((p) => p.pay_date >= today && !["paid", "locked"].includes(p.status)).sort((a, b) => a.pay_date.localeCompare(b.pay_date))[0];
  let cur = { gross: 0, net: 0, ee: 0, er: 0, cost: 0, n: 0 };
  if (current && can.readPayroll(role)) {
    const { data } = await supabase.from("payroll_items").select("*").eq("period_id", current.id);
    const I = data ?? [];
    const t = (k: string) => sum(I.map((i) => Number(i[k])));
    cur = { gross: t("gross_pay"), net: t("net_pay"), ee: t("total_deductions"), er: sum([t("sss_er"), t("sss_ec"), t("philhealth_er"), t("pagibig_er")]), cost: t("employer_cost"), n: I.length };
  }
  const activeKinds = new Set((configs.data ?? []).filter((c) => !c.effective_to || c.effective_to >= today).map((c) => c.kind));
  const missing = ["sss", "philhealth", "pagibig", "bir", "pay_rates"].filter((k) => !activeKinds.has(k));
  const thirteenth = sum(((yearItems.data ?? []) as { thirteenth_month_basis: number }[]).map((i) => Number(i.thirteenth_month_basis))) / 12;

  // monthly trend for the year
  const byMonth = new Map<string, number>();
  for (const i of (yearItems.data ?? []) as unknown as { gross_pay: number; payroll_periods: { pay_date: string } }[]) {
    const m = i.payroll_periods.pay_date.slice(0, 7);
    byMonth.set(m, (byMonth.get(m) ?? 0) + Number(i.gross_pay));
  }
  const months = [...byMonth.entries()].sort();
  const max = Math.max(1, ...months.map(([, v]) => v));

  return (
    <>
      <PageHeader title="Dashboard" subtitle="MJGarcia Trading payroll overview" />
      {sp.denied && <Notice tone="warning" title="Your role does not have access to that page." />}
      <Notice tone="info">{COMPLIANCE_NOTE}</Notice>
      {missing.length > 0 && (
        <Notice tone="error" title="⚠ STATUTORY CONFIGURATION WARNING">
          No active configuration for today: {missing.join(", ").toUpperCase()}. Payroll cannot be finalized until an administrator adds one under{" "}
          <Link href="/statutory" className="underline">Statutory Tables</Link>.
        </Notice>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="card p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Current payroll period</div>
          {current ? (
            <>
              <Link href={`/payroll/${current.id}`} className="mt-1 block text-lg font-semibold text-brand-700 hover:underline">{current.code}</Link>
              <div className="text-xs text-slate-500">{fmtDate(current.period_start)} – {fmtDate(current.period_end)}</div>
              <div className="mt-1"><StatusBadge status={current.status} /></div>
            </>
          ) : (
            <div className="mt-1 text-sm text-slate-500">None yet — <Link href="/payroll" className="text-brand-700 underline">create one</Link></div>
          )}
        </div>
        <StatCard label="Active employees" value={String(empCount.count ?? 0)} />
        <StatCard label="Upcoming pay date" value={upcoming ? fmtDate(upcoming.pay_date) : "—"} hint={upcoming?.code} />
        <StatCard label="Pending approvals" value={String(pending.length)} hint={pending.map((p) => p.code).join(", ") || "Nothing waiting"} />
      </div>

      {can.readPayroll(role) && (
        <>
          <h2 className="mb-2 text-sm font-semibold text-slate-700">{current ? `Payroll ${current.code}` : "Current payroll"} ({cur.n} employees)</h2>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
            <StatCard label="Gross payroll" value={cur.gross} />
            <StatCard label="Employee deductions" value={cur.ee} />
            <StatCard label="Employer contributions" value={cur.er} />
            <StatCard label="Net payroll" value={cur.net} tone="brand" />
            <StatCard label="Total employer cost" value={cur.cost} />
          </div>
          <div className="mb-4 grid gap-3 lg:grid-cols-3">
            <StatCard label="Unpaid loan balances" value={sum((loans.data ?? []).map((l) => Number(l.balance)))} hint={`${loans.data?.length ?? 0} active loan(s)`} />
            <StatCard label={`13th month accrued ${year}`} value={thirteenth} hint="Basic salary earned ÷ 12, all employees" />
            <div className="card p-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Gross payroll by month, {year}</div>
              {months.length ? (
                <div className="flex h-24 items-end gap-1.5" role="img" aria-label="Gross payroll by month">
                  {months.map(([m, v]) => (
                    <div key={m} className="flex flex-1 flex-col items-center gap-1" title={`${m}: ${peso(v)}`}>
                      <div className="w-full rounded-t bg-brand-600" style={{ height: `${Math.max(4, (v / max) * 80)}px` }} />
                      <span className="text-[10px] text-slate-500">{new Date(m + "-01T00:00:00").toLocaleString("en", { month: "short" })}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-slate-500">No payroll yet this year.</div>
              )}
            </div>
          </div>
        </>
      )}

      <div className="card overflow-x-auto">
        <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold">Recent payroll periods</div>
        <table className="table">
          <thead><tr><th>Code</th><th>Period</th><th>Pay date</th><th>Status</th></tr></thead>
          <tbody>
            {list.slice(0, 6).map((p) => (
              <tr key={p.id}><td><Link className="text-brand-700 hover:underline" href={`/payroll/${p.id}`}>{p.code}</Link></td><td>{fmtDate(p.period_start)} – {fmtDate(p.period_end)}</td><td>{fmtDate(p.pay_date)}</td><td><StatusBadge status={p.status} /></td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
