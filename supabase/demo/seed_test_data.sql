-- OPTIONAL TEST DATA — every row is flagged is_test_data = true and shows a TEST badge.
-- Run only in a test project, after the migrations. Delete before going live:
--   delete from loan_accounts where employee_id in (select id from employees where is_test_data);
--   delete from employee_allowances where employee_id in (select id from employees where is_test_data);
--   delete from employees where is_test_data;   -- only if they have no payroll items

with p as (select id from positions where name = 'Delivery Rider'),
     d as (select id from departments where name = 'Operations'),
     b as (select id from branches where name = 'Main')
insert into employees (employee_no, first_name, last_name, position_id, department_id, branch_id, employment_status, date_hired,
                       pay_frequency, salary_type, daily_rate, work_region, wage_classification, is_test_data)
select 'TEST-001', 'Juan', 'Dela Cruz', p.id, d.id, b.id, 'regular', '2025-01-06', 'semi_monthly', 'daily', 700, 'IV-A', 'non_agriculture', true
from p, d, b;

with p as (select id from positions where name = 'Admin Staff'),
     d as (select id from departments where name = 'Administration')
insert into employees (employee_no, first_name, last_name, position_id, department_id, employment_status, date_hired,
                       pay_frequency, salary_type, monthly_rate, work_region, is_test_data)
select 'TEST-002', 'Maria', 'Santos', p.id, d.id, 'regular', '2024-06-01', 'semi_monthly', 'monthly', 30000, 'IV-A', true from p, d;

insert into employee_government_ids (employee_id, sss_no, philhealth_no, pagibig_no, tin, payment_method)
select id, '00-0000000-0', '00-000000000-0', '0000-0000-0000', '000-000-000-000', 'cash' from employees where employee_no in ('TEST-001','TEST-002');

insert into employee_allowances (employee_id, earning_code, amount, per_period)
select id, 'RICE', 500, true from employees where employee_no = 'TEST-001';

insert into loan_accounts (employee_id, loan_type, principal, installments, installment_amount, balance, notes)
select id, 'cash_advance', 1200, 3, 400, 1200, 'TEST DATA' from employees where employee_no = 'TEST-001';
