-- MJGarcia Trading Payroll — COMPLETE DATABASE SETUP (run once in Supabase SQL Editor)
-- Paste this ENTIRE file into a new query and click Run. The very first line must start with --


-- ======== 20261002000100_schema.sql ========
-- =============================================================================
-- MJGarcia Trading Payroll — core schema
-- Run in Supabase SQL editor (or `supabase db push`). Order: 0100 → 0200 → 0300.
-- =============================================================================

-- gen_random_uuid() is built into PostgreSQL 13+ (Supabase runs 15+)

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type app_role as enum (
  'super_admin', 'payroll_admin', 'payroll_reviewer', 'payroll_approver',
  'hr', 'accounting', 'viewer', 'employee'
);
create type employment_status as enum (
  'applicant', 'probationary', 'regular', 'contractual', 'casual',
  'part_time', 'resigned', 'terminated', 'inactive'
);
create type pay_frequency as enum ('daily', 'weekly', 'semi_monthly', 'monthly');
create type salary_type as enum ('monthly', 'daily', 'hourly');
create type payroll_status as enum (
  'draft', 'encoding', 'for_review', 'approved', 'posted', 'paid', 'locked', 'cancelled'
);
create type payroll_mode as enum ('auto', 'hybrid', 'manual');
create type payment_method as enum ('cash', 'bank_transfer', 'gcash', 'other');
create type payment_status as enum ('unpaid', 'scheduled', 'paid', 'failed', 'cancelled');
create type config_kind as enum ('sss', 'philhealth', 'pagibig', 'bir', 'pay_rates');
create type config_status as enum ('draft', 'active', 'retired');
create type holiday_type as enum ('regular', 'special_non_working', 'special_working', 'local', 'company');
create type loan_status as enum ('active', 'paid', 'cancelled', 'on_hold');
create type adjustment_status as enum ('pending', 'approved', 'rejected', 'applied');

-- ---------------------------------------------------------------------------
-- Users & roles
-- ---------------------------------------------------------------------------
create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text,
  role app_role not null default 'viewer',
  employee_id uuid,               -- set for self-service employees
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Organization
-- ---------------------------------------------------------------------------
create table company_settings (
  id int primary key default 1 check (id = 1),
  company_name text not null default 'MJGarcia Trading',
  business_address text,
  tin text,
  rdo text,
  sss_employer_no text,
  philhealth_employer_no text,
  pagibig_employer_no text,
  default_pay_frequency pay_frequency not null default 'semi_monthly',
  pay_days text default '15, end of month',
  work_week text default 'Monday–Saturday',
  -- CompanyPolicy (see src/lib/payroll/types.ts)
  policy jsonb not null default '{
    "hoursPerDay": 8, "workDaysPerYear": 313, "contributionSchedule": "split_trueup",
    "minimumNetPay": 0, "excessiveDeductionRatio": 0.5, "monthlyRatedPremiumOnly": true
  }'::jsonb,
  attendance_rules jsonb not null default '{
    "shiftStart": "08:00", "gracePeriodMinutes": 0, "lateRule": "per_minute", "undertimeRule": "per_minute", "otRoundingMinutes": 0,
    "nsdStart": "22:00", "nsdEnd": "06:00"
  }'::jsonb,
  updated_by uuid references auth.users (id),
  updated_at timestamptz not null default now()
);
insert into company_settings (id) values (1);

