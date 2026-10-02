export type AppRole =
  | "super_admin"
  | "payroll_admin"
  | "payroll_reviewer"
  | "payroll_approver"
  | "hr"
  | "accounting"
  | "viewer"
  | "employee";

export const ROLE_LABELS: Record<AppRole, string> = {
  super_admin: "Super Admin",
  payroll_admin: "Payroll Admin",
  payroll_reviewer: "Payroll Reviewer",
  payroll_approver: "Payroll Approver",
  hr: "HR",
  accounting: "Accounting",
  viewer: "Viewer",
  employee: "Employee (self-service)",
};

const is = (r: AppRole | null | undefined, ...roles: AppRole[]) => !!r && roles.includes(r);

/** Mirrors the SQL helpers in the security migration. The database is the real gate. */
export const can = {
  readPayroll: (r?: AppRole | null) => is(r, "super_admin", "payroll_admin", "payroll_reviewer", "payroll_approver", "accounting", "viewer"),
  writePayroll: (r?: AppRole | null) => is(r, "super_admin", "payroll_admin"),
  writeEmployees: (r?: AppRole | null) => is(r, "super_admin", "payroll_admin", "hr"),
  readGovIds: (r?: AppRole | null) => is(r, "super_admin", "payroll_admin", "hr", "accounting"),
  review: (r?: AppRole | null) => is(r, "super_admin", "payroll_reviewer", "payroll_approver"),
  approve: (r?: AppRole | null) => is(r, "super_admin", "payroll_approver"),
  post: (r?: AppRole | null) => is(r, "super_admin", "payroll_admin", "accounting"),
  pay: (r?: AppRole | null) => is(r, "super_admin", "payroll_admin", "accounting"),
  editConfig: (r?: AppRole | null) => is(r, "super_admin"),
  editReference: (r?: AppRole | null) => is(r, "super_admin", "payroll_admin"),
  manageUsers: (r?: AppRole | null) => is(r, "super_admin"),
  readAudit: (r?: AppRole | null) => is(r, "super_admin", "payroll_reviewer", "payroll_approver", "accounting"),
  staff: (r?: AppRole | null) => !!r && r !== "employee",
};
