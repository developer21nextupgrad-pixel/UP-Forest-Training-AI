"use client";

import Link from "next/link";
import {
  Bot,
  ClipboardList,
  BookOpen,
  AlertTriangle,
  FileText,
  ScanSearch,
  ArrowRight,
  Trees,
} from "lucide-react";

const modules = [
  {
    title: "AI Field Assistant",
    description:
      "Get assistance with forest laws, procedures and field-related questions.",
    href: "/field/assistant",
    icon: Bot,
  },
  {
    title: "Patrol Reports",
    description:
      "Create patrol reports, save drafts and review submitted reports.",
    href: "/field/patrol",
    icon: ClipboardList,
  },
  {
    title: "Daily Diary",
    description:
      "Record daily field activities and observations.",
    href: "/field/daily-diary",
    icon: BookOpen,
  },
  {
    title: "Incident Reports",
    description:
      "Record forest incidents and related details.",
    href: "/field/incidents",
    icon: AlertTriangle,
  },
  {
    title: "Offence & Seizure",
    description:
      "Document offence details and seized materials.",
    href: "/field/offence-seizure",
    icon: FileText,
  },
  {
    title: "Species Identification",
    description:
      "Use the species identification module for field assistance.",
    href: "/field/species",
    icon: ScanSearch,
  },
];

export default function FieldDashboard() {
  return (
    <main className="min-h-screen bg-slate-50 p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl space-y-8">
        <section className="overflow-hidden rounded-3xl bg-[#063c2b] p-6 text-white shadow-lg sm:p-9">
          <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-center">
            <div className="max-w-2xl">
              <div className="mb-4 flex items-center gap-2 text-sm text-emerald-100">
                <Trees className="size-5" />
                Forest Department Portal
              </div>

              <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
                Field Officer Dashboard
              </h1>

              <p className="mt-3 max-w-xl leading-7 text-emerald-100">
                Manage field activities, maintain reports and access
                AI-powered assistance from one place.
              </p>
            </div>

            <div className="hidden size-24 shrink-0 items-center justify-center rounded-3xl bg-white/10 sm:flex">
              <Trees className="size-14 text-emerald-100" />
            </div>
          </div>
        </section>

        <section>
          <div className="mb-5">
            <h2 className="text-xl font-bold text-slate-900">
              Field Operations
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Select a module to get started.
            </p>
          </div>

          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {modules.map((item) => {
              const Icon = item.icon;

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-1 hover:border-emerald-300 hover:shadow-md"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex size-12 items-center justify-center rounded-xl bg-emerald-50 text-emerald-800">
                      <Icon className="size-6" />
                    </div>

                    <ArrowRight className="size-5 text-slate-400 transition group-hover:translate-x-1 group-hover:text-emerald-700" />
                  </div>

                  <h3 className="mt-5 font-semibold text-slate-900">
                    {item.title}
                  </h3>

                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    {item.description}
                  </p>
                </Link>
              );
            })}
          </div>
        </section>
      </div>
    </main>
  );
}
