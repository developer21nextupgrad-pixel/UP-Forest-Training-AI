"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "@/lib/api";
import { getStoredUser } from "@/lib/auth";
import { loadDailyDiaryList } from "@/lib/daily-diary-list";
import {
    clearDiaryFormDraft,
    enqueueDiaryOperation,
    getOfflineDiaries,
    loadDiaryFormDraft,
    notifyOfflineQueueChanged,
    saveDiaryFormDraft,
    saveOfflineDiary,
    syncDiaryQueue,
    type DiaryPayload,
    type OfflineDiary,
} from "@/lib/offline-diary";
import { useOfflineDiarySync } from "@/hooks/use-offline-diary-sync";
import { Button } from "../ui/button";

type ReviewStatus =
    | "PENDING"
    | "APPROVED"
    | "REJECTED"
    | "CHANGES_REQUESTED";

type Diary = {
    diary_id: string;
    form_type: "DAILY_DIARY";
    status: "DRAFT" | "SUBMITTED" | "PENDING_SUBMISSION";
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
    sync_error?: string | null;
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
    const [ownerId, setOwnerId] = useState<string | null>(null);
    const [restored, setRestored] = useState(false);
    const localId = useRef<string>("");
    const ownerIdRef = useRef<string | null>(null);
    const offlineSync = useOfflineDiarySync(ownerId);

    const [loading, setLoading] = useState(false);
    const [loadingDiaries, setLoadingDiaries] = useState(false);
    const [extracting, setExtracting] = useState(false);
    const [message, setMessage] = useState("");
    const [error, setError] = useState("");

    const localDiaryToView = useCallback((record: OfflineDiary): Diary => ({
        diary_id: record.serverId ?? record.localId,
        form_type: "DAILY_DIARY",
        status: record.status,
        diary_date: record.payload.diary_date,
        subject: record.payload.subject,
        description: record.payload.description,
        location: record.payload.location,
        activities: record.payload.activities,
        observations: record.payload.observations,
        additional_remarks: record.payload.additional_remarks,
        updated_at: record.updatedAt,
        sync_error: record.syncError,
    }), []);

    const loadDiaries = useCallback(async () => {
        try {
            setLoadingDiaries(true);
            setError("");

            const serverDiaries = await loadDailyDiaryList<Diary>();
            const offlineDiaries = ownerId ? await getOfflineDiaries(ownerId) : [];
            const localRows = offlineDiaries.map(localDiaryToView);
            const serverIds = new Set(serverDiaries.map((diary) => diary.diary_id));
            setDiaries([
                ...serverDiaries.map((serverDiary) => {
                    const local = localRows.find((diary) => diary.diary_id === serverDiary.diary_id);
                    return local?.status === "PENDING_SUBMISSION" ? local : serverDiary;
                }),
                ...localRows.filter((diary) => !serverIds.has(diary.diary_id)),
            ]);

        } catch (err: any) {
            if (ownerId) {
                try {
                    const offlineDiaries = await getOfflineDiaries(ownerId);
                    setDiaries(offlineDiaries.map(localDiaryToView));
                    if (!offlineDiaries.length) {
                        setError(err?.message || "Unable to load daily diaries.");
                    }
                } catch (storageError) {
                    setError(storageError instanceof Error ? storageError.message : "Unable to read saved offline diaries.");
                }
            } else {
                setError(err?.message || "Unable to load daily diaries.");
            }
        } finally {
            setLoadingDiaries(false);
        }
    }, [localDiaryToView, ownerId]);

    useEffect(() => {
        const updateOwner = () => {
            const user = getStoredUser();
            const nextOwner = user?.role === "FIELD_OFFICER" ? user.id : null;
            if (ownerIdRef.current !== nextOwner) {
                ownerIdRef.current = nextOwner;
                setForm(emptyForm);
                setEditingId(null);
                setDiaries([]);
                setRestored(false);
                localId.current = crypto.randomUUID();
            }
            setOwnerId(nextOwner);
        };
        updateOwner();
        window.addEventListener("storage", updateOwner);
        window.addEventListener("up-forest-auth-expired", updateOwner);
        return () => {
            window.removeEventListener("storage", updateOwner);
            window.removeEventListener("up-forest-auth-expired", updateOwner);
        };
    }, []);

    useEffect(() => {
        if (!ownerId) return;
        let cancelled = false;
        const restore = async () => {
            try {
                const draft = await loadDiaryFormDraft(ownerId, "active");
                if (cancelled) return;
                if (draft) {
                    localId.current = draft.localId;
                    setEditingId(draft.editingId);
                    setForm(draft.form as typeof emptyForm);
                    setMessage("Restored your locally saved daily diary draft.");
                }
            } catch (storageError) {
                if (!cancelled) setError(storageError instanceof Error ? storageError.message : "Unable to restore the local draft.");
            } finally {
                if (!cancelled) setRestored(true);
            }
        };
        void restore();
        return () => { cancelled = true; };
    }, [ownerId]);

    useEffect(() => {
        if (!ownerId || !restored) return;
        const timeout = window.setTimeout(() => {
            const hasContent = Boolean(
                form.subject.trim() ||
                form.description.trim() ||
                form.location.trim() ||
                form.observations.trim() ||
                form.additional_remarks.trim() ||
                form.activities.some((activity) => activity.trim()),
            );
            if (!hasContent && !editingId) {
                void clearDiaryFormDraft(ownerId, "active").catch((storageError) => {
                    setError(storageError instanceof Error ? storageError.message : "Unable to clear the empty local draft.");
                });
                return;
            }
            void saveDiaryFormDraft(ownerId, {
                key: "active",
                localId: localId.current || crypto.randomUUID(),
                editingId,
                form,
            }).catch((storageError) => {
                setError(storageError instanceof Error ? storageError.message : "Unable to save the local draft.");
            });
        }, 400);
        return () => window.clearTimeout(timeout);
    }, [ownerId, restored, editingId, form]);

    useEffect(() => {
        if (!ownerId) return;
        void loadDiaries();
    }, [loadDiaries, ownerId]);

    useEffect(() => {
        if (offlineSync.state === "Synced" && ownerId) void loadDiaries();
    }, [offlineSync.state, loadDiaries, ownerId]);

    const updateField = (field: keyof typeof form, value: any) => {
        setForm((prev) => ({
            ...prev,
            [field]: value,
        }));
    };

    const toDateInputValue = (
        value?: string | null
    ): string => {
        if (!value) return "";

        const date = value.trim();

        // Already in YYYY-MM-DD format
        if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            return date;
        }

        // Convert DD-MM-YYYY to YYYY-MM-DD
        const match = date.match(
            /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/
        );

        if (match) {
            const [, day, month, year] = match;

            return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
        }

        return "";
    };

    const handleAIExtract = async () => {
        const narrative = form.description.trim();

        if (!narrative) {
            setError("Please enter your field activity description first.");
            return;
        }

        try {
            setExtracting(true);
            setError("");
            setMessage("");

            const response = await apiRequest<{
                success: boolean;
                fields: {
                    diary_date?: string | null;
                    subject?: string | null;
                    description?: string | null;
                    location?: string | null;
                    activities?: string[];
                    observations?: string | null;
                    additional_remarks?: string | null;
                };
            }>("/api/v1/field/forms/daily-diary/extract", {
                method: "POST",
                body: JSON.stringify({ text: narrative }),
            });

            if (!("data" in response)) {
                throw new Error("Unable to extract diary details.");
            }

            const fields = response.data.fields;



            setForm((prev) => {
                const fields = response.data.fields;

                const extractedDate = fields.diary_date?.trim() || "";

                // Normalize the extracted date to YYYY-MM-DD
                let diaryDate = "";

                if (/^\d{4}-\d{2}-\d{2}$/.test(extractedDate)) {
                    diaryDate = extractedDate;
                } else {
                    const match = extractedDate.match(
                        /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/
                    );

                    if (match) {
                        const [, day, month, year] = match;

                        diaryDate = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
                    }
                }

                return {
                    ...prev,

                    diary_date: diaryDate || prev.diary_date,
                    subject: fields.subject?.trim() || prev.subject,
                    location: fields.location?.trim() || prev.location,

                    // Preserve the original description
                    description: prev.description,

                    activities: fields.activities?.length
                        ? fields.activities
                        : prev.activities,

                    observations:
                        fields.observations?.trim() || prev.observations,

                    additional_remarks:
                        fields.additional_remarks?.trim() ||
                        prev.additional_remarks,
                };
            });



            setMessage("AI extraction complete. Please review the details.");
        } catch (err: any) {
            setError(err?.message || "AI extraction failed.");
        } finally {
            setExtracting(false);
        }
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
        localId.current = crypto.randomUUID();
    };

    const handleSaveDraft = async () => {
        if (!ownerId) {
            setError("Sign in as a field officer before saving daily diary data.");
            return;
        }
        try {
            setLoading(true);
            setMessage("");
            setError("");

            const payload: DiaryPayload = {
                diary_date: form.diary_date || null,
                subject: form.subject || null,
                description: form.description || null,
                location: form.location || null,
                activities: form.activities.filter((item) => item.trim()),
                observations: form.observations || null,
                additional_remarks: form.additional_remarks || null,
            };

            const cached = await getOfflineDiaries(ownerId);
            const cachedDiary = cached.find((diary) =>
                diary.localId === localId.current ||
                (editingId && diary.serverId === editingId)
            );
            const record: OfflineDiary = {
                ownerId,
                localId: cachedDiary?.localId ?? localId.current,
                serverId: cachedDiary ? cachedDiary.serverId : editingId,
                payload,
                status: "DRAFT",
                updatedAt: new Date().toISOString(),
                syncError: null,
            };
            await saveOfflineDiary(record);
            await enqueueDiaryOperation(
                ownerId,
                record,
                record.serverId ? "UPDATE" : "CREATE",
            );
            await saveDiaryFormDraft(ownerId, {
                key: "active",
                localId: record.localId,
                editingId,
                form,
            });

            const syncResult = await syncDiaryQueue(ownerId);
            notifyOfflineQueueChanged();
            if (syncResult === "synced") {
                await clearDiaryFormDraft(ownerId, "active");
                resetForm();
                setMessage(editingId
                    ? "Daily diary draft updated successfully."
                    : "Daily diary draft saved successfully.");
                await loadDiaries();
            } else if (syncResult === "offline" || syncResult === "busy") {
                await clearDiaryFormDraft(ownerId, "active");
                resetForm();
                setMessage("Daily diary saved on this device and pending sync.");
                await loadDiaries();
            } else {
                setError(syncResult === "auth_required"
                    ? "Please sign in again to sync. Your daily diary is safely retained on this device."
                    : "The server could not save this diary. Your data is retained locally; review the sync status before retrying.");
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : "Unable to save daily diary locally.");
        } finally {
            setLoading(false);
        }
    };

    const handleEdit = async (diary: Diary) => {
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
        if (ownerId) {
            const cached = await getOfflineDiaries(ownerId);
            const offlineDiary = cached.find((item) =>
                item.localId === diary.diary_id || item.serverId === diary.diary_id
            );
            localId.current = offlineDiary?.localId ?? diary.diary_id;
        }

        setMessage("");
        setError("");

        window.scrollTo({
            top: 0,
            behavior: "smooth",
        });
    };

    const handleSubmit = async (diaryId: string) => {
        if (!ownerId) {
            setError("Sign in as a field officer before submitting a daily diary.");
            return;
        }
        try {
            setLoading(true);
            setMessage("");
            setError("");

            const cached = await getOfflineDiaries(ownerId);
            let record = cached.find((item) =>
                item.localId === diaryId || item.serverId === diaryId
            );
            if (!record) {
                const diary = diaries.find((item) => item.diary_id === diaryId);
                if (!diary) throw new Error("Daily diary is not available to submit.");
                record = {
                    ownerId,
                    localId: diaryId,
                    serverId: diaryId,
                    payload: {
                        diary_date: diary.diary_date ?? null,
                        subject: diary.subject ?? null,
                        description: diary.description ?? null,
                        location: diary.location ?? null,
                        activities: diary.activities ?? [],
                        observations: diary.observations ?? null,
                        additional_remarks: diary.additional_remarks ?? null,
                        source_text: diary.source_text ?? null,
                    },
                    status: "DRAFT",
                    updatedAt: new Date().toISOString(),
                    syncError: null,
                };
            }
            const pendingRecord = { ...record, status: "PENDING_SUBMISSION" as const };
            await saveOfflineDiary(pendingRecord);
            await enqueueDiaryOperation(ownerId, pendingRecord, "SUBMIT");
            const syncResult = await syncDiaryQueue(ownerId);
            if (syncResult === "synced") {
                setMessage("Daily diary submitted successfully.");
            } else if (syncResult === "offline" || syncResult === "busy") {
                setMessage("Submission is pending. The diary will be submitted after the server validates it.");
            } else {
                setError(syncResult === "auth_required"
                    ? "Please sign in again to submit. Your pending submission is retained."
                    : "The server has not confirmed submission. Your pending submission is retained.");
            }
            await loadDiaries();
            notifyOfflineQueueChanged();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Unable to submit daily diary.");
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

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/20 bg-white/10 px-4 py-3 text-sm text-white">
                <div aria-live="polite">
                    <span className="font-semibold">{offlineSync.state}</span>
                    <span className="ml-2">
                        {offlineSync.pendingCount} pending {offlineSync.pendingCount === 1 ? "operation" : "operations"}
                    </span>
                    {offlineSync.message && <span className="ml-2">{offlineSync.message}</span>}
                    {offlineSync.message?.startsWith("Sign in again") && (
                        <a className="ml-2 underline" href="/field/login">Sign in</a>
                    )}
                </div>
                <button
                    type="button"
                    onClick={() => void offlineSync.syncNow(true)}
                    disabled={offlineSync.syncing || !ownerId || offlineSync.pendingCount === 0}
                    className="rounded-lg border border-white/30 px-3 py-1.5 font-medium hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                >
                    {offlineSync.syncing ? "Syncing..." : "Sync Now"}
                </button>
            </div>

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
                            value={form.diary_date || ""}
                            onChange={(e) => {
                                updateField("diary_date", e.target.value);
                            }}
                            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition-colors focus:border-green-500 focus:ring-2 focus:ring-green-100"
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
                    <div className="md:col-span-2 flex flex-col gap-2">
                        {/* Description */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-black-200">
                                Description
                            </label>

                            <textarea
                                value={form.description}
                                onChange={(e) =>
                                    setForm({ ...form, description: e.target.value })
                                }
                                placeholder="Describe today's field activities..."
                                rows={5}
                                className="w-full min-h-[140px] resize-y rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-green-500"
                            />


                            <div className="mt-2 flex justify-start">
                                <Button
                                    type="button"
                                    onClick={handleAIExtract}
                                    disabled={extracting || !form.description.trim()}
                                >
                                    {extracting ? "Extracting..." : "✨ AI Extract"}
                                </Button>
                            </div>

                        </div>

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
                                {diary.sync_error && (
                                    <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                                        Sync failed: {diary.sync_error}
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
                                    {diary.status !== "SUBMITTED" && (
                                        <>
                                            <button
                                                type="button"
                                                onClick={() => handleEdit(diary)}
                                                disabled={loading}
                                                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                                            >
                                                Edit
                                            </button>

                                            {diary.status === "DRAFT" ? (
                                                <button
                                                    type="button"
                                                    onClick={() => handleSubmit(diary.diary_id)}
                                                    disabled={loading}
                                                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                                                >
                                                    Submit
                                                </button>
                                            ) : (
                                                <span className="self-center text-xs text-amber-700">
                                                    Submission pending server validation
                                                </span>
                                            )}
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