"use client";

import { ChangeEvent, useCallback, useEffect, useRef, useState } from "react";
import {
    Camera,
    CheckCircle2,
    Image as ImageIcon,
    Loader2,
    RotateCcw,
    Search,
    Sparkles,
    Upload,
} from "lucide-react";
import { toast } from "sonner";
import { apiRequest } from "@/lib/api";
import { checkDiaryBackendReachable } from "@/lib/offline-diary";
import { getStoredUser } from "@/lib/auth";
import {
    clearOfflineSpeciesDraft,
    loadOfflineSpeciesDraft,
    saveOfflineSpeciesDraft,
} from "@/lib/offline-species-draft";

type SpeciesResult = {
    common_name: string | null;
    local_name: string | null;
    scientific_name: string | null;
    category: string | null;
    confidence: number;
    identification_status:
    | "identified"
    | "uncertain"
    | "not_identifiable";
    description: string | null;
    key_features: string[];
    alternative_species: {
        common_name: string | null;
        scientific_name: string | null;
        confidence: number;
    }[];
    image?: {
        filename: string | null;
        width: number;
        height: number;
        format: string;
    };
};

type ForestKnowledge = {
    chunk_id: string;
    document_id: string;
    text: string;
    score: number;
    source_reference: string;
    book_title: string | null;
    section_title: string | null;
    chapter_title: string | null;
    page_number: number | null;
    page_end: number | null;
};

type SpeciesResponse = {
    success: boolean;
    result: SpeciesResult;
    forest_knowledge: ForestKnowledge[];
};

const MAX_AUTOMATIC_RETRIES = 5;

