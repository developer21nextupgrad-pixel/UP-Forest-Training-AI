"use client";

import Link from "next/link";
import {
  BookOpen,
  ClipboardCheck,
  Bot,
  ArrowRight,
  Sparkles,
  Users,
  BarChart3,
  Library,
  ShieldCheck,
} from "lucide-react";

const roles = [
  {
    title: "Student",
    eyebrow: "LEARNING EXPERIENCE",
    icon: BookOpen,
    description:
      "Learn chapters, practice quizzes and get AI-powered study support.",
    tags: ["AI Tutor", "Chapters", "Quizzes"],
    href: "/student/login",
    button: "Continue as Student",
    accent: "emerald",
    features: [
      "AI-powered learning assistance",
      "Chapter-wise learning",
      "Quizzes & progress tracking",
    ],
  },
  {
    title: "Instructor",
    eyebrow: "TEACHING & MANAGEMENT",
    icon: ClipboardCheck,
    description:
      "Guide learners, manage learning content and monitor their progress.",
    tags: ["Learners", "Content", "Analytics"],
    href: "/instructor/login",
    button: "Continue as Instructor",
    accent: "teal",
    features: [
      "Manage assigned learners",
      "Create & manage learning content",
      "Monitor learner performance",
    ],
  },
  {
    title: "Administrator",
    eyebrow: "PLATFORM CONTROL",
    icon: Bot,
    description:
      "Manage users, content, assessments and the complete learning platform.",
    tags: ["Users", "Content", "Platform"],
    href: "/admin/login",
    button: "Continue as Admin",
    accent: "cyan",
    features: [
      "User & role management",
      "Content & assessment control",
      "Platform-wide analytics",
    ],
  },
];

export default function TrainingPortal() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[url('/forest.jpg')] bg-cover bg-center bg-no-repeat">
      {/* Background overlay */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/55 via-black/65 to-black/90" />

      {/* Ambient glow */}
      <div className="absolute left-1/2 top-24 h-64 w-96 -translate-x-1/2 rounded-full bg-emerald-500/10 blur-3xl" />

      <main className="relative z-10 mx-auto flex min-h-[calc(100vh-80px)] max-w-[1500px] flex-col px-5 py-8 lg:px-8">
        {/* HERO */}
        <section className="mx-auto max-w-3xl text-center">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-950/40 px-3 py-1.5 backdrop-blur-md">
            <Sparkles className="h-3.5 w-3.5 text-emerald-400" />

            <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-300">
              Forest Department Learning Ecosystem
            </span>
          </div>

          <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl lg:text-[42px]">
            Training &{" "}
            <span className="text-emerald-400">Learning Portal</span>
          </h1>

          <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-white/70 sm:text-base">
            Build knowledge. Strengthen conservation.
          </p>

          <p className="mx-auto mt-1 max-w-2xl text-xs text-white/50">
            Choose your role to access the right tools, learning resources and
            platform capabilities.
          </p>
        </section>

        {/* ROLE CARDS */}
        <section className="mt-7 grid flex-1 grid-cols-1 gap-5 md:grid-cols-3 lg:mt-8">
          {roles.map((role) => {
            const Icon = role.icon;

            return (
              <div
                key={role.title}
                className="group relative flex min-h-[390px] flex-col overflow-hidden rounded-2xl border border-white/15 bg-[#07120f]/90 shadow-[0_15px_45px_rgba(0,0,0,0.4)] backdrop-blur-md transition-all duration-300 hover:-translate-y-1 hover:border-emerald-400/35 hover:shadow-[0_20px_55px_rgba(0,0,0,0.55)]"
              >
                {/* Top accent */}
                <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-400/70 to-transparent" />

                {/* Card header */}
                <div className="flex items-start justify-between px-6 pt-6">
                  <div className="flex items-center gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-emerald-400/20 bg-emerald-500/10 shadow-inner">
                      <Icon className="h-6 w-6 text-emerald-400" />
                    </div>

                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-emerald-400/80">
                        {role.eyebrow}
                      </p>

                      <h2 className="mt-0.5 text-xl font-semibold text-white">
                        {role.title}
                      </h2>
                    </div>
                  </div>

                  <div className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/50 transition-all duration-300 group-hover:border-emerald-400/30 group-hover:text-emerald-400">
                    <ArrowRight className="h-4 w-4" />
                  </div>
                </div>

                {/* Tags */}
                <div className="flex flex-wrap gap-1.5 px-6 pt-5">
                  {role.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full border border-emerald-400/10 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-medium text-emerald-300"
                    >
                      {tag}
                    </span>
                  ))}
                </div>

                {/* Description */}
                <div className="px-6 pt-4">
                  <p className="text-sm leading-5 text-white/65">
                    {role.description}
                  </p>
                </div>

                {/* Features */}
                <div className="mx-6 mt-5 border-t border-white/8 pt-4">
                  <div className="space-y-2.5">
                    {role.features.map((feature) => (
                      <div
                        key={feature}
                        className="flex items-center gap-2 text-xs text-white/70"
                      >
                        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-500/15">
                          <ShieldCheck className="h-3 w-3 text-emerald-400" />
                        </span>

                        <span>{feature}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Bottom CTA */}
                <div className="mt-auto px-6 pb-6 pt-6">
                  <Link
                    href={role.href}
                    className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-emerald-300/10 bg-emerald-500 px-4 text-sm font-semibold text-white shadow-lg shadow-emerald-950/20 transition-all duration-200 hover:bg-emerald-400 hover:shadow-emerald-500/20"
                  >
                    {role.button}

                    <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
                  </Link>
                </div>
              </div>
            );
          })}
        </section>

        {/* TRUST / INFO STRIP */}
        <section className="mt-6 hidden rounded-2xl border border-emerald-300/10 bg-emerald-950/35 px-6 py-3 backdrop-blur-md md:block">
          <div className="grid grid-cols-3 divide-x divide-white/10">
            <div className="flex items-center justify-center gap-2">
              <Users className="h-4 w-4 text-emerald-400" />
              <span className="text-xs text-white/65">
                Role-based access
              </span>
            </div>

            <div className="flex items-center justify-center gap-2">
              <Library className="h-4 w-4 text-emerald-400" />
              <span className="text-xs text-white/65">
                Centralized knowledge
              </span>
            </div>

            <div className="flex items-center justify-center gap-2">
              <BarChart3 className="h-4 w-4 text-emerald-400" />
              <span className="text-xs text-white/65">
                Progress & analytics
              </span>
            </div>
          </div>
        </section>

        {/* FOOTER */}
        <footer className="pt-5 text-center text-[11px] text-white/45">
          Uttar Pradesh Forest Department&nbsp; • &nbsp;Van Hain To Kal Hai
        </footer>
      </main>
    </div>
  );
}