"use client";



import React, { useEffect, useRef, useState } from "react";

import {

    AlertTriangle,

    CheckCircle2,

    Clock3,

    Loader2,

    Save,

    Send,

    Sparkles,

    XCircle,

} from "lucide-react";

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



type ReviewStatus =

    | "PENDING"

    | "APPROVED"

    | "REJECTED"

    | "CHANGES_REQUESTED";



type IncidentReport = {

    incident_id: string;

    form_type: string;

    status: "DRAFT" | "SUBMITTED";



    review_status?: ReviewStatus | null;

    review_comment?: string | null;

    reviewed_by?: string | null;

    reviewed_at?: string | null;



    incident_date: string | null;

    incident_time: string | null;

    division: string | null;

    range_name: string | null;

    beat: string | null;

    location: string | null;

    incident_type: string | null;

    reported_by: string | null;

    persons_involved: string[];

    wildlife_involved: string | null;

    incident_description: string | null;

    immediate_action_taken: string | null;

    authorities_informed: string | null;

    injury_or_damage: string | null;

    evidence_details: string | null;

    additional_remarks: string | null;

    source_text: string | null;



    created_at?: string | null;

    updated_at?: string | null;

    submitted_at?: string | null;

};



type IncidentFields = Omit<

    IncidentReport,

    | "incident_id"

    | "form_type"

    | "status"

    | "review_status"

    | "review_comment"

    | "reviewed_by"

    | "reviewed_at"

    | "created_at"

    | "updated_at"

    | "submitted_at"

>;



type ExtractResponse = {

    success: boolean;

    form_type: string;

    fields: IncidentFields;

    missing_fields: string[];

    source_text: string;

    confidence: number | null;

    message?: string | null;

};



const emptyFields: IncidentFields = {

    incident_date: "",

    incident_time: "",

    division: "",

    range_name: "",

    beat: "",

    location: "",

    incident_type: "",

    reported_by: "",

    persons_involved: [],

    wildlife_involved: "",

    incident_description: "",

    immediate_action_taken: "",

    authorities_informed: "",

    injury_or_damage: "",

    evidence_details: "",

    additional_remarks: "",

    source_text: "",

};



