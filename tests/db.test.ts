/**
 * Database tests: runs the real migrations in an in-process Postgres (PGlite)
 * with a minimal stand-in for Supabase's auth schema, then exercises RLS,
 * the approval workflow, locking, posting and reversal.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const SUPABASE_STUB = `
  create role anon nologin; create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to authenticated;
  grant execute on function auth.uid() to authenticated;
`;

const U = {
  admin: "00000000-0000-0000-0000-000000000001", // first user → super_admin
  preparer: "00000000-0000-0000-0000-000000000002",
  approver: "00000000-0000-0000-0000-000000000003",
  rider: "00000000-0000-0000-0000-000000000004",
  viewer: "00000000-0000-0000-0000-000000000005",
};

let db: PGlite;

async function as(user: keyof typeof U | null) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user ? U[user] : ""}', false);`);
  if (user) await db.exec("set role authenticated");
}
async function q<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
  return (await db.query<T>(sql, params)).rows;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STUB);
  const dir = join(__dirname, "..", "supabase", "migrations");
  for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(join(dir, f), "utf8"));
  for (const [k, id] of Object.entries(U)) await db.query("insert into auth.users (id, email) values ($1, $2)", [id, `${k}@test.local`]);
  await db.exec(`
    update profiles set role = 'payroll_admin' where id = '${U.preparer}';
    update profiles set role = 'payroll_approver' where id = '${U.approver}';
    update profiles set role = 'employee' where id = '${U.rider}';
  `);
}, 60_000);

describe("database", () => {
  let juanId = "", otherId = "", periodId = "", loanId = "", itemId = "";

  it("first signup is super_admin, later signups default to viewer", async () => {
    const rows = await q<{ id: string; role: string }>("select id, role from profiles order by id");
    expect(rows[0].role).toBe("super_admin");
    expect(rows.find((r) => r.id === U.viewer)?.role).toBe("viewer");
  });

  it("seeds active statutory configuration for every kind", async () => {
    const rows = await q<{ kind: string }>("select kind from statutory_configurations where status = 'active' order by kind::text");
    expect(rows.map((r) => r.kind)).toEqual(["bir", "pagibig", "pay_rates", "philhealth", "sss"]);
  });

  it("payroll admin creates employees; viewer cannot", async () => {
    await as("preparer");
    juanId = (await q<{ id: string }>(
      `insert into employees (employee_no, first_name, last_name, salary_type, daily_rate, is_test_data) values ('T-001','Juan','Dela Cruz','daily',700,true) returning id`
    ))[0].id;
    otherId = (await q<{ id: string }>(
      `insert into employees (employee_no, first_name, last_name, salary_type, daily_rate, is_test_data) values ('T-002','Maria','Santos','daily',650,true) returning id`
    ))[0].id;
    await q(`insert into employee_government_ids (employee_id, sss_no, tin) values ($1, '34-1234567-8', '123-456-789-000')`, [juanId]);
    const hist = await q("select * from employee_salary_history where employee_id = $1", [juanId]);
    expect(hist).toHaveLength(1);

    await as("viewer");
    await expect(q(`insert into employees (employee_no, first_name, last_name) values ('X','X','X')`)).rejects.toThrow();
    expect(await q("select * from employee_government_ids")).toHaveLength(0); // viewer cannot see gov IDs
    expect((await q("select * from employees")).length).toBe(2);
  });

  it("only super_admin can add statutory configurations; active ones are immutable", async () => {
    await as("preparer");
    await expect(q(`insert into statutory_configurations (kind,name,effective_from,payload,source) values ('sss','x','2027-01-01','{}','x')`)).rejects.toThrow();
    await as("admin");
    await expect(q(`update statutory_configurations set payload = '{}' where kind = 'sss'`)).rejects.toThrow(/cannot be modified/);
    await q(`update statutory_configurations set effective_to = '2030-12-31' where kind = 'sss'`); // closing a version is allowed
  });

  it("creates a period, rejects duplicates, encodes items", async () => {
    await as("preparer");
    periodId = (await q<{ id: string }>(
      `insert into payroll_periods (code, period_start, period_end, pay_date, frequency) values ('2026-10-A','2026-10-01','2026-10-15','2026-10-15','semi_monthly') returning id`
    ))[0].id;
    await expect(
      q(`insert into payroll_periods (code, period_start, period_end, pay_date, frequency) values ('dup','2026-10-01','2026-10-15','2026-10-15','semi_monthly')`)
    ).rejects.toThrow();
    loanId = (await q<{ id: string }>(
      `insert into loan_accounts (employee_id, loan_type, principal, installments, installment_amount, balance) values ($1,'cash_advance',1200,3,500,1200) returning id`,
      [juanId]
    ))[0].id;
    const result = { loans: [{ loanId, label: "Cash advance", loanType: "cash_advance", scheduled: 500, deducted: 500, deferred: 0 }] };
    itemId = (await q<{ id: string }>(
      `insert into payroll_items (period_id, employee_id, input, result, gross_pay, net_pay) values ($1,$2,'{}',$3,8837.5,7590) returning id`,
      [periodId, juanId, JSON.stringify(result)]
    ))[0].id;
    await q(`insert into payroll_items (period_id, employee_id, input, result, gross_pay, net_pay) values ($1,$2,'{}','{"loans":[]}',8000,7000)`, [periodId, otherId]);
    // status cannot be changed directly
    await expect(q(`update payroll_periods set status = 'approved' where id = $1`, [periodId])).rejects.toThrow(/approval workflow/);
  });

  it("18. approval workflow enforces roles", async () => {
    await as("preparer");
    await q(`select transition_payroll($1, 'encoding')`, [periodId]);
    await q(`select transition_payroll($1, 'for_review')`, [periodId]);
    await expect(q(`select transition_payroll($1, 'approved')`, [periodId])).rejects.toThrow(/not allowed/);
    await as("approver");
    await q(`select transition_payroll($1, 'approved')`, [periodId]);
    const [p] = await q<{ status: string; approved_by: string }>(`select status, approved_by from payroll_periods where id = $1`, [periodId]);
    expect(p).toMatchObject({ status: "approved", approved_by: U.approver });
  });

  it("items are read-only once approved", async () => {
    await as("preparer");
    await expect(q(`update payroll_items set net_pay = 1 where id = $1`, [itemId])).rejects.toThrow(/cannot be edited/);
  });

  it("posting deducts loans and creates payments; 19. reversal restores them", async () => {
    await as("preparer");
    await q(`select transition_payroll($1, 'posted')`, [periodId]);
    expect((await q<{ balance: string }>(`select balance from loan_accounts where id = $1`, [loanId]))[0].balance).toBe("700.00");
    expect(await q(`select * from payroll_payments where period_id = $1`, [periodId])).toHaveLength(2);

    await expect(q(`select reverse_posting($1, 'wrong rate')`, [periodId])).rejects.toThrow(/Not authorized/);
    await as("approver");
    await q(`select reverse_posting($1, 'Wrong daily rate for Maria')`, [periodId]);
    expect((await q<{ balance: string }>(`select balance from loan_accounts where id = $1`, [loanId]))[0].balance).toBe("1200.00");
    expect((await q<{ status: string }>(`select status from payroll_periods where id = $1`, [periodId]))[0].status).toBe("approved");
  });

  it("17. paid → locked payroll is frozen; corrections go through adjustments", async () => {
    await as("preparer");
    await q(`select transition_payroll($1, 'posted')`, [periodId]);
    await expect(q(`select transition_payroll($1, 'paid')`, [periodId])).rejects.toThrow(/not yet marked Paid/);
    await q(`update payroll_payments set status = 'paid', payment_date = '2026-10-15' where period_id = $1`, [periodId]);
    await q(`select transition_payroll($1, 'paid')`, [periodId]);
    await as("approver");
    await q(`select transition_payroll($1, 'locked')`, [periodId]);
    await expect(q(`select reverse_posting($1, 'x')`, [periodId])).rejects.toThrow(/Only Posted/);
    await as("preparer");
    await expect(q(`delete from payroll_items where id = $1`, [itemId])).rejects.toThrow(/cannot be edited/);
    await expect(q(`update payroll_periods set pay_date = '2026-10-20' where id = $1`, [periodId])).rejects.toThrow(/read-only/);

    const [adj] = await q<{ id: string }>(
      `insert into payroll_adjustments (original_period_id, original_item_id, employee_id, adjustment_type, amount, reason) values ($1,$2,$3,'earning',350,'Unpaid OT 4 hrs on Oct 10') returning id`,
      [periodId, itemId, juanId]
    );
    await expect(q(`select decide_adjustment($1, true)`, [adj.id])).rejects.toThrow(/Not authorized/);
    await as("approver");
    await q(`select decide_adjustment($1, true)`, [adj.id]);
  });

  it("employee sees only their own posted payslip", async () => {
    await as("admin");
    await q(`update profiles set employee_id = $1 where id = $2`, [juanId, U.rider]);
    await as("rider");
    const items = await q<{ employee_id: string }>(`select employee_id from payroll_items`);
    expect(items).toHaveLength(1);
    expect(items[0].employee_id).toBe(juanId);
    expect(await q(`select * from employee_government_ids`)).toHaveLength(1);
    expect(await q(`select * from audit_logs`)).toHaveLength(0);
  });

  it("audit trail captured changes and is append-only", async () => {
    await as("admin");
    const logs = await q<{ action: string; user_id: string }>(`select action, user_id from audit_logs where entity = 'payroll_periods' order by id`);
    expect(logs.map((l) => l.action)).toContain("status:approved→posted");
    expect(logs.map((l) => l.action)).toContain("reverse_posting");
    await expect(q(`delete from audit_logs`)).rejects.toThrow();
    await as(null);
    await expect(q(`delete from audit_logs`)).rejects.toThrow(/cannot be deleted/);
  });
});
