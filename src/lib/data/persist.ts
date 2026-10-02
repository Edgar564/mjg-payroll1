import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildInput, itemTotals, type EncodedEntry, type PeriodContext } from "./entry";
import { calculatePayroll } from "@/lib/payroll/engine";
import type { PayrollResult } from "@/lib/payroll/types";
import { friendlyError } from "./errors";

/** Recalculate on the server (authoritative) and upsert payroll items. */
export async function persistItems(sb: SupabaseClient, userId: string, ctx: PeriodContext, rows: { employeeId: string; encoded: EncodedEntry }[]) {
  const errors: string[] = [];
  let saved = 0;
  for (const row of rows) {
    const emp = ctx.employees.find((e) => e.profile.id === row.employeeId);
    if (!emp) {
      errors.push(`Employee ${row.employeeId} is not eligible for this payroll.`);
      continue;
    }
    const input = buildInput(ctx, emp, row.encoded);
    const result: PayrollResult = calculatePayroll(input);
    result.issues.unshift(...emp.contextIssues);
    for (const m of ctx.missingConfig) {
      if (!result.issues.some((i) => i.code === `MISSING_${m.toUpperCase()}_CONFIG`))
        result.issues.unshift({ level: "warning", code: "CONFIG_MISSING", message: `No active ${m.replace("_", " ")} configuration for this period.` });
    }
    const totals = itemTotals(result);
    const { error } = await sb.from("payroll_items").upsert(
      {
        period_id: ctx.period.id,
        employee_id: emp.profile.id,
        mode: row.encoded.mode,
        manual_reason: row.encoded.manualReason ?? null,
        input: {
          encoded: row.encoded,
          adjustmentIds: emp.adjustments.map((a) => a.id),
          monthToDate: input.monthToDate ?? null,
          yearToDate: input.yearToDate ?? null,
        },
        result,
        config_ids: ctx.configIds,
        ...totals,
        updated_by: userId,
      },
      { onConflict: "period_id,employee_id" }
    );
    if (error) {
      errors.push(`${emp.summary.name}: ${friendlyError(error)}`);
      continue;
    }
    saved++;
    if (result.overrides.length) {
      await sb.rpc("log_event", {
        p_action: "manual_override",
        p_entity: "payroll_items",
        p_entity_id: `${ctx.period.code}/${emp.summary.employee_no}`,
        p_new: { employee: emp.summary.name, mode: row.encoded.mode, overrides: result.overrides },
        p_reason: result.overrides.map((o) => `${o.key}: ${o.reason}`).join("; "),
      });
    }
  }
  return { saved, errors };
}

