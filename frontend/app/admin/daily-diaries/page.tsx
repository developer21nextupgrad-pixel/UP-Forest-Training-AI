"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, RefreshCw, FileText } from "lucide-react";

import { adminDailyDiaryApi } from "@/services/admin-daily-diary.service";

type DailyDiary = {
    id: string;
    officer_id: string;
    officer_name: string;
    officer_email: string;
    diary_date: string | null;
    subject: string | null;
    location: string | null;
    status: string;
    submitted_at: string | null;
    review_status: string | null;
    review_comment: string | null;
};

export default function AdminDailyDiariesPage() {
    const router = useRouter();
    const [diaries, setDiaries] = useState<DailyDiary[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const loadDiaries = async () => {
        try {
            setLoading(true);
            setError("");

            const response = await adminDailyDiaryApi.listSubmittedDiaries();

            if ("data" in response) {
                setDiaries(response.data || []);
            } else if (Array.isArray(response)) {
                setDiaries(response);
            } else {
                throw new Error("Unable to load daily diaries.");
            }
        } catch (err) {
            console.error("Failed to load daily diaries:", err);
            setError("Failed to load submitted daily diaries.");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void loadDiaries();
    }, []);

    return (
        <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
            <div className="mb-7 flex items-start justify-between gap-4">
                <div>
                    <p className="text-sm font-medium text-[#08744f]">
                        Administration
                    </p>

                    <h1 className="mt-1 text-3xl font-bold tracking-tight">
                        Daily Diaries
                    </h1>

                    <p className="mt-2 text-sm text-muted-foreground">
                        Review daily diary entries submitted by field officers.
                    </p>
                </div>

                <button
                    type="button"
                    onClick={() => void loadDiaries()}
                    disabled={loading}
                    className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-semibold hover:bg-muted disabled:opacity-50"
                >
                    <RefreshCw
                        className={`size-4 ${loading ? "animate-spin" : ""}`}
                    />
                    Refresh
                </button>
            </div>

            {error && (
                <div className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                    {error}
                </div>
            )}

            <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
                <div className="border-b border-border px-5 py-4">
                    <div className="flex items-center gap-2">
                        <FileText className="size-5 text-[#08744f]" />

                        <h2 className="font-semibold">
                            Submitted Daily Diaries
                        </h2>

                        <span className="ml-auto text-sm text-muted-foreground">
                            {diaries.length} total
                        </span>
                    </div>
                </div>

                {loading ? (
                    <div className="p-8 text-center text-sm text-muted-foreground">
                        Loading daily diaries...
                    </div>
                ) : diaries.length === 0 ? (
                    <div className="p-10 text-center">
                        <FileText className="mx-auto size-10 text-muted-foreground" />

                        <p className="mt-3 font-medium">
                            No submitted daily diaries found.
                        </p>

                        <p className="mt-1 text-sm text-muted-foreground">
                            Submitted diaries will appear here.
                        </p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[900px] text-sm">
                            <thead className="bg-muted/50">
                                <tr className="border-b border-border text-left">
                                    <th className="px-5 py-3 font-semibold">
                                        Officer
                                    </th>

                                    <th className="px-5 py-3 font-semibold">
                                        Diary Date
                                    </th>

                                    <th className="px-5 py-3 font-semibold">
                                        Subject
                                    </th>

                                    <th className="px-5 py-3 font-semibold">
                                        Location
                                    </th>

                                    <th className="px-5 py-3 font-semibold">
                                        Review Status
                                    </th>

                                    <th className="px-5 py-3 font-semibold">
                                        Submitted
                                    </th>

                                    <th className="px-5 py-3 text-right font-semibold">
                                        Action
                                    </th>
                                </tr>
                            </thead>

                            <tbody>
                                {diaries.map((diary) => (
                                    <tr
                                        key={diary.id}
                                        className="border-b border-border last:border-b-0 hover:bg-muted/30"
                                    >
                                        <td className="px-5 py-4">
                                            <div className="font-medium">
                                                {diary.officer_name}
                                            </div>

                                            <div className="mt-0.5 text-xs text-muted-foreground">
                                                {diary.officer_email}
                                            </div>
                                        </td>

                                        <td className="px-5 py-4">
                                            {diary.diary_date || "—"}
                                        </td>

                                        <td className="max-w-[220px] px-5 py-4">
                                            <span className="line-clamp-2">
                                                {diary.subject || "—"}
                                            </span>
                                        </td>

                                        <td className="max-w-[200px] px-5 py-4">
                                            <span className="line-clamp-2">
                                                {diary.location || "—"}
                                            </span>
                                        </td>

                                        <td className="px-5 py-4">
                                            <span className="inline-flex rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
                                                {diary.review_status || "PENDING"}
                                            </span>
                                        </td>

                                        <td className="px-5 py-4 text-muted-foreground">
                                            {diary.submitted_at
                                                ? new Date(diary.submitted_at).toLocaleString()
                                                : "—"}
                                        </td>

                                        <td className="px-5 py-4 text-right">
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    router.push(`/admin/daily-diaries/${diary.id}`)
                                                }
                                                className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-semibold hover:bg-muted"
                                            >
                                                <Eye className="size-4" />
                                                View
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}