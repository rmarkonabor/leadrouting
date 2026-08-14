import type { ReactNode } from "react";

export function Field({
  label,
  htmlFor,
  error,
  children,
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm" htmlFor={htmlFor}>
      <span className="font-medium text-foreground">{label}</span>
      {children}
      {error ? <span className="text-xs text-danger-text">{error}</span> : null}
    </label>
  );
}
