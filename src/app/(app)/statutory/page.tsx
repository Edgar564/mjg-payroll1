import { getSession } from "@/lib/data/session";
import { can } from "@/lib/roles";
import { peso } from "@/lib/payroll/money";
import { DAY_TYPE_LABELS, type DayType } from "@/lib/payroll/types";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { COMPLIANCE_NOTE, Notice, PageHeader, StatusBadge, fmtDate, label } from "@/components/ui";
import { activateConfig, addConfigVersion, addMinimumWage, deleteDraft, retireConfig } from "./actions";

const KINDS = [
  { kind: "sss", title: "SSS contribution table", official: "https://www.sss.gov.ph/" },
  { kind: "philhealth", title: "PhilHealth premium", official: "https://www.philhealth.gov.ph/" },
  { kind: "pagibig", title: "Pag-IBIG / HDMF", official: "https://www.pagibigfund.gov.ph/" },
  { kind: "bir", title: "BIR withholding tax tables", official: "https://www.bir.gov.ph/" },
  { kind: "pay_rates", title: "Overtime, holiday & NSD multipliers", official: "https://www.dole.gov.ph/" },
] as const;

/* eslint-disable @typescript-eslint/no-explicit-any */
function PayloadView({ kind, p }: { kind: string; p: any }) {
  const pct = (n: number) => `${+(n * 100).toFixed(4)}%`;
  if (kind === "sss")
    return (
      <div className="max-h-80 overflow-y-auto">
        <div className="mb-1 text-xs">Employee {pct(p.eeRate)} · Employer {pct(p.erRate)} of MSC</div>
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-white"><tr className="text-slate-500"><th className="text-left">Compensation range</th><th className="text-right">MSC regular</th><th className="text-right">MSC MPF</th><th className="text-right">EE</th><th className="text-right">ER</th><th className="text-right">EC</th><th className="text-right">Total</th></tr></thead>
          <tbody>
            {p.brackets.map((b: any, i: number) => {
              const msc = b.mscRegular + b.mscMpf;
              return (
                <tr key={i} className="border-t border-slate-100">
                  <td>{i === 0 ? `Below ${peso(p.brackets[1]?.rangeFrom ?? 0)}` : b.rangeTo === null ? `${peso(b.rangeFrom)} and above` : `${peso(b.rangeFrom)} – ${peso(b.rangeTo)}`}</td>
                  <td className="num">{peso(b.mscRegular)}</td><td className="num">{peso(b.mscMpf)}</td>
                  <td className="num">{peso(msc * p.eeRate)}</td><td className="num">{peso(msc * p.erRate)}</td><td className="num">{peso(b.ec)}</td>
                  <td className="num">{peso(msc * (p.eeRate + p.erRate) + b.ec)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  if (kind === "philhealth")
    return <div className="text-sm">Premium {pct(p.rate)} of monthly basic salary · floor {peso(p.floor)} · ceiling {peso(p.ceiling)} · employee share {pct(p.eeShare)} of premium</div>;
  if (kind === "pagibig")
    return (
      <div className="text-sm">
        Maximum fund salary {peso(p.maxFundSalary)}
        <ul className="ml-4 list-disc">{p.tiers.map((t: any, i: number) => <li key={i}>{t.upTo === null ? "Above" : `Up to ${peso(t.upTo)}`}: employee {pct(t.eeRate)}, employer {pct(t.erRate)}</li>)}</ul>
      </div>
    );
  if (kind === "bir")
    return (
      <div className="grid gap-3 text-xs md:grid-cols-2">
        <div className="md:col-span-2 text-sm">13th month &amp; other benefits exemption: {peso(p.otherBenefitsThreshold)} per year</div>
        {Object.entries(p.tables).map(([f, rows]: [string, any]) => (
          <div key={f}>
            <div className="font-semibold">{label(f)}</div>
            <table className="w-full">
              <tbody>{rows.map((r: any, i: number) => <tr key={i} className="border-t border-slate-100"><td>Over {peso(r.over)}</td><td className="num">{peso(r.fixed)}</td><td className="num">+ {pct(r.rate)} of excess</td></tr>)}</tbody>
            </table>
          </div>
        ))}
      </div>
    );
  if (kind === "pay_rates")
    return (
      <table className="w-full max-w-lg text-xs">
        <thead><tr className="text-slate-500"><th className="text-left">Day type</th><th className="text-right">First 8 hrs</th><th className="text-right">Overtime</th></tr></thead>
        <tbody>
          {Object.keys(p.work).map((d) => <tr key={d} className="border-t border-slate-100"><td>{DAY_TYPE_LABELS[d as DayType]}</td><td className="num">{pct(p.work[d])}</td><td className="num">{pct(p.ot[d])}</td></tr>)}
          <tr className="border-t border-slate-100"><td>Night differential</td><td className="num" colSpan={2}>{pct(p.nsdRate)} of applicable hourly rate</td></tr>
          <tr className="border-t border-slate-100"><td>Unworked regular holiday</td><td className="num" colSpan={2}>{pct(p.unworkedRegularHoliday)}</td></tr>
        </tbody>
      </table>
    );
  return <pre className="text-xs">{JSON.stringify(p, null, 2)}</pre>;
}

export default async function StatutoryPage() {
  const { supabase, role } = await getSession();
  const today = new Date().toISOString().slice(0, 10);
  const [{ data: configs }, { data: wages }] = await Promise.all([
    supabase.from("statutory_configurations").select("*").order("effective_from", { ascending: false }),
    supabase.from("minimum_wage_rates").select("*").order("region").order("effective_from", { ascending: false }),
  ]);
  const admin = can.editConfig(role);
  return (
    <>
      <PageHeader title="Statutory tables" subtitle="Dated, versioned configuration. Payroll uses the version effective on the period end date. Historical versions are never overwritten." />
      <Notice tone="warning">{COMPLIANCE_NOTE}</Notice>
      {KINDS.map(({ kind, title, official }) => {
        const list = (configs ?? []).filter((c) => c.kind === kind);
        const current = list.find((c) => c.status === "active" && c.effective_from <= today && (!c.effective_to || c.effective_to >= today));
        return (
          <section key={kind} className="card mb-4 p-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold">{title}</h2>
              <a href={official} target="_blank" rel="noreferrer" className="text-xs text-brand-700 hover:underline">Official source ↗</a>
            </div>
            {!current && <Notice tone="error" title="⚠ STATUTORY CONFIGURATION WARNING">No active configuration covers today. Payroll cannot be finalized until one is activated.</Notice>}
            {list.map((c) => (
              <details key={c.id} className="mb-2 rounded-md border border-slate-200 p-3" open={c.id === current?.id}>
                <summary className="flex cursor-pointer flex-wrap items-center gap-3 text-sm">
                  <span className="font-medium">{c.name}</span>
                  <StatusBadge status={c.status} />
                  <span className="text-xs text-slate-500">{fmtDate(c.effective_from)} → {c.effective_to ? fmtDate(c.effective_to) : "open"}</span>
                  {c.id === current?.id && <span className="text-xs font-semibold text-emerald-700">IN USE TODAY</span>}
                  {c.effective_to && c.effective_to < today && c.status === "active" && <span className="text-xs text-slate-500">expired (kept for historical payroll)</span>}
                </summary>
                <div className="mt-2 text-xs text-slate-600"><b>Source:</b> {c.source}{c.notes && <> · <b>Notes:</b> {c.notes}</>}</div>
                <div className="mt-3"><PayloadView kind={kind} p={c.payload} /></div>
                {admin && (
                  <div className="mt-3 flex gap-2">
                    {c.status === "draft" && (
                      <>
                        <form action={activateConfig}><input type="hidden" name="id" value={c.id} /><button className="btn-primary text-xs">Activate</button></form>
                        <form action={deleteDraft}><input type="hidden" name="id" value={c.id} /><button className="btn-danger text-xs">Delete draft</button></form>
                      </>
                    )}
                    {c.status === "active" && <form action={retireConfig}><input type="hidden" name="id" value={c.id} /><button className="btn-secondary text-xs">Retire</button></form>}
                  </div>
                )}
              </details>
            ))}
            {admin && (
              <details className="mt-2">
                <summary className="cursor-pointer text-sm text-brand-700">+ Add new version (e.g. new circular)</summary>
                <ActionForm action={addConfigVersion} className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  <input type="hidden" name="kind" value={kind} />
                  <label className="lg:col-span-2"><span className="label">Name</span><input name="name" className="input" required placeholder={`${title} 2027`} /></label>
                  <label><span className="label">Effective from</span><input type="date" name="effective_from" className="input" required /></label>
                  <label><span className="label">Effective to (optional)</span><input type="date" name="effective_to" className="input" /></label>
                  <label className="lg:col-span-4"><span className="label">Official source / issuance *</span><input name="source" className="input" required placeholder="e.g. SSS Circular No. 20XX-XXX" /></label>
                  <label className="lg:col-span-4"><span className="label">Table data (JSON — pre-filled from the current version; edit only the values that changed)</span>
                    <textarea name="payload" className="input h-48 font-mono text-xs" defaultValue={JSON.stringify((current ?? list[0])?.payload ?? {}, null, 2)} required />
                  </label>
                  <label className="lg:col-span-3"><span className="label">Notes</span><input name="notes" className="input" /></label>
                  <div className="flex items-end"><SubmitButton>Save as draft</SubmitButton></div>
                </ActionForm>
              </details>
            )}
          </section>
        );
      })}

      <section className="card mb-4 p-4">
        <h2 className="mb-2 text-base font-semibold">Minimum wage by region</h2>
        <p className="mb-3 text-xs text-slate-500">The employee&apos;s work region, province, city and sector select the applicable rate. Source: <a className="text-brand-700 underline" href="https://nwpc.dole.gov.ph/" target="_blank" rel="noreferrer">NWPC</a>.</p>
        <div className="overflow-x-auto">
          <table className="table">
            <thead><tr><th>Region</th><th>Province / City</th><th>Area</th><th>Sector</th><th>Wage order</th><th>Effective</th><th className="num">Daily rate</th></tr></thead>
            <tbody>
              {(wages ?? []).map((w) => (
                <tr key={w.id}><td>{w.region}</td><td>{[w.province, w.city].filter(Boolean).join(" / ") || "All"}</td><td>{w.area_classification ?? "—"}</td><td>{label(w.sector)}</td><td>{w.wage_order}</td><td>{fmtDate(w.effective_from)}{w.effective_to ? ` – ${fmtDate(w.effective_to)}` : ""}</td><td className="num">{peso(w.daily_rate)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        {can.editReference(role) && (
          <ActionForm action={addMinimumWage} resetOnSuccess className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-6">
            <input name="region" className="input" placeholder="Region e.g. NCR" required />
            <input name="province" className="input" placeholder="Province (optional)" />
            <input name="city" className="input" placeholder="City (optional)" />
            <input name="area_classification" className="input" placeholder="Area classification" />
            <select name="sector" className="input"><option value="non_agriculture">Non-agriculture</option><option value="retail_service">Retail/service</option><option value="agriculture">Agriculture</option><option value="other">Other</option></select>
            <input name="daily_rate" className="input" placeholder="Daily rate ₱" inputMode="decimal" required />
            <input name="wage_order" className="input" placeholder="Wage order no." required />
            <input type="date" name="effective_from" className="input" required />
            <input type="date" name="effective_to" className="input" />
            <input name="source" className="input lg:col-span-2" placeholder="Source" />
            <SubmitButton variant="secondary">Add rate</SubmitButton>
          </ActionForm>
        )}
      </section>
    </>
  );
}
