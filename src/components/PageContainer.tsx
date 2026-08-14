import type { ReactNode } from "react";

export function PageContainer({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">{children}</main>
  );
}

export function PageTitle({ children }: { children: ReactNode }) {
  return <h1 className="text-2xl font-semibold">{children}</h1>;
}