export default function SpeciesIdentification() {
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const identifyRef = useRef<(automatic?: boolean) => Promise<void>>(async () => undefined);
    const authBlockedRef = useRef(false);
    const identifyingRef = useRef(false);
    const automaticRetryCountRef = useRef(0);
    const automaticRetryTimerRef = useRef<number | null>(null);

    const [ownerId, setOwnerId] = useState<string | null>(null);
    const [draftOwnerId, setDraftOwnerId] = useState<string | null>(null);
    const [connectivity, setConnectivity] = useState<"Online" | "Offline">("Offline");
    const [queuedIdentification, setQueuedIdentification] = useState(false);
    const [syncError, setSyncError] = useState<string | null>(null);
    const [restored, setRestored] = useState(false);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [result, setResult] = useState<SpeciesResult | null>(null);
    const [forestKnowledge, setForestKnowledge] =
        useState<ForestKnowledge[]>([]);
    const [identifying, setIdentifying] = useState(false);

    useEffect(() => {
        const updateOwner = () => {
            const user = getStoredUser();
            setOwnerId(user?.role === "FIELD_OFFICER" ? user.id : null);
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
        let cancelled = false;
        setRestored(false);
        setDraftOwnerId(null);
        setSelectedFile(null);
        setPreviewUrl((previousUrl) => {
            if (previousUrl) URL.revokeObjectURL(previousUrl);
            return null;
        });
        setResult(null);
        setForestKnowledge([]);
        setQueuedIdentification(false);
        setSyncError(null);
        automaticRetryCountRef.current = 0;
        if (automaticRetryTimerRef.current !== null) {
            window.clearTimeout(automaticRetryTimerRef.current);
            automaticRetryTimerRef.current = null;
        }
        authBlockedRef.current = false;
        if (!ownerId) return;
        void loadOfflineSpeciesDraft(ownerId)
            .then((draft) => {
                if (cancelled || !draft) return;
                const file = new File([draft.image], draft.fileName, { type: draft.mimeType });
                setDraftOwnerId(ownerId);
                setSelectedFile(file);
                setPreviewUrl(URL.createObjectURL(file));
                setQueuedIdentification(draft.queued);
                setResult(draft.result as SpeciesResult | null);
                setForestKnowledge(draft.forestKnowledge as ForestKnowledge[]);
            })
            .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Unable to restore the local species image."))
            .finally(() => { if (!cancelled) setRestored(true); });
        return () => { cancelled = true; };
    }, [ownerId]);

    const persistSpeciesDraft = useCallback(async (
        file: File,
        queued: boolean,
        currentResult: SpeciesResult | null = result,
        knowledge: ForestKnowledge[] = forestKnowledge,
    ) => {
        if (!ownerId) return;
        await saveOfflineSpeciesDraft({
            ownerId,
            image: file,
            fileName: file.name,
            mimeType: file.type,
            queued,
            result: currentResult,
            forestKnowledge: knowledge,
            updatedAt: new Date().toISOString(),
        });
    }, [forestKnowledge, ownerId, result]);

    const scheduleAutomaticRetry = useCallback(() => {
        automaticRetryCountRef.current += 1;
        if (automaticRetryCountRef.current >= MAX_AUTOMATIC_RETRIES) {
            setSyncError("Automatic retries are paused. Select Sync Now to retry this identification.");
            return;
        }
        if (automaticRetryTimerRef.current !== null) {
            window.clearTimeout(automaticRetryTimerRef.current);
        }
        const delay = Math.min(1_000 * 2 ** (automaticRetryCountRef.current - 1), 16_000);
        automaticRetryTimerRef.current = window.setTimeout(() => {
            automaticRetryTimerRef.current = null;
            if (!authBlockedRef.current) void identifyRef.current(true);
        }, delay);
    }, []);

    const handleFileChange = (
        event: ChangeEvent<HTMLInputElement>
    ) => {
        const file = event.target.files?.[0];

        if (!file) {
            return;
        }

        const allowedTypes = [
            "image/jpeg",
            "image/png",
            "image/webp",
        ];

        if (!allowedTypes.includes(file.type)) {
            toast.error(
                "Only JPEG, PNG, and WebP images are supported."
            );
            return;
        }

        if (file.size > 10 * 1024 * 1024) {
            toast.error("Image size must be less than 10 MB.");
            return;
        }

        setSelectedFile(file);
        setDraftOwnerId(ownerId);
        setResult(null);
        setForestKnowledge([]);
        setQueuedIdentification(false);
        setSyncError(null);
        automaticRetryCountRef.current = 0;

        const url = URL.createObjectURL(file);
        setPreviewUrl(url);
        if (ownerId) {
            void persistSpeciesDraft(file, false, null, [])
                .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Unable to save the local species image."));
        }
    };

    const handleIdentify = useCallback(async (automatic = false) => {
        if (automatic && authBlockedRef.current) return;
        if (identifyingRef.current) return;
        if (!automatic) {
            authBlockedRef.current = false;
            automaticRetryCountRef.current = 0;
            setSyncError(null);
            if (automaticRetryTimerRef.current !== null) {
                window.clearTimeout(automaticRetryTimerRef.current);
                automaticRetryTimerRef.current = null;
            }
        }
        const activeUser = getStoredUser();
        if (
            !ownerId ||
            draftOwnerId !== ownerId ||
            activeUser?.role !== "FIELD_OFFICER" ||
            activeUser.id !== ownerId
        ) {
            authBlockedRef.current = true;
            if (!automatic) toast.error("Sign in to the original field officer account to use this saved image.");
            return;
        }
        if (!selectedFile) {
            if (!automatic) toast.error("Please select an image first.");
            return;
        }

        setIdentifying(true);
        identifyingRef.current = true;

        try {
            const backendReachable = navigator.onLine && await checkDiaryBackendReachable();
            if (automatic && !backendReachable) return;
            if (!backendReachable) {
                await persistSpeciesDraft(selectedFile, true, null, []);
                setQueuedIdentification(true);
                toast.info("Identification is queued and will run when the service is reachable.");
                return;
            }
            const formData = new FormData();
            formData.append("image", selectedFile);

            const response = await apiRequest<SpeciesResponse>(
                "/api/v1/field/species/identify",
                {
                    method: "POST",
                    body: formData,
                }
            );

            if (!response.success) {
                const retryable = response.code === "NETWORK" ||
                    response.code === "TIMEOUT" ||
                    response.code === "SERVER_ERROR" ||
                    (response.status !== undefined && response.status >= 500);
                if (response.status === 401 || response.status === 403) authBlockedRef.current = true;
                if (ownerId && retryable) {
                    await persistSpeciesDraft(selectedFile, true, null, []);
                    setQueuedIdentification(true);
                    if (automatic) scheduleAutomaticRetry();
                    toast.info("Identification is queued and will run when the service is reachable.");
                    return;
                }
                throw new Error(response.message || "Species identification failed.");
            }
            if (!response.result) {
                throw new Error("Species identification returned an invalid response.");
            }

            setResult(response.result);
            setForestKnowledge(
                response.forest_knowledge || []
            );
            setQueuedIdentification(false);
            setSyncError(null);
            automaticRetryCountRef.current = 0;
            if (automaticRetryTimerRef.current !== null) {
                window.clearTimeout(automaticRetryTimerRef.current);
                automaticRetryTimerRef.current = null;
            }
            await persistSpeciesDraft(
                selectedFile,
                false,
                response.result,
                response.forest_knowledge || [],
            );

            toast.success(
                "Species identified successfully."
            );
        } catch (error) {
            const apiFailure = error as { code?: string; status?: number };
            if (
                ownerId &&
                (apiFailure.code === "NETWORK" || apiFailure.code === "TIMEOUT" ||
                    apiFailure.code === "SERVER_ERROR" || (apiFailure.status !== undefined && apiFailure.status >= 500))
            ) {
                try {
                    await persistSpeciesDraft(selectedFile, true, null, []);
                    setQueuedIdentification(true);
                    if (automatic) scheduleAutomaticRetry();
                    toast.info("Identification is queued and will run when the service is reachable.");
                    return;
                } catch (storageError) {
                    toast.error(storageError instanceof Error ? storageError.message : "Unable to queue species identification.");
                }
            }
            if (apiFailure.status === 401 || apiFailure.status === 403) authBlockedRef.current = true;
            setSyncError(error instanceof Error ? error.message : "Unable to identify species.");
            console.error(
                "Species identification error:",
                error
            );

            toast.error(
                error instanceof Error
                    ? error.message
                    : "Unable to identify species."
            );
        } finally {
            identifyingRef.current = false;
            setIdentifying(false);
        }
    }, [draftOwnerId, ownerId, persistSpeciesDraft, scheduleAutomaticRetry, selectedFile]);
    identifyRef.current = handleIdentify;

    useEffect(() => {
        if (!ownerId || !restored) return;
        let cancelled = false;
        const checkConnection = async () => {
            const reachable = navigator.onLine && await checkDiaryBackendReachable();
            if (cancelled) return;
            setConnectivity(reachable ? "Online" : "Offline");
            if (
                reachable &&
                queuedIdentification &&
                !syncError &&
                !identifyingRef.current &&
                automaticRetryTimerRef.current === null &&
                !authBlockedRef.current &&
                automaticRetryCountRef.current < MAX_AUTOMATIC_RETRIES
            ) {
                void identifyRef.current(true);
            }
        };
        const onOffline = () => setConnectivity("Offline");
        window.addEventListener("online", checkConnection);
        window.addEventListener("offline", onOffline);
        const interval = window.setInterval(checkConnection, 30_000);
        void checkConnection();
        return () => {
            cancelled = true;
            window.removeEventListener("online", checkConnection);
            window.removeEventListener("offline", onOffline);
            window.clearInterval(interval);
        };
    }, [ownerId, queuedIdentification, restored, syncError]);

    useEffect(() => () => {
        if (automaticRetryTimerRef.current !== null) {
            window.clearTimeout(automaticRetryTimerRef.current);
        }
    }, []);

    const handleReset = () => {
        if (previewUrl) {
            URL.revokeObjectURL(previewUrl);
        }

        setSelectedFile(null);
        setPreviewUrl(null);
        setResult(null);
        setForestKnowledge([]);
        setQueuedIdentification(false);
        setSyncError(null);
        automaticRetryCountRef.current = 0;
        if (automaticRetryTimerRef.current !== null) {
            window.clearTimeout(automaticRetryTimerRef.current);
            automaticRetryTimerRef.current = null;
        }
        authBlockedRef.current = false;
        if (ownerId) {
            void clearOfflineSpeciesDraft(ownerId)
                .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Unable to clear the local species image."));
        }

        if (fileInputRef.current) {
            fileInputRef.current.value = "";
        }
    };

    const syncState = identifying
        ? "Syncing"
        : syncError
            ? "Sync Failed"
            : queuedIdentification
                ? "Pending Sync"
                : connectivity === "Online"
                    ? result ? "Synced" : "Online"
                    : "Offline";

    const confidencePercentage = result
        ? Math.round(result.confidence * 100)
        : 0;

    const confidenceLevel =
        confidencePercentage >= 80
            ? {
                label: "Species Identified",
                message: "High confidence identification.",
                badgeClass: "text-emerald-700",
                confidenceClass: "text-emerald-600",
                borderClass: "border-emerald-200",
                backgroundClass: "bg-emerald-50/50",
            }
            : confidencePercentage >= 50
                ? {
                    label: "Identification Needs Verification",
                    message:
                        "Please verify the species before taking any field action.",
                    badgeClass: "text-amber-700",
                    confidenceClass: "text-amber-600",
                    borderClass: "border-amber-200",
                    backgroundClass: "bg-amber-50/50",
                }
                : {
                    label: "Unable to Reliably Identify",
                    message:
                        "The image does not provide enough confidence. Try uploading a clearer or closer photo.",
                    badgeClass: "text-red-700",
                    confidenceClass: "text-red-600",
                    borderClass: "border-red-200",
                    backgroundClass: "bg-red-50/50",
                };

    return (
        <section className="rounded-2xl border bg-white p-5 shadow-sm">
            <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white">
                <span className="font-medium">{syncState}</span>
                <span>{queuedIdentification ? "1 pending identification" : "0 pending identifications"}</span>
                {queuedIdentification && (
                    <button
                        type="button"
                        onClick={() => void handleIdentify()}
                        disabled={identifying}
                        className="rounded-md border border-white/60 px-3 py-1.5 font-medium text-white transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        Sync Now
                    </button>
                )}
                {syncError && <span role="status" className="basis-full text-amber-300">{syncError}</span>}
            </div>
            <div className="mb-5 flex items-start justify-between gap-4">
                <div>
                    <div className="flex items-center gap-2">
                        <div className="rounded-xl bg-emerald-50 p-2">
                            <Sparkles className="h-5 w-5 text-emerald-600" />
                        </div>

                        <div>
                            <h2 className="text-lg font-semibold text-gray-900">
                                Wildlife & Plant Identification
                            </h2>

                            <p className="text-sm text-gray-500">
                                Upload a field photo to identify a species using AI.
                            </p>
                        </div>
                    </div>
                </div>

                {selectedFile && (
                    <button
                        type="button"
                        onClick={handleReset}
                        className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                    >
                        <RotateCcw className="h-4 w-4" />
                        Reset
                    </button>
                )}
            </div>

            {!selectedFile ? (
                <div
                    className="cursor-pointer rounded-2xl border-2 border-dashed border-gray-300 p-8 text-center transition hover:border-emerald-400 hover:bg-emerald-50/30"
                    onClick={() => fileInputRef.current?.click()}
                >
                    <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50">
                        <Camera className="h-7 w-7 text-emerald-600" />
                    </div>

                    <h3 className="font-medium text-gray-900">
                        Upload a wildlife or plant photo
                    </h3>

                    <p className="mt-1 text-sm text-gray-500">
                        JPEG, PNG or WebP • Maximum 10 MB
                    </p>

                    <button
                        type="button"
                        onClick={(event) => {
                            event.stopPropagation();
                            fileInputRef.current?.click();
                        }}
                        className="mt-5 inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-700"
                    >
                        <Upload className="h-4 w-4" />
                        Choose Photo
                    </button>

                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="hidden"
                        onChange={handleFileChange}
                    />
                </div>
            ) : (
                <div className="space-y-5">
                    <div className="overflow-hidden rounded-2xl border bg-gray-50">
                        {previewUrl && (
                            <img
                                src={previewUrl}
                                alt="Selected field photo"
                                className="max-h-[420px] w-full object-contain"
                            />
                        )}
                    </div>

                    <div className="flex flex-col gap-3 sm:flex-row">
                        <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={identifying}
                            className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                        >
                            <ImageIcon className="h-4 w-4" />
                            Change Photo
                        </button>

                        <button
                            type="button"
                            onClick={() => void handleIdentify()}
                            disabled={identifying}
                            className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            {identifying ? (
                                <>
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    Identifying...
                                </>
                            ) : (
                                <>
                                    <Search className="h-4 w-4" />
                                    Identify Species
                                </>
                            )}
                        </button>
                    </div>

                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="hidden"
                        onChange={handleFileChange}
                    />
                </div>
            )}

            {result && (
                <div
                    className={`mt-6 rounded-2xl border p-5 ${confidenceLevel.borderClass} ${confidenceLevel.backgroundClass}`}
                >
                    <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                            <div className="flex items-center gap-2">
                                <CheckCircle2
                                    className={`h-5 w-5 ${confidenceLevel.confidenceClass}`}
                                />

                                <span
                                    className={`text-sm font-medium ${confidenceLevel.badgeClass}`}
                                >
                                    {confidenceLevel.label}
                                </span>
                            </div>

                            <p
                                className={`mt-2 text-sm ${confidenceLevel.badgeClass}`}
                            >
                                {confidenceLevel.message}
                            </p>

                            <h3 className="mt-2 text-2xl font-bold text-gray-900">
                                {result.common_name || "Unknown Species"}
                            </h3>

                            {result.local_name && (
                                <p className="mt-1 text-base text-gray-700">
                                    {result.local_name}
                                </p>
                            )}

                            {result.scientific_name && (
                                <p className="mt-1 text-sm italic text-gray-500">
                                    {result.scientific_name}
                                </p>
                            )}
                        </div>

                        <div className="rounded-xl bg-white px-4 py-3 text-center shadow-sm">
                            <p className="text-xs text-gray-500">
                                Confidence
                            </p>

                            <p
                                className={`text-2xl font-bold ${confidenceLevel.confidenceClass}`}
                            >
                                {confidencePercentage}%
                            </p>
                        </div>
                    </div>

                    {result.category && (
                        <div className="mt-4">
                            <span className="inline-flex rounded-full bg-white px-3 py-1 text-xs font-medium capitalize text-gray-700">
                                {result.category}
                            </span>
                        </div>
                    )}

                    {result.description && (
                        <div className="mt-5">
                            <h4 className="text-sm font-semibold text-gray-900">
                                Description
                            </h4>

                            <p className="mt-1 text-sm leading-6 text-gray-600">
                                {result.description}
                            </p>
                        </div>
                    )}

                    {result.key_features?.length > 0 && (
                        <div className="mt-5">
                            <h4 className="text-sm font-semibold text-gray-900">
                                Key Features
                            </h4>

                            <ul className="mt-2 space-y-1">
                                {result.key_features.map(
                                    (feature, index) => (
                                        <li
                                            key={`${feature}-${index}`}
                                            className="text-sm text-gray-600"
                                        >
                                            • {feature}
                                        </li>
                                    )
                                )}
                            </ul>
                        </div>
                    )}

                    {result.alternative_species?.length > 0 && (
                        <div className="mt-5">
                            <h4 className="text-sm font-semibold text-gray-900">
                                Alternative Species
                            </h4>

                            <div className="mt-2 space-y-2">
                                {result.alternative_species.map(
                                    (species, index) => (
                                        <div
                                            key={`${species.common_name}-${index}`}
                                            className="rounded-xl bg-white p-3"
                                        >
                                            <p className="text-sm font-medium text-gray-900">
                                                {species.common_name || "Unknown"}
                                            </p>

                                            {species.scientific_name && (
                                                <p className="text-xs italic text-gray-500">
                                                    {species.scientific_name}
                                                </p>
                                            )}

                                            <p className="mt-1 text-xs text-gray-500">
                                                Confidence:{" "}
                                                {Math.round(
                                                    species.confidence * 100
                                                )}
                                                %
                                            </p>
                                        </div>
                                    )
                                )}
                            </div>
                        </div>
                    )}
                    {forestKnowledge.length > 0 && 
                         confidencePercentage >= 50 && (
                        
                        <div className="mt-6 border-t border-emerald-200 pt-6">
                            <div className="flex items-center gap-2">
                                <div className="rounded-lg bg-white p-2 shadow-sm">
                                    <Sparkles className="h-4 w-4 text-emerald-600" />
                                </div>

                                <div>
                                    <h4 className="text-base font-semibold text-gray-900">
                                        Forest Department Knowledge
                                    </h4>

                                    <p className="text-xs text-gray-500">
                                        Relevant information retrieved from the Forest
                                        Department knowledge base.
                                    </p>
                                </div>
                            </div>

                            <div className="mt-4 space-y-4">
                                {forestKnowledge.map((knowledge, index) => (
                                    <div
                                        key={knowledge.chunk_id || index}
                                        className="rounded-xl border bg-white p-4 shadow-sm"
                                    >
                                        <div className="flex flex-wrap items-start justify-between gap-3">
                                            <div>
                                                {knowledge.book_title && (
                                                    <p className="text-sm font-semibold text-gray-900">
                                                        📚 {knowledge.book_title}
                                                    </p>
                                                )}

                                                {knowledge.chapter_title && (
                                                    <p className="mt-1 text-xs text-gray-500">
                                                        Chapter: {knowledge.chapter_title}
                                                    </p>
                                                )}

                                                {knowledge.section_title && (
                                                    <p className="mt-1 text-xs text-gray-500">
                                                        Section: {knowledge.section_title}
                                                    </p>
                                                )}
                                            </div>

                                            {knowledge.page_number !== null && (
                                                <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
                                                    Page {knowledge.page_number}
                                                    {knowledge.page_end &&
                                                        knowledge.page_end !== knowledge.page_number
                                                        ? `–${knowledge.page_end}`
                                                        : ""}
                                                </span>
                                            )}
                                        </div>

                                        <p className="mt-3 text-sm leading-6 text-gray-700">
                                            {knowledge.text}
                                        </p>

                                        <div className="mt-3 flex flex-wrap items-center gap-3 border-t pt-3">
                                            <span className="text-xs text-gray-500">
                                                Relevance:{" "}
                                                {Math.round(knowledge.score * 100)}%
                                            </span>

                                            {knowledge.source_reference && (
                                                <span
                                                    className="max-w-full truncate text-xs text-gray-400"
                                                    title={knowledge.source_reference}
                                                >
                                                    Source: {knowledge.source_reference}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </section>
    );
}