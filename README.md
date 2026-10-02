# MJGarcia Trading — Philippine Payroll System

Next.js 15 + Supabase (PostgreSQL, Auth, Row Level Security). Built for a small LPG distribution team (mostly daily-rated riders, drivers and helpers) with **manual encoding as a first-class method**.

> Payroll statutory rates are configurable and must be verified against the latest applicable government issuance before payroll processing.

---

> **To put it online for all devices (Supabase + Netlify), follow [DEPLOY.md](DEPLOY.md).**

## 1. Set up (about 15 minutes)

1. **Create a Supabase project** at supabase.com (free tier is enough for <20 employees).
2. **Run the database setup** — Supabase dashboard → SQL Editor → **New query** → open `supabase/SETUP_ALL_IN_ONE.sql` in a text editor (Notepad / VS Code), select all, copy, paste, **Run**. The first pasted line must start with `--`; if the editor shows `{` on line 1, you pasted the wrong file.
   The same SQL is also split into these files (run in order) if you prefer:
   1. `supabase/migrations/20261002000100_schema.sql`
   2. `supabase/migrations/20261002000200_security_and_workflow.sql`
   3. `supabase/migrations/20261002000300_seed_reference_data.sql`
   (Or with the Supabase CLI: `supabase link` then `supabase db push`.)
3. Optional, test project only: `supabase/demo/seed_test_data.sql` (rows marked **TEST DATA**).
4. **Configure the app**
   ```bash
   cp .env.example .env.local      # fill in Project URL + anon key (Settings → API)
   npm install
   npm run dev                      # http://localhost:3000
   ```
   Never put the `service_role` key in this app.
5. **Create the first account** on the sign-in page — it becomes **Super Admin**. Everyone else signs up and starts as **Viewer** until you assign a role under *Users & Roles*.
6. In Supabase → Authentication → Providers → Email, decide whether to require email confirmation.
7. Deploy: Vercel (or any Node host). Set the same two environment variables.

## 2. First payroll, step by step

1. **Settings** — company name, TIN, employer numbers, work-day factor (313 = Mon–Sat), contribution schedule.
2. **Statutory Tables** — confirm each table matches the current circular. Add your region's minimum wage if not Calabarzon.
3. **Employees** — add or import (CSV template on the page). Set work region for the minimum-wage check.
4. **Loans & Advances**, recurring **allowances / deductions** (on each employee page; deductions need a written authorization reference).
5. **Payroll Periods → New** (e.g. "Semi-monthly — 1st to 15th").
6. **Add all eligible employees** — days are pre-filled (Mon–Sat minus holidays, or from Attendance if recorded).
7. Edit the **grid** (type, arrow keys, paste from Excel, or import CSV) or open an employee for full detail: Auto / Hybrid (override with reason) / Manual.
8. **Start encoding → Submit for review → Approve → Post → record payments → Mark Paid → Lock.**
9. Print **payslips** and the **payroll register**; run **Reports** for SSS/PhilHealth/Pag-IBIG/BIR remittances.
10. Mistake after posting? *Reverse posting* (if unpaid). After paid/locked? Use **Adjustments** — approved adjustments flow into the next payroll automatically.

## 3. How it is built

| Layer | Where | Notes |
|---|---|---|
| Calculation engine | `src/lib/payroll/` | Pure TypeScript, no DB/UI. Every rate comes from configuration passed in. `calculatePayroll()` returns amounts **and** a step-by-step trace ("View calculation"). |
| Statutory config | `statutory_configurations` table | Versioned by `effective_from/effective_to`, `status`, `source`. Active versions cannot be edited — add a new version. Payroll uses the version effective on the period end date. |
| Data loading | `src/lib/data/load.ts` | Builds engine input: allowances, loans, deductions, commissions, approved adjustments, month-to-date (semi-monthly true-up), year-to-date, minimum wage, holidays, attendance. |
| Saving | `src/lib/data/persist.ts` | Server recomputes every save (browser preview is never trusted), stores input + full result + totals. |
| Workflow & integrity | SQL functions/triggers | `transition_payroll()` enforces role per step; items are read-only unless Draft/Encoding; posting writes loan transactions and payment records in one transaction; `reverse_posting()`; audit triggers on every table; audit log and loan ledger are append-only. |
| Security | RLS on all tables | Roles: Super Admin, Payroll Admin, Reviewer, Approver, HR, Accounting, Viewer, Employee (own posted payslips only). Government IDs hidden from Viewer and masked in lists. |

