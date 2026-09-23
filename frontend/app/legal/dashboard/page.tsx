"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import {
    getStoredUser,
    type AuthUser,
} from "@/lib/auth";

export default function LegalDashboardPage() {
    const router = useRouter();

    const [user, setUser] = useState<AuthUser | null>(null);
    const [ready, setReady] = useState(false);

    useEffect(() => {
        const storedUser = getStoredUser();

        if (!storedUser || storedUser.role !== "LEGAL_USER") {
            router.replace("/legal/login");
            return;
        }

        setUser(storedUser);
        setReady(true);
    }, [router]);

    if (!ready || !user) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-slate-50">
                <div className="text-center">
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-700 text-lg font-bold text-white shadow-lg">
                        F
                    </div>

                    <p className="mt-4 text-sm font-semibold text-slate-900">
                        Forest Library
                    </p>

                    <p className="mt-1 text-xs text-slate-500">
                        Loading Legal Portal...
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50">

            {/* ================= HEADER ================= */}
            <header className="border-b border-slate-200 bg-white">
                <div className="mx-auto flex h-20 max-w-[1440px] items-center justify-between px-6 lg:px-10">

                    {/* Brand */}
                    <div className="flex items-center gap-3">
                        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-700 text-lg font-bold text-white shadow-sm">
                            F
                        </div>

                        <div>
                            <p className="text-lg font-bold tracking-tight text-slate-900">
                                Forest Library
                            </p>

                            <p className="text-xs font-medium text-slate-500">
                                Forest Laws & Compliance
                            </p>
                        </div>
                    </div>

                    {/* Navigation */}
                    <nav className="hidden items-center gap-8 md:flex">
                        <button
                            onClick={() => router.push("/legal/dashboard")}
                            className="text-sm font-semibold text-emerald-700"
                        >
                            Dashboard
                        </button>

                        <button
                            onClick={() => router.push("/legal")}
                            className="text-sm font-medium text-slate-600 transition hover:text-emerald-700"
                        >
                            Legal Assistant
                        </button>

                        <button
                            className="text-sm font-medium text-slate-600 transition hover:text-emerald-700"
                        >
                            Knowledge Base
                        </button>

                        <button
                            className="text-sm font-medium text-slate-600 transition hover:text-emerald-700"
                        >
                            Compliance
                        </button>
                    </nav>

                    {/* User */}
                    <div className="flex items-center gap-3">
                        <div className="hidden text-right sm:block">
                            <p className="text-sm font-semibold text-slate-900">
                                {user.full_name}
                            </p>

                            <p className="text-xs text-slate-500">
                                Legal User
                            </p>
                        </div>

                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-50 text-sm font-bold text-emerald-700 ring-1 ring-emerald-100">
                            {user.full_name.charAt(0).toUpperCase()}
                        </div>
                    </div>
                </div>
            </header>

            {/* ================= MAIN ================= */}
            <main className="mx-auto max-w-[1440px] px-6 py-8 lg:px-10">

                {/* Welcome */}
                <section className="relative overflow-hidden rounded-3xl bg-slate-900 px-7 py-9 text-white shadow-xl lg:px-10">

                    <div className="relative z-10 max-w-3xl">
                        <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold tracking-wide text-emerald-200 ring-1 ring-white/10">
                            <span className="h-2 w-2 rounded-full bg-emerald-400" />
                            LEGAL KNOWLEDGE PORTAL
                        </div>

                        <h1 className="text-3xl font-bold tracking-tight lg:text-4xl">
                            Welcome back, {user.full_name}
                        </h1>

                        <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-300 lg:text-base">
                            Access verified forest laws, rules, orders, judgments and
                            document-grounded legal assistance from one secure workspace.
                        </p>

                        <div className="mt-7 flex flex-wrap gap-3">
                            <button
                                onClick={() => router.push("/legal")}
                                className="rounded-xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-900/20 transition hover:bg-emerald-500"
                            >
                                Open Legal AI Assistant →
                            </button>

                            <button
                                className="rounded-xl border border-white/15 bg-white/10 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/15"
                            >
                                Explore Knowledge Base
                            </button>
                        </div>
                    </div>

                    {/* Decorative element */}
                    <div className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full border border-emerald-400/10" />
                    <div className="pointer-events-none absolute -right-5 -top-10 h-48 w-48 rounded-full border border-emerald-400/10" />

                    <div className="pointer-events-none absolute bottom-0 right-10 hidden h-40 w-40 rounded-t-full bg-emerald-500/5 lg:block" />
                </section>

                {/* ================= STATS ================= */}
                <section className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">

                    <StatCard
                        icon="⚖️"
                        label="Legal Assistant"
                        value="AI"
                        description="Document grounded"
                    />

                    <StatCard
                        icon="📚"
                        label="Knowledge Base"
                        value="Verified"
                        description="Official documents"
                    />

                    <StatCard
                        icon="🔎"
                        label="Search"
                        value="Hybrid"
                        description="Semantic + lexical"
                    />

                    <StatCard
                        icon="🔐"
                        label="Access"
                        value="Secure"
                        description="Legal user portal"
                    />

                </section>

                {/* ================= SERVICES ================= */}
                <section className="mt-9">

                    <div className="mb-5 flex items-end justify-between">
                        <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
                                Legal Workspace
                            </p>

                            <h2 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">
                                Legal Knowledge & Assistance
                            </h2>

                            <p className="mt-2 text-sm text-slate-500">
                                Tools designed for forest law research and compliance work.
                            </p>
                        </div>
                    </div>

                    <div className="grid gap-5 lg:grid-cols-3">

                        {/* AI Assistant */}
                        <DashboardCard
                            icon="⚖️"
                            eyebrow="AI POWERED"
                            title="Legal AI Assistant"
                            description="Ask natural-language questions about forest laws, rules, orders and judgments."
                            action="Open Assistant"
                            onClick={() => router.push("/legal")}
                            featured
                        />

                        {/* Knowledge Base */}
                        <DashboardCard
                            icon="📚"
                            eyebrow="DOCUMENT LIBRARY"
                            title="Legal Knowledge Base"
                            description="Access verified acts, rules, circulars, orders, SOPs and judgments."
                            action="Browse Documents"
                        />

                        {/* Compliance */}
                        <DashboardCard
                            icon="✓"
                            eyebrow="COMPLIANCE"
                            title="Compliance Support"
                            description="Use document-grounded information for legal and compliance-related queries."
                            action="View Compliance Tools"
                        />

                    </div>
                </section>

                {/* ================= QUICK ACCESS ================= */}
                <section className="mt-9 grid gap-5 lg:grid-cols-[1.5fr_1fr]">

                    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">

                        <div className="flex items-center justify-between">
                            <div>
                                <h2 className="text-lg font-bold text-slate-900">
                                    Quick Access
                                </h2>

                                <p className="mt-1 text-sm text-slate-500">
                                    Frequently used legal resources.
                                </p>
                            </div>
                        </div>

                        <div className="mt-5 grid gap-3 sm:grid-cols-2">

                            <QuickLink
                                icon="📜"
                                title="Forest Acts"
                                description="Acts and legislation"
                            />

                            <QuickLink
                                icon="📋"
                                title="Rules & Orders"
                                description="Rules, orders and circulars"
                            />

                            <QuickLink
                                icon="🏛️"
                                title="Judgments"
                                description="Court decisions"
                            />

                            <QuickLink
                                icon="📑"
                                title="SOPs"
                                description="Standard procedures"
                            />

                        </div>
                    </div>

                    {/* Account */}
                    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">

                        <div className="flex items-center gap-3">
                            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
                                👤
                            </div>

                            <div>
                                <h2 className="font-bold text-slate-900">
                                    Account
                                </h2>

                                <p className="text-xs text-slate-500">
                                    Legal portal access
                                </p>
                            </div>
                        </div>

                        <div className="mt-6 space-y-4">

                            <AccountRow
                                label="Name"
                                value={user.full_name}
                            />

                            <AccountRow
                                label="Email"
                                value={user.email}
                            />

                            <AccountRow
                                label="Role"
                                value="LEGAL_USER"
                            />

                        </div>

                    </div>
                </section>

                {/* Footer */}
                <footer className="mt-10 border-t border-slate-200 py-6">
                    <div className="flex flex-col justify-between gap-2 text-xs text-slate-500 sm:flex-row">
                        <p>
                            Forest Library · Forest Laws & Compliance
                        </p>

                        <p>
                            Secure document-grounded legal assistance
                        </p>
                    </div>
                </footer>

            </main>
        </div>
    );
}

