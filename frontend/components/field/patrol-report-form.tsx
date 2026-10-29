"use client";

import {
    AlertTriangle,
    CheckCircle2,
    Loader2,
    Plus,
    RotateCcw,
    Save,
    Send,
    Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { apiRequest } from "@/lib/api";
import {
    createFieldLocalId,
    enqueueOfflineFieldOperation,
    fieldCreateOperationId,
    fieldSyncableFailure,
    getOfflineFormRecord,
    loadOfflineFormDraft,
    saveOfflineFormDraft,
    useOfflineFieldForm,
    type OfflineFieldRecord,
} from "@/lib/offline-field-forms";
import { OfflineFieldFormControls } from "./offline-field-form-controls";

type PatrolReportFields = {
    patrol_date: string | null;
    beat: string | null;
    range_name: string | null;
    division: string | null;

    start_time: string | null;
    end_time: string | null;

    location: string | null;
    team_members: string[];

    purpose: string | null;
    observations: string | null;
    wildlife_sighting: string | null;
    illegal_activity: string | null;
    action_taken: string | null;
    incident_details: string | null;
    additional_remarks: string | null;
};

type PatrolReportResponse = {
    success: boolean;
    form_type: string;
    fields: PatrolReportFields;
    missing_fields: string[];
    source_text: string;
    confidence: number | null;
    message: string | null;
};

type PatrolReportSaveResponse = {
    success: boolean;
    report_id: string;
    form_type: string;
    status: string;
    message: string;
};

type PatrolReportSubmitResponse = {
    success: boolean;
    report_id: string;
    form_type: string;
    status: string;
    submitted_at: string;
    message: string;
};

type PatrolReportDraft = PatrolReportFields & {
    report_id: string;
    form_type: string;
    status: string;
    source_text: string | null;
    ai_confidence: number | null;
    created_at: string | null;
    updated_at: string | null;
};

type Props = {
    onClose?: () => void;
    initialDraft?: PatrolReportDraft | null;
    onSaved?: () => void;
};

const EMPTY_FIELDS: PatrolReportFields = {
    patrol_date: null,
    beat: null,
    range_name: null,
    division: null,

    start_time: null,
    end_time: null,

    location: null,
    team_members: [],

    purpose: null,
    observations: null,
    wildlife_sighting: null,
    illegal_activity: null,
    action_taken: null,
    incident_details: null,
    additional_remarks: null,
};

const FIELD_LABELS: Record<string, string> = {
    patrol_date: "Patrol Date",
    beat: "Beat",
    range_name: "Range",
    division: "Division",
    start_time: "Start Time",
    end_time: "End Time",
    location: "Location",
    purpose: "Purpose",
    observations: "Observations",
    wildlife_sighting: "Wildlife Sighting",
    illegal_activity: "Illegal Activity",
    action_taken: "Action Taken",
    incident_details: "Incident Details",
    additional_remarks: "Additional Remarks",
};

const REQUIRED_SUBMIT_FIELDS = [
    "patrol_date",
    "beat",
    "start_time",
    "end_time",
    "location",
    "purpose",
] as const;

export function PatrolReportForm({
    onClose,
    initialDraft,
    onSaved,
}: Props) {
    const offline = useOfflineFieldForm("PATROL_REPORT");
    const localId = useRef("");
    const previousOwnerId = useRef<string | null>(null);
    const [description, setDescription] = useState("");

    const [fields, setFields] =
        useState<PatrolReportFields>(EMPTY_FIELDS);

    const [missingFields, setMissingFields] = useState<string[]>([]);

    const [confidence, setConfidence] =
        useState<number | null>(null);

    const [isExtracting, setIsExtracting] = useState(false);
    const [isExtracted, setIsExtracted] = useState(false);

    const [isSaving, setIsSaving] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const [savedReportId, setSavedReportId] =
        useState<string | null>(null);

    const [reportId, setReportId] =
        useState<string | null>(null);

    const [isSubmitted, setIsSubmitted] = useState(false);
    const [queuedCreate, setQueuedCreate] = useState(false);
    const [offlineDraftRestored, setOfflineDraftRestored] = useState(false);

    useEffect(() => {
        if (!localId.current) localId.current = initialDraft?.report_id ?? createFieldLocalId();
    }, [initialDraft]);

    useEffect(() => {
        if (previousOwnerId.current !== offline.ownerId) {
            const hadPreviousOwner = previousOwnerId.current !== null;
            previousOwnerId.current = offline.ownerId;
            if (!initialDraft || hadPreviousOwner) {
                setFields(EMPTY_FIELDS);
                setDescription("");
                setConfidence(null);
                setIsExtracted(false);
                setReportId(null);
                setSavedReportId(null);
                setQueuedCreate(false);
                setIsSubmitted(false);
                localId.current = offline.ownerId ? createFieldLocalId() : "";
            }
        }
        setOfflineDraftRestored(false);
        if (!offline.ownerId) return;
        if (initialDraft) {
            setOfflineDraftRestored(true);
            return;
        }
        let cancelled = false;
        void loadOfflineFormDraft<Record<string, unknown>>(offline.ownerId, "PATROL_REPORT", "active")
            .then((draft) => {
                if (cancelled || !draft) return;
                const snapshot = draft.snapshot;
                if (typeof snapshot.localId === "string") localId.current = snapshot.localId;
                if (snapshot.fields && typeof snapshot.fields === "object") setFields(snapshot.fields as PatrolReportFields);
                if (typeof snapshot.description === "string") setDescription(snapshot.description);
                if (typeof snapshot.confidence === "number" || snapshot.confidence === null) setConfidence(snapshot.confidence as number | null);
                setIsExtracted(snapshot.isExtracted === true);
                if (typeof snapshot.reportId === "string") setReportId(snapshot.reportId);
                if (typeof snapshot.savedReportId === "string") setSavedReportId(snapshot.savedReportId);
                if (snapshot.queuedCreate === true) setQueuedCreate(true);
                toast.info("Restored your locally saved patrol report draft.");
            })
            .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Unable to restore the local patrol draft."))
            .finally(() => { if (!cancelled) setOfflineDraftRestored(true); });
        return () => { cancelled = true; };
    }, [initialDraft, offline.ownerId]);

    useEffect(() => {
        if (!offline.ownerId || !offlineDraftRestored || !localId.current || isSubmitted) return;
        void saveOfflineFormDraft(offline.ownerId, "PATROL_REPORT", "active", {
            localId: localId.current,
            fields: fields as unknown as Record<string, unknown>,
            description,
            confidence,
            isExtracted,
            reportId,
            savedReportId,
            queuedCreate,
        }).catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Unable to save the local patrol draft."));
    }, [confidence, description, fields, isExtracted, isSubmitted, offline.ownerId, offlineDraftRestored, queuedCreate, reportId, savedReportId]);

    useEffect(() => {
        if (!offline.ownerId || !localId.current) return;
        const refreshRecord = () => {
            void getOfflineFormRecord(offline.ownerId!, "PATROL_REPORT", localId.current)
                .then((record) => {
                    if (!record) return;
                    if (record.serverId) {
                        setReportId(record.serverId);
                        setSavedReportId(record.serverId);
                        setQueuedCreate(false);
                    }
                    if (record.status === "SUBMITTED") setIsSubmitted(true);
                })
                .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Unable to refresh patrol sync status."));
        };
        window.addEventListener("up-forest-offline-queue-changed", refreshRecord);
        return () => window.removeEventListener("up-forest-offline-queue-changed", refreshRecord);
    }, [offline.ownerId]);

    /**
     * Load an existing saved draft into the form.
     */
    useEffect(() => {
        if (!initialDraft) {
            return;
        }

        setDescription(initialDraft.source_text ?? "");

        setFields({
            patrol_date: initialDraft.patrol_date,
            beat: initialDraft.beat,
            range_name: initialDraft.range_name,
            division: initialDraft.division,

            start_time: initialDraft.start_time,
            end_time: initialDraft.end_time,

            location: initialDraft.location,
            team_members: initialDraft.team_members ?? [],

            purpose: initialDraft.purpose,
            observations: initialDraft.observations,
            wildlife_sighting: initialDraft.wildlife_sighting,
            illegal_activity: initialDraft.illegal_activity,
            action_taken: initialDraft.action_taken,
            incident_details: initialDraft.incident_details,
            additional_remarks: initialDraft.additional_remarks,
        });

        setMissingFields([]);
        setConfidence(initialDraft.ai_confidence);

        setReportId(initialDraft.report_id);
        setSavedReportId(initialDraft.report_id);
        localId.current = initialDraft.report_id;

        setIsExtracted(true);
        setIsSubmitted(initialDraft.status === "SUBMITTED");
    }, [initialDraft]);

    const updateField = (
        key: keyof PatrolReportFields,
        value: string | null,
    ) => {
        setFields((previous) => ({
            ...previous,
            [key]: value,
        }));

        if (key === "patrol_date") {
            setMissingFields((previous) =>
                previous.filter((field) => field !== "patrol_date"),
            );
        }

        if (key === "beat") {
            setMissingFields((previous) =>
                previous.filter((field) => field !== "beat"),
            );
        }

        if (key === "start_time") {
            setMissingFields((previous) =>
                previous.filter((field) => field !== "start_time"),
            );
        }

        if (key === "end_time") {
            setMissingFields((previous) =>
                previous.filter((field) => field !== "end_time"),
            );
        }

        if (key === "location") {
            setMissingFields((previous) =>
                previous.filter((field) => field !== "location"),
            );
        }

        if (key === "purpose") {
            setMissingFields((previous) =>
                previous.filter((field) => field !== "purpose"),
            );
        }
    };

    const extractReport = async () => {
        const cleanDescription = description.trim();

        if (!cleanDescription) {
            toast.error(
                "Please describe the patrol before extracting the report.",
            );
            return;
        }

        setIsExtracting(true);
        setIsExtracted(false);
        setReportId(null);
        setSavedReportId(null);
        setIsSubmitted(false);

        try {
            const result =
                await apiRequest<PatrolReportResponse>(
                    "/api/v1/field/forms/patrol/extract",
                    {
                        method: "POST",
                        body: JSON.stringify({
                            text: cleanDescription,
                            language: null,
                        }),
                    },
                );

            if (!result.success) {
                throw new Error(
                    result.message ||
                        "Unable to extract patrol report.",
                );
            }

            setFields(result.fields);

            setMissingFields(
                result.missing_fields ?? [],
            );

            setConfidence(result.confidence ?? null);

            setIsExtracted(true);

            toast.success(
                "Patrol report fields extracted successfully.",
            );
        } catch (error) {
            const message =
                error instanceof Error
                    ? error.message
                    : "Unable to extract patrol report.";

            toast.error(message);
        } finally {
            setIsExtracting(false);
        }
    };

    const validateRequiredFields = () => {
        const missing: string[] = [];

        for (const fieldName of REQUIRED_SUBMIT_FIELDS) {
            const value = fields[fieldName];

            if (
                value === null ||
                value === undefined ||
                String(value).trim() === ""
            ) {
                missing.push(fieldName);
            }
        }

        if (missing.length > 0) {
            setMissingFields(missing);

            const labels = missing.map(
                (field) => FIELD_LABELS[field] || field,
            );

            toast.error(
                `Please complete: ${labels.join(", ")}`,
            );

            return false;
        }

        if (
            fields.start_time &&
            fields.end_time &&
            fields.end_time <= fields.start_time
        ) {
            toast.error(
                "End time must be later than start time.",
            );

            return false;
        }

        return true;
    };

    const saveDraft = async () => {
        if (!isExtracted) {
            toast.error(
                "Please extract the patrol report first.",
            );
            return;
        }

        if (isSubmitted) {
            toast.error(
                "This patrol report has already been submitted.",
            );
            return;
        }

        setIsSaving(true);

        try {
            const payload = {
                ...fields,

                team_members: fields.team_members
                    .map((member) => member.trim())
                    .filter(Boolean),

                source_text:
                    description.trim() || null,

                ai_confidence: confidence,
            };

            const isUpdating = Boolean(reportId);
            const operationId = fieldCreateOperationId("PATROL_REPORT", localId.current || (localId.current = createFieldLocalId()));
            if (offline.ownerId && (!navigator.onLine || (queuedCreate && !reportId))) {
                const record: OfflineFieldRecord = {
                    ownerId: offline.ownerId,
                    module: "PATROL_REPORT",
                    localId: localId.current,
                    serverId: reportId,
                    payload,
                    status: "DRAFT",
                    syncError: null,
                    updatedAt: new Date().toISOString(),
                };
                await enqueueOfflineFieldOperation(
                    offline.ownerId,
                    "PATROL_REPORT",
                    record,
                    reportId ? "UPDATE" : "CREATE",
                );
                if (!reportId) setQueuedCreate(true);
                toast.info("Patrol report draft is saved locally and will sync when the service is available.");
                return;
            }

            const result =
                await apiRequest<PatrolReportSaveResponse>(
                    isUpdating
                        ? `/api/v1/field/forms/patrol/${reportId}`
                        : "/api/v1/field/forms/patrol",
                    {
                        method: isUpdating
                            ? "PUT"
                            : "POST",
                        body: JSON.stringify(isUpdating ? payload : { ...payload, client_operation_id: operationId }),
                    },
                );

            if (!result.success) {
                if (offline.ownerId && fieldSyncableFailure(result)) {
                    const record: OfflineFieldRecord = {
                        ownerId: offline.ownerId,
                        module: "PATROL_REPORT",
                        localId: localId.current,
                        serverId: reportId,
                        payload,
                        status: "DRAFT",
                        syncError: null,
                        updatedAt: new Date().toISOString(),
                    };
                    await enqueueOfflineFieldOperation(offline.ownerId, "PATROL_REPORT", record, isUpdating ? "UPDATE" : "CREATE");
                    setQueuedCreate(!isUpdating);
                    toast.info("Patrol report draft is saved locally and will sync when the service is available.");
                    return;
                }
                throw new Error(
                    result.message ||
                        "Unable to save patrol report draft.",
                );
            }

            setReportId(result.report_id);
            setSavedReportId(result.report_id);
            setQueuedCreate(false);

            toast.success(
                isUpdating
                    ? "Patrol report draft updated successfully."
                    : "Patrol report draft saved successfully.",
            );

            onSaved?.();
        } catch (error) {
            const message =
                error instanceof Error
                    ? error.message
                    : "Unable to save patrol report draft.";

            toast.error(message);
        } finally {
            setIsSaving(false);
        }
    };

    const submitReport = async () => {
        if (isSubmitted) {
            toast.info("This patrol report is already submitted.");
            return;
        }

        if (!savedReportId && !queuedCreate) {
            toast.error(
                "Please save the patrol report draft before submitting.",
            );
            return;
        }

        if (!isExtracted) {
            toast.error(
                "Please extract the patrol report first.",
            );
            return;
        }

        if (!validateRequiredFields()) {
            return;
        }

        setIsSubmitting(true);

        try {
            if (offline.ownerId && (!navigator.onLine || (queuedCreate && !savedReportId))) {
                const record: OfflineFieldRecord = {
                    ownerId: offline.ownerId,
                    module: "PATROL_REPORT",
                    localId: localId.current,
                    serverId: savedReportId,
                    payload: {
                        ...fields,
                        team_members: fields.team_members.map((member) => member.trim()).filter(Boolean),
                        source_text: description.trim() || null,
                        ai_confidence: confidence,
                    },
                    status: "PENDING_SUBMISSION",
                    syncError: null,
                    updatedAt: new Date().toISOString(),
                };
                await enqueueOfflineFieldOperation(offline.ownerId, "PATROL_REPORT", record, "SUBMIT");
                toast.info("Submission is pending sync and server validation.");
                return;
            }
            const result =
                await apiRequest<PatrolReportSubmitResponse>(
                    `/api/v1/field/forms/patrol/${savedReportId}/submit`,
                    {
                        method: "POST",
                    },
                );

            if (!result.success) {
                if (offline.ownerId && fieldSyncableFailure(result)) {
                    const record: OfflineFieldRecord = {
                        ownerId: offline.ownerId,
                        module: "PATROL_REPORT",
                        localId: localId.current,
                        serverId: savedReportId,
                        payload: {
                            ...fields,
                            team_members: fields.team_members.map((member) => member.trim()).filter(Boolean),
                            source_text: description.trim() || null,
                            ai_confidence: confidence,
                        },
                        status: "PENDING_SUBMISSION",
                        syncError: null,
                        updatedAt: new Date().toISOString(),
                    };
                    await enqueueOfflineFieldOperation(offline.ownerId, "PATROL_REPORT", record, "SUBMIT");
                    toast.info("Submission is pending sync and server validation.");
                    return;
                }
                throw new Error(
                    result.message ||
                        "Unable to submit patrol report.",
                );
            }

            setIsSubmitted(true);

            setReportId(result.report_id);
            setSavedReportId(result.report_id);

            toast.success(
                "Patrol report submitted successfully.",
            );

            onSaved?.();
        } catch (error) {
            const message =
                error instanceof Error
                    ? error.message
                    : "Unable to submit patrol report.";

            toast.error(message);
        } finally {
            setIsSubmitting(false);
        }
    };

    const resetForm = () => {
        if (isSubmitted) {
            toast.error(
                "Submitted reports cannot be reset from this form.",
            );
            return;
        }

        setDescription("");
        setFields(EMPTY_FIELDS);
        setMissingFields([]);
        setConfidence(null);
        setIsExtracted(false);
        setSavedReportId(null);
        setReportId(null);
        setIsSubmitted(false);
    };

    const addTeamMember = () => {
        if (isSubmitted) {
            return;
        }

        setFields((previous) => ({
            ...previous,
            team_members: [
                ...previous.team_members,
                "",
            ],
        }));
    };

    const updateTeamMember = (
        index: number,
        value: string,
    ) => {
        if (isSubmitted) {
            return;
        }

        setFields((previous) => ({
            ...previous,
            team_members: previous.team_members.map(
                (member, memberIndex) =>
                    memberIndex === index
                        ? value
                        : member,
            ),
        }));
    };

    const removeTeamMember = (index: number) => {
        if (isSubmitted) {
            return;
        }

        setFields((previous) => ({
            ...previous,
            team_members:
                previous.team_members.filter(
                    (_, memberIndex) =>
                        memberIndex !== index,
                ),
        }));
    };

    const inputClassName =
        "w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-60";

    const textareaClassName =
        "min-h-[100px] w-full resize-y rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-60";

    const formDisabled =
        isSubmitted ||
        isSaving ||
        isSubmitting;

    return (
        <section className="rounded-2xl border border-border bg-card text-card-foreground shadow-sm">
            <div className="border-b border-border px-5 py-3">
                <OfflineFieldFormControls {...offline} />
            </div>
            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
                <div>
                    <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-lg font-semibold">
                            {isSubmitted
                                ? "Patrol Report Submitted"
                                : reportId
                                  ? "Edit Patrol Report Draft"
                                  : "Patrol Report Auto-Fill"}
                        </h2>

                        {isSubmitted && (
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                Submitted
                            </span>
                        )}
                    </div>

                    <p className="mt-1 text-sm text-muted-foreground">
                        {isSubmitted
                            ? "This patrol report has been successfully submitted."
                            : reportId
                              ? "Review and edit the saved patrol report draft."
                              : "Describe your patrol in Hindi or English and AI will extract the report fields."}
                    </p>
                </div>

                {onClose && (
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={isSaving || isSubmitting}
                        className="rounded-xl border border-border px-3 py-2 text-sm font-medium transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        Close
                    </button>
                )}
            </div>

            <div className="space-y-6 p-5">
                {/* Description */}
                <div>
                    <label className="mb-2 block text-sm font-medium">
                        Patrol Description
                    </label>

                    <textarea
                        value={description}
                        onChange={(event) =>
                            setDescription(
                                event.target.value,
                            )
                        }
                        disabled={formDisabled}
                        placeholder="Describe your patrol in Hindi or English..."
                        className={textareaClassName}
                    />

                    <div className="mt-3 flex flex-wrap gap-2">
                        <button
                            type="button"
                            onClick={extractReport}
                            disabled={
                                isExtracting ||
                                isSaving ||
                                isSubmitting ||
                                isSubmitted ||
                                !description.trim()
                            }
                            className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {isExtracting ? (
                                <>
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    Extracting...
                                </>
                            ) : (
                                "Extract Report"
                            )}
                        </button>

                        <button
                            type="button"
                            onClick={resetForm}
                            disabled={
                                isExtracting ||
                                isSaving ||
                                isSubmitting ||
                                isSubmitted
                            }
                            className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-medium transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            <RotateCcw className="h-4 w-4" />
                            Reset
                        </button>
                    </div>
                </div>

                {/* Submission success */}
                {isSubmitted && (
                    <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
                        <div className="flex gap-3">
                            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />

                            <div>
                                <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                                    Patrol report submitted successfully
                                </p>

                                <p className="mt-1 text-xs text-muted-foreground">
                                    The report is now in SUBMITTED status and can no longer be edited from this draft form.
                                </p>

                                {reportId && (
                                    <p className="mt-2 text-xs text-muted-foreground">
                                        Report ID: {reportId}
                                    </p>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* Extraction status */}
                {isExtracted && (
                    <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="flex items-center gap-2">
                                <CheckCircle2 className="h-5 w-5 text-emerald-600" />

                                <div>
                                    <p className="text-sm font-semibold">
                                        Report fields extracted
                                    </p>

                                    <p className="text-xs text-muted-foreground">
                                        {isSubmitted
                                            ? "Submitted report details."
                                            : "Review the fields before saving or submitting."}
                                    </p>
                                </div>
                            </div>

                            {confidence !== null && (
                                <div className="text-sm font-medium">
                                    AI Confidence:{" "}
                                    {Math.round(
                                        confidence * 100,
                                    )}
                                    %
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Missing fields */}
                {isExtracted &&
                    missingFields.length > 0 &&
                    !isSubmitted && (
                        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
                            <div className="flex gap-3">
                                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />

                                <div>
                                    <p className="text-sm font-semibold">
                                        Some fields need attention
                                    </p>

                                    <p className="mt-1 text-xs text-muted-foreground">
                                        These fields were not found
                                        in the description. You can
                                        enter them manually.
                                    </p>

                                    <div className="mt-3 flex flex-wrap gap-2">
                                        {missingFields.map(
                                            (field) => (
                                                <span
                                                    key={field}
                                                    className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
                                                >
                                                    {FIELD_LABELS[
                                                        field
                                                    ] || field}
                                                </span>
                                            ),
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                {/* Fields */}
                {isExtracted && (
                    <div className="space-y-6">
                        {/* Basic information */}
                        <div>
                            <h3 className="mb-4 text-sm font-semibold">
                                Patrol Information
                            </h3>

                            <div className="grid gap-4 md:grid-cols-2">
                                <div>
                                    <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                                        Patrol Date
                                    </label>

                                    <input
                                        type="date"
                                        value={
                                            fields.patrol_date ??
                                            ""
                                        }
                                        onChange={(event) =>
                                            updateField(
                                                "patrol_date",
                                                event.target
                                                    .value ||
                                                    null,
                                            )
                                        }
                                        disabled={formDisabled}
                                        className={inputClassName}
                                    />
                                </div>

                                <div>
                                    <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                                        Beat
                                    </label>

                                    <input
                                        value={
                                            fields.beat ?? ""
                                        }
                                        onChange={(event) =>
                                            updateField(
                                                "beat",
                                                event.target
                                                    .value ||
                                                    null,
                                            )
                                        }
                                        disabled={formDisabled}
                                        placeholder="Beat number/name"
                                        className={inputClassName}
                                    />
                                </div>

                                <div>
                                    <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                                        Range
                                    </label>

                                    <input
                                        value={
                                            fields.range_name ??
                                            ""
                                        }
                                        onChange={(event) =>
                                            updateField(
                                                "range_name",
                                                event.target
                                                    .value ||
                                                    null,
                                            )
                                        }
                                        disabled={formDisabled}
                                        placeholder="Range name"
                                        className={inputClassName}
                                    />
                                </div>

                                <div>
                                    <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                                        Division
                                    </label>

                                    <input
                                        value={
                                            fields.division ??
                                            ""
                                        }
                                        onChange={(event) =>
                                            updateField(
                                                "division",
                                                event.target
                                                    .value ||
                                                    null,
                                            )
                                        }
                                        disabled={formDisabled}
                                        placeholder="Division name"
                                        className={inputClassName}
                                    />
                                </div>

                                <div>
                                    <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                                        Start Time
                                    </label>

                                    <input
                                        type="time"
                                        value={fields.start_time?.slice(0, 5) ?? ""}
                                        onChange={(event) =>
                                            updateField(
                                                "start_time",
                                                event.target
                                                    .value ||
                                                    null,
                                            )
                                        }
                                        disabled={formDisabled}
                                        className={inputClassName}
                                    />
                                </div>

                                <div>
                                    <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                                        End Time
                                    </label>

                                    <input
                                        type="time"
                                        value={fields.end_time?.slice(0, 5) ?? ""}
                                        onChange={(event) =>
                                            updateField(
                                                "end_time",
                                                event.target
                                                    .value ||
                                                    null,
                                            )
                                        }
                                        disabled={formDisabled}
                                        className={inputClassName}
                                    />
                                </div>

                                <div className="md:col-span-2">
                                    <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                                        Location
                                    </label>

                                    <input
                                        value={
                                            fields.location ??
                                            ""
                                        }
                                        onChange={(event) =>
                                            updateField(
                                                "location",
                                                event.target
                                                    .value ||
                                                    null,
                                            )
                                        }
                                        disabled={formDisabled}
                                        placeholder="Patrol location"
                                        className={inputClassName}
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Team */}
                        <div>
                            <div className="mb-4 flex items-center justify-between gap-3">
                                <h3 className="text-sm font-semibold">
                                    Team Members
                                </h3>

                                <button
                                    type="button"
                                    onClick={
                                        addTeamMember
                                    }
                                    disabled={formDisabled}
                                    className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    <Plus className="h-3.5 w-3.5" />
                                    Add Member
                                </button>
                            </div>

                            <div className="space-y-2">
                                {fields.team_members
                                    .length === 0 && (
                                    <p className="rounded-xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
                                        No team members added.
                                    </p>
                                )}

                                {fields.team_members.map(
                                    (
                                        member,
                                        index,
                                    ) => (
                                        <div
                                            key={`${index}-${member}`}
                                            className="flex gap-2"
                                        >
                                            <input
                                                value={
                                                    member
                                                }
                                                onChange={(
                                                    event,
                                                ) =>
                                                    updateTeamMember(
                                                        index,
                                                        event
                                                            .target
                                                            .value,
                                                    )
                                                }
                                                disabled={
                                                    formDisabled
                                                }
                                                placeholder={`Team member ${index + 1}`}
                                                className={inputClassName}
                                            />

                                            <button
                                                type="button"
                                                onClick={() =>
                                                    removeTeamMember(
                                                        index,
                                                    )
                                                }
                                                disabled={
                                                    formDisabled
                                                }
                                                className="rounded-xl border border-border px-3 text-muted-foreground transition hover:border-red-500/30 hover:bg-red-500/5 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                                                aria-label="Remove team member"
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </button>
                                        </div>
                                    ),
                                )}
                            </div>
                        </div>

                        {/* Patrol details */}
                        <div>
                            <h3 className="mb-4 text-sm font-semibold">
                                Patrol Details
                            </h3>

                            <div className="space-y-4">
                                <div>
                                    <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                                        Purpose
                                    </label>

                                    <textarea
                                        value={
                                            fields.purpose ??
                                            ""
                                        }
                                        onChange={(event) =>
                                            updateField(
                                                "purpose",
                                                event.target
                                                    .value ||
                                                    null,
                                            )
                                        }
                                        disabled={formDisabled}
                                        className={textareaClassName}
                                    />
                                </div>

                                <div>
                                    <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                                        Observations
                                    </label>

                                    <textarea
                                        value={
                                            fields.observations ??
                                            ""
                                        }
                                        onChange={(event) =>
                                            updateField(
                                                "observations",
                                                event.target
                                                    .value ||
                                                    null,
                                            )
                                        }
                                        disabled={formDisabled}
                                        className={textareaClassName}
                                    />
                                </div>

                                <div>
                                    <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                                        Wildlife Sighting
                                    </label>

                                    <textarea
                                        value={
                                            fields.wildlife_sighting ??
                                            ""
                                        }
                                        onChange={(event) =>
                                            updateField(
                                                "wildlife_sighting",
                                                event.target
                                                    .value ||
                                                    null,
                                            )
                                        }
                                        disabled={formDisabled}
                                        className={textareaClassName}
                                    />
                                </div>

                                <div>
                                    <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                                        Illegal Activity
                                    </label>

                                    <textarea
                                        value={
                                            fields.illegal_activity ??
                                            ""
                                        }
                                        onChange={(event) =>
                                            updateField(
                                                "illegal_activity",
                                                event.target
                                                    .value ||
                                                    null,
                                            )
                                        }
                                        disabled={formDisabled}
                                        className={textareaClassName}
                                    />
                                </div>

                                <div>
                                    <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                                        Action Taken
                                    </label>

                                    <textarea
                                        value={
                                            fields.action_taken ??
                                            ""
                                        }
                                        onChange={(event) =>
                                            updateField(
                                                "action_taken",
                                                event.target
                                                    .value ||
                                                    null,
                                            )
                                        }
                                        disabled={formDisabled}
                                        className={textareaClassName}
                                    />
                                </div>

                                <div>
                                    <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                                        Incident Details
                                    </label>

                                    <textarea
                                        value={
                                            fields.incident_details ??
                                            ""
                                        }
                                        onChange={(event) =>
                                            updateField(
                                                "incident_details",
                                                event.target
                                                    .value ||
                                                    null,
                                            )
                                        }
                                        disabled={formDisabled}
                                        className={textareaClassName}
                                    />
                                </div>

                                <div>
                                    <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                                        Additional Remarks
                                    </label>

                                    <textarea
                                        value={
                                            fields.additional_remarks ??
                                            ""
                                        }
                                        onChange={(event) =>
                                            updateField(
                                                "additional_remarks",
                                                event.target
                                                    .value ||
                                                    null,
                                            )
                                        }
                                        disabled={formDisabled}
                                        className={textareaClassName}
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Footer actions */}
                        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
                            <div>
                                {savedReportId &&
                                    !isSubmitted && (
                                        <p className="text-xs text-emerald-600 dark:text-emerald-400">
                                            Draft saved successfully.
                                        </p>
                                    )}

                                {isSubmitted && (
                                    <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                                        Report status: SUBMITTED
                                    </p>
                                )}

                                {reportId && (
                                    <p className="mt-1 text-xs text-muted-foreground">
                                        Report ID:{" "}
                                        {reportId}
                                    </p>
                                )}
                            </div>

                            <div className="flex flex-wrap gap-2">
                                {!isSubmitted && (
                                    <>
                                        <button
                                            type="button"
                                            onClick={
                                                saveDraft
                                            }
                                            disabled={
                                                isSaving ||
                                                isSubmitting
                                            }
                                            className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                                        >
                                            {isSaving ? (
                                                <>
                                                    <Loader2 className="h-4 w-4 animate-spin" />
                                                    {reportId
                                                        ? "Updating..."
                                                        : "Saving..."}
                                                </>
                                            ) : (
                                                <>
                                                    <Save className="h-4 w-4" />
                                                    {reportId
                                                        ? "Update Draft"
                                                        : "Save Draft"}
                                                </>
                                            )}
                                        </button>

                                        <button
                                            type="button"
                                            onClick={
                                                submitReport
                                            }
                                            disabled={
                                                isSubmitting ||
                                                isSaving ||
                                                (!savedReportId && !queuedCreate)
                                            }
                                            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                                            title={
                                                !savedReportId && !queuedCreate
                                                    ? "Save the draft before submitting."
                                                    : "Submit patrol report"
                                            }
                                        >
                                            {isSubmitting ? (
                                                <>
                                                    <Loader2 className="h-4 w-4 animate-spin" />
                                                    Submitting...
                                                </>
                                            ) : (
                                                <>
                                                    <Send className="h-4 w-4" />
                                                    Submit Report
                                                </>
                                            )}
                                        </button>
                                    </>
                                )}

                                {isSubmitted && (
                                    <button
                                        type="button"
                                        disabled
                                        className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white opacity-90"
                                    >
                                        <CheckCircle2 className="h-4 w-4" />
                                        Report Submitted
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </section>
    );
}