import type { ReactNode } from "react";
import { Activity, ArrowUpRight } from "lucide-react";

export function MetricCard({ label, value, detail }: { label: string; value: any; detail?: string }) {
  return (
    <div className="group rounded-2xl border border-border/80 bg-card p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
        <span className="flex size-8 items-center justify-center rounded-lg bg-emerald-50 text-[#08744f] dark:bg-emerald-950/40 dark:text-emerald-300"><Activity className="size-4" /></span>
      </div>
      <p className="mt-3 text-3xl font-bold tracking-tight">{value ?? "—"}</p>
      {detail && <p className="mt-1 text-xs text-muted-foreground">{detail}</p>}
    </div>
  );
}

export function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-border/80 bg-card p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-bold">{title}</h2>
        <ArrowUpRight className="size-4 text-muted-foreground" />
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}
