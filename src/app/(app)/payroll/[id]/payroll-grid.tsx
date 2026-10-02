"use client";
import Link from "next/link";
import { useMemo, useRef, useState, useTransition } from "react";
import { calculatePayroll } from "@/lib/payroll/engine";
import { peso } from "@/lib/payroll/money";
import { GRID_COLUMNS, applyGrid, buildInput, encodedToGrid, type EncodedEntry, type GridKey, type PeriodContext } from "@/lib/data/entry";
import { saveGrid } from "../actions";
import { downloadCsv, parseCsv } from "@/lib/csv";

type Row = { employeeId: string; encoded: EncodedEntry; dirty: boolean };

export function PayrollGrid({ ctx, editable }: { ctx: PeriodContext; editable: boolean }) {
  const inPayroll = ctx.employees.filter((e) => e.item);
  const [rows, setRows] = useState<Row[]>(() => inPayroll.map((e) => ({ employeeId: e.profile.id, encoded: e.item!.encoded, dirty: false })));
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"name" | "net">("name");
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [importPreview, setImportPreview] = useState<{ ok: { employeeId: string; name: string; values: Partial<Record<GridKey, number>> }[]; bad: string[] } | null>(null);
  const [pending, start] = useTransition();
  const tableRef = useRef<HTMLTableElement>(null);

  const empById = useMemo(() => new Map(ctx.employees.map((e) => [e.profile.id, e])), [ctx.employees]);
  const computed = useMemo(
    () =>
      rows.map((r) => {
        const emp = empById.get(r.employeeId)!;
        const result = calculatePayroll(buildInput(ctx, emp, r.encoded));
        const issues = [...emp.contextIssues, ...result.issues];
        return { row: r, emp, result, grid: encodedToGrid(r.encoded, emp.profile.salaryType), issues };
      }),
    [rows, ctx, empById]
  );
  const visible = computed
    .filter((c) => !search || `${c.emp.summary.name} ${c.emp.summary.employee_no}`.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => (sort === "net" ? b.result.netPay - a.result.netPay : a.emp.summary.name.localeCompare(b.emp.summary.name)));

  const setCell = (employeeId: string, key: GridKey, value: number) =>
    setRows((rs) =>
      rs.map((r) => {
        if (r.employeeId !== employeeId) return r;
        const emp = empById.get(employeeId)!;
        const g = encodedToGrid(r.encoded, emp.profile.salaryType);
        return { ...r, encoded: applyGrid(r.encoded, emp.profile.salaryType, { ...g, [key]: value }), dirty: true };
      })
    );

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>, ri: number, ci: number) {
    const moves: Record<string, [number, number]> = { ArrowDown: [1, 0], Enter: [1, 0], ArrowUp: [-1, 0] };
    if (e.key === "ArrowRight" && e.currentTarget.selectionStart === e.currentTarget.value.length) moves.ArrowRight = [0, 1];
    if (e.key === "ArrowLeft" && e.currentTarget.selectionStart === 0) moves.ArrowLeft = [0, -1];
    const mv = moves[e.key];
    if (!mv) return;
    e.preventDefault();
    const next = tableRef.current?.querySelector<HTMLInputElement>(`input[data-r="${ri + mv[0]}"][data-c="${ci + mv[1]}"]`);
    next?.focus();
    next?.select();
  }

  /** Paste a block copied from Excel / Google Sheets starting at this cell. */
  function onPaste(e: React.ClipboardEvent<HTMLInputElement>, ri: number, ci: number) {
    const text = e.clipboardData.getData("text");
    if (!text.includes("\t") && !text.includes("\n")) return;
    e.preventDefault();
    const lines = text.replace(/\r/g, "").split("\n").filter((l) => l.length);
    lines.forEach((line, dr) => {
      const target = visible[ri + dr];
      if (!target) return;
      line.split("\t").forEach((cell, dc) => {
        const col = GRID_COLUMNS[ci + dc];
        if (!col) return;
        const v = Number(cell.replace(/[₱,\s]/g, ""));
        if (Number.isFinite(v) && v >= 0) setCell(target.row.employeeId, col.key, v);
      });
    });
  }

  function save() {
    const dirty = rows.filter((r) => r.dirty);
    if (!dirty.length) return setMsg({ tone: "ok", text: "Nothing to save." });
    start(async () => {
      const res = await saveGrid(ctx.period.id, dirty.map(({ employeeId, encoded }) => ({ employeeId, encoded })));
      if (res.error) setMsg({ tone: "error", text: res.error });
      else {
        setMsg({ tone: "ok", text: res.ok ?? "Saved." });
        setRows((rs) => rs.map((r) => ({ ...r, dirty: false })));
      }
    });
  }

  function exportCsv() {
    const header = ["Employee No", "Employee", ...GRID_COLUMNS.map((c) => c.label), "Gross", "Deductions", "Net Pay"];
    const body = computed.map((c) => [
      c.emp.summary.employee_no,
      c.emp.summary.name,
      ...GRID_COLUMNS.map((col) => c.grid[col.key]),
      c.result.grossPay.toFixed(2),
      c.result.totalDeductions.toFixed(2),
      c.result.netPay.toFixed(2),
    ]);
    downloadCsv(`payroll-grid-${ctx.period.code}.csv`, [header, ...body]);
  }

  async function importCsv(file: File) {
    const table = parseCsv(await file.text());
    const header = table[0]?.map((h) => h.trim().toLowerCase()) ?? [];
    const noIdx = header.findIndex((h) => h === "employee no" || h === "employee_no");
    if (noIdx < 0) return setImportPreview({ ok: [], bad: ['The file needs an "Employee No" column. Export the grid first to get the template.'] });
    const colIdx = GRID_COLUMNS.map((c) => ({ key: c.key, idx: header.findIndex((h) => h === c.label.toLowerCase() || h === c.key.toLowerCase()) }));
    const ok: NonNullable<typeof importPreview>["ok"] = [];
    const bad: string[] = [];
    const seen = new Set<string>();
    table.slice(1).forEach((line, i) => {
      if (!line.some((c) => c.trim())) return;
      const no = line[noIdx]?.trim();
      const emp = ctx.employees.find((e) => e.summary.employee_no === no);
      if (!no) return bad.push(`Row ${i + 2}: missing employee number.`);
      if (!emp) return bad.push(`Row ${i + 2}: employee number ${no} is not in this payroll's eligible list.`);
      if (seen.has(no)) return bad.push(`Row ${i + 2}: duplicate employee ${no}.`);
      const values: Partial<Record<GridKey, number>> = {};
      for (const { key, idx } of colIdx) {
        if (idx < 0) continue;
        const raw = (line[idx] ?? "").replace(/[₱,\s]/g, "");
        if (raw === "") continue;
        const v = Number(raw);
        if (!Number.isFinite(v) || v < 0) return bad.push(`Row ${i + 2} (${no}): invalid amount "${line[idx]}" in ${key}.`);
        values[key] = v;
      }
      seen.add(no);
      ok.push({ employeeId: emp.profile.id, name: emp.summary.name, values });
    });
    setImportPreview({ ok, bad });
  }

  function applyImport() {
    if (!importPreview) return;
    setRows((rs) => {
      const next = [...rs];
      for (const imp of importPreview.ok) {
        const emp = empById.get(imp.employeeId)!;
        let r = next.find((x) => x.employeeId === imp.employeeId);
        if (!r) {
          r = { employeeId: imp.employeeId, encoded: emp.defaultEncoded, dirty: true };
          next.push(r);
        }
        const g = encodedToGrid(r.encoded, emp.profile.salaryType);
        const idx = next.indexOf(r);
        next[idx] = { ...r, encoded: applyGrid(r.encoded, emp.profile.salaryType, { ...g, ...imp.values }), dirty: true };
      }
      return next;
    });
    setMsg({ tone: "ok", text: `Imported ${importPreview.ok.length} row(s). Review, then Save.` });
    setImportPreview(null);
  }

  const totals = computed.reduce(
    (a, c) => ({ gross: a.gross + c.result.grossPay, ded: a.ded + c.result.totalDeductions, net: a.net + c.result.netPay }),
    { gross: 0, ded: 0, net: 0 }
  );
  const dirtyCount = rows.filter((r) => r.dirty).length;

  return (
    <section className="card mb-4">
      <div className="no-print flex flex-wrap items-center gap-2 border-b border-slate-200 p-3">
        <h2 className="mr-auto text-sm font-semibold">Payroll grid {editable && <span className="font-normal text-slate-500">— type, use arrow keys/Enter, or paste from Excel</span>}</h2>
        <input className="input w-48" placeholder="Search employee" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="input w-36" value={sort} onChange={(e) => setSort(e.target.value as "name" | "net")}>
          <option value="name">Sort: name</option>
          <option value="net">Sort: net pay</option>
        </select>
        <button className="btn-secondary" onClick={exportCsv} type="button">Export CSV</button>
        {editable && (
          <label className="btn-secondary cursor-pointer">
            Import CSV
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && importCsv(e.target.files[0])} />
          </label>
        )}
        {editable && (
          <button className="btn-primary" onClick={save} disabled={pending || !dirtyCount} type="button">
            {pending ? "Saving…" : `Save ${dirtyCount ? `(${dirtyCount})` : ""}`}
          </button>
        )}
      </div>
      {msg && <div className={`mx-3 mt-3 rounded-md px-3 py-2 text-sm ${msg.tone === "error" ? "bg-red-50 text-red-800" : "bg-emerald-50 text-emerald-800"}`}>{msg.text}</div>}
      {importPreview && (
        <div className="m-3 rounded-md border border-sky-200 bg-sky-50 p-3 text-sm">
          <div className="font-semibold">Import preview</div>
          <div>{importPreview.ok.length} valid row(s): {importPreview.ok.map((o) => o.name).join(", ") || "none"}</div>
          {importPreview.bad.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-red-800">{importPreview.bad.map((b) => <li key={b}>{b}</li>)}</ul>
          )}
          <div className="mt-2 flex gap-2">
            <button className="btn-primary" onClick={applyImport} disabled={!importPreview.ok.length} type="button">Apply valid rows</button>
            <button className="btn-secondary" onClick={() => setImportPreview(null)} type="button">Cancel</button>
          </div>
          <div className="mt-1 text-xs text-slate-600">Invalid rows are never applied.</div>
        </div>
      )}
      <div className="overflow-x-auto">
        <table ref={tableRef} className="table min-w-[1400px]">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-slate-50">Employee</th>
              {GRID_COLUMNS.map((c) => <th key={c.key} title={c.hint} className="num">{c.label}</th>)}
              <th className="num">Gross</th><th className="num">SSS</th><th className="num">PHIC</th><th className="num">HDMF</th><th className="num">Tax</th><th className="num">Loans</th><th className="num">Net pay</th><th />
            </tr>
          </thead>
          <tbody>
            {visible.map((c, ri) => {
              const errors = c.issues.filter((i) => i.level === "error");
              const warns = c.issues.filter((i) => i.level === "warning");
              return (
                <tr key={c.row.employeeId} className={c.row.dirty ? "bg-amber-50/50" : ""}>
                  <td className="sticky left-0 z-10 min-w-52 bg-white">
                    <Link href={`/payroll/${ctx.period.id}/entry/${c.row.employeeId}`} className="font-medium text-brand-700 hover:underline">{c.emp.summary.name}</Link>
                    <div className="text-[11px] text-slate-500">
                      {c.emp.summary.employee_no} · {c.emp.profile.salaryType} · {c.row.encoded.mode}
                      {c.emp.summary.is_test_data && <span className="ml-1 font-bold text-orange-600">TEST</span>}
                    </div>
                    {(errors.length > 0 || warns.length > 0) && (
                      <div className="text-[11px]" title={c.issues.map((i) => i.message).join("\n")}>
                        {errors.length > 0 && <span className="mr-2 font-semibold text-red-700">⛔ {errors.length} error</span>}
                        {warns.length > 0 && <span className="text-amber-700">⚠ {warns.length} warning</span>}
                      </div>
                    )}
                  </td>
                  {GRID_COLUMNS.map((col, ci) => (
                    <td key={col.key} className="px-1 py-1">
                      <input
                        data-r={ri}
                        data-c={ci}
                        className="input w-20 text-right tabular-nums"
                        inputMode="decimal"
                        disabled={!editable || c.row.encoded.mode === "manual"}
                        value={c.grid[col.key] || ""}
                        placeholder="0"
                        onChange={(e) => {
                          const v = Number(e.target.value.replace(/[₱,]/g, ""));
                          if (e.target.value === "" || (Number.isFinite(v) && v >= 0)) setCell(c.row.employeeId, col.key, e.target.value === "" ? 0 : v);
                        }}
                        onKeyDown={(e) => onKeyDown(e, ri, ci)}
                        onPaste={(e) => onPaste(e, ri, ci)}
                        onFocus={(e) => e.target.select()}
                      />
                    </td>
                  ))}
                  <td className="num">{peso(c.result.grossPay)}</td>
                  <td className="num">{peso(c.result.statutory.sssEE + c.result.statutory.sssMpfEE)}</td>
                  <td className="num">{peso(c.result.statutory.philhealthEE)}</td>
                  <td className="num">{peso(c.result.statutory.pagibigEE)}</td>
                  <td className="num">{peso(c.result.tax.withholdingTax)}</td>
                  <td className="num">{peso(c.result.totalLoans)}</td>
                  <td className={`num font-semibold ${c.result.netPay < 0 ? "text-red-700" : ""}`}>{peso(c.result.netPay)}</td>
                  <td><Link href={`/payroll/${ctx.period.id}/entry/${c.row.employeeId}`} className="text-xs text-brand-700 hover:underline">{editable ? "Detail" : "View"}</Link></td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <td className="sticky left-0 bg-white px-3 py-2">Totals ({computed.length})</td>
              <td colSpan={GRID_COLUMNS.length} />
              <td className="num px-3">{peso(totals.gross)}</td>
              <td colSpan={5} className="num px-3 text-xs font-normal text-slate-500">Deductions {peso(totals.ded)}</td>
              <td className="num px-3">{peso(totals.net)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      {editable && <p className="px-3 py-2 text-[11px] text-slate-500">Employees in Manual mode are edited from their detail page. Values update instantly; nothing is stored until you click Save.</p>}
    </section>
  );
}
