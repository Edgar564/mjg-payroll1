import Link from "next/link";
import { peso } from "@/lib/payroll/money";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
        {subtitle && <div className="mt-0.5 text-sm text-slate-500">{subtitle}</div>}
      </div>
      {actions && <div className="no-print flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700",
  encoding: "bg-sky-100 text-sky-800",
  for_review: "bg-amber-100 text-amber-800",
  approved: "bg-indigo-100 text-indigo-800",
  posted: "bg-violet-100 text-violet-800",
  paid: "bg-emerald-100 text-emerald-800",
  locked: "bg-slate-800 text-white",
  cancelled: "bg-red-100 text-red-700",
  active: "bg-emerald-100 text-emerald-800",
  retired: "bg-slate-100 text-slate-500",
  pending: "bg-amber-100 text-amber-800",
  rejected: "bg-red-100 text-red-700",
  applied: "bg-emerald-100 text-emerald-800",
  unpaid: "bg-amber-100 text-amber-800",
  scheduled: "bg-sky-100 text-sky-800",
  failed: "bg-red-100 text-red-700",
  on_hold: "bg-slate-100 text-slate-600",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status] ?? "bg-slate-100 text-slate-700"}`}>
      {status.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())}
    </span>
  );
}

export function TestBadge() {
  return <span className="ml-1.5 rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-orange-700">Test data</span>;
}

export function StatCard({ label, value, hint, tone = "default" }: { label: string; value: string | number; hint?: string; tone?: "default" | "brand" | "muted" }) {
  return (
    <div className={`card p-4 ${tone === "brand" ? "border-brand-600 bg-brand-50" : ""}`}>
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="num mt-1 text-left text-xl font-semibold text-slate-900">{typeof value === "number" ? peso(value) : value}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

export function Notice({ tone = "info", title, children }: { tone?: "info" | "warning" | "error" | "success"; title?: string; children?: React.ReactNode }) {
  const styles = {
    info: "border-sky-200 bg-sky-50 text-sky-900",
    warning: "border-amber-300 bg-amber-50 text-amber-900",
    error: "border-red-300 bg-red-50 text-red-900",
    success: "border-emerald-300 bg-emerald-50 text-emerald-900",
  }[tone];
  return (
    <div className={`mb-4 rounded-md border px-4 py-3 text-sm ${styles}`}>
      {title && <div className="font-semibold">{title}</div>}
      {children && <div className={title ? "mt-1" : ""}>{children}</div>}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-10 text-center text-sm text-slate-500">{children}</div>;
}

export function Field({ label, children, hint, className = "" }: { label: string; children: React.ReactNode; hint?: string; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-0.5 block text-[11px] text-slate-500">{hint}</span>}
    </label>
  );
}

export function LinkButton({ href, children, variant = "secondary" }: { href: string; children: React.ReactNode; variant?: "primary" | "secondary" }) {
  return (
    <Link href={href} className={variant === "primary" ? "btn-primary" : "btn-secondary"}>
      {children}
    </Link>
  );
}

export const COMPLIANCE_NOTE =
  "Payroll statutory rates are configurable and must be verified against the latest applicable government issuance before payroll processing.";

export function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d.length === 10 ? d + "T00:00:00" : d).toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" });
}
export function fmtDateTime(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-PH", { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
export const label = (s: string | null | undefined) => (s ? s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()) : "—");
