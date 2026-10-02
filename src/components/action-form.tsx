"use client";
import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";

export type ActionResult = { error?: string; ok?: string } | null;
export type FormAction = (prev: ActionResult, formData: FormData) => Promise<ActionResult>;

export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess = false,
  confirm,
}: {
  action: FormAction;
  children: React.ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  confirm?: string;
}) {
  const [state, formAction] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <form
      ref={ref}
      action={formAction}
      className={className}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {state?.error && <div className="mb-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{state.error}</div>}
      {state?.ok && <div className="mb-3 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{state.ok}</div>}
      {children}
    </form>
  );
}

export function SubmitButton({ children, variant = "primary", className = "" }: { children: React.ReactNode; variant?: "primary" | "secondary" | "danger"; className?: string }) {
  const { pending } = useFormStatus();
  const cls = variant === "primary" ? "btn-primary" : variant === "danger" ? "btn-danger" : "btn-secondary";
  return (
    <button className={`${cls} ${className}`} disabled={pending}>
      {pending ? "Saving…" : children}
    </button>
  );
}