/* =========================================================
   COMPONENTS
========================================================= */

function StatCard({
    icon,
    label,
    value,
    description,
}: {
    icon: string;
    label: string;
    value: string;
    description: string;
}) {
    return (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
            <div className="flex items-start justify-between">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-lg">
                    {icon}
                </div>

                <span className="rounded-full bg-slate-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    Active
                </span>
            </div>

            <p className="mt-5 text-xs font-medium text-slate-500">
                {label}
            </p>

            <p className="mt-1 text-xl font-bold text-slate-900">
                {value}
            </p>

            <p className="mt-1 text-xs text-slate-500">
                {description}
            </p>
        </div>
    );
}

function DashboardCard({
    icon,
    eyebrow,
    title,
    description,
    action,
    onClick,
    featured = false,
}: {
    icon: string;
    eyebrow: string;
    title: string;
    description: string;
    action: string;
    onClick?: () => void;
    featured?: boolean;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`group flex min-h-[250px] flex-col rounded-2xl border p-6 text-left shadow-sm transition hover:-translate-y-1 hover:shadow-lg ${featured
                    ? "border-emerald-200 bg-emerald-50/40"
                    : "border-slate-200 bg-white"
                }`}
        >
            <div className="flex items-start justify-between">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white text-2xl shadow-sm ring-1 ring-slate-200">
                    {icon}
                </div>

                <span className="text-xs font-semibold uppercase tracking-wider text-emerald-700">
                    {eyebrow}
                </span>
            </div>

            <div className="mt-6">
                <h3 className="text-xl font-bold text-slate-900">
                    {title}
                </h3>

                <p className="mt-2 text-sm leading-6 text-slate-600">
                    {description}
                </p>
            </div>

            <div className="mt-auto pt-6 text-sm font-semibold text-emerald-700 transition group-hover:text-emerald-800">
                {action} →
            </div>
        </button>
    );
}

function QuickLink({
    icon,
    title,
    description,
}: {
    icon: string;
    title: string;
    description: string;
}) {
    return (
        <button
            type="button"
            className="flex items-center gap-4 rounded-xl border border-slate-100 bg-slate-50 p-4 text-left transition hover:border-emerald-200 hover:bg-emerald-50/40"
        >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white text-lg shadow-sm">
                {icon}
            </div>

            <div>
                <p className="text-sm font-semibold text-slate-900">
                    {title}
                </p>

                <p className="mt-0.5 text-xs text-slate-500">
                    {description}
                </p>
            </div>
        </button>
    );
}

function AccountRow({
    label,
    value,
}: {
    label: string;
    value: string;
}) {
    return (
        <div className="border-b border-slate-100 pb-3 last:border-0 last:pb-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                {label}
            </p>

            <p className="mt-1 truncate text-sm font-medium text-slate-800">
                {value}
            </p>
        </div>
    );
}