create table branches (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  address text,
  region text,
  province text,
  city text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table departments (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  active boolean not null default true
);
create table positions (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  active boolean not null default true
);

-- ---------------------------------------------------------------------------
-- Employees
-- ---------------------------------------------------------------------------
create table employees (
  id uuid primary key default gen_random_uuid(),
  employee_no text not null unique,
  first_name text not null,
  middle_name text,
  last_name text not null,
  suffix text,
  nickname text,
  birth_date date,
  gender text,
  civil_status text,
  address text,
  barangay text,
  city text,
  province text,
  region text,
  zip_code text,
  contact_no text,
  email text,
  emergency_contact text,
  emergency_contact_no text,
  -- employment
  position_id uuid references positions (id),
  department_id uuid references departments (id),
  branch_id uuid references branches (id),
  employment_status employment_status not null default 'probationary',
  employment_type text,
  date_hired date,
  regularization_date date,
  separation_date date,
  separation_reason text,
  -- pay
  pay_frequency pay_frequency not null default 'semi_monthly',
  salary_type salary_type not null default 'daily',
  monthly_rate numeric(12,2) check (monthly_rate is null or monthly_rate >= 0),
  daily_rate numeric(12,2) check (daily_rate is null or daily_rate >= 0),
  hourly_rate numeric(12,2) check (hourly_rate is null or hourly_rate >= 0),
  is_minimum_wage_earner boolean not null default false,
  commission_eligible boolean not null default false,
  ot_eligible boolean not null default true,
  nsd_eligible boolean not null default true,
  holiday_pay_eligible boolean not null default true,
  thirteenth_month_eligible boolean not null default true,
  sss_covered boolean not null default true,
  philhealth_covered boolean not null default true,
  pagibig_covered boolean not null default true,
  -- minimum wage lookup
  work_region text,
  work_province text,
  work_city text,
  wage_classification text default 'non_agriculture',
  minimum_wage_override numeric(12,2),
  is_test_data boolean not null default false,
  deleted_at timestamptz,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_by uuid references auth.users (id),
  updated_at timestamptz not null default now()
);
create index employees_status_idx on employees (employment_status) where deleted_at is null;
alter table profiles add constraint profiles_employee_fk foreign key (employee_id) references employees (id) on delete set null;

-- Sensitive identifiers live in their own table so access can be narrower.
create table employee_government_ids (
  employee_id uuid primary key references employees (id) on delete cascade,
  sss_no text,
  philhealth_no text,
  pagibig_no text,
  tin text,
  bir_status text,          -- e.g. "MWE", "Regular", "Exempt"
  payment_method payment_method not null default 'cash',
  bank_name text,
  bank_account_no text,
  gcash_no text,
  updated_by uuid references auth.users (id),
  updated_at timestamptz not null default now()
);

create table employee_salary_history (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees (id) on delete cascade,
  effective_date date not null default current_date,
  salary_type salary_type not null,
  monthly_rate numeric(12,2),
  daily_rate numeric(12,2),
  hourly_rate numeric(12,2),
  changed_by uuid references auth.users (id),
  changed_at timestamptz not null default now(),
  notes text
);
create index on employee_salary_history (employee_id, effective_date desc);

create table employee_documents (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees (id) on delete cascade,
  doc_type text not null,
  title text,
  storage_path text not null,   -- Supabase Storage (private bucket "employee-documents")
  uploaded_by uuid references auth.users (id),
  uploaded_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Earning / deduction catalog
-- ---------------------------------------------------------------------------
create table earning_types (
  code text primary key,
  label text not null,
  category text not null check (category in ('allowance','commission','bonus','incentive','other')),
  tax_treatment text not null check (tax_treatment in ('taxable','non_taxable','de_minimis','other_benefit')),
  de_minimis_limit text,         -- free-text reference to the applicable limit
  include_in_sss boolean not null default false,
  include_in_pagibig boolean not null default false,
  include_in_13th boolean not null default false,
  bir_treatment_note text,
  active boolean not null default true
);

create table employee_allowances (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees (id) on delete cascade,
  earning_code text not null references earning_types (code),
  amount numeric(12,2) not null check (amount >= 0),
  is_fixed boolean not null default true,
  recurring boolean not null default true,
  per_period boolean not null default true,  -- false = amount is monthly; split across periods
  effective_from date not null default current_date,
  effective_to date,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now()
);

create table employee_deductions (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees (id) on delete cascade,
  code text not null,              -- UNIFORM, DAMAGE, OTHER …
  label text not null,
  amount numeric(12,2) not null check (amount > 0),
  recurring boolean not null default false,
  start_date date not null default current_date,
  end_date date,
  authorization_ref text not null, -- signed authorization / reference (required)
  notes text,
  active boolean not null default true,
  applied_period_id uuid,          -- non-recurring: set when posted
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Commission, loans
-- ---------------------------------------------------------------------------
create table commission_records (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees (id) on delete cascade,
  period_id uuid,
  commission_type text not null default 'sales',
  sales_basis numeric(14,2),
  rate numeric(8,4),
  amount numeric(12,2) not null check (amount >= 0),
  reference text,
  notes text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create table loan_accounts (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees (id) on delete cascade,
  loan_type text not null check (loan_type in ('salary_loan','cash_advance','sss_loan','pagibig_loan','company_loan','emergency_advance','other')),
  reference_no text,
  principal numeric(12,2) not null check (principal > 0),
  interest numeric(12,2) not null default 0 check (interest >= 0),
  total_payable numeric(12,2) generated always as (principal + interest) stored,
  installments int not null check (installments > 0),
  installment_amount numeric(12,2) not null check (installment_amount > 0),
  balance numeric(12,2) not null,
  date_released date not null default current_date,
  start_deduction date not null default current_date,
  end_deduction date,
  status loan_status not null default 'active',
  priority int not null default 0,
  notes text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);
create index on loan_accounts (employee_id) where status = 'active';

create table loan_transactions (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null references loan_accounts (id) on delete restrict,
  payroll_item_id uuid,
  period_id uuid,
  kind text not null check (kind in ('deduction','manual_payment','adjustment','reversal')),
  amount numeric(12,2) not null,   -- positive reduces balance; reversal is negative
  txn_date date not null default current_date,
  notes text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Calendars & statutory configuration (versioned, never overwritten)
-- ---------------------------------------------------------------------------
create table holidays (
  id uuid primary key default gen_random_uuid(),
  holiday_date date not null,
  name text not null,
  holiday_type holiday_type not null,
  region text,                     -- null = nationwide
  status text not null default 'active' check (status in ('active','cancelled')),
  source text,
  created_at timestamptz not null default now(),
  unique (holiday_date, name, region)
);

create table minimum_wage_rates (
  id uuid primary key default gen_random_uuid(),
  region text not null,
  province text,
  city text,
  area_classification text,        -- e.g. "Component cities", "2nd–5th class municipalities"
  sector text not null default 'non_agriculture'
    check (sector in ('non_agriculture','agriculture','retail_service','other')),
  wage_order text not null,
  effective_from date not null,
  effective_to date,
  daily_rate numeric(10,2) not null check (daily_rate > 0),
  source text,
  notes text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create table statutory_configurations (
  id uuid primary key default gen_random_uuid(),
  kind config_kind not null,
  name text not null,
  effective_from date not null,
  effective_to date,
  status config_status not null default 'draft',
  payload jsonb not null,          -- shape per kind: see src/lib/payroll/types.ts
  source text not null,            -- official issuance reference (required)
  notes text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_by uuid references auth.users (id),
  updated_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from)
);
create index on statutory_configurations (kind, effective_from desc) where status = 'active';

-- ---------------------------------------------------------------------------
-- Payroll
-- ---------------------------------------------------------------------------
create table payroll_periods (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,                    -- e.g. 2026-10-A
  period_start date not null,
  period_end date not null,
  pay_date date not null,
  frequency pay_frequency not null,
  periods_in_month int not null default 2 check (periods_in_month between 1 and 31),
  is_last_of_month boolean not null default false,
  status payroll_status not null default 'draft',
  is_adjustment boolean not null default false,
  adjusts_period_id uuid references payroll_periods (id),
  notes text,
  prepared_by uuid references auth.users (id),
  submitted_at timestamptz,
  reviewed_by uuid references auth.users (id),
  reviewed_at timestamptz,
  approved_by uuid references auth.users (id),
  approved_at timestamptz,
  posted_by uuid references auth.users (id),
  posted_at timestamptz,
  paid_at timestamptz,
  locked_by uuid references auth.users (id),
  locked_at timestamptz,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (period_end >= period_start)
);
-- No two regular (non-adjustment, non-cancelled) payrolls with the same dates & frequency
create unique index payroll_periods_no_duplicate
  on payroll_periods (period_start, period_end, frequency)
  where not is_adjustment and status <> 'cancelled';

create table payroll_items (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references payroll_periods (id) on delete restrict,
  employee_id uuid not null references employees (id) on delete restrict,
  mode payroll_mode not null default 'auto',
  manual_reason text,
  input jsonb not null,            -- PayrollInput minus config (what was encoded)
  result jsonb not null,           -- PayrollResult (full explanation + trace)
  config_ids jsonb,                -- statutory configuration rows used
  -- denormalized totals for reports
  basic_pay numeric(12,2) not null default 0,
  ot_pay numeric(12,2) not null default 0,
  holiday_pay numeric(12,2) not null default 0,
  rest_day_pay numeric(12,2) not null default 0,
  nsd_pay numeric(12,2) not null default 0,
  commission numeric(12,2) not null default 0,
  allowances numeric(12,2) not null default 0,
  bonus numeric(12,2) not null default 0,
  other_earnings numeric(12,2) not null default 0,
  gross_pay numeric(12,2) not null default 0,
  sss_ee numeric(12,2) not null default 0,
  sss_er numeric(12,2) not null default 0,
  sss_ec numeric(12,2) not null default 0,
  philhealth_ee numeric(12,2) not null default 0,
  philhealth_er numeric(12,2) not null default 0,
  pagibig_ee numeric(12,2) not null default 0,
  pagibig_er numeric(12,2) not null default 0,
  withholding_tax numeric(12,2) not null default 0,
  taxable_compensation numeric(12,2) not null default 0,
  non_taxable_compensation numeric(12,2) not null default 0,
  loans numeric(12,2) not null default 0,
  advances numeric(12,2) not null default 0,
  other_deductions numeric(12,2) not null default 0,
  total_deductions numeric(12,2) not null default 0,
  net_pay numeric(12,2) not null default 0,
  employer_cost numeric(12,2) not null default 0,
  thirteenth_month_basis numeric(12,2) not null default 0,
  has_errors boolean not null default false,
  has_overrides boolean not null default false,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_by uuid references auth.users (id),
  updated_at timestamptz not null default now(),
  unique (period_id, employee_id)
);
create index on payroll_items (employee_id);

create table payroll_payments (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references payroll_periods (id) on delete restrict,
  payroll_item_id uuid not null references payroll_items (id) on delete restrict,
  employee_id uuid not null references employees (id),
  net_pay numeric(12,2) not null,
  payment_date date,
  payment_method payment_method not null default 'cash',
  bank text,
  reference_no text,
  status payment_status not null default 'unpaid',
  paid_by uuid references auth.users (id),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (payroll_item_id)
);

create table payroll_adjustments (
  id uuid primary key default gen_random_uuid(),
  original_period_id uuid not null references payroll_periods (id),
  original_item_id uuid references payroll_items (id),
  employee_id uuid not null references employees (id),
  adjustment_type text not null check (adjustment_type in ('earning','deduction','statutory_correction','tax_correction','reversal')),
  amount numeric(12,2) not null check (amount > 0),
  taxable boolean not null default true,
  reason text not null check (length(trim(reason)) > 0),
  status adjustment_status not null default 'pending',
  requested_by uuid references auth.users (id),
  requested_at timestamptz not null default now(),
  approved_by uuid references auth.users (id),
  approved_at timestamptz,
  applied_period_id uuid references payroll_periods (id)
);

create table thirteenth_month_records (
  id uuid primary key default gen_random_uuid(),
  year int not null,
  employee_id uuid not null references employees (id),
  months jsonb not null,            -- [Jan..Dec] basic salary earned
  total_basic numeric(12,2) not null,
  computed numeric(12,2) not null,
  adjustment numeric(12,2) not null default 0,
  adjustment_reason text,
  amount numeric(12,2) not null,
  computation_type text not null default 'full_year' check (computation_type in ('full_year','pro_rated','separated')),
  status text not null default 'draft' check (status in ('draft','final','paid')),
  paid_period_id uuid references payroll_periods (id),
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  unique (year, employee_id)
);

-- ---------------------------------------------------------------------------
-- Attendance (optional — payroll never depends on it)
-- ---------------------------------------------------------------------------
create table attendance (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees (id) on delete cascade,
  work_date date not null,
  time_in time,
  time_out time,
  break_minutes int not null default 60,
  regular_hours numeric(5,2) not null default 0,
  ot_hours numeric(5,2) not null default 0,
  night_hours numeric(5,2) not null default 0,
  night_ot_hours numeric(5,2) not null default 0,
  late_minutes int not null default 0,
  undertime_minutes int not null default 0,
  absent boolean not null default false,
  leave_type text,
  leave_paid boolean not null default false,
  rest_day boolean not null default false,
  day_type_override text,          -- holiday classification override
  notes text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  unique (employee_id, work_date)
);

-- ---------------------------------------------------------------------------
-- Audit trail (append-only)
-- ---------------------------------------------------------------------------
create table audit_logs (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  user_id uuid,
  user_email text,
  action text not null,
  entity text not null,
  entity_id text,
  old_value jsonb,
  new_value jsonb,
  reason text,
  ip text,
  user_agent text
);
create index on audit_logs (entity, entity_id);
create index on audit_logs (at desc);


-- ======== 20261002000200_security_and_workflow.sql ========
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


-- ======== 20261002000300_seed_reference_data.sql ========
-- GENERATED by scripts/generate-seed.ts — do not edit by hand.
-- Reference data. Verify every row against the latest official issuance before processing payroll.

insert into statutory_configurations (kind, name, effective_from, status, payload, source, notes) values
  ('sss', 'SSS contribution schedule 2025 (15%)', '2025-01-01', 'active', '{"eeRate":0.05,"erRate":0.1,"brackets":[{"rangeFrom":0,"rangeTo":5249.99,"mscRegular":5000,"mscMpf":0,"ec":10},{"rangeFrom":5250,"rangeTo":5749.99,"mscRegular":5500,"mscMpf":0,"ec":10},{"rangeFrom":5750,"rangeTo":6249.99,"mscRegular":6000,"mscMpf":0,"ec":10},{"rangeFrom":6250,"rangeTo":6749.99,"mscRegular":6500,"mscMpf":0,"ec":10},{"rangeFrom":6750,"rangeTo":7249.99,"mscRegular":7000,"mscMpf":0,"ec":10},{"rangeFrom":7250,"rangeTo":7749.99,"mscRegular":7500,"mscMpf":0,"ec":10},{"rangeFrom":7750,"rangeTo":8249.99,"mscRegular":8000,"mscMpf":0,"ec":10},{"rangeFrom":8250,"rangeTo":8749.99,"mscRegular":8500,"mscMpf":0,"ec":10},{"rangeFrom":8750,"rangeTo":9249.99,"mscRegular":9000,"mscMpf":0,"ec":10},{"rangeFrom":9250,"rangeTo":9749.99,"mscRegular":9500,"mscMpf":0,"ec":10},{"rangeFrom":9750,"rangeTo":10249.99,"mscRegular":10000,"mscMpf":0,"ec":10},{"rangeFrom":10250,"rangeTo":10749.99,"mscRegular":10500,"mscMpf":0,"ec":10},{"rangeFrom":10750,"rangeTo":11249.99,"mscRegular":11000,"mscMpf":0,"ec":10},{"rangeFrom":11250,"rangeTo":11749.99,"mscRegular":11500,"mscMpf":0,"ec":10},{"rangeFrom":11750,"rangeTo":12249.99,"mscRegular":12000,"mscMpf":0,"ec":10},{"rangeFrom":12250,"rangeTo":12749.99,"mscRegular":12500,"mscMpf":0,"ec":10},{"rangeFrom":12750,"rangeTo":13249.99,"mscRegular":13000,"mscMpf":0,"ec":10},{"rangeFrom":13250,"rangeTo":13749.99,"mscRegular":13500,"mscMpf":0,"ec":10},{"rangeFrom":13750,"rangeTo":14249.99,"mscRegular":14000,"mscMpf":0,"ec":10},{"rangeFrom":14250,"rangeTo":14749.99,"mscRegular":14500,"mscMpf":0,"ec":10},{"rangeFrom":14750,"rangeTo":15249.99,"mscRegular":15000,"mscMpf":0,"ec":30},{"rangeFrom":15250,"rangeTo":15749.99,"mscRegular":15500,"mscMpf":0,"ec":30},{"rangeFrom":15750,"rangeTo":16249.99,"mscRegular":16000,"mscMpf":0,"ec":30},{"rangeFrom":16250,"rangeTo":16749.99,"mscRegular":16500,"mscMpf":0,"ec":30},{"rangeFrom":16750,"rangeTo":17249.99,"mscRegular":17000,"mscMpf":0,"ec":30},{"rangeFrom":17250,"rangeTo":17749.99,"mscRegular":17500,"mscMpf":0,"ec":30},{"rangeFrom":17750,"rangeTo":18249.99,"mscRegular":18000,"mscMpf":0,"ec":30},{"rangeFrom":18250,"rangeTo":18749.99,"mscRegular":18500,"mscMpf":0,"ec":30},{"rangeFrom":18750,"rangeTo":19249.99,"mscRegular":19000,"mscMpf":0,"ec":30},{"rangeFrom":19250,"rangeTo":19749.99,"mscRegular":19500,"mscMpf":0,"ec":30},{"rangeFrom":19750,"rangeTo":20249.99,"mscRegular":20000,"mscMpf":0,"ec":30},{"rangeFrom":20250,"rangeTo":20749.99,"mscRegular":20000,"mscMpf":500,"ec":30},{"rangeFrom":20750,"rangeTo":21249.99,"mscRegular":20000,"mscMpf":1000,"ec":30},{"rangeFrom":21250,"rangeTo":21749.99,"mscRegular":20000,"mscMpf":1500,"ec":30},{"rangeFrom":21750,"rangeTo":22249.99,"mscRegular":20000,"mscMpf":2000,"ec":30},{"rangeFrom":22250,"rangeTo":22749.99,"mscRegular":20000,"mscMpf":2500,"ec":30},{"rangeFrom":22750,"rangeTo":23249.99,"mscRegular":20000,"mscMpf":3000,"ec":30},{"rangeFrom":23250,"rangeTo":23749.99,"mscRegular":20000,"mscMpf":3500,"ec":30},{"rangeFrom":23750,"rangeTo":24249.99,"mscRegular":20000,"mscMpf":4000,"ec":30},{"rangeFrom":24250,"rangeTo":24749.99,"mscRegular":20000,"mscMpf":4500,"ec":30},{"rangeFrom":24750,"rangeTo":25249.99,"mscRegular":20000,"mscMpf":5000,"ec":30},{"rangeFrom":25250,"rangeTo":25749.99,"mscRegular":20000,"mscMpf":5500,"ec":30},{"rangeFrom":25750,"rangeTo":26249.99,"mscRegular":20000,"mscMpf":6000,"ec":30},{"rangeFrom":26250,"rangeTo":26749.99,"mscRegular":20000,"mscMpf":6500,"ec":30},{"rangeFrom":26750,"rangeTo":27249.99,"mscRegular":20000,"mscMpf":7000,"ec":30},{"rangeFrom":27250,"rangeTo":27749.99,"mscRegular":20000,"mscMpf":7500,"ec":30},{"rangeFrom":27750,"rangeTo":28249.99,"mscRegular":20000,"mscMpf":8000,"ec":30},{"rangeFrom":28250,"rangeTo":28749.99,"mscRegular":20000,"mscMpf":8500,"ec":30},{"rangeFrom":28750,"rangeTo":29249.99,"mscRegular":20000,"mscMpf":9000,"ec":30},{"rangeFrom":29250,"rangeTo":29749.99,"mscRegular":20000,"mscMpf":9500,"ec":30},{"rangeFrom":29750,"rangeTo":30249.99,"mscRegular":20000,"mscMpf":10000,"ec":30},{"rangeFrom":30250,"rangeTo":30749.99,"mscRegular":20000,"mscMpf":10500,"ec":30},{"rangeFrom":30750,"rangeTo":31249.99,"mscRegular":20000,"mscMpf":11000,"ec":30},{"rangeFrom":31250,"rangeTo":31749.99,"mscRegular":20000,"mscMpf":11500,"ec":30},{"rangeFrom":31750,"rangeTo":32249.99,"mscRegular":20000,"mscMpf":12000,"ec":30},{"rangeFrom":32250,"rangeTo":32749.99,"mscRegular":20000,"mscMpf":12500,"ec":30},{"rangeFrom":32750,"rangeTo":33249.99,"mscRegular":20000,"mscMpf":13000,"ec":30},{"rangeFrom":33250,"rangeTo":33749.99,"mscRegular":20000,"mscMpf":13500,"ec":30},{"rangeFrom":33750,"rangeTo":34249.99,"mscRegular":20000,"mscMpf":14000,"ec":30},{"rangeFrom":34250,"rangeTo":34749.99,"mscRegular":20000,"mscMpf":14500,"ec":30},{"rangeFrom":34750,"rangeTo":null,"mscRegular":20000,"mscMpf":15000,"ec":30}]}'::jsonb, 'SSS Circular No. 2024-006 (RA 11199) — 15% rate, MSC ₱5,000–₱35,000, effective January 2025', 'MSC ₱5,000–₱35,000; MSC above ₱20,000 goes to the Mandatory Provident Fund (WISP). EC ₱10 below ₱15,000 MSC, ₱30 at ₱15,000 and up. Confirmed unchanged for 2026.'),
  ('philhealth', 'PhilHealth premium 5% (2024 onward)', '2024-01-01', 'active', '{"rate":0.05,"floor":10000,"ceiling":100000,"eeShare":0.5}'::jsonb, 'RA 11223 (UHC Act) premium schedule; PhilHealth Advisory — 5%, ₱10,000 floor, ₱100,000 ceiling', 'Monthly basic salary basis; shared equally by employer and employee.'),
  ('pagibig', 'Pag-IBIG / HDMF — MFS ₱10,000', '2024-02-01', 'active', '{"maxFundSalary":10000,"tiers":[{"upTo":1500,"eeRate":0.01,"erRate":0.02},{"upTo":null,"eeRate":0.02,"erRate":0.02}]}'::jsonb, 'RA 9679; HDMF Circular No. 460 — Maximum Fund Salary ₱10,000', 'Employee 1% if monthly compensation ≤ ₱1,500, else 2%; employer 2%.'),
  ('bir', 'BIR withholding tax table 2023 onward', '2023-01-01', 'active', '{"otherBenefitsThreshold":90000,"tables":{"daily":[{"over":0,"fixed":0,"rate":0},{"over":685,"fixed":0,"rate":0.15},{"over":1096,"fixed":61.65,"rate":0.2},{"over":2192,"fixed":280.85,"rate":0.25},{"over":5479,"fixed":1102.6,"rate":0.3},{"over":21918,"fixed":6034.3,"rate":0.35}],"weekly":[{"over":0,"fixed":0,"rate":0},{"over":4808,"fixed":0,"rate":0.15},{"over":7692,"fixed":432.6,"rate":0.2},{"over":15385,"fixed":1971.2,"rate":0.25},{"over":38462,"fixed":7740.45,"rate":0.3},{"over":153846,"fixed":42355.65,"rate":0.35}],"semi_monthly":[{"over":0,"fixed":0,"rate":0},{"over":10417,"fixed":0,"rate":0.15},{"over":16667,"fixed":937.5,"rate":0.2},{"over":33333,"fixed":4270.7,"rate":0.25},{"over":83333,"fixed":16770.7,"rate":0.3},{"over":333333,"fixed":91770.7,"rate":0.35}],"monthly":[{"over":0,"fixed":0,"rate":0},{"over":20833,"fixed":0,"rate":0.15},{"over":33333,"fixed":1875,"rate":0.2},{"over":66667,"fixed":8541.8,"rate":0.25},{"over":166667,"fixed":33541.8,"rate":0.3},{"over":666667,"fixed":183541.8,"rate":0.35}],"annual":[{"over":0,"fixed":0,"rate":0},{"over":250000,"fixed":0,"rate":0.15},{"over":400000,"fixed":22500,"rate":0.2},{"over":800000,"fixed":102500,"rate":0.25},{"over":2000000,"fixed":402500,"rate":0.3},{"over":8000000,"fixed":2202500,"rate":0.35}]}}'::jsonb, 'RR 11-2018 Annex E — Revised Withholding Tax Table effective January 1, 2023; RA 10963 (TRAIN) — ₱90,000 13th month/other benefits exemption', 'Daily, weekly, semi-monthly, monthly and annual tables; ₱90,000 13th month & other benefits exemption.'),
  ('pay_rates', 'DOLE premium & overtime multipliers', '2018-01-01', 'active', '{"work":{"ordinary":1,"rest_day":1.3,"special":1.3,"special_rest":1.5,"regular":2,"regular_rest":2.6,"double":3,"double_rest":3.9},"ot":{"ordinary":1.25,"rest_day":1.69,"special":1.69,"special_rest":1.95,"regular":2.6,"regular_rest":3.38,"double":3.9,"double_rest":5.07},"nsdRate":0.1,"unworkedRegularHoliday":1}'::jsonb, 'Labor Code Arts. 86, 87, 93, 94; DOLE Handbook on Workers'' Statutory Monetary Benefits', 'Multipliers of the basic hourly rate. NSD = 10% of the applicable hourly rate (10 PM – 6 AM).');

insert into earning_types (code, label, category, tax_treatment, include_in_sss, include_in_pagibig, include_in_13th, bir_treatment_note) values
  ('ALLOW_TRANSPO', 'Transportation allowance', 'allowance', 'taxable', true, false, false, 'Taxable unless it is a liquidated reimbursement of business expense.'),
  ('ALLOW_MEAL', 'Meal allowance', 'allowance', 'taxable', true, false, false, 'Taxable. OT meal allowance within the de minimis limit uses MEAL_OT.'),
  ('MEAL_OT', 'Overtime meal allowance', 'allowance', 'de_minimis', false, false, false, 'De minimis only within the BIR limit; encode any excess as taxable.'),
  ('RICE', 'Rice subsidy', 'allowance', 'de_minimis', false, false, false, 'De minimis only within the BIR limit; encode any excess as taxable.'),
  ('ALLOW_COMM', 'Communication allowance', 'allowance', 'taxable', true, false, false, 'Taxable unless liquidated.'),
  ('ALLOW_MOBILE', 'Mobile allowance', 'allowance', 'taxable', true, false, false, 'Taxable unless liquidated.'),
  ('ALLOW_FUEL', 'Fuel allowance', 'allowance', 'taxable', true, false, false, 'Taxable unless liquidated.'),
  ('ALLOW_HOUSING', 'Housing allowance', 'allowance', 'taxable', true, false, false, 'Review fringe-benefit rules for managerial staff.'),
  ('ALLOW_OTHER', 'Other allowance', 'allowance', 'taxable', true, false, false, ''),
  ('COMMISSION', 'Sales commission', 'commission', 'taxable', true, false, false, 'Supplementary compensation.'),
  ('INCENTIVE', 'Incentive', 'incentive', 'taxable', true, false, false, 'Productivity/sales incentive.'),
  ('BONUS', 'Bonus', 'bonus', 'other_benefit', false, false, false, 'Counts toward the ₱90,000 13th month & other benefits exemption.'),
  ('THIRTEENTH', '13th month pay', 'bonus', 'other_benefit', false, false, false, 'Counts toward the ₱90,000 exemption.'),
  ('LEAVE_CONV', 'Leave conversion', 'other', 'taxable', false, false, false, 'Check de minimis rules for monetized unused leave; default taxable.'),
  ('SEPARATION', 'Separation / retirement benefit', 'other', 'taxable', false, false, false, 'Exempt only in qualifying cases (e.g. separation beyond the employee''s control). Change treatment per case.'),
  ('ADJ_EARN', 'Payroll adjustment (earning)', 'other', 'taxable', true, false, false, 'From approved payroll adjustments.'),
  ('ADJ_EARN_NT', 'Payroll adjustment (non-taxable)', 'other', 'non_taxable', false, false, false, 'From approved payroll adjustments.'),
  ('OTHER_EARN', 'Other earnings', 'other', 'taxable', true, false, false, '');

-- Eid'l Fitr and Eid'l Adha are proclaimed separately each year; add them from their own proclamations.
insert into holidays (holiday_date, name, holiday_type, source) values
  ('2026-01-01', 'New Year''s Day', 'regular', 'Proclamation No. 1006, s. 2025'),
  ('2026-02-17', 'Chinese New Year', 'special_non_working', 'Proclamation No. 1006, s. 2025'),
  ('2026-02-25', 'EDSA People Power Revolution Anniversary', 'special_working', 'Proclamation No. 1006, s. 2025'),
  ('2026-04-02', 'Maundy Thursday', 'regular', 'Proclamation No. 1006, s. 2025'),
  ('2026-04-03', 'Good Friday', 'regular', 'Proclamation No. 1006, s. 2025'),
  ('2026-04-04', 'Black Saturday', 'special_non_working', 'Proclamation No. 1006, s. 2025'),
  ('2026-04-09', 'Araw ng Kagitingan', 'regular', 'Proclamation No. 1006, s. 2025'),
  ('2026-05-01', 'Labor Day', 'regular', 'Proclamation No. 1006, s. 2025'),
  ('2026-06-12', 'Independence Day', 'regular', 'Proclamation No. 1006, s. 2025'),
  ('2026-08-21', 'Ninoy Aquino Day', 'special_non_working', 'Proclamation No. 1006, s. 2025'),
  ('2026-08-31', 'National Heroes Day', 'regular', 'Proclamation No. 1006, s. 2025'),
  ('2026-11-01', 'All Saints'' Day', 'special_non_working', 'Proclamation No. 1006, s. 2025'),
  ('2026-11-02', 'All Souls'' Day', 'special_non_working', 'Proclamation No. 1006, s. 2025'),
  ('2026-11-30', 'Bonifacio Day', 'regular', 'Proclamation No. 1006, s. 2025'),
  ('2026-12-08', 'Feast of the Immaculate Conception of Mary', 'special_non_working', 'Proclamation No. 1006, s. 2025'),
  ('2026-12-24', 'Christmas Eve', 'special_non_working', 'Proclamation No. 1006, s. 2025'),
  ('2026-12-25', 'Christmas Day', 'regular', 'Proclamation No. 1006, s. 2025'),
  ('2026-12-30', 'Rizal Day', 'regular', 'Proclamation No. 1006, s. 2025'),
  ('2026-12-31', 'Last Day of the Year', 'special_non_working', 'Proclamation No. 1006, s. 2025');

-- CALABARZON only. Rows for Extended Metropolitan Area / 1st class municipalities and for other regions
-- must be added from the applicable NWPC wage order. Retail/service = establishments with ≤10 workers.
insert into minimum_wage_rates (region, area_classification, sector, wage_order, effective_from, daily_rate, source) values
  ('IV-A', 'Component cities', 'non_agriculture', 'Wage Order No. IVA-22 (2nd tranche)', '2026-04-01', 600, 'NWPC Region IV-A current daily minimum wage rates (nwpc.dole.gov.ph/region-iva)'),
  ('IV-A', 'Component cities', 'agriculture', 'Wage Order No. IVA-22 (2nd tranche)', '2026-04-01', 525, 'NWPC Region IV-A current daily minimum wage rates (nwpc.dole.gov.ph/region-iva)'),
  ('IV-A', 'Component cities', 'retail_service', 'Wage Order No. IVA-22 (2nd tranche)', '2026-04-01', 508, 'NWPC Region IV-A current daily minimum wage rates (nwpc.dole.gov.ph/region-iva)'),
  ('IV-A', 'Reclassified 1st class municipalities', 'non_agriculture', 'Wage Order No. IVA-22 (2nd tranche)', '2026-04-01', 550, 'NWPC Region IV-A current daily minimum wage rates (nwpc.dole.gov.ph/region-iva)'),
  ('IV-A', 'Reclassified 1st class municipalities', 'agriculture', 'Wage Order No. IVA-22 (2nd tranche)', '2026-04-01', 525, 'NWPC Region IV-A current daily minimum wage rates (nwpc.dole.gov.ph/region-iva)'),
  ('IV-A', 'Reclassified 1st class municipalities', 'retail_service', 'Wage Order No. IVA-22 (2nd tranche)', '2026-04-01', 508, 'NWPC Region IV-A current daily minimum wage rates (nwpc.dole.gov.ph/region-iva)'),
  ('IV-A', '2nd to 5th class municipalities', 'non_agriculture', 'Wage Order No. IVA-22 (2nd tranche)', '2026-04-01', 525, 'NWPC Region IV-A current daily minimum wage rates (nwpc.dole.gov.ph/region-iva)'),
  ('IV-A', '2nd to 5th class municipalities', 'agriculture', 'Wage Order No. IVA-22 (2nd tranche)', '2026-04-01', 508, 'NWPC Region IV-A current daily minimum wage rates (nwpc.dole.gov.ph/region-iva)'),
  ('IV-A', '2nd to 5th class municipalities', 'retail_service', 'Wage Order No. IVA-22 (2nd tranche)', '2026-04-01', 508, 'NWPC Region IV-A current daily minimum wage rates (nwpc.dole.gov.ph/region-iva)');

insert into departments (name) values ('Operations'), ('Sales'), ('Administration'), ('Warehouse');
insert into positions (name) values ('Delivery Rider'), ('Driver'), ('Helper'), ('Showroom Staff'), ('Sales Agent'), ('Warehouse Staff'), ('Admin Staff'), ('Cashier');
insert into branches (name, region) values ('Main', 'IV-A');

