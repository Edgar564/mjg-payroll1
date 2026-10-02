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
