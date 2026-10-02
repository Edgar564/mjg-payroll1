"use server";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/data/session";
import { can } from "@/lib/roles";
import { friendlyError, num, str } from "@/lib/data/errors";
import type { ActionResult } from "@/components/action-form";

export async function createLoan(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const { supabase, user, role } = await getSession();
  if (!can.writePayroll(role)) return { error: "Only payroll admins can create loans." };
  const principal = num(fd.get("principal"));
  const interest = num(fd.get("interest")) ?? 0;
  const installments = num(fd.get("installments"));
  let installment = num(fd.get("installment_amount"));
  if (!str(fd.get("employee_id"))) return { error: "Choose the employee." };
  if (!principal || principal <= 0) return { error: "Enter the principal amount." };
  if (!installments || installments < 1 || !Number.isInteger(installments)) return { error: "Number of installments must be a whole number of at least 1." };
  if (interest < 0) return { error: "Interest cannot be negative." };
  const total = principal + interest;
  if (!installment) installment = Math.ceil((total / installments) * 100) / 100;
  if (installment > total) return { error: "Installment cannot exceed the total payable." };
  const { error } = await supabase.from("loan_accounts").insert({
    employee_id: str(fd.get("employee_id")),
    loan_type: String(fd.get("loan_type")),
    reference_no: str(fd.get("reference_no")),
    principal,
    interest,
    installments,
    installment_amount: installment,
    balance: total,
    date_released: str(fd.get("date_released")) ?? new Date().toISOString().slice(0, 10),
    start_deduction: str(fd.get("start_deduction")) ?? new Date().toISOString().slice(0, 10),
    end_deduction: str(fd.get("end_deduction")),
    priority: num(fd.get("priority")) ?? 0,
    notes: str(fd.get("notes")),
    created_by: user.id,
  });
  if (error) return { error: friendlyError(error) };
  revalidatePath("/loans");
  return { ok: `Loan created. Installment ${installment.toFixed(2)} per payroll.` };
}

export async function recordLoanPayment(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const { supabase, user, role } = await getSession();
  if (!can.writePayroll(role)) return { error: "Only payroll admins can record loan payments." };
  const loanId = String(fd.get("loan_id"));
  const amount = num(fd.get("amount"));
  const notes = str(fd.get("notes"));
  if (!amount || amount <= 0) return { error: "Enter an amount greater than zero." };
  if (!notes) return { error: "Enter a note (e.g. OR number or reason)." };
  const { data: loan } = await supabase.from("loan_accounts").select("balance").eq("id", loanId).single();
  if (!loan) return { error: "Loan not found." };
  if (amount > Number(loan.balance)) return { error: "Payment exceeds the remaining balance." };
  const { error } = await supabase.from("loan_transactions").insert({ loan_id: loanId, kind: "manual_payment", amount, notes, created_by: user.id });
  if (error) return { error: friendlyError(error) };
  const newBal = Math.round((Number(loan.balance) - amount) * 100) / 100;
  await supabase.from("loan_accounts").update({ balance: newBal, status: newBal <= 0 ? "paid" : "active" }).eq("id", loanId);
  revalidatePath("/loans");
  return { ok: "Payment recorded." };
}

export async function setLoanStatus(fd: FormData) {
  const { supabase, role } = await getSession();
  if (!can.writePayroll(role)) return;
  await supabase.from("loan_accounts").update({ status: String(fd.get("status")) }).eq("id", String(fd.get("loan_id")));
  revalidatePath("/loans");
}
