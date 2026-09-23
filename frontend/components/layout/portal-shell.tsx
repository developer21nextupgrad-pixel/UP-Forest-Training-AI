"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Bell,
  ClipboardCheck,
  FileText,
  Home,
  Library,
  LogOut,
  Menu,
  Settings,
  ShieldCheck,
  Users,
  X,
  GraduationCap,
} from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";
import { useAuth } from "@/components/auth/auth-provider";
import { ThemeToggle } from "@/components/common/theme-toggle";

// ============================================================
// STUDENT NAVIGATION
// ============================================================

const studentNav = [
  { href: "/student", label: "Dashboard", icon: Home },
  { href: "/student/tutor", label: "Training & Learning", icon: GraduationCap },
  { href: "/student/subjects", label: "Library", icon: Library },
  { href: "/student/quizzes", label: "Quizzes", icon: ClipboardCheck },
  { href: "/student/progress", label: "Progress", icon: BarChart3 },
  { href: "/student/history", label: "History", icon: FileText },
  { href: "/student/profile", label: "Profile", icon: GraduationCap },
];

// ============================================================
// ADMIN NAVIGATION
// ============================================================

const adminNav = [
  { href: "/admin", label: "Dashboard", icon: Home },
  { href: "/admin/books", label: "Books Management", icon: Library },
  { href: "/admin/users", label: "Users Management", icon: Users },
  {
    href: "/admin/quizzes",
    label: "Quizzes Management",
    icon: ClipboardCheck,
  },
  {
    href: "/admin/content",
    label: "Content Intelligence",
    icon: FileText,
  },
  {
    href: "/admin/analytics",
    label: "Reports & Analytics",
    icon: BarChart3,
  },
  { href: "/settings", label: "System Settings", icon: Settings },
];

// ============================================================
// INSTRUCTOR NAVIGATION
// ============================================================

const instructorNav = [
  { href: "/instructor", label: "Dashboard", icon: Home },
  { href: "/instructor/subjects", label: "Subjects", icon: Library },
  { href: "/instructor/students", label: "Students", icon: Users },
  {
    href: "/instructor/quizzes",
    label: "Quizzes",
    icon: ClipboardCheck,
  },
  {
    href: "/instructor/analytics",
    label: "Analytics",
    icon: BarChart3,
  },
  { href: "/settings", label: "Settings", icon: Settings },
];

// ============================================================
// ROLE NAVIGATION
// ============================================================

function navigationForRole(role?: string) {
  if (role === "ADMIN") {
    return adminNav;
  }

  if (role === "INSTRUCTOR") {
    return instructorNav;
  }

  return studentNav;
}

// ============================================================
// PORTAL SHELL
// ============================================================

