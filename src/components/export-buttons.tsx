"use client";
import { downloadCsv } from "@/lib/csv";

/** CSV (opens in Excel), Excel-compatible .xls (HTML table), and Print / Save as PDF. */
export function ExportButtons({ filename, rows }: { filename: string; rows: (string | number | null | undefined)[][] }) {
  function excel() {
    const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
    const isNum = (v: unknown) => typeof v === "number" || (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v));
    const html =
      `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"></head><body><table>` +
      rows
        .map((r, i) =>
          "<tr>" +
          r.map((v) => (i > 0 && isNum(v) ? `<td style="mso-number-format:'\\0022₱\\0022#,##0.00'">${v}</td>` : `<td>${esc(v)}</td>`)).join("") +
          "</tr>"
        )
        .join("") +
      "</table></body></html>";
    const blob = new Blob(["﻿" + html], { type: "application/vnd.ms-excel" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${filename}.xls`;
    a.click();
  }
  return (
    <div className="no-print flex gap-2">
      <button type="button" className="btn-secondary" onClick={() => downloadCsv(`${filename}.csv`, rows)}>CSV</button>
      <button type="button" className="btn-secondary" onClick={excel}>Excel</button>
      <button type="button" className="btn-secondary" onClick={() => window.print()}>Print / PDF</button>
    </div>
  );
}
