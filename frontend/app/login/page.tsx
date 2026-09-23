"use client";

import { FormEvent, Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Eye,
  EyeOff,
  LockKeyhole,
  Mail,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";

import { AuthShell } from "@/components/auth/auth-shell";
import { apiRequest } from "@/lib/api";
import {
  dashboardForRole,
  getAccessToken,
  saveAuth,
  type TokenResponse,
} from "@/lib/auth";

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [intent, setIntent] = useState<"STUDENT" | "INSTRUCTOR" | "ADMIN">("STUDENT");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const role = (searchParams.get("role") || "").toUpperCase();

    if (role === "STUDENT" || role === "INSTRUCTOR" || role === "ADMIN") {
      setIntent(role);
    }
  }, [searchParams]);

  useEffect(() => {
    if (getAccessToken()) {
      // AuthProvider performs the authoritative /me check and redirects.
    }
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);

    const result = await apiRequest<TokenResponse>("/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: email.trim(),
        password,
      }),
    });

    setLoading(false);

    if (!result.success) {
      const message =
        result.message === "Invalid credentials"
          ? "Invalid email or password."
          : result.message;

      setError(message);
      return;
    }

    const auth = result.data;

    if (auth.user.role !== intent) {
      const labels = {
        STUDENT: "student",
        INSTRUCTOR: "instructor",
        ADMIN: "administrator",
      };

      setError(
        `This account does not have ${labels[intent]} access.`
      );
      return;
    }

    saveAuth(auth, remember);

    toast.success("Welcome back", {
      description: `Signed in as ${auth.user.full_name}.`,
    });

    const next = searchParams.get("next");

    const roleDashboard = dashboardForRole(auth.user.role);

    const safeNext =
      next &&
      next.startsWith("/") &&
      !next.startsWith("//") &&
      next.startsWith(roleDashboard)
        ? next
        : roleDashboard;

    router.replace(safeNext);
  }

  return (
    <AuthShell
      eyebrow="Welcome back"
      title="Sign in to your library"
      subtitle="Continue your learning journey with secure access to books, quizzes and AI-powered study tools."
    >
      <div className="mb-6 grid grid-cols-3 rounded-2xl border border-border bg-card p-1.5 shadow-sm">
        {[
          ["STUDENT", UserRound, "Student"],
          ["INSTRUCTOR", UserRound, "Instructor"],
          ["ADMIN", ShieldCheck, "Admin"],
        ].map(([value, Icon, label]) => {
          const selected = intent === value;
          const Component = Icon as typeof UserRound;

          return (
            <button
              key={value as string}
              type="button"
              onClick={() =>
                setIntent(
                  value as "STUDENT" | "INSTRUCTOR" | "ADMIN"
                )
              }
              className={`flex min-h-11 items-center justify-center gap-2 rounded-xl text-sm font-medium transition ${selected
                  ? "bg-[#0b6b4f] text-white shadow-sm"
                  : "text-muted-foreground hover:bg-muted"
                }`}
            >
              <Component className="size-4" />
              {label as string}
            </button>
          );
        })}
      </div>

      <form onSubmit={submit} className="space-y-5">
        {error && (
          <div
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300"
          >
            {error}
          </div>
        )}

        <label className="block text-sm font-medium">
          Email address

          <span className="relative mt-2 block">
            <Mail className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />

            <input
              required
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              className="h-12 w-full rounded-xl border border-input bg-background pl-10 pr-4 outline-none transition focus:border-[#0b6b4f] focus:ring-4 focus:ring-[#0b6b4f]/10"
            />
          </span>
        </label>

        <label className="block text-sm font-medium">
          Password

          <span className="relative mt-2 block">
            <LockKeyhole className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />

            <input
              required
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter your password"
              className="h-12 w-full rounded-xl border border-input bg-background pl-10 pr-12 outline-none transition focus:border-[#0b6b4f] focus:ring-4 focus:ring-[#0b6b4f]/10"
            />

            <button
              type="button"
              onClick={() => setShowPassword((value) => !value)}
              className="absolute right-2 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label={
                showPassword ? "Hide password" : "Show password"
              }
            >
              {showPassword ? (
                <EyeOff className="size-4" />
              ) : (
                <Eye className="size-4" />
              )}
            </button>
          </span>
        </label>

        <div className="flex items-center justify-between gap-4 text-sm">
          <label className="flex items-center gap-2 text-muted-foreground">
            <input
              type="checkbox"
              checked={remember}
              onChange={(event) =>
                setRemember(event.target.checked)
              }
              className="size-4 rounded border-input accent-[#0b6b4f]"
            />
            Remember me
          </label>

          <Link
            href="/forgot-password"
            className="font-medium text-[#08744f] hover:underline dark:text-emerald-400"
          >
            Forgot password?
          </Link>
        </div>

        <button
          disabled={loading}
          className="flex h-12 w-full items-center justify-center rounded-xl bg-[#08744f] px-4 font-semibold text-white shadow-sm transition hover:bg-[#075f42] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? (
            <span className="flex items-center gap-2">
              <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              Signing in…
            </span>
          ) : (
            "Sign in"
          )}
        </button>
      </form>

      <p className="mt-7 text-center text-sm text-muted-foreground">
        Don&apos;t have an account?{" "}
        <Link
          href="/register"
          className="font-semibold text-[#08744f] hover:underline dark:text-emerald-400"
        >
          Create a student account
        </Link>
      </p>
    </AuthShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <AuthShell
          eyebrow="Welcome back"
          title="Sign in to your library"
          subtitle="Loading secure login..."
        >
          <div className="h-12 w-full animate-pulse rounded-xl bg-muted" />
        </AuthShell>
      }
    >
      <LoginContent />
    </Suspense>
  );
}