export function PortalShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  const { user, logout } = useAuth();

  const [open, setOpen] = useState(false);

  // Only these portals actually use the left sidebar.
  const hasSidebar =
    pathname.startsWith("/student") ||
    pathname.startsWith("/admin") ||
    pathname.startsWith("/instructor");

  const nav = navigationForRole(user?.role);

  const profileHref =
    user?.role === "ADMIN"
      ? "/settings"
      : user?.role === "INSTRUCTOR"
        ? "/settings"
        : "/student/profile";

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* ======================================================
          SIDEBAR
      ======================================================= */}

      {hasSidebar && (
        <aside
          className={cn(
            "fixed inset-y-0 left-0 z-50 flex w-[270px] flex-col bg-[#063c2b] text-white shadow-2xl shadow-emerald-950/10 transition-transform duration-200 lg:translate-x-0",
            open ? "translate-x-0" : "-translate-x-full",
          )}
        >
          {/* BRAND */}
          <div className="flex h-20 items-center gap-3 border-b border-white/10 px-5">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-white text-[#063c2b] shadow-lg">
              <ShieldCheck className="size-6" />
            </div>

            <div className="min-w-0">
              <p className="truncate text-sm font-bold tracking-wide">
                Forest Library
              </p>

              <p className="text-[11px] text-emerald-100/70">
                Uttar Pradesh Forest Department
              </p>
            </div>

            <button
              className="ml-auto rounded-lg p-2 text-emerald-100 hover:bg-white/10 lg:hidden"
              onClick={() => setOpen(false)}
              aria-label="Close navigation"
            >
              <X className="size-5" />
            </button>
          </div>

          {/* NAVIGATION */}
          <div className="px-4 py-5">
            <p className="mb-3 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-100/50">
              Workspace
            </p>

            <nav
              className="space-y-1"
              aria-label="Portal navigation"
            >
              {nav.map(({ href, label, icon: Icon }) => {
                const active =
                  pathname === href ||
                  (href !== "/student" &&
                    pathname.startsWith(`${href}/`));

                return (
                  <Link
                    key={href}
                    href={href}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                      active
                        ? "bg-white text-[#063c2b] shadow-sm"
                        : "text-emerald-50/75 hover:bg-white/10 hover:text-white",
                    )}
                  >
                    <Icon className="size-[18px] shrink-0" />

                    <span>{label}</span>
                  </Link>
                );
              })}
            </nav>
          </div>

          {/* USER AREA */}
          <div className="mt-auto space-y-3 border-t border-white/10 p-4">
            <div className="rounded-2xl bg-white/8 p-3">
              <div className="flex items-center gap-3">
                <div className="flex size-9 items-center justify-center rounded-full bg-emerald-400/20 text-emerald-100">
                  <GraduationCap className="size-5" />
                </div>

                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">
                    {user?.full_name ?? "Library User"}
                  </p>

                  <p className="text-[11px] text-emerald-100/60">
                    {user?.role ?? "USER"}
                  </p>
                </div>
              </div>
            </div>

            <button
              onClick={() => void logout()}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-emerald-50/75 hover:bg-white/10 hover:text-white"
            >
              <LogOut className="size-[18px]" />

              Logout
            </button>
          </div>
        </aside>
      )}

      {/* ======================================================
          MOBILE SIDEBAR OVERLAY
      ======================================================= */}

      {hasSidebar && open && (
        <button
          className="fixed inset-0 z-40 bg-slate-950/40 backdrop-blur-sm lg:hidden"
          onClick={() => setOpen(false)}
          aria-label="Close navigation overlay"
        />
      )}

      {/* ======================================================
          MAIN APPLICATION AREA

          IMPORTANT:
          Only sidebar portals get the 270px left offset.
          Field / Legal / Home remain full width.
      ======================================================= */}

      <div
        className={cn(
          "min-h-screen",
          hasSidebar && "lg:pl-[270px]",
        )}
      >
        {/* ====================================================
            TOP HEADER
        ===================================================== */}

        <header className="sticky top-0 z-30 border-b border-emerald-950/8 bg-white/90 backdrop-blur-xl dark:border-white/10 dark:bg-[#0b1b15]/90">
          <div className="flex h-[72px] items-center gap-3 px-4 sm:px-6 lg:px-8">
            {/* MOBILE MENU */}
            {hasSidebar && (
              <button
                onClick={() => setOpen(true)}
                className="rounded-xl border border-border bg-card p-2.5 lg:hidden"
                aria-label="Open navigation"
              >
                <Menu className="size-5" />
              </button>
            )}

            {/* SEARCH */}
            <div className="min-w-0 flex-1">
              <div className="hidden max-w-xl items-center gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2 sm:flex">
                <span className="text-muted-foreground">
                  ⌕
                </span>

                <input
                  className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                  placeholder="Search books, topics..."
                  aria-label="Search books and topics"
                />
              </div>
            </div>

            {/* NOTIFICATIONS */}
            <button
              className="relative rounded-xl border border-border bg-card p-2.5 text-muted-foreground hover:text-foreground"
              aria-label="Notifications"
            >
              <Bell className="size-5" />

              <span className="absolute right-2 top-2 size-1.5 rounded-full bg-emerald-600" />
            </button>

            {/* USER */}
            <Link
              href={profileHref}
              className="hidden items-center gap-2 rounded-xl border border-border bg-card px-2.5 py-1.5 sm:flex"
            >
              <span className="flex size-8 items-center justify-center rounded-full bg-emerald-50 text-[#08744f] dark:bg-emerald-950/50 dark:text-emerald-300">
                <GraduationCap className="size-4" />
              </span>

              <span className="max-w-28 text-left">
                <span className="block truncate text-xs font-semibold">
                  {user?.full_name ?? "User"}
                </span>

                <span className="block text-[10px] text-muted-foreground">
                  {user?.role ?? ""}
                </span>
              </span>
            </Link>

            {/* THEME */}
            <ThemeToggle />
          </div>
        </header>

        {/* ====================================================
            PAGE CONTENT
        ===================================================== */}

        <main className="min-h-[calc(100vh-72px)]">
          {children}
        </main>
      </div>
    </div>
  );
}