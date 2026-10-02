/** Validation for statutory configuration payloads entered by administrators. */
import { z } from "zod";

const rate = z.number().min(0).max(1);
const money = z.number().min(0);
const dayTypes = ["ordinary", "rest_day", "special", "special_rest", "regular", "regular_rest", "double", "double_rest"] as const;
const dayMap = z.object(Object.fromEntries(dayTypes.map((d) => [d, z.number().min(0).max(10)])) as Record<(typeof dayTypes)[number], z.ZodNumber>);
const taxTable = z.array(z.object({ over: money, fixed: money, rate })).min(1);

export const PAYLOAD_SCHEMAS = {
  sss: z.object({
    eeRate: rate,
    erRate: rate,
    brackets: z
      .array(z.object({ rangeFrom: money, rangeTo: money.nullable(), mscRegular: money, mscMpf: money, ec: money }))
      .min(1)
      .refine((b) => b.filter((x) => x.rangeTo === null).length === 1, "Exactly one top bracket must have rangeTo = null"),
  }),
  philhealth: z.object({ rate, floor: money, ceiling: money, eeShare: rate }).refine((p) => p.ceiling >= p.floor, "Ceiling must be ≥ floor"),
  pagibig: z.object({ maxFundSalary: money, tiers: z.array(z.object({ upTo: money.nullable(), eeRate: rate, erRate: rate })).min(1) }),
  bir: z.object({
    otherBenefitsThreshold: money,
    tables: z.object({ daily: taxTable, weekly: taxTable, semi_monthly: taxTable, monthly: taxTable, annual: taxTable }),
  }),
  pay_rates: z.object({ work: dayMap, ot: dayMap, nsdRate: rate, unworkedRegularHoliday: z.number().min(0).max(3) }),
} as const;

export type ConfigKind = keyof typeof PAYLOAD_SCHEMAS;

export function validatePayload(kind: ConfigKind, payload: unknown): { ok: true } | { ok: false; error: string } {
  const r = PAYLOAD_SCHEMAS[kind].safeParse(payload);
  if (r.success) return { ok: true };
  return { ok: false, error: r.error.issues.map((i) => `${i.path.join(".") || "payload"}: ${i.message}`).slice(0, 5).join("; ") };
}
