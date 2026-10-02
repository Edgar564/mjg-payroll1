"use client";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { reversePosting, transition } from "../actions";

type Step = { to: string; label: string; needsReason?: boolean; variant?: "primary" | "secondary" | "danger"; confirm?: string };

const FLOW = ["draft", "encoding", "for_review", "approved", "posted", "paid", "locked"];

export function Workflow({
  periodId,
  status,
  perms,
  blocking,
}: {
  periodId: string;
  status: string;
  perms: { write: boolean; review: boolean; approve: boolean; post: boolean; pay: boolean };
  blocking: number;
}) {
  const steps: Step[] = [];
  if (status === "draft" && perms.write) steps.push({ to: "encoding", label: "Start encoding" });
  if (status === "encoding" && perms.write) steps.push({ to: "for_review", label: "Submit for review", confirm: "Submit this payroll for review? Encoding will be locked." });
  if (status === "for_review" && perms.approve) steps.push({ to: "approved", label: "Approve payroll", confirm: "Approve this payroll?" });
  if (status === "for_review" && perms.review) steps.push({ to: "encoding", label: "Return for correction", needsReason: true, variant: "secondary" });
  if (status === "approved" && perms.post) steps.push({ to: "posted", label: "Post payroll", confirm: "Post this payroll? Loan balances will be updated and payment records created." });
  if (status === "approved" && perms.approve) steps.push({ to: "encoding", label: "Reopen", needsReason: true, variant: "secondary" });
  if (status === "posted" && perms.pay) steps.push({ to: "paid", label: "Mark payroll Paid" });
  if (status === "paid" && perms.approve) steps.push({ to: "locked", label: "Lock payroll", confirm: "Lock this payroll? It becomes permanently read-only. Corrections will require a payroll adjustment." });
  if (["draft", "encoding", "for_review"].includes(status) && perms.write) steps.push({ to: "cancelled", label: "Cancel payroll", needsReason: true, variant: "danger" });

  const idx = FLOW.indexOf(status);
  return (
    <div className="card no-print mb-4 p-4">
      <ol className="mb-3 flex flex-wrap items-center gap-1 text-xs">
        {FLOW.map((s, i) => (
          <li key={s} className="flex items-center gap-1">
            <span className={`rounded-full px-2 py-0.5 ${i < idx ? "bg-brand-100 text-brand-700" : i === idx ? "bg-brand-600 font-semibold text-white" : "bg-slate-100 text-slate-500"}`}>
              {s.replace("_", " ")}
            </span>
            {i < FLOW.length - 1 && <span className="text-slate-300">→</span>}
          </li>
        ))}
        {status === "cancelled" && <li className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-red-700">cancelled</li>}
      </ol>
      {blocking > 0 && ["encoding", "draft"].includes(status) && (
        <div className="mb-2 text-sm text-red-700">{blocking} employee(s) have blocking errors and must be fixed before submitting.</div>
      )}
      <div className="flex flex-wrap items-start gap-3">
        {steps.filter((s) => !s.needsReason).map((s) => (
          <ActionForm key={s.to + s.label} action={transition} confirm={s.confirm}>
            <input type="hidden" name="period_id" value={periodId} />
            <input type="hidden" name="to" value={s.to} />
            <SubmitButton variant={s.variant ?? "primary"}>{s.label}</SubmitButton>
          </ActionForm>
        ))}
        {steps.filter((s) => s.needsReason).map((s) => (
          <details key={s.to + s.label} className="rounded-md">
            <summary className={`${s.variant === "danger" ? "btn-danger" : "btn-secondary"} cursor-pointer list-none`}>{s.label}…</summary>
            <ActionForm action={transition} confirm={s.confirm} className="mt-2 flex flex-wrap items-start gap-2">
              <input type="hidden" name="period_id" value={periodId} />
              <input type="hidden" name="to" value={s.to} />
              <input name="reason" required placeholder="Reason (required)" className="input w-64" />
              <SubmitButton variant={s.variant ?? "primary"}>Confirm</SubmitButton>
            </ActionForm>
          </details>
        ))}
        {status === "posted" && perms.approve && (
          <ActionForm action={reversePosting} confirm="Reverse this posting? Loan deductions will be restored and payments cancelled." className="flex gap-2">
            <input type="hidden" name="period_id" value={periodId} />
            <input name="reason" required placeholder="Reason for reversal" className="input w-56" />
            <SubmitButton variant="danger">Reverse posting</SubmitButton>
          </ActionForm>
        )}
        {!steps.length && status !== "posted" && <div className="text-sm text-slate-500">No actions available for your role at this stage.</div>}
      </div>
    </div>
  );
}
