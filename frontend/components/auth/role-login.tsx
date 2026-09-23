"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
    ArrowLeft,
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
    saveAuth,
    type TokenResponse,
    type UserRole,
} from "@/lib/auth";

interface RoleLoginProps {
    role: UserRole;
    eyebrow: string;
    title: string;
    subtitle: string;
    defaultNext: string;
    authEndpoint?: string;
    allowRegistration?: boolean;
    backHref?: string;
    backLabel?: string;
}

const ROLE_LABELS: Record<UserRole, string> = {
    STUDENT: "student",
    INSTRUCTOR: "instructor",
    ADMIN: "administrator",
    LEGAL_USER: "legal user",
    FIELD_OFFICER: "field officer",
};

export function RoleLogin({
    role,
    eyebrow,
    title,
    subtitle,
    defaultNext,
    authEndpoint = "/api/v1/auth/login",
    allowRegistration = false,
    backHref = "/training",
    backLabel = "Back to role selection",
}: RoleLoginProps) {
    const router = useRouter();
    const searchParams = useSearchParams();

    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [remember, setRemember] = useState(true);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();

        setError("");
        setLoading(true);

        const result = await apiRequest<TokenResponse>(
            authEndpoint,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    email: email.trim(),
                    password,
                }),
            },
        );

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

        /*
         * Critical:
         * Do not save a token if the account belongs to another role.
         */
        if (auth.user.role !== role) {
            setError(
                `This account does not have ${ROLE_LABELS[role]} access.`,
            );
            return;
        }

        saveAuth(auth, remember);

        toast.success("Welcome back", {
            description: `Signed in as ${auth.user.full_name}.`,
        });

        /*
         * Only allow an internal path that belongs to the
         * authenticated user's own role.
         */
        const requestedNext = searchParams.get("next");

        const safeNext =
            requestedNext &&
                requestedNext.startsWith("/") &&
                !requestedNext.startsWith("//") &&
                requestedNext.startsWith(dashboardForRole(auth.user.role))
                ? requestedNext
                : defaultNext;

        router.replace(safeNext);
    }

    return (
        <AuthShell
            eyebrow={eyebrow}
            title={title}
            subtitle={subtitle}
        >
            <div className="mb-6">
                <Link
                    href={backHref}
                    className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-[#08744f] dark:hover:text-emerald-400"
                >
                    <ArrowLeft className="size-4" />
                    {backLabel}
                </Link>
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
                    type="submit"
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

            {allowRegistration && (
                <p className="mt-7 text-center text-sm text-muted-foreground">
                    Don&apos;t have a student account?{" "}
                    <Link
                        href="/register"
                        className="font-semibold text-[#08744f] hover:underline dark:text-emerald-400"
                    >
                        Create one
                    </Link>
                </p>
            )}

            <div className="mt-7 flex items-center justify-center gap-2 text-xs text-muted-foreground">
                {role === "ADMIN" ? (
                    <ShieldCheck className="size-4 text-[#08744f] dark:text-emerald-400" />
                ) : (
                    <UserRound className="size-4 text-[#08744f] dark:text-emerald-400" />
                )}

                <span>
                    Secure {ROLE_LABELS[role]} access
                </span>
            </div>
        </AuthShell>
    );
}