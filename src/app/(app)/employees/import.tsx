"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { downloadCsv, parseCsv } from "@/lib/csv";
import { importEmployees, type ImportEmployee } from "./import-action";

const COLS = ["employee_no", "last_name", "first_name", "middle_name", "employment_status", "date_hired", "pay_frequency", "salary_type", "monthly_rate", "daily_rate", "hourly_rate", "work_region", "sss_no", "philhealth_no", "pagibig_no", "tin"];
const STATUSES = ["applicant", "probationary", "regular", "contractual", "casual", "part_time", "resigned", "terminated", "inactive"];

export function EmployeeImport({ existingNos }: { existingNos: string[] }) {
  const router = useRouter();
  const [preview, setPreview] = useState<{ ok: ImportEmployee[]; bad: string[] } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  async function load(file: File) {
    const t = parseCsv(await file.text());
    const h = t[0]?.map((x) => x.trim().toLowerCase()) ?? [];
    const missing = ["employee_no", "last_name", "first_name", "salary_type"].filter((c) => !h.includes(c));
    if (missing.length) return setPreview({ ok: [], bad: [`Missing required column(s): ${missing.join(", ")}. Download the template.`] });
    const ok: ImportEmployee[] = [];
    const bad: string[] = [];
    const seen = new Set(existingNos);
    t.slice(1).forEach((r, i) => {
      if (!r.some((c) => c.trim())) return;
      const get = (c: string) => (h.indexOf(c) >= 0 ? r[h.indexOf(c)]?.trim() ?? "" : "");
      const row = Object.fromEntries(COLS.map((c) => [c, get(c)])) as Record<string, string>;
      const n = i + 2;
      if (!row.employee_no || !row.last_name || !row.first_name) return bad.push(`Row ${n}: employee_no, last_name and first_name are required.`);
      if (seen.has(row.employee_no)) return bad.push(`Row ${n}: duplicate employee ${row.employee_no}.`);
      if (!["monthly", "daily", "hourly"].includes(row.salary_type)) return bad.push(`Row ${n}: salary_type must be monthly, daily or hourly.`);
      const rate = Number(row[`${row.salary_type}_rate`]);
      if (!(rate > 0)) return bad.push(`Row ${n}: ${row.salary_type}_rate must be a positive amount.`);
      if (row.employment_status && !STATUSES.includes(row.employment_status)) return bad.push(`Row ${n}: invalid employment_status.`);
      if (row.date_hired && !/^\d{4}-\d{2}-\d{2}$/.test(row.date_hired)) return bad.push(`Row ${n}: date_hired must be YYYY-MM-DD.`);
      if (row.pay_frequency && !["weekly", "semi_monthly", "monthly", "daily"].includes(row.pay_frequency)) return bad.push(`Row ${n}: invalid pay_frequency.`);
      seen.add(row.employee_no);
      ok.push(row as unknown as ImportEmployee);
    });
    setPreview({ ok, bad });
  }

  return (
    <details className="card mb-4 p-4">
      <summary className="cursor-pointer text-sm font-semibold text-brand-700">Import employees from CSV</summary>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="btn-secondary" onClick={() => downloadCsv("employee-import-template.csv", [COLS, ["E-001", "Dela Cruz", "Juan", "Santos", "regular", "2024-01-15", "semi_monthly", "daily", "", "700", "", "IV-A", "", "", "", ""]])}>Download template</button>
        <label className="btn-secondary cursor-pointer">Choose CSV<input type="file" accept=".csv" className="hidden" onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} /></label>
      </div>
      {preview && (
        <div className="mt-3 text-sm">
          <div className="font-semibold">{preview.ok.length} valid · {preview.bad.length} invalid (invalid rows are never inserted)</div>
          {preview.bad.length > 0 && <ul className="mt-1 list-disc pl-5 text-red-800">{preview.bad.slice(0, 20).map((b) => <li key={b}>{b}</li>)}</ul>}
          {preview.ok.length > 0 && (
            <table className="table mt-2"><thead><tr><th>No.</th><th>Name</th><th>Salary</th><th>Status</th></tr></thead>
              <tbody>{preview.ok.map((r) => <tr key={r.employee_no}><td>{r.employee_no}</td><td>{r.last_name}, {r.first_name}</td><td>{r.salary_type} {r[`${r.salary_type}_rate` as keyof ImportEmployee]}</td><td>{r.employment_status || "probationary"}</td></tr>)}</tbody>
            </table>
          )}
          <button className="btn-primary mt-2" disabled={!preview.ok.length || pending} onClick={() => start(async () => {
            const res = await importEmployees(preview.ok);
            setMsg(res.error ?? res.ok ?? null);
            if (!res.error) { setPreview(null); router.refresh(); }
          })}>{pending ? "Importing…" : `Import ${preview.ok.length} employee(s)`}</button>
        </div>
      )}
      {msg && <div className="mt-2 text-sm">{msg}</div>}
    </details>
  );
}