const reviewLabel = (status?: ReviewStatus | null) => {

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



const reviewClass = (status?: ReviewStatus | null) => {

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



const inputClass =

    "w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-green-600 focus:ring-2 focus:ring-green-100";



function createNewFields(): IncidentFields {

    return {

        ...emptyFields,

        persons_involved: [],

    };

}



export function IncidentReport() {

    const offline = useOfflineFieldForm("INCIDENT_REPORT");
    const localId = useRef("");
    const previousOwnerId = useRef<string | null>(null);

    const [fields, setFields] =

        useState<IncidentFields>(createNewFields);



    const [reports, setReports] = useState<IncidentReport[]>([]);

    const [incidentText, setIncidentText] = useState("");

    const [editingId, setEditingId] = useState<string | null>(null);



    const [extracting, setExtracting] = useState(false);

    const [saving, setSaving] = useState(false);

    const [submittingId, setSubmittingId] = useState<string | null>(null);

    const [loadingReports, setLoadingReports] = useState(false);



    const [confidence, setConfidence] = useState<number | null>(null);

    const [missingFields, setMissingFields] = useState<string[]>([]);
    const [queuedCreate, setQueuedCreate] = useState(false);
    const [offlineDraftRestored, setOfflineDraftRestored] = useState(false);

    useEffect(() => {
        if (!localId.current) localId.current = createFieldLocalId();
    }, []);

    useEffect(() => {
        if (previousOwnerId.current !== offline.ownerId) {
            previousOwnerId.current = offline.ownerId;
            setFields(createNewFields());
            setIncidentText("");
            setEditingId(null);
            setConfidence(null);
            setMissingFields([]);
            setQueuedCreate(false);
            localId.current = offline.ownerId ? createFieldLocalId() : "";
        }
        setOfflineDraftRestored(false);
        if (!offline.ownerId) return;
        let cancelled = false;
        void loadOfflineFormDraft<Record<string, unknown>>(offline.ownerId, "INCIDENT_REPORT", "active")
            .then((draft) => {
                if (cancelled || !draft) return;
                const snapshot = draft.snapshot;
                if (typeof snapshot.localId === "string") localId.current = snapshot.localId;
                if (snapshot.fields && typeof snapshot.fields === "object") setFields(snapshot.fields as IncidentFields);
                if (typeof snapshot.incidentText === "string") setIncidentText(snapshot.incidentText);
                if (typeof snapshot.editingId === "string") setEditingId(snapshot.editingId);
                if (typeof snapshot.confidence === "number" || snapshot.confidence === null) setConfidence(snapshot.confidence as number | null);
                setQueuedCreate(snapshot.queuedCreate === true);
                toast.info("Restored your locally saved incident report draft.");
            })
            .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Unable to restore the local incident draft."))
            .finally(() => { if (!cancelled) setOfflineDraftRestored(true); });
        return () => { cancelled = true; };
    }, [offline.ownerId]);

    useEffect(() => {
        if (!offline.ownerId || !offlineDraftRestored || !localId.current) return;
        void saveOfflineFormDraft(offline.ownerId, "INCIDENT_REPORT", "active", {
            localId: localId.current,
            fields: fields as unknown as Record<string, unknown>,
            incidentText,
            editingId,
            confidence,
            queuedCreate,
        }).catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Unable to save the local incident draft."));
    }, [confidence, editingId, fields, incidentText, offline.ownerId, offlineDraftRestored, queuedCreate]);

    useEffect(() => {
        if (!offline.ownerId || !localId.current) return;
        const refreshRecord = () => {
            void getOfflineFormRecord(offline.ownerId!, "INCIDENT_REPORT", localId.current)
                .then((record) => {
                    if (!record) return;
                    if (record.serverId) {
                        setEditingId(record.serverId);
                        setQueuedCreate(false);
                    }
                    if (record.status === "SUBMITTED") resetForm();
                })
                .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Unable to refresh incident sync status."));
        };
        window.addEventListener("up-forest-offline-queue-changed", refreshRecord);
        return () => window.removeEventListener("up-forest-offline-queue-changed", refreshRecord);
    }, [offline.ownerId]);



    const loadReports = async () => {

        setLoadingReports(true);



        try {

            const response = await apiRequest<{

                success: boolean;

                incidents: IncidentReport[];

                total: number;

            }>("/api/v1/field/forms/incident");



            if (!response.success) {

                throw new Error("Unable to load incident reports.");

            }



            setReports(response.incidents ?? []);

        } catch (error) {

            const message =

                error instanceof Error

                    ? error.message

                    : "Unable to load incident reports.";



            toast.error(message);

        } finally {

            setLoadingReports(false);

        }

    };



    useEffect(() => {

        void loadReports();

    }, []);



    const updateField = <K extends keyof IncidentFields>(

        field: K,

        value: IncidentFields[K],

    ) => {

        setFields((previous) => ({

            ...previous,

            [field]: value,

        }));

    };



    const handleExtract = async () => {

        const text = incidentText.trim();



        if (!text) {

            toast.error("Please describe the incident first.");

            return;

        }



        setExtracting(true);



        try {

            const response = await apiRequest<ExtractResponse>(

                "/api/v1/field/forms/incident/extract",

                {

                    method: "POST",

                    body: JSON.stringify({

                        text,

                    }),

                },

            );



            if (!response.success) {

                throw new Error(

                    response.message ?? "Unable to extract incident details.",

                );

            }



            setFields({

                ...createNewFields(),

                ...response.fields,

                source_text: response.source_text,

                persons_involved:

                    response.fields.persons_involved ?? [],

            });



            setConfidence(response.confidence ?? null);

            setMissingFields(response.missing_fields ?? []);



            toast.success("Incident details extracted successfully.");

        } catch (error) {

            const message =

                error instanceof Error

                    ? error.message

                    : "Unable to extract incident details.";



            toast.error(message);

        } finally {

            setExtracting(false);

        }

    };



    const resetForm = () => {

        setFields(createNewFields());

        setIncidentText("");

        setEditingId(null);

        setConfidence(null);

        setMissingFields([]);
        setQueuedCreate(false);
        localId.current = createFieldLocalId();

    };



    const handleSaveDraft = async () => {

        setSaving(true);



        const payload = {

            incident_date: fields.incident_date || null,

            incident_time: fields.incident_time || null,

            division: fields.division || null,

            range_name: fields.range_name || null,

            beat: fields.beat || null,

            location: fields.location || null,

            incident_type: fields.incident_type || null,

            reported_by: fields.reported_by || null,

            persons_involved: fields.persons_involved.filter(

                (item) => item.trim(),

            ),

            wildlife_involved: fields.wildlife_involved || null,

            incident_description:

                fields.incident_description || null,

            immediate_action_taken:

                fields.immediate_action_taken || null,

            authorities_informed:

                fields.authorities_informed || null,

            injury_or_damage:

                fields.injury_or_damage || null,

            evidence_details:

                fields.evidence_details || null,

            additional_remarks:

                fields.additional_remarks || null,

            source_text: fields.source_text || null,

        };



        try {

            const createId = fieldCreateOperationId(
                "INCIDENT_REPORT",
                localId.current || (localId.current = createFieldLocalId()),
            );
            const record: OfflineFieldRecord = {
                ownerId: offline.ownerId ?? "",
                module: "INCIDENT_REPORT",
                localId: localId.current,
                serverId: editingId,
                payload,
                status: "DRAFT",
                syncError: null,
                updatedAt: new Date().toISOString(),
            };
            const isQueuedUpdate = queuedCreate && !editingId;

            if (offline.ownerId && (!navigator.onLine || isQueuedUpdate)) {
                await enqueueOfflineFieldOperation(
                    offline.ownerId,
                    "INCIDENT_REPORT",
                    { ...record, ownerId: offline.ownerId },
                    editingId || isQueuedUpdate ? "UPDATE" : "CREATE",
                );
                if (!editingId && !isQueuedUpdate) setQueuedCreate(true);
                toast.info("Incident report draft is saved locally and will sync when the service is available.");
                return;
            }

            const response = await apiRequest<{
                incident_id: string;
                status: string;
                message?: string;
            }>(
                editingId ? `/api/v1/field/forms/incident/${editingId}` : "/api/v1/field/forms/incident",
                {
                    method: editingId ? "PUT" : "POST",
                    body: JSON.stringify({ ...payload, client_operation_id: createId }),
                },
            );

            if (!response.success) {
                if (offline.ownerId && fieldSyncableFailure(response)) {
                    await enqueueOfflineFieldOperation(
                        offline.ownerId,
                        "INCIDENT_REPORT",
                        { ...record, ownerId: offline.ownerId },
                        editingId ? "UPDATE" : "CREATE",
                    );
                    if (!editingId) setQueuedCreate(true);
                    toast.info("Incident report draft is saved locally and will sync when the service is available.");
                    return;
                }
                throw new Error(response.message ?? "Unable to save incident report draft.");
            }

            setEditingId(response.data.incident_id);
            setQueuedCreate(false);
            toast.success(editingId ? "Incident report draft updated." : "Incident report draft saved.");

            await loadReports();

        } catch (error) {

            const message =

                error instanceof Error

                    ? error.message

                    : "Unable to save incident report.";



            toast.error(message);

        } finally {

            setSaving(false);

        }

    };

    const handleSubmit = async (reportId?: string) => {

        const id = reportId ?? editingId;



        if (!id && !queuedCreate) {

            toast.error(

                "Please save the incident report as a draft first.",

            );

            return;

        }



        setSubmittingId(id);



        try {

            const report = id ? reports.find((item) => item.incident_id === id) : undefined;
            const payload = report
                ? {
                    incident_date: report.incident_date,
                    incident_time: report.incident_time,
                    division: report.division,
                    range_name: report.range_name,
                    beat: report.beat,
                    location: report.location,
                    incident_type: report.incident_type,
                    reported_by: report.reported_by,
                    persons_involved: report.persons_involved,
                    wildlife_involved: report.wildlife_involved,
                    incident_description: report.incident_description,
                    immediate_action_taken: report.immediate_action_taken,
                    authorities_informed: report.authorities_informed,
                    injury_or_damage: report.injury_or_damage,
                    evidence_details: report.evidence_details,
                    additional_remarks: report.additional_remarks,
                    source_text: report.source_text,
                }
                : fields as unknown as Record<string, unknown>;
            const operationLocalId = localId.current ||
                (localId.current = id ?? createFieldLocalId());
            if (offline.ownerId && (!navigator.onLine || (queuedCreate && !id))) {
                const record: OfflineFieldRecord = {
                    ownerId: offline.ownerId,
                    module: "INCIDENT_REPORT",
                    localId: operationLocalId,
                    serverId: id || null,
                    payload,
                    status: "PENDING_SUBMISSION",
                    syncError: null,
                    updatedAt: new Date().toISOString(),
                };
                await enqueueOfflineFieldOperation(offline.ownerId, "INCIDENT_REPORT", record, "SUBMIT");
                toast.info("Submission is pending sync and server validation.");
                return;
            }
            if (!id) throw new Error("Save the incident report draft before submitting.");

            const response = await apiRequest<{

                success: boolean;

                incident_id: string;

                form_type?: string;

                status: string;

                submitted_at?: string;

                message?: string;

            }>(

                `/api/v1/field/forms/incident/${id}/submit`,

                {

                    method: "POST",

                },

            );



            console.log(

                "INCIDENT SUBMIT RESPONSE:",

                response,

            );



            if (!response.success) {

                if (offline.ownerId && fieldSyncableFailure(response)) {
                    const record: OfflineFieldRecord = {
                        ownerId: offline.ownerId,
                        module: "INCIDENT_REPORT",
                        localId: operationLocalId,
                        serverId: id || null,
                        payload,
                        status: "PENDING_SUBMISSION",
                        syncError: null,
                        updatedAt: new Date().toISOString(),
                    };
                    await enqueueOfflineFieldOperation(offline.ownerId, "INCIDENT_REPORT", record, "SUBMIT");
                    toast.info("Submission is pending sync and server validation.");
                    return;
                }
                throw new Error(

                    response.message ??

                    "Unable to submit incident report.",

                );

            }



            toast.success(

                response.message ??

                "Incident report submitted successfully.",

            );



            resetForm();



            await loadReports();

        } catch (error) {

            console.error(

                "INCIDENT SUBMIT ERROR:",

                error,

            );



            const message =

                error instanceof Error

                    ? error.message

                    : "Unable to submit incident report.";



            toast.error(message);

        } finally {

            setSubmittingId(null);

        }

    };



    const handleDelete = async (reportId: string) => {

        const confirmed = window.confirm(

            "Are you sure you want to delete this draft incident report?",

        );



        if (!confirmed) {

            return;

        }



        try {

            const response = await apiRequest<{

                success: boolean;

                incident_id: string;

                message?: string;

            }>(

                `/api/v1/field/forms/incident/${reportId}`,

                {

                    method: "DELETE",

                },

            );



            console.log(

                "INCIDENT DELETE RESPONSE:",

                response,

            );



            if (!response.success) {

                throw new Error(

                    response.message ??

                    "Unable to delete incident report.",

                );

            }



            toast.success(

                response.message ??

                "Incident report draft deleted successfully.",

            );



            if (editingId === reportId) {

                resetForm();

            }



            await loadReports();

        } catch (error) {

            console.error(

                "INCIDENT DELETE ERROR:",

                error,

            );



            const message =

                error instanceof Error

                    ? error.message

                    : "Unable to delete incident report.";



            toast.error(message);

        }

    };



    const handleEdit = (report: IncidentReport) => {

        if (report.status !== "DRAFT") {

            return;

        }



        setEditingId(report.incident_id);



        setFields({

            incident_date: report.incident_date ?? "",

            incident_time: report.incident_time ?? "",

            division: report.division ?? "",

            range_name: report.range_name ?? "",

            beat: report.beat ?? "",

            location: report.location ?? "",

            incident_type: report.incident_type ?? "",

            reported_by: report.reported_by ?? "",

            persons_involved:

                report.persons_involved ?? [],

            wildlife_involved:

                report.wildlife_involved ?? "",

            incident_description:

                report.incident_description ?? "",

            immediate_action_taken:

                report.immediate_action_taken ?? "",

            authorities_informed:

                report.authorities_informed ?? "",

            injury_or_damage:

                report.injury_or_damage ?? "",

            evidence_details:

                report.evidence_details ?? "",

            additional_remarks:

                report.additional_remarks ?? "",

            source_text: report.source_text ?? "",

        });



        setIncidentText(report.source_text ?? "");

        setConfidence(null);

        setMissingFields([]);



        window.scrollTo({

            top: 0,

            behavior: "smooth",

        });

    };



    const renderReviewStatus = (report: IncidentReport) => {

        if (report.status !== "SUBMITTED") {

            return null;

        }



        return (

            <div className="mt-4 rounded-lg bg-gray-50 p-4">

                <div className="flex flex-wrap items-center gap-2">

                    <span className="text-sm font-medium text-gray-700">

                        Review Status:

                    </span>



                    <span

                        className={`rounded-full px-2.5 py-1 text-xs font-semibold ${reviewClass(

                            report.review_status,

                        )}`}

                    >

                        {reviewLabel(report.review_status)}

                    </span>

                </div>



                {report.review_comment && (

                    <div className="mt-3">

                        <p className="text-xs font-medium text-gray-500">

                            Admin Comment

                        </p>



                        <p className="mt-1 text-sm text-gray-700">

                            {report.review_comment}

                        </p>

                    </div>

                )}



                {report.reviewed_at && (

                    <p className="mt-2 text-xs text-gray-500">

                        Reviewed:{" "}

                        {new Date(report.reviewed_at).toLocaleString()}

                    </p>

                )}

            </div>

        );

    };

    return (

        <section className="space-y-6">

            <OfflineFieldFormControls {...offline} />

            {/* Header */}

            <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">

                <div className="flex items-start gap-3">

                    <div className="rounded-lg bg-red-50 p-2">

                        <AlertTriangle className="h-6 w-6 text-red-600" />

                    </div>



                    <div>

                        <h2 className="text-xl font-semibold text-gray-900">

                            Incident Report

                        </h2>



                        <p className="mt-1 text-sm text-gray-600">

                            Describe the incident in your own words. AI

                            will extract the report fields automatically.

                        </p>

                    </div>

                </div>

            </div>



            {/* AI Extraction */}

            <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">

                <div className="mb-3 flex items-center gap-2">

                    <Sparkles className="h-5 w-5 text-green-600" />



                    <h3 className="font-semibold text-gray-900">

                        AI Incident Extraction

                    </h3>

                </div>



                <textarea

                    value={incidentText}

                    onChange={(event) =>

                        setIncidentText(event.target.value)

                    }

                    placeholder="Example: Today at around 7:30 PM, an injured deer was found near Mohanpur forest area..."

                    rows={5}

                    className={inputClass}

                />



                <div className="mt-3 flex flex-wrap items-center gap-3">

                    <button

                        type="button"

                        onClick={handleExtract}

                        disabled={extracting}

                        className="inline-flex items-center gap-2 rounded-lg bg-green-700 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-green-800 disabled:cursor-not-allowed disabled:opacity-60"

                    >

                        {extracting ? (

                            <Loader2 className="h-4 w-4 animate-spin" />

                        ) : (

                            <Sparkles className="h-4 w-4" />

                        )}



                        {extracting

                            ? "Extracting..."

                            : "AI Extract"}

                    </button>



                    {confidence !== null && (

                        <span className="rounded-full bg-green-50 px-3 py-1.5 text-xs font-medium text-green-700">

                            AI Confidence:{" "}

                            {Math.round(confidence * 100)}%

                        </span>

                    )}



                    {(editingId || queuedCreate) && (

                        <span className="rounded-full bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700">

                            Editing Draft

                        </span>

                    )}

                </div>



                {missingFields.length > 0 && (

                    <div className="mt-4 rounded-lg border border-yellow-200 bg-yellow-50 p-3">

                        <p className="text-sm font-medium text-yellow-800">

                            Missing / incomplete fields

                        </p>



                        <p className="mt-1 text-xs text-yellow-700">

                            {missingFields.join(", ")}

                        </p>

                    </div>

                )}

            </div>



            {/* Structured Form */}

            <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">

                <div className="mb-5">

                    <h3 className="text-lg font-semibold text-gray-900">

                        Incident Details

                    </h3>



                    <p className="mt-1 text-sm text-gray-500">

                        Review and correct the AI-extracted information

                        before saving or submitting.

                    </p>

                </div>



                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">

                    {/* Incident Date */}

                    <div>

                        <label className="mb-1 block text-sm font-medium text-gray-700">

                            Incident Date

                        </label>



                        <input

                            type="date"

                            value={fields.incident_date ?? ""}

                            onChange={(event) =>

                                updateField(

                                    "incident_date",

                                    event.target.value,

                                )

                            }

                            className={inputClass}

                        />

                    </div>



                    {/* Incident Time */}

                    <div>

                        <label className="mb-1 block text-sm font-medium text-gray-700">

                            Incident Time

                        </label>



                        <input

                            type="time"

                            value={fields.incident_time ?? ""}

                            onChange={(event) =>

                                updateField(

                                    "incident_time",

                                    event.target.value,

                                )

                            }

                            className={inputClass}

                        />

                    </div>



                    {/* Division */}

                    <div>

                        <label className="mb-1 block text-sm font-medium text-gray-700">

                            Division

                        </label>



                        <input

                            value={fields.division ?? ""}

                            onChange={(event) =>

                                updateField(

                                    "division",

                                    event.target.value,

                                )

                            }

                            placeholder="Forest Division"

                            className={inputClass}

                        />

                    </div>



                    {/* Range */}

                    <div>

                        <label className="mb-1 block text-sm font-medium text-gray-700">

                            Range

                        </label>



                        <input

                            value={fields.range_name ?? ""}

                            onChange={(event) =>

                                updateField(

                                    "range_name",

                                    event.target.value,

                                )

                            }

                            placeholder="Range name"

                            className={inputClass}

                        />

                    </div>



                    {/* Beat */}

                    <div>

                        <label className="mb-1 block text-sm font-medium text-gray-700">

                            Beat

                        </label>



                        <input

                            value={fields.beat ?? ""}

                            onChange={(event) =>

                                updateField(

                                    "beat",

                                    event.target.value,

                                )

                            }

                            placeholder="Beat name"

                            className={inputClass}

                        />

                    </div>



                    {/* Location */}

                    <div>

                        <label className="mb-1 block text-sm font-medium text-gray-700">

                            Location

                        </label>



                        <input

                            value={fields.location ?? ""}

                            onChange={(event) =>

                                updateField(

                                    "location",

                                    event.target.value,

                                )

                            }

                            placeholder="Incident location"

                            className={inputClass}

                        />

                    </div>



                    {/* Incident Type */}

                    <div>

                        <label className="mb-1 block text-sm font-medium text-gray-700">

                            Incident Type

                        </label>



                        <input

                            value={fields.incident_type ?? ""}

                            onChange={(event) =>

                                updateField(

                                    "incident_type",

                                    event.target.value,

                                )

                            }

                            placeholder="e.g. Wildlife Injury, Illegal Activity"

                            className={inputClass}

                        />

                    </div>



                    {/* Reported By */}

                    <div>

                        <label className="mb-1 block text-sm font-medium text-gray-700">

                            Reported By

                        </label>



                        <input

                            value={fields.reported_by ?? ""}

                            onChange={(event) =>

                                updateField(

                                    "reported_by",

                                    event.target.value,

                                )

                            }

                            placeholder="Name / source"

                            className={inputClass}

                        />

                    </div>



                    {/* Persons Involved */}

                    <div className="md:col-span-2">

                        <label className="mb-1 block text-sm font-medium text-gray-700">

                            Persons Involved

                        </label>



                        <input

                            value={(

                                fields.persons_involved ?? []

                            ).join(", ")}

                            onChange={(event) =>

                                updateField(

                                    "persons_involved",

                                    event.target.value

                                        .split(",")

                                        .map((item) => item.trim())

                                        .filter(Boolean),

                                )

                            }

                            placeholder="Person 1, Person 2"

                            className={inputClass}

                        />



                        <p className="mt-1 text-xs text-gray-500">

                            Separate multiple persons with commas.

                        </p>

                    </div>



                    {/* Wildlife */}

                    <div className="md:col-span-2">

                        <label className="mb-1 block text-sm font-medium text-gray-700">

                            Wildlife Involved

                        </label>



                        <input

                            value={

                                fields.wildlife_involved ?? ""

                            }

                            onChange={(event) =>

                                updateField(

                                    "wildlife_involved",

                                    event.target.value,

                                )

                            }

                            placeholder="Animal / species involved"

                            className={inputClass}

                        />

                    </div>



                    {/* Description */}

                    <div className="md:col-span-2">

                        <label className="mb-1 block text-sm font-medium text-gray-700">

                            Incident Description

                        </label>



                        <textarea

                            value={

                                fields.incident_description ?? ""

                            }

                            onChange={(event) =>

                                updateField(

                                    "incident_description",

                                    event.target.value,

                                )

                            }

                            rows={4}

                            className={inputClass}

                        />

                    </div>



                    {/* Immediate Action */}

                    <div className="md:col-span-2">

                        <label className="mb-1 block text-sm font-medium text-gray-700">

                            Immediate Action Taken

                        </label>



                        <textarea

                            value={

                                fields.immediate_action_taken ?? ""

                            }

                            onChange={(event) =>

                                updateField(

                                    "immediate_action_taken",

                                    event.target.value,

                                )

                            }

                            rows={4}

                            className={inputClass}

                        />

                    </div>



                    {/* Authorities */}

                    <div>

                        <label className="mb-1 block text-sm font-medium text-gray-700">

                            Authorities Informed

                        </label>



                        <textarea

                            value={

                                fields.authorities_informed ?? ""

                            }

                            onChange={(event) =>

                                updateField(

                                    "authorities_informed",

                                    event.target.value,

                                )

                            }

                            rows={3}

                            className={inputClass}

                        />

                    </div>



                    {/* Injury */}

                    <div>

                        <label className="mb-1 block text-sm font-medium text-gray-700">

                            Injury / Damage

                        </label>



                        <textarea

                            value={

                                fields.injury_or_damage ?? ""

                            }

                            onChange={(event) =>

                                updateField(

                                    "injury_or_damage",

                                    event.target.value,

                                )

                            }

                            rows={3}

                            className={inputClass}

                        />

                    </div>



                    {/* Evidence */}

                    <div className="md:col-span-2">

                        <label className="mb-1 block text-sm font-medium text-gray-700">

                            Evidence Details

                        </label>



                        <textarea

                            value={

                                fields.evidence_details ?? ""

                            }

                            onChange={(event) =>

                                updateField(

                                    "evidence_details",

                                    event.target.value,

                                )

                            }

                            rows={3}

                            className={inputClass}

                            placeholder="Photos, documents, physical evidence, etc."

                        />

                    </div>



                    {/* Remarks */}

                    <div className="md:col-span-2">

                        <label className="mb-1 block text-sm font-medium text-gray-700">

                            Additional Remarks

                        </label>



                        <textarea

                            value={

                                fields.additional_remarks ?? ""

                            }

                            onChange={(event) =>

                                updateField(

                                    "additional_remarks",

                                    event.target.value,

                                )

                            }

                            rows={3}

                            className={inputClass}

                        />

                    </div>

                </div>



                {/* Actions */}

                <div className="mt-6 flex flex-wrap gap-3 border-t border-gray-100 pt-5">

                    <button

                        type="button"

                        onClick={handleSaveDraft}

                        disabled={saving}

                        className="inline-flex items-center gap-2 rounded-lg bg-green-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-green-800 disabled:cursor-not-allowed disabled:opacity-60"

                    >

                        {saving ? (

                            <Loader2 className="h-4 w-4 animate-spin" />

                        ) : (

                            <Save className="h-4 w-4" />

                        )}



                        {saving ? "Saving..." : "Save Draft"}

                    </button>



                    {editingId && (

                        <button

                            type="button"

                            onClick={() =>

                                void handleSubmit()

                            }

                            disabled={

                                submittingId === editingId

                            }

                            className="inline-flex items-center gap-2 rounded-lg bg-green-700 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-green-800 disabled:cursor-not-allowed disabled:opacity-60"

                        >

                            {submittingId === editingId ? (

                                <Loader2 className="h-4 w-4 animate-spin" />

                            ) : (

                                <Send className="h-4 w-4" />

                            )}



                            {submittingId === editingId

                                ? "Submitting..."

                                : "Submit Report"}

                        </button>

                    )}



                    {editingId && (

                        <button

                            type="button"

                            onClick={resetForm}

                            className="rounded-lg px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-100"

                        >

                            Cancel

                        </button>

                    )}

                </div>

            </div>



            {/* History */}

            <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">

                <div className="mb-5 flex items-center justify-between">

                    <div>

                        <h3 className="text-lg font-semibold text-gray-900">

                            My Incident Reports

                        </h3>



                        <p className="mt-1 text-sm text-gray-500">

                            Drafts and submitted incident reports.

                        </p>

                    </div>



                    <button

                        type="button"

                        onClick={() => void loadReports()}

                        className="text-sm font-medium text-green-700 hover:text-green-800"

                    >

                        Refresh

                    </button>

                </div>



                {loadingReports ? (

                    <div className="flex items-center justify-center py-10 text-gray-500">

                        <Loader2 className="mr-2 h-5 w-5 animate-spin" />

                        Loading reports...

                    </div>

                ) : reports.length === 0 ? (

                    <div className="rounded-lg bg-gray-50 py-10 text-center">

                        <AlertTriangle className="mx-auto h-8 w-8 text-gray-400" />



                        <p className="mt-2 text-sm text-gray-500">

                            No incident reports found.

                        </p>

                    </div>

                ) : (

                    <div className="space-y-4">

                        {reports.map((report) => (

                            <div

                                key={report.incident_id}

                                className="rounded-xl border border-gray-200 p-4"

                            >

                                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">

                                    <div>

                                        <div className="flex flex-wrap items-center gap-2">

                                            <h4 className="font-semibold text-gray-900">

                                                {report.incident_type ||

                                                    "Incident Report"}

                                            </h4>



                                            {report.status ===

                                                "SUBMITTED" ? (

                                                <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-700">

                                                    <CheckCircle2 className="h-3 w-3" />

                                                    Submitted

                                                </span>

                                            ) : (

                                                <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-700">

                                                    <Clock3 className="h-3 w-3" />

                                                    Draft

                                                </span>

                                            )}

                                        </div>



                                        <div className="mt-2 space-y-1 text-sm text-gray-600">

                                            {report.incident_date && (

                                                <p>

                                                    <span className="font-medium">

                                                        Date:

                                                    </span>{" "}

                                                    {report.incident_date}

                                                </p>

                                            )}



                                            {report.incident_time && (

                                                <p>

                                                    <span className="font-medium">

                                                        Time:

                                                    </span>{" "}

                                                    {report.incident_time}

                                                </p>

                                            )}



                                            {report.location && (

                                                <p>

                                                    <span className="font-medium">

                                                        Location:

                                                    </span>{" "}

                                                    {report.location}

                                                </p>

                                            )}



                                            {report.division && (

                                                <p>

                                                    <span className="font-medium">

                                                        Division:

                                                    </span>{" "}

                                                    {report.division}

                                                </p>

                                            )}

                                        </div>

                                    </div>



                                    {report.status === "DRAFT" && (

                                        <div className="flex gap-2">

                                            <button

                                                type="button"

                                                onClick={() =>

                                                    handleEdit(report)

                                                }

                                                className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"

                                            >

                                                Edit

                                            </button>



                                            <button

                                                type="button"

                                                onClick={() =>

                                                    void handleSubmit(

                                                        report.incident_id,

                                                    )

                                                }

                                                disabled={

                                                    submittingId ===

                                                    report.incident_id

                                                }

                                                className="inline-flex items-center gap-2 rounded-lg bg-green-700 px-3 py-2 text-sm font-medium text-white hover:bg-green-800 disabled:opacity-60"

                                            >

                                                {submittingId ===

                                                    report.incident_id && (

                                                        <Loader2 className="h-4 w-4 animate-spin" />

                                                    )}



                                                Submit

                                            </button>



                                            <button

                                                type="button"

                                                onClick={() =>

                                                    void handleDelete(report.incident_id)

                                                }

                                                className="inline-flex items-center gap-2 rounded-lg border border-red-300 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50"

                                            >

                                                <XCircle className="h-4 w-4" />

                                                Delete

                                            </button>

                                        </div>

                                    )}

                                </div>



                                {report.status ===

                                    "SUBMITTED" &&

                                    report.review_status ===

                                    "APPROVED" && (

                                        <div className="mt-4 flex items-center gap-2 rounded-lg bg-green-50 p-3 text-sm text-green-700">

                                            <CheckCircle2 className="h-4 w-4" />



                                            This incident report has

                                            been approved by admin.

                                        </div>

                                    )}



                                {report.status ===

                                    "SUBMITTED" &&

                                    report.review_status ===

                                    "REJECTED" && (

                                        <div className="mt-4 flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">

                                            <XCircle className="h-4 w-4" />



                                            This incident report was

                                            rejected.

                                        </div>

                                    )}



                                {renderReviewStatus(report)}

                            </div>

                        ))}

                    </div>

                )}

            </div>

        </section>

    );

}



export default IncidentReport;