### Key calculation rules (all configurable)
- **SSS**: bracket lookup on monthly compensation (MSC ₱5,000–₱35,000; MSC above ₱20,000 goes to MPF); EE 5% / ER 10% + EC.
- **PhilHealth**: 5% of monthly basic salary, ₱10,000 floor / ₱100,000 ceiling, 50/50. Basic only — no OT, allowances, commissions.
- **Pag-IBIG**: 1%/2% EE, 2% ER, ₱10,000 maximum fund salary.
- **Semi-monthly contributions**: 1st cut-off = half of projected month; last cut-off = actual full-month amount minus what was already deducted (or "deduct all on last cut-off" in Settings).
- **BIR**: RR 11-2018 Annex E tables (2023 onward) per pay frequency; MWE exemption for basic/OT/holiday/NSD; 13th month & other benefits taxable only above ₱90,000 YTD; annual year-end adjustment in Reports.
- **OT / holiday / rest day / NSD**: multipliers per day type in the Pay Rates table (DOLE defaults).
- **Net pay protection**: if deductions would push net pay below the policy minimum, one-time deductions then loans are deferred (shown on the payslip); statutory and tax are never deferred.

## 4. Tests

```bash
npm test            # 40 tests
npm run typecheck
```
- `src/lib/payroll/engine.test.ts` — monthly, semi-monthly, daily, OT, holiday, NSD, absence, tardiness, SSS/PhilHealth/Pag-IBIG, BIR, MWE, 13th month, loans, manual/hybrid override, negative net pay, true-up.
- `src/lib/payroll/attendance.test.ts` — late, grace period, undertime, OT rounding, night shift.
- `tests/db.test.ts` — runs the real migrations (PGlite): RLS, role-gated approval, locked payroll, posting, reversal, adjustments, employee self-service, append-only audit.

The full UI was also exercised end-to-end in a browser against PostgreSQL 16 + PostgREST (sign-up → employees → payroll → approve → post → pay → lock → payslip → reports → adjustment → attendance).

`npm run gen:seed` regenerates the seed SQL from `src/lib/payroll/defaults.ts`, so seeded rates and tested rates never drift.

## 5. Verify before going live

| Item | Seeded value | Source to check |
|---|---|---|
| SSS | 15% (5/10), MSC ₱5,000–₱35,000, MPF above ₱20,000 | SSS Circular 2024-006 (sss.gov.ph) |
| PhilHealth | 5%, ₱10,000–₱100,000 | philhealth.gov.ph advisories |
| Pag-IBIG | MFS ₱10,000 | HDMF Circular 460 |
| BIR | Annex E, effective 2023-01-01; ₱90,000 threshold | bir.gov.ph RR 11-2018 |
| Minimum wage | **Calabarzon only** (WO IVA-22 2nd tranche: ₱600 / ₱550 / ₱525 / ₱508) | nwpc.dole.gov.ph — add your exact area and other regions |
| Holidays 2026 | Proclamation 1006 list | Add Eid'l Fitr / Eid'l Adha and local holidays from their proclamations |

## 6. Not included in this version
- Leave balances/accrual (SIL) — leave days are encoded per payroll as paid/unpaid.
- BIR Form 2316 / 1601-C / alphalist file generation and SSS/PhilHealth/Pag-IBIG upload files (reports give the figures).
- Emailing payslips (print / Save as PDF works).
- Employee documents UI (table + storage path exist; create a private Storage bucket `employee-documents` when you add it).
- Loan and commission CSV import (employee, attendance and payroll-grid import are included).
- A dedicated final-pay wizard: separated employees remain payable until their separation date; add leave conversion / separation benefit as earnings and pro-rated 13th month from the 13th Month page.
- Calculations run on the Next.js server; a Payroll Admin calling the database API directly could store a hand-made result. Every write is audited.
