-- =============================================================================
-- RBAC helpers, Row Level Security, audit triggers, payroll workflow functions
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Role helpers
-- ---------------------------------------------------------------------------
create or replace function public.current_app_role() returns app_role
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid() and active
$$;

create or replace function public.has_role(variadic roles app_role[]) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = any(roles) from profiles where id = auth.uid() and active), false)
$$;

create or replace function public.my_employee_id() returns uuid
language sql stable security definer set search_path = public as $$
  select employee_id from profiles where id = auth.uid() and active
$$;

-- role groups
create or replace function public.is_staff() returns boolean language sql stable as $$
  select has_role('super_admin','payroll_admin','payroll_reviewer','payroll_approver','hr','accounting','viewer')
$$;
create or replace function public.can_read_payroll() returns boolean language sql stable as $$
  select has_role('super_admin','payroll_admin','payroll_reviewer','payroll_approver','accounting','viewer')
$$;
create or replace function public.can_write_payroll() returns boolean language sql stable as $$
  select has_role('super_admin','payroll_admin')
$$;
create or replace function public.can_write_employees() returns boolean language sql stable as $$
  select has_role('super_admin','payroll_admin','hr')
$$;
create or replace function public.can_read_gov_ids() returns boolean language sql stable as $$
  select has_role('super_admin','payroll_admin','hr','accounting')
$$;

-- New auth users get a profile. The very first user becomes super_admin.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, email, full_name, role)
  values (
    new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', new.email),
    case when exists (select 1 from profiles) then 'viewer'::app_role else 'super_admin'::app_role end
  );
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Audit trail
-- ---------------------------------------------------------------------------
create or replace function public.write_audit(
  p_action text, p_entity text, p_entity_id text, p_old jsonb, p_new jsonb, p_reason text
) returns void language plpgsql security definer set search_path = public as $$
declare v_headers jsonb;
begin
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then v_headers := null;
  end;
  insert into audit_logs (user_id, user_email, action, entity, entity_id, old_value, new_value, reason, ip, user_agent)
  values (
    auth.uid(),
    (select email from profiles where id = auth.uid()),
    p_action, p_entity, p_entity_id, p_old, p_new,
    coalesce(p_reason, nullif(current_setting('app.audit_reason', true), '')),
    coalesce(v_headers->>'x-forwarded-for', v_headers->>'x-real-ip'),
    v_headers->>'user-agent'
  );
end $$;

create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform write_audit('create', tg_table_name, coalesce(to_jsonb(new)->>'id', to_jsonb(new)->>'employee_id'), null, to_jsonb(new), null);
    return new;
  elsif tg_op = 'UPDATE' then
    if to_jsonb(new) - 'updated_at' is distinct from to_jsonb(old) - 'updated_at' then
      perform write_audit('update', tg_table_name, coalesce(to_jsonb(new)->>'id', to_jsonb(new)->>'employee_id'), to_jsonb(old), to_jsonb(new), null);
    end if;
    return new;
  else
    perform write_audit('delete', tg_table_name, coalesce(to_jsonb(old)->>'id', to_jsonb(old)->>'employee_id'), to_jsonb(old), null, null);
    return old;
  end if;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'employees','employee_government_ids','employee_allowances','employee_deductions','loan_accounts',
    'loan_transactions','commission_records','statutory_configurations','minimum_wage_rates','holidays',
    'payroll_periods','payroll_items','payroll_payments','payroll_adjustments','thirteenth_month_records',
    'company_settings','profiles','attendance'
  ] loop
    execute format('create trigger audit_%1$s after insert or update or delete on %1$I for each row execute function audit_row()', t);
  end loop;
end $$;

