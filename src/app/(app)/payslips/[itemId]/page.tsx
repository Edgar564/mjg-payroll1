import { notFound } from "next/navigation";
import { getSession } from "@/lib/data/session";
import { loadPayslips } from "@/lib/data/payslips";
import { Payslip } from "@/components/payslip";
import { PrintButton } from "@/components/print-button";

export default async function PayslipPage({ params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await params;
  const { supabase } = await getSession();
  const [slip] = await loadPayslips(supabase, { itemId });
  if (!slip) notFound();
  return (
    <>
      <div className="no-print mb-4 flex justify-end"><PrintButton /></div>
      <Payslip d={slip} />
      <p className="no-print text-center text-xs text-slate-500">Use Print → “Save as PDF” to download. Email delivery is not configured in this version.</p>
    </>
  );
}
