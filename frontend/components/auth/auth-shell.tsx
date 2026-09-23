"use client";

import { BookOpen, CheckCircle2, ShieldCheck, TreePine } from "lucide-react";

export function AuthShell({
  eyebrow,
  title,
  subtitle,
  children,
}: {
  eyebrow?: string;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-[calc(100vh-0px)] bg-[#f7faf8] dark:bg-background">
      <div className="mx-auto grid min-h-screen max-w-[1440px] lg:grid-cols-[minmax(360px,0.9fr)_minmax(520px,1.1fr)]">
        <section className="relative hidden overflow-hidden bg-[#063b2c] text-white lg:flex lg:flex-col lg:justify-between lg:p-12 xl:p-16">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_10%,rgba(74,180,120,.3),transparent_35%),radial-gradient(circle_at_85%_75%,rgba(20,115,78,.45),transparent_40%)]" />
          <div className="absolute -left-28 bottom-[-100px] size-[430px] rounded-full bg-white/5 blur-3xl" />
          <div className="absolute right-[-100px] top-[-100px] size-[380px] rounded-full bg-[#4bbf82]/10 blur-3xl" />

          <div className="relative z-10">
            <div className="flex items-center gap-3">
              <div className="flex size-11 items-center justify-center rounded-2xl border border-white/15 bg-white/10 shadow-lg backdrop-blur">
                <TreePine className="size-6" />
              </div>
              <div>
                <p className="text-sm font-semibold tracking-wide">Forest Department</p>
                <p className="text-xs text-white/65">Library & Learning Portal</p>
              </div>
            </div>
          </div>

          <div className="relative z-10 max-w-xl">
            <div className="mb-7 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-emerald-200/80">
              <span className="size-2 rounded-full bg-emerald-300" />
              Knowledge for conservation
            </div>
            <h2 className="text-4xl font-semibold leading-[1.08] tracking-tight xl:text-5xl">
              Learn today. Protect forests tomorrow.
            </h2>
            <p className="mt-5 max-w-lg text-base leading-7 text-white/70">
              One secure place for forest education, books, assessments and AI-assisted learning.
            </p>
            <div className="mt-9 grid gap-3 sm:grid-cols-3">
              {[
                [BookOpen, "4,000+", "Library resources"],
                [ShieldCheck, "Secure", "Role-based access"],
                [CheckCircle2, "AI Ready", "Guided learning"],
              ].map(([Icon, value, label]) => {
                const Component = Icon as typeof BookOpen;
                return (
                  <div key={label as string} className="rounded-2xl border border-white/10 bg-white/[0.06] p-4 backdrop-blur-sm">
                    <Component className="size-5 text-emerald-200" />
                    <p className="mt-4 text-lg font-semibold">{value as string}</p>
                    <p className="mt-0.5 text-xs text-white/55">{label as string}</p>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="relative z-10 flex items-end justify-between text-xs text-white/45">
            <span>Government learning ecosystem</span>
            <span>© Forest Department</span>
          </div>

          <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-44 opacity-30">
            <div className="absolute bottom-0 left-[8%] h-32 w-16 rounded-t-full bg-[#021e17]" />
            <div className="absolute bottom-0 left-[17%] h-48 w-24 rounded-t-full bg-[#021e17]" />
            <div className="absolute bottom-0 left-[31%] h-28 w-14 rounded-t-full bg-[#021e17]" />
            <div className="absolute bottom-0 right-[18%] h-44 w-20 rounded-t-full bg-[#021e17]" />
            <div className="absolute bottom-0 right-[7%] h-32 w-14 rounded-t-full bg-[#021e17]" />
          </div>
        </section>

        <section className="flex min-h-screen items-center justify-center px-5 py-10 sm:px-8 lg:px-12 xl:px-20">
          <div className="w-full max-w-[520px]">
            <div className="mb-8 lg:hidden">
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-xl bg-[#0b6b4f] text-white">
                  <TreePine className="size-5" />
                </div>
                <div>
                  <p className="font-semibold">Forest Department</p>
                  <p className="text-xs text-muted-foreground">Library & Learning Portal</p>
                </div>
              </div>
            </div>

            <div className="mb-7">
              {eyebrow && <p className="mb-3 text-sm font-medium text-[#08744f] dark:text-emerald-400">{eyebrow}</p>}
              <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
              <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">{subtitle}</p>
            </div>
            {children}
          </div>
        </section>
      </div>
    </main>
  );
}