-- Application-level events (e.g. statutory override explanations)
create or replace function public.log_event(p_action text, p_entity text, p_entity_id text, p_new jsonb, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'Not authorized'; end if;
  perform write_audit(p_action, p_entity, p_entity_id, null, p_new, p_reason);
end $$;

-- ---------------------------------------------------------------------------
-- Integrity guards
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
create trigger t_employees_touch before update on employees for each row execute function touch_updated_at();
create trigger t_items_touch before update on payroll_items for each row execute function touch_updated_at();
create trigger t_periods_touch before update on payroll_periods for each row execute function touch_updated_at();
create trigger t_config_touch before update on statutory_configurations for each row execute function touch_updated_at();

-- Salary changes are kept as history
create or replace function public.track_salary() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT'
     or new.salary_type is distinct from old.salary_type
     or new.monthly_rate is distinct from old.monthly_rate
     or new.daily_rate is distinct from old.daily_rate
     or new.hourly_rate is distinct from old.hourly_rate then
    insert into employee_salary_history (employee_id, salary_type, monthly_rate, daily_rate, hourly_rate, changed_by)
    values (new.id, new.salary_type, new.monthly_rate, new.daily_rate, new.hourly_rate, auth.uid());
  end if;
  return new;
end $$;
create trigger t_employee_salary after insert or update on employees for each row execute function track_salary();

-- Payroll items are editable only while the period is Draft or Encoding.
create or replace function public.guard_payroll_items() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_status payroll_status;
begin
  select status into v_status from payroll_periods where id = coalesce(new.period_id, old.period_id);
  if v_status not in ('draft','encoding') then
    raise exception 'Payroll is % and cannot be edited. Create a payroll adjustment instead.', v_status
      using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end $$;
create trigger t_guard_items before insert or update or delete on payroll_items
  for each row execute function guard_payroll_items();

-- Status changes only through transition_payroll(); finalized periods are frozen.
create or replace function public.guard_payroll_periods() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then raise exception 'Only Draft payroll periods can be deleted. Cancel it instead.'; end if;
    return old;
  end if;
  if new.status is distinct from old.status and coalesce(current_setting('app.transition', true), '') <> 'on' then
    raise exception 'Payroll status can only change through the approval workflow.';
  end if;
  if old.status in ('approved','posted','paid','locked','cancelled')
     and (new.period_start, new.period_end, new.pay_date, new.frequency, new.periods_in_month, new.is_last_of_month)
         is distinct from (old.period_start, old.period_end, old.pay_date, old.frequency, old.periods_in_month, old.is_last_of_month) then
    raise exception 'Payroll is % — period dates are read-only.', old.status;
  end if;
  return new;
end $$;
create trigger t_guard_periods before update or delete on payroll_periods
  for each row execute function guard_payroll_periods();

-- Statutory configurations: active rows are never edited in place (only retired/closed).
create or replace function public.guard_config() returns trigger language plpgsql as $$
begin
  if old.status = 'active' and (new.payload is distinct from old.payload or new.effective_from is distinct from old.effective_from or new.kind is distinct from old.kind) then
    raise exception 'Active statutory configurations cannot be modified. Add a new version with a later effective date.';
  end if;
  return new;
end $$;
create trigger t_guard_config before update on statutory_configurations for each row execute function guard_config();
create or replace function public.no_delete() returns trigger language plpgsql as $$
begin raise exception '% records cannot be deleted.', tg_table_name; end $$;
create trigger t_config_nodelete before delete on statutory_configurations for each row
  when (old.status <> 'draft') execute function no_delete();
create trigger t_audit_nodelete before update or delete on audit_logs for each row execute function no_delete();
create trigger t_loantx_nodelete before update or delete on loan_transactions for each row execute function no_delete();

-- ---------------------------------------------------------------------------
-- Workflow: Draft → Encoding → For Review → Approved → Posted → Paid → Locked
-- ---------------------------------------------------------------------------
create or replace function public.transition_payroll(p_period uuid, p_to payroll_status, p_reason text default null)
returns payroll_periods language plpgsql security definer set search_path = public as $$
declare
  p payroll_periods;
  v_from payroll_status;
  v_count int;
  r record;
  l jsonb;
begin
  select * into p from payroll_periods where id = p_period for update;
  if not found then raise exception 'Payroll period not found.'; end if;
  v_from := p.status;

  -- authorization per transition
  if not (
    (v_from = 'draft'      and p_to = 'encoding'   and has_role('super_admin','payroll_admin')) or
    (v_from = 'encoding'   and p_to = 'for_review' and has_role('super_admin','payroll_admin')) or
    (v_from = 'for_review' and p_to = 'encoding'   and has_role('super_admin','payroll_reviewer','payroll_approver')) or
    (v_from = 'for_review' and p_to = 'approved'   and has_role('super_admin','payroll_approver')) or
    (v_from = 'approved'   and p_to = 'encoding'   and has_role('super_admin','payroll_approver')) or
    (v_from = 'approved'   and p_to = 'posted'     and has_role('super_admin','payroll_admin','accounting')) or
    (v_from = 'posted'     and p_to = 'paid'       and has_role('super_admin','accounting','payroll_admin')) or
    (v_from = 'paid'       and p_to = 'locked'     and has_role('super_admin','payroll_approver')) or
    (v_from in ('draft','encoding','for_review') and p_to = 'cancelled' and has_role('super_admin','payroll_admin'))
  ) then
    raise exception 'You are not allowed to move this payroll from % to %.', v_from, p_to;
  end if;

  if p_to in ('cancelled') or (v_from in ('for_review','approved') and p_to = 'encoding') then
    if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required.'; end if;
  end if;

  if p_to = 'for_review' then
    select count(*) into v_count from payroll_items where period_id = p_period;
    if v_count = 0 then raise exception 'Add at least one employee before submitting for review.'; end if;
    select count(*) into v_count from payroll_items where period_id = p_period and has_errors;
    if v_count > 0 then raise exception '% employee(s) still have blocking errors.', v_count; end if;
  end if;

  if p_to = 'approved' then
    select count(*) into v_count from payroll_items where period_id = p_period and (has_errors or net_pay < 0);
    if v_count > 0 then raise exception 'Cannot approve: % employee(s) have errors or negative net pay.', v_count; end if;
  end if;

  if p_to = 'posted' then
    -- Loan deductions become loan transactions; payment records are created.
    for r in select * from payroll_items where period_id = p_period loop
      for l in select * from jsonb_array_elements(coalesce(r.result->'loans', '[]'::jsonb)) loop
        if (l->>'deducted')::numeric > 0 then
          insert into loan_transactions (loan_id, payroll_item_id, period_id, kind, amount, txn_date, created_by)
          values ((l->>'loanId')::uuid, r.id, p_period, 'deduction', (l->>'deducted')::numeric, p.pay_date, auth.uid());
          update loan_accounts set balance = balance - (l->>'deducted')::numeric,
                 status = case when balance - (l->>'deducted')::numeric <= 0 then 'paid'::loan_status else status end
           where id = (l->>'loanId')::uuid;
        end if;
      end loop;
      insert into payroll_payments (period_id, payroll_item_id, employee_id, net_pay, payment_method, bank)
      select p_period, r.id, r.employee_id, r.net_pay, coalesce(g.payment_method, 'cash'), g.bank_name
        from (select 1) x left join employee_government_ids g on g.employee_id = r.employee_id
      on conflict (payroll_item_id) do update set net_pay = excluded.net_pay, status = 'unpaid';
    end loop;
    -- One-time deductions and approved adjustments are consumed by this payroll
    update employee_deductions d set applied_period_id = p_period
     where not d.recurring and d.applied_period_id is null
       and exists (select 1 from payroll_items i where i.period_id = p_period and i.employee_id = d.employee_id
                   and i.result->'otherDeductions' @> jsonb_build_array(jsonb_build_object('code', 'DED:' || d.id::text)));
    update payroll_adjustments a set status = 'applied', applied_period_id = p_period
     where a.status = 'approved'
       and exists (select 1 from payroll_items i where i.period_id = p_period and i.employee_id = a.employee_id
                   and (i.input->'adjustmentIds') ? a.id::text);
    p.posted_by := auth.uid(); p.posted_at := now();
  end if;

  if p_to = 'paid' then
    select count(*) into v_count from payroll_payments where period_id = p_period and status not in ('paid','cancelled');
    if v_count > 0 then raise exception '% payment(s) are not yet marked Paid.', v_count; end if;
    p.paid_at := now();
  end if;

  if p_to = 'for_review' then p.submitted_at := now(); p.prepared_by := coalesce(p.prepared_by, auth.uid()); end if;
  if p_to = 'approved' then p.approved_by := auth.uid(); p.approved_at := now(); p.reviewed_by := coalesce(p.reviewed_by, auth.uid()); p.reviewed_at := coalesce(p.reviewed_at, now()); end if;
  if p_to = 'encoding' and v_from in ('for_review','approved') then p.reviewed_by := auth.uid(); p.reviewed_at := now(); p.approved_by := null; p.approved_at := null; end if;
  if p_to = 'locked' then p.locked_by := auth.uid(); p.locked_at := now(); end if;

  perform set_config('app.transition', 'on', true);
  update payroll_periods set
    status = p_to, submitted_at = p.submitted_at, prepared_by = p.prepared_by,
    reviewed_by = p.reviewed_by, reviewed_at = p.reviewed_at, approved_by = p.approved_by, approved_at = p.approved_at,
    posted_by = p.posted_by, posted_at = p.posted_at, paid_at = p.paid_at, locked_by = p.locked_by, locked_at = p.locked_at
  where id = p_period returning * into p;
  perform set_config('app.transition', 'off', true);

  perform write_audit('status:' || v_from || '→' || p_to, 'payroll_periods', p_period::text,
                      jsonb_build_object('status', v_from), jsonb_build_object('status', p_to), p_reason);
  return p;
end $$;

-- Undo a posting that has not been paid: reverse loan deductions, cancel payments, return to Approved.
create or replace function public.reverse_posting(p_period uuid, p_reason text)
returns payroll_periods language plpgsql security definer set search_path = public as $$
declare p payroll_periods; t record;
begin
  if not has_role('super_admin','payroll_approver') then raise exception 'Not authorized to reverse a posting.'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required.'; end if;
  select * into p from payroll_periods where id = p_period for update;
  if p.status <> 'posted' then raise exception 'Only Posted payrolls can be reversed. Paid or Locked payroll needs an adjustment.'; end if;
  if exists (select 1 from payroll_payments where period_id = p_period and status = 'paid') then
    raise exception 'Some employees are already paid. Use a payroll adjustment instead.';
  end if;
  for t in select * from loan_transactions where period_id = p_period and kind = 'deduction'
           and not exists (select 1 from loan_transactions x where x.period_id = p_period and x.kind = 'reversal' and x.loan_id = loan_transactions.loan_id and x.payroll_item_id = loan_transactions.payroll_item_id) loop
    insert into loan_transactions (loan_id, payroll_item_id, period_id, kind, amount, notes, created_by)
    values (t.loan_id, t.payroll_item_id, p_period, 'reversal', -t.amount, p_reason, auth.uid());
    update loan_accounts set balance = balance + t.amount, status = case when status = 'paid' then 'active' else status end where id = t.loan_id;
  end loop;
  update payroll_payments set status = 'cancelled' where period_id = p_period;
  update employee_deductions set applied_period_id = null where applied_period_id = p_period;
  update payroll_adjustments set status = 'approved', applied_period_id = null where applied_period_id = p_period;
  perform set_config('app.transition', 'on', true);
  update payroll_periods set status = 'approved', posted_by = null, posted_at = null where id = p_period returning * into p;
  perform set_config('app.transition', 'off', true);
  perform write_audit('reverse_posting', 'payroll_periods', p_period::text, jsonb_build_object('status','posted'), jsonb_build_object('status','approved'), p_reason);
  return p;
end $$;

create or replace function public.decide_adjustment(p_id uuid, p_approve boolean)
returns payroll_adjustments language plpgsql security definer set search_path = public as $$
declare a payroll_adjustments;
begin
  if not has_role('super_admin','payroll_approver') then raise exception 'Not authorized to approve adjustments.'; end if;
  update payroll_adjustments set status = case when p_approve then 'approved'::adjustment_status else 'rejected'::adjustment_status end,
         approved_by = auth.uid(), approved_at = now()
   where id = p_id and status = 'pending' returning * into a;
  if not found then raise exception 'Adjustment is not pending.'; end if;
  return a;
end $$;

-- ---------------------------------------------------------------------------
-- Masking helper for list views
-- ---------------------------------------------------------------------------
create or replace function public.mask_id(v text) returns text language sql immutable as $$
  select case when v is null or length(v) < 4 then v else repeat('•', greatest(length(v) - 4, 0)) || right(v, 4) end
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'profiles','company_settings','branches','departments','positions','employees','employee_government_ids',
    'employee_salary_history','employee_documents','earning_types','employee_allowances','employee_deductions',
    'commission_records','loan_accounts','loan_transactions','holidays','minimum_wage_rates','statutory_configurations',
    'payroll_periods','payroll_items','payroll_payments','payroll_adjustments','thirteenth_month_records',
    'attendance','audit_logs'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('grant select, insert, update, delete on %I to authenticated', t);
  end loop;
end $$;
grant usage on schema public to authenticated;

-- profiles
create policy profiles_self on profiles for select to authenticated using (id = auth.uid() or has_role('super_admin'));
create policy profiles_admin on profiles for update to authenticated using (has_role('super_admin')) with check (has_role('super_admin'));

-- reference data readable by staff, editable by admins
create policy settings_read on company_settings for select to authenticated using (is_staff());
create policy settings_write on company_settings for update to authenticated using (has_role('super_admin')) with check (has_role('super_admin'));

do $$
declare t text;
begin
  foreach t in array array['branches','departments','positions','earning_types'] loop
    execute format('create policy %1$s_read on %1$I for select to authenticated using (is_staff())', t);
    execute format('create policy %1$s_write on %1$I for all to authenticated using (has_role(''super_admin'',''payroll_admin'',''hr'')) with check (has_role(''super_admin'',''payroll_admin'',''hr''))', t);
  end loop;
  foreach t in array array['holidays','minimum_wage_rates'] loop
    execute format('create policy %1$s_read on %1$I for select to authenticated using (is_staff())', t);
    execute format('create policy %1$s_write on %1$I for all to authenticated using (has_role(''super_admin'',''payroll_admin'')) with check (has_role(''super_admin'',''payroll_admin''))', t);
  end loop;
end $$;

-- statutory configuration: everyone on staff reads, only super_admin writes
create policy config_read on statutory_configurations for select to authenticated using (is_staff());
create policy config_write on statutory_configurations for all to authenticated using (has_role('super_admin')) with check (has_role('super_admin'));

-- employees: staff read; employees see their own record
create policy employees_read on employees for select to authenticated using (is_staff() or id = my_employee_id());
create policy employees_write on employees for insert to authenticated with check (can_write_employees());
create policy employees_update on employees for update to authenticated using (can_write_employees()) with check (can_write_employees());

create policy govids_read on employee_government_ids for select to authenticated using (can_read_gov_ids() or employee_id = my_employee_id());
create policy govids_write on employee_government_ids for all to authenticated using (can_write_employees()) with check (can_write_employees());

create policy salhist_read on employee_salary_history for select to authenticated using (can_read_payroll() or has_role('hr'));
create policy docs_rw on employee_documents for all to authenticated using (can_write_employees()) with check (can_write_employees());

do $$
declare t text;
begin
  foreach t in array array['employee_allowances','employee_deductions','commission_records','loan_accounts','attendance','thirteenth_month_records'] loop
    execute format('create policy %1$s_read on %1$I for select to authenticated using (can_read_payroll() or has_role(''hr'') or employee_id = my_employee_id())', t);
    execute format('create policy %1$s_write on %1$I for all to authenticated using (can_write_payroll()) with check (can_write_payroll())', t);
  end loop;
end $$;
create policy loantx_read on loan_transactions for select to authenticated using (
  can_read_payroll() or exists (select 1 from loan_accounts la where la.id = loan_id and la.employee_id = my_employee_id()));
create policy loantx_insert on loan_transactions for insert to authenticated with check (can_write_payroll());

-- payroll
create policy periods_read on payroll_periods for select to authenticated using (
  can_read_payroll() or (my_employee_id() is not null and status in ('posted','paid','locked')));
create policy periods_insert on payroll_periods for insert to authenticated with check (can_write_payroll() and status = 'draft');
create policy periods_update on payroll_periods for update to authenticated using (can_write_payroll()) with check (can_write_payroll());
create policy periods_delete on payroll_periods for delete to authenticated using (can_write_payroll());

create policy items_read on payroll_items for select to authenticated using (
  can_read_payroll()
  or (employee_id = my_employee_id() and exists (select 1 from payroll_periods pp where pp.id = period_id and pp.status in ('posted','paid','locked'))));
create policy items_write on payroll_items for all to authenticated using (can_write_payroll()) with check (can_write_payroll());

create policy payments_read on payroll_payments for select to authenticated using (can_read_payroll() or employee_id = my_employee_id());
create policy payments_update on payroll_payments for update to authenticated using (has_role('super_admin','accounting','payroll_admin')) with check (has_role('super_admin','accounting','payroll_admin'));

create policy adj_read on payroll_adjustments for select to authenticated using (can_read_payroll());
create policy adj_insert on payroll_adjustments for insert to authenticated with check (can_write_payroll() and status = 'pending');

-- audit: read by oversight roles; writes only via security-definer functions
create policy audit_read on audit_logs for select to authenticated using (has_role('super_admin','payroll_reviewer','payroll_approver','accounting'));

revoke insert, update, delete on audit_logs from authenticated;
revoke update, delete on loan_transactions from authenticated;
revoke delete on payroll_payments, payroll_adjustments from authenticated;
grant execute on function transition_payroll(uuid, payroll_status, text), reverse_posting(uuid, text),
  decide_adjustment(uuid, boolean), log_event(text, text, text, jsonb, text), mask_id(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Accounts created BEFORE this setup ran have no profile yet: create them.
-- The earliest account becomes Super Admin if none exists.
-- ---------------------------------------------------------------------------
insert into profiles (id, email, full_name, role)
select u.id, u.email, coalesce(u.raw_user_meta_data->>'full_name', u.email), 'viewer'
from auth.users u
where not exists (select 1 from profiles p where p.id = u.id);

update profiles set role = 'super_admin'
where id = (select id from profiles order by created_at, id limit 1)
  and not exists (select 1 from profiles where role = 'super_admin');
