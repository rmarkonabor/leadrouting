import type { ReactNode } from "react";

export function Table({ children }: { children?: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full border-collapse text-left text-sm">{children}</table>
    </div>
  );
}

export function TableHead({ children }: { children?: ReactNode }) {
  return <thead className="bg-neutral-bg text-xs uppercase text-muted">{children}</thead>;
}

export function TableBody({ children }: { children?: ReactNode }) {
  return <tbody className="divide-y divide-border">{children}</tbody>;
}

export function TableRow({ children }: { children?: ReactNode }) {
  return <tr className="hover:bg-neutral-bg/50">{children}</tr>;
}

export function TableHeaderCell({ children }: { children?: ReactNode }) {
  return <th className="px-3 py-2 font-medium">{children}</th>;
}

export function TableCell({ children }: { children?: ReactNode }) {
  return <td className="px-3 py-2 align-top">{children}</td>;
}
