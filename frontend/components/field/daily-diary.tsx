"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";

type ReviewStatus =
    | "PENDING"
    | "APPROVED"
    | "REJECTED"
    | "CHANGES_REQUESTED";

type Diary = {
    diary_id: string;
    form_type: "DAILY_DIARY";
    status: "DRAFT" | "SUBMITTED";
    review_status?: ReviewStatus | null;
    review_comment?: string | null;
    reviewed_by?: string | null;
    reviewed_at?: string | null;

    diary_date?: string | null;
    subject?: string | null;
    description?: string | null;
    location?: string | null;
    activities?: string[];
    observations?: string | null;
    additional_remarks?: string | null;
    source_text?: string | null;

    created_at?: string | null;
    updated_at?: string | null;
    submitted_at?: string | null;
};

type DailyDiaryProps = {
    onClose?: () => void;
};

const emptyForm = {
    diary_date: new Date().toISOString().split("T")[0],
    subject: "",
    description: "",
    location: "",
    activities: [""],
    observations: "",
    additional_remarks: "",
};

export function DailyDiary({ onClose }: DailyDiaryProps) {
    const [form, setForm] = useState(emptyForm);
    const [diaries, setDiaries] = useState<Diary[]>([]);
    const [editingId, setEditingId] = useState<string | null>(null);

    const [loading, setLoading] = useState(false);
    const [loadingDiaries, setLoadingDiaries] = useState(false);
    const [message, setMessage] = useState("");
    const [error, setError] = useState("");

    const loadDiaries = async () => {
        try {
            setLoadingDiaries(true);
            setError("");

            const response = await apiRequest<{
                success: boolean;
                diaries: Diary[];
                total: number;
            }>("/api/v1/field/forms/daily-diary");

            if ("data" in response) {
                setDiaries(response.data.diaries || []);
            } else {
                throw new Error("Unable to load daily diaries.");
            }

        } catch (err: any) {
            setError(err?.message || "Unable to load daily diaries.");
        } finally {
            setLoadingDiaries(false);
        }
    };

    useEffect(() => {
        loadDiaries();
    }, []);

    const updateField = (field: keyof typeof form, value: any) => {
        setForm((prev) => ({
            ...prev,
            [field]: value,
        }));
    };

    const addActivity = () => {
        setForm((prev) => ({
            ...prev,
            activities: [...prev.activities, ""],
        }));
    };

    const updateActivity = (index: number, value: string) => {
        setForm((prev) => {
            const activities = [...prev.activities];
            activities[index] = value;

            return {
                ...prev,
                activities,
            };
        });
    };

    const removeActivity = (index: number) => {
        setForm((prev) => {
            const activities = prev.activities.filter((_, i) => i !== index);

            return {
                ...prev,
                activities: activities.length ? activities : [""],
            };
        });
    };

    const resetForm = () => {
        setForm(emptyForm);
        setEditingId(null);
    };

    const handleSaveDraft = async () => {
        try {
            setLoading(true);
            setMessage("");
            setError("");

            const payload = {
                diary_date: form.diary_date || null,
                subject: form.subject || null,
                description: form.description || null,
                location: form.location || null,
                activities: form.activities.filter((item) => item.trim()),
                observations: form.observations || null,
                additional_remarks: form.additional_remarks || null,
            };

            if (editingId) {
                await apiRequest(
                    `/api/v1/field/forms/daily-diary/${editingId}`,
                    {
                        method: "PUT",
                        body: JSON.stringify(payload),
                    }
                );

                setMessage("Daily diary draft updated successfully.");
            } else {
                await apiRequest(
                    "/api/v1/field/forms/daily-diary",
                    {
                        method: "POST",
                        body: JSON.stringify(payload),
                    }
                );

                setMessage("Daily diary draft saved successfully.");
            }

            resetForm();
            await loadDiaries();
        } catch (err: any) {
            setError(err?.message || "Unable to save daily diary.");
        } finally {
            setLoading(false);
        }
    };

    const handleEdit = (diary: Diary) => {
        setEditingId(diary.diary_id);

        setForm({
            diary_date:
                diary.diary_date ||
                new Date().toISOString().split("T")[0],
            subject: diary.subject || "",
            description: diary.description || "",
            location: diary.location || "",
            activities:
                diary.activities && diary.activities.length
                    ? diary.activities
                    : [""],
            observations: diary.observations || "",
            additional_remarks: diary.additional_remarks || "",
        });

        setMessage("");
        setError("");

        window.scrollTo({
            top: 0,
            behavior: "smooth",
        });
    };

    const handleSubmit = async (diaryId: string) => {
        try {
            setLoading(true);
            setMessage("");
            setError("");

            await apiRequest(
                `/api/v1/field/forms/daily-diary/${diaryId}/submit`,
                {
                    method: "POST",
                }
            );

            setMessage("Daily diary submitted successfully.");
            await loadDiaries();
        } catch (err: any) {
            setError(err?.message || "Unable to submit daily diary.");
        } finally {
            setLoading(false);
        }
    };

    const getReviewLabel = (status?: ReviewStatus | null) => {
        switch (status) {
            case "APPROVED":
                return "Approved";
            case "REJECTED":
                return "Rejected";
            case "CHANGES_REQUESTED":
                return "Changes Requested";
            default:
                return "Pending Review";
        }
    };

    const getReviewClass = (status?: ReviewStatus | null) => {
        switch (status) {
            case "APPROVED":
                return "bg-green-100 text-green-700";
            case "REJECTED":
                return "bg-red-100 text-red-700";
            case "CHANGES_REQUESTED":
                return "bg-yellow-100 text-yellow-700";
            default:
                return "bg-gray-100 text-gray-700";
        }
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-xl font-bold text-white">
                        Daily Diary
                    </h2>

                    <p className="mt-1 text-sm font-medium text-white/80">
                        Create and manage your daily field diary.
                    </p>
                </div>

                {onClose && (
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                    >
                        Close
                    </button>
                )}
            </div>

            {/* Messages */}
            {message && (
                <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
                    {message}
                </div>
            )}

            {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {error}
                </div>
            )}

            {/* Form */}
            <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
                <div className="mb-5">
                    <h3 className="text-lg font-semibold text-gray-900">
                        {editingId ? "Edit Daily Diary" : "New Daily Diary"}
                    </h3>
                </div>

                <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                    {/* Date */}
                    <div>
                        <label className="mb-1 block text-sm font-medium text-gray-700">
                            Diary Date
                        </label>
                        <input
                            type="date"
                            value={form.diary_date}
                            onChange={(e) =>
                                updateField("diary_date", e.target.value)
                            }
                            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-green-500"
                        />
                    </div>

                    {/* Subject */}
                    <div>
                        <label className="mb-1 block text-sm font-medium text-gray-700">
                            Subject
                        </label>
                        <input
                            type="text"
                            value={form.subject}
                            onChange={(e) =>
                                updateField("subject", e.target.value)
                            }
                            placeholder="Enter diary subject"
                            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-green-500"
                        />
                    </div>

                    {/* Location */}
                    <div className="md:col-span-2">
                        <label className="mb-1 block text-sm font-medium text-gray-700">
                            Location
                        </label>
                        <input
                            type="text"
                            value={form.location}
                            onChange={(e) =>
                                updateField("location", e.target.value)
                            }
                            placeholder="Enter field location"
                            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-green-500"
                        />
                    </div>

                    {/* Description */}
                    <div className="md:col-span-2">
                        <label className="mb-1 block text-sm font-medium text-gray-700">
                            Description
                        </label>
                        <textarea
                            rows={4}
                            value={form.description}
                            onChange={(e) =>
                                updateField("description", e.target.value)
                            }
                            placeholder="Describe today's field activities..."
                            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-green-500"
                        />
                    </div>

                    {/* Activities */}
                    <div className="md:col-span-2">
                        <div className="mb-2 flex items-center justify-between">
                            <label className="block text-sm font-medium text-gray-700">
                                Activities
                            </label>

                            <button
                                type="button"
                                onClick={addActivity}
                                className="text-sm font-medium text-green-600 hover:text-green-700"
                            >
                                + Add Activity
                            </button>
                        </div>

                        <div className="space-y-2">
                            {form.activities.map((activity, index) => (
                                <div key={index} className="flex gap-2">
                                    <input
                                        type="text"
                                        value={activity}
                                        onChange={(e) =>
                                            updateActivity(index, e.target.value)
                                        }
                                        placeholder={`Activity ${index + 1}`}
                                        className="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-green-500"
                                    />

                                    {form.activities.length > 1 && (
                                        <button
                                            type="button"
                                            onClick={() => removeActivity(index)}
                                            className="rounded-lg border border-red-200 px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                                        >
                                            Remove
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Observations */}
                    <div className="md:col-span-2">
                        <label className="mb-1 block text-sm font-medium text-gray-700">
                            Observations
                        </label>
                        <textarea
                            rows={3}
                            value={form.observations}
                            onChange={(e) =>
                                updateField("observations", e.target.value)
                            }
                            placeholder="Enter observations"
                            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-green-500"
                        />
                    </div>

                    {/* Additional Remarks */}
                    <div className="md:col-span-2">
                        <label className="mb-1 block text-sm font-medium text-gray-700">
                            Additional Remarks
                        </label>
                        <textarea
                            rows={3}
                            value={form.additional_remarks}
                            onChange={(e) =>
                                updateField("additional_remarks", e.target.value)
                            }
                            placeholder="Enter additional remarks"
                            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-green-500"
                        />
                    </div>
                </div>

                {/* Form Actions */}
                <div className="mt-6 flex flex-wrap gap-3">
                    <button
                        type="button"
                        onClick={handleSaveDraft}
                        disabled={loading}
                        className="rounded-lg bg-green-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {loading
                            ? "Saving..."
                            : editingId
                                ? "Update Draft"
                                : "Save Draft"}
                    </button>

                    {editingId && (
                        <button
                            type="button"
                            onClick={resetForm}
                            disabled={loading}
                            className="rounded-lg border border-gray-300 px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                        >
                            Cancel
                        </button>
                    )}
                </div>
            </div>

            {/* Existing Diaries */}
            <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
                <div className="mb-5 flex items-center justify-between">
                    <div>
                        <h3 className="text-lg font-semibold text-gray-900">
                            My Daily Diaries
                        </h3>
                        <p className="mt-1 text-sm text-gray-500">
                            View your saved and submitted diary entries.
                        </p>
                    </div>

                    <button
                        type="button"
                        onClick={loadDiaries}
                        disabled={loadingDiaries}
                        className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                    >
                        {loadingDiaries ? "Refreshing..." : "Refresh"}
                    </button>
                </div>

                {loadingDiaries ? (
                    <p className="text-sm text-gray-500">
                        Loading diaries...
                    </p>
                ) : diaries.length === 0 ? (
                    <div className="rounded-lg bg-gray-50 px-4 py-8 text-center text-sm text-gray-500">
                        No daily diaries found.
                    </div>
                ) : (
                    <div className="space-y-4">
                        {diaries.map((diary) => (
                            <div
                                key={diary.diary_id}
                                className="rounded-lg border border-gray-200 p-4"
                            >
                                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                                    <div>
                                        <h4 className="font-medium text-gray-900">
                                            {diary.subject || "Daily Diary"}
                                        </h4>

                                        <p className="mt-1 text-sm text-gray-500">
                                            {diary.diary_date || "No date"}
                                            {diary.location
                                                ? ` • ${diary.location}`
                                                : ""}
                                        </p>
                                    </div>

                                    <div className="flex flex-wrap gap-2">
                                        <span
                                            className={`rounded-full px-3 py-1 text-xs font-medium ${diary.status === "SUBMITTED"
                                                    ? "bg-blue-100 text-blue-700"
                                                    : "bg-gray-100 text-gray-700"
                                                }`}
                                        >
                                            {diary.status}
                                        </span>

                                        {diary.status === "SUBMITTED" && (
                                            <span
                                                className={`rounded-full px-3 py-1 text-xs font-medium ${getReviewClass(
                                                    diary.review_status
                                                )}`}
                                            >
                                                {getReviewLabel(diary.review_status)}
                                            </span>
                                        )}
                                    </div>
                                </div>

                                {diary.description && (
                                    <p className="mt-3 text-sm text-gray-700">
                                        {diary.description}
                                    </p>
                                )}

                                {/* Review information */}
                                {diary.status === "SUBMITTED" && (
                                    <div className="mt-4 rounded-lg bg-gray-50 p-3">
                                        <p className="text-sm font-medium text-gray-700">
                                            Review Status
                                        </p>

                                        <p className="mt-1 text-sm text-gray-600">
                                            {getReviewLabel(diary.review_status)}
                                        </p>

                                        {diary.review_comment && (
                                            <div className="mt-2">
                                                <p className="text-xs font-medium text-gray-500">
                                                    Admin Comment
                                                </p>
                                                <p className="mt-1 text-sm text-gray-700">
                                                    {diary.review_comment}
                                                </p>
                                            </div>
                                        )}

                                        {diary.reviewed_at && (
                                            <p className="mt-2 text-xs text-gray-500">
                                                Reviewed:{" "}
                                                {new Date(
                                                    diary.reviewed_at
                                                ).toLocaleString()}
                                            </p>
                                        )}
                                    </div>
                                )}

                                {/* Actions */}
                                <div className="mt-4 flex flex-wrap gap-2">
                                    {diary.status === "DRAFT" && (
                                        <>
                                            <button
                                                type="button"
                                                onClick={() => handleEdit(diary)}
                                                disabled={loading}
                                                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                                            >
                                                Edit
                                            </button>

                                            <button
                                                type="button"
                                                onClick={() =>
                                                    handleSubmit(diary.diary_id)
                                                }
                                                disabled={loading}
                                                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                                            >
                                                Submit
                                            </button>
                                        </>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}