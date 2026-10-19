"use client";

import {
    AlertCircle,
    CheckCircle2,
    FileText,
    Image as ImageIcon,
    Loader2,
    Save,
    Send,
    Sparkles,
    Trash2,
    Upload,
} from "lucide-react";
import { useState,useEffect } from "react";
import { toast } from "sonner";

import { apiRequest, apiUrl } from "@/lib/api";
import { getAccessToken } from "@/lib/auth";

type JsonItem = Record<string, unknown>;

type OffenceSeizureFields = {
    offence_date: string | null;
    offence_time: string | null;
    division: string | null;
    range_name: string | null;
    beat: string | null;
    location: string | null;
    offence_type: string | null;
    applicable_law: string | null;
    applicable_section: string | null;
    persons_involved: JsonItem[];
    seized_material: JsonItem[];
    seizure_location: string | null;
    seizure_date: string | null;
    seizure_time: string | null;
    vehicle_details: string | null;
    vehicle_registration_number: string | null;
    evidence_details: string | null;
    witnesses: JsonItem[];
    action_taken: string | null;
    authorities_informed: string | null;
    case_reference_number: string | null;
    fir_number: string | null;
    incident_reference_id: string | null;
    description: string | null;
    additional_remarks: string | null;
    source_text: string | null;
    ai_confidence: number | null;
};

type ExtractResponse = {
    success: boolean;
    fields: OffenceSeizureFields;
};

type SaveResponse = {
    success: boolean;
    report_id: string;
    form_type?: string;
    status: string;
    message?: string;

};

type EvidenceFile = {
    id: string;
    file_name: string;
    file_type: string;
    file_size: number;
    mime_type: string;
    description: string | null;
    uploaded_at: string;
};

type Props = {
    onClose?: () => void;
};

const emptyFields: OffenceSeizureFields = {
    offence_date: "",
    offence_time: "",
    division: "",
    range_name: "",
    beat: "",
    location: "",
    offence_type: "",
    applicable_law: "",
    applicable_section: "",
    persons_involved: [],
    seized_material: [],
    seizure_location: "",
    seizure_date: "",
    seizure_time: "",
    vehicle_details: "",
    vehicle_registration_number: "",
    evidence_details: "",
    witnesses: [],
    action_taken: "",
    authorities_informed: "",
    case_reference_number: "",
    fir_number: "",
    incident_reference_id: "",
    description: "",
    additional_remarks: "",
    source_text: "",
    ai_confidence: null,
};

const inputClass =
    "w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-green-600 focus:ring-2 focus:ring-green-100";

const textareaClass =
    "w-full min-h-24 rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-green-600 focus:ring-2 focus:ring-green-100";

function parseJsonArray(value: string, label: string): JsonItem[] {
    if (!value.trim()) {
        return [];
    }

    try {
        const parsed = JSON.parse(value);

        if (!Array.isArray(parsed)) {
            throw new Error(`${label} must be a JSON array.`);
        }

        return parsed;
    } catch {
        throw new Error(
            `${label} must contain valid JSON array data.`,
        );
    }
}

function formatJson(value: JsonItem[]) {
    return JSON.stringify(value ?? [], null, 2);
}

function normaliseFields(
    fields: OffenceSeizureFields,
): OffenceSeizureFields {
    return {
        ...fields,
        offence_date: fields.offence_date || null,
        offence_time: fields.offence_time || null,
        division: fields.division || null,
        range_name: fields.range_name || null,
        beat: fields.beat || null,
        location: fields.location || null,
        offence_type: fields.offence_type || null,
        applicable_law: fields.applicable_law || null,
        applicable_section: fields.applicable_section || null,
        seizure_location: fields.seizure_location || null,
        seizure_date: fields.seizure_date || null,
        seizure_time: fields.seizure_time || null,
        vehicle_details: fields.vehicle_details || null,
        vehicle_registration_number:
            fields.vehicle_registration_number || null,
        evidence_details: fields.evidence_details || null,
        action_taken: fields.action_taken || null,
        authorities_informed: fields.authorities_informed || null,
        case_reference_number:
            fields.case_reference_number || null,
        fir_number: fields.fir_number || null,
        incident_reference_id:
            fields.incident_reference_id || null,
        description: fields.description || null,
        additional_remarks: fields.additional_remarks || null,
        source_text: fields.source_text || null,
    };
}

export function OffenceSeizureReport({ onClose }: Props) {
    const [fields, setFields] =
        useState<OffenceSeizureFields>(emptyFields);

    const [reportText, setReportText] = useState("");

    const [personsText, setPersonsText] = useState("[]");
    const [seizedMaterialText, setSeizedMaterialText] =
        useState("[]");
    const [witnessesText, setWitnessesText] = useState("[]");

    const [reportId, setReportId] = useState<string | null>(null);

    
    useEffect(() => {
        const savedId = localStorage.getItem("offenceSeizureReportId");

        if (!savedId) return;

        const restoreReport = async () => {
            try {
                const response = await apiRequest<Record<string, unknown>>(
                    `/api/v1/field/forms/offence-seizure/${savedId}`
                );

                console.log("Restored offence report:", response);
                const report = response as Partial<OffenceSeizureFields> & {
                    id?: string;
                    ai_confidence?: number | null;
                };

                setReportId(report.id ?? savedId);

                setFields((prev) => ({
                    ...prev,
                    ...Object.fromEntries(
                        Object.keys(emptyFields).map((key) => [
                            key,
                            report[key as keyof OffenceSeizureFields] ?? "",
                        ])
                    ),
                }));

                setPersonsText(formatJson(report.persons_involved ?? []));
                setSeizedMaterialText(formatJson(report.seized_material ?? []));
                setWitnessesText(formatJson(report.witnesses ?? []));

                setConfidence(report.ai_confidence ?? null);
            } catch (error) {
                console.error("Failed to restore offence report:", error);
                toast.error("Unable to restore saved draft.");
            }
        };

        void restoreReport();
    }, []);


    const [extracting, setExtracting] = useState(false);
    const [saving, setSaving] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [evidenceFiles, setEvidenceFiles] = useState<EvidenceFile[]>([]);
    const [uploadingEvidence, setUploadingEvidence] = useState(false);

    const [confidence, setConfidence] =
        useState<number | null>(null);

    const updateField = <K extends keyof OffenceSeizureFields>(
        field: K,
        value: OffenceSeizureFields[K],
    ) => {
        setFields((previous) => ({
            ...previous,
            [field]: value,
        }));
    };

    const handleExtract = async () => {
        const text = reportText.trim();

        if (!text) {
            toast.error(
                "Please describe the offence/seizure incident first.",
            );
            return;
        }

        setExtracting(true);

        try {
            const response = await apiRequest<ExtractResponse>(
                "/api/v1/field/forms/offence-seizure/extract",
                {
                    method: "POST",
                    body: JSON.stringify({
                        text,
                    }),
                },
            );

            
            if (!response.success) {
                const errorResponse = response as ExtractResponse & {
                    message?: string;
                    detail?: string;
                };

                throw new Error(
                    errorResponse.message ||
                    errorResponse.detail ||
                    "Unable to extract Offence & Seizure details."
                );
            }


            const extracted = response.fields;

            setFields({
                ...emptyFields,
                ...extracted,
                source_text: text,
                offence_date: extracted.offence_date ?? "",
                offence_time: extracted.offence_time ?? "",
                seizure_date: extracted.seizure_date ?? "",
                seizure_time: extracted.seizure_time ?? "",
                incident_reference_id:
                    extracted.incident_reference_id ?? "",
            });



            setPersonsText(
                formatJson(extracted.persons_involved ?? []),
            );

            setSeizedMaterialText(
                formatJson(extracted.seized_material ?? []),
            );

            setWitnessesText(
                formatJson(extracted.witnesses ?? []),
            );

            setConfidence(extracted.ai_confidence ?? null);

            toast.success(
                "Offence & Seizure details extracted successfully.",
            );
        
        } catch (error) {
            console.error(
                "[Offence-Seizure Extraction Error]",
                error
            );

            const message =
                error instanceof Error
                    ? error.message
                    : "Unable to extract report.";

            toast.error(message);
        } finally {
            setExtracting(false);
        }

    };

    const buildPayload = (): OffenceSeizureFields => {
        return normaliseFields({
            ...fields,
            persons_involved: parseJsonArray(
                personsText,
                "Persons involved",
            ),
            seized_material: parseJsonArray(
                seizedMaterialText,
                "Seized material",
            ),
            witnesses: parseJsonArray(
                witnessesText,
                "Witnesses",
            ),
        });
    };

    const handleSave = async () => {
        setSaving(true);

        try {
            const payloadFields = buildPayload();

            const response = await apiRequest<SaveResponse>(
                reportId
                    ? `/api/v1/field/forms/offence-seizure/${reportId}`
                    : "/api/v1/field/forms/offence-seizure",
                {
                    method: reportId ? "PUT" : "POST",
                    body: JSON.stringify({
                        fields: payloadFields,
                    }),
                },
            );

            if (!response.success) {
                throw new Error(
                    response.message ??
                    "Unable to save Offence & Seizure report.",
                );
            }

            const savedId = response.report_id;

            if (!savedId) {
                throw new Error(
                    "Report was saved but report ID was not returned.",
                );
            }

            setReportId(savedId);
            localStorage.setItem("offenceSeizureReportId", savedId);
            await loadEvidence(savedId);

            toast.success(
                reportId
                    ? "Offence & Seizure draft updated."
                    : "Offence & Seizure draft saved.",
            );
        } catch (error) {
            const message =
                error instanceof Error
                    ? error.message
                    : "Unable to save report.";

            toast.error(message);
        } finally {
            setSaving(false);
        }
    };

    const handleEvidenceUpload = async (
        event: React.ChangeEvent<HTMLInputElement>
    ) => {
        const file = event.target.files?.[0];

        if (!file) return;

        if (!reportId) {
            toast.error("Please save the report before uploading evidence.");
            event.target.value = "";
            return;
        }

        const allowedTypes = [
            "image/jpeg",
            "image/png",
            "image/webp",
            "application/pdf",
        ];

        if (!allowedTypes.includes(file.type)) {
            toast.error("Only JPG, PNG, WEBP and PDF files are allowed.");
            event.target.value = "";
            return;
        }

        if (file.size > 10 * 1024 * 1024) {
            toast.error("Maximum file size is 10 MB.");
            event.target.value = "";
            return;
        }

        try {
            setUploadingEvidence(true);

            const formData = new FormData();
            formData.append("file", file);
            formData.append("report_type", "OFFENCE_SEIZURE");
            formData.append("report_id", reportId);

            const response = await apiRequest(
                "/api/v1/field/evidence/upload",
                {
                    method: "POST",
                    body: formData,
                }
            );

            const uploadedFile = (response as unknown as {
                evidence: EvidenceFile;
            }).evidence;

            setEvidenceFiles((prev) => [uploadedFile, ...prev]);

            toast.success("Evidence uploaded successfully.");
        } catch (error) {
            console.error("Evidence upload failed:", error);
            toast.error("Failed to upload evidence.");
        } finally {
            setUploadingEvidence(false);
            event.target.value = "";
        }
    };

    const loadEvidence = async (id: string) => {
        try {
            const response = await apiRequest(
                `/api/v1/field/evidence/OFFENCE_SEIZURE/${id}`
            );

            const data = response as unknown as {
                evidence: EvidenceFile[];
            };

            setEvidenceFiles(data.evidence || []);
        } catch (error) {
            console.error("Failed to load evidence:", error);
        }
    };

    const handleEvidenceOpen = async (file: EvidenceFile) => {
        try {
            const token = getAccessToken();

            if (!token) {
                toast.error("Your session has expired. Please sign in again.");
                return;
            }

            const response = await fetch(
                apiUrl(`/api/v1/field/evidence/${file.id}/file`),
                {
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                }
            );

            if (!response.ok) {
                throw new Error("Unable to open evidence file.");
            }

            const blob = await response.blob();
            const url = URL.createObjectURL(blob);

            window.open(url, "_blank");

            setTimeout(() => {
                URL.revokeObjectURL(url);
            }, 60_000);
        } catch (error) {
            console.error("Failed to open evidence:", error);
            toast.error("Unable to open evidence file.");
        }
    };

    const handleEvidenceDelete = async (evidenceId: string) => {
        if (!window.confirm("Are you sure you want to delete this evidence file?")) {
            return;
        }
        try {
            const response = await apiRequest(
                `/api/v1/field/evidence/${evidenceId}`,
                {
                    method: "DELETE",
                }
            );

            if (!response.success) {
                throw new Error(
                    response.message ?? "Unable to delete evidence."
                );
            }

            setEvidenceFiles((prev) =>
                prev.filter((file) => file.id !== evidenceId)
            );

            toast.success("Evidence deleted successfully.");
        } catch (error) {
            console.error("Failed to delete evidence:", error);
            toast.error("Unable to delete evidence.");
        }
    };

    const handleSubmit = async () => {
        if (!reportId) {
            toast.error(
                "Please save the report as a draft first.",
            );
            return;
        }

        setSubmitting(true);

        try {
            await apiRequest(
                `/api/v1/field/forms/offence-seizure/${reportId}/submit`,
                {
                    method: "POST",
                },
            );

            toast.success(
                "Offence & Seizure Report submitted successfully.",
            );

            setReportId(null);
            setFields(emptyFields);
            setReportText("");
            setPersonsText("[]");
            setSeizedMaterialText("[]");
            setWitnessesText("[]");
            setConfidence(null);
        } catch (error) {
            const message =
                error instanceof Error
                    ? error.message
                    : "Unable to submit report.";

            toast.error(message);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="space-y-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            {/* Header */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <div className="flex items-center gap-2">
                        <FileText className="h-5 w-5 text-green-700" />
                        <h2 className="text-xl font-semibold text-gray-900">
                            Offence & Seizure Report
                        </h2>
                    </div>

                    <p className="mt-1 text-sm text-gray-500">
                        Describe the incident in Hindi or English and let AI
                        extract the structured report.
                    </p>
                </div>

                {onClose && (
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                    >
                        Close
                    </button>
                )}
            </div>

            {/* AI Extraction */}
            <section className="rounded-xl border border-green-100 bg-green-50 p-4">
                <div className="mb-3 flex items-center gap-2">
                    <Sparkles className="h-5 w-5 text-green-700" />
                    <h3 className="font-semibold text-gray-900">
                        AI Report Extraction
                    </h3>
                </div>

                <textarea
                    value={reportText}
                    onChange={(event) =>
                        setReportText(event.target.value)
                    }
                    placeholder="Example: आज दिनांक 08 अक्टूबर 2026 को रेंज ... में अवैध लकड़ी कटान की सूचना मिली..."
                    className={`${textareaClass} min-h-32`}
                />

                <div className="mt-3 flex flex-wrap items-center gap-3">
                    <button
                        type="button"
                        onClick={handleExtract}
                        disabled={extracting}
                        className="inline-flex items-center gap-2 rounded-lg bg-green-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-800 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {extracting ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                            <Sparkles className="h-4 w-4" />
                        )}

                        {extracting
                            ? "Extracting..."
                            : "Extract with AI"}
                    </button>

                    {confidence !== null && (
                        <span className="rounded-full bg-white px-3 py-1.5 text-sm font-medium text-gray-700">
                            AI Confidence:{" "}
                            {(confidence * 100).toFixed(0)}%
                        </span>
                    )}
                </div>
            </section>

            {/* Basic Details */}
            <section>
                <h3 className="mb-4 text-base font-semibold text-gray-900">
                    Basic Details
                </h3>

                <div className="grid gap-4 md:grid-cols-2">
                    <Field
                        label="Offence Date"
                        type="date"
                        value={fields.offence_date ?? ""}
                        onChange={(value) =>
                            updateField("offence_date", value)
                        }
                    />

                    <Field
                        label="Offence Time"
                        type="time"
                        value={(fields.offence_time ?? "").slice(0, 5)}
                        onChange={(value) =>
                            updateField("offence_time", value)
                        }
                    />

                    <Field
                        label="Division"
                        value={fields.division ?? ""}
                        onChange={(value) =>
                            updateField("division", value)
                        }
                    />

                    <Field
                        label="Range"
                        value={fields.range_name ?? ""}
                        onChange={(value) =>
                            updateField("range_name", value)
                        }
                    />

                    <Field
                        label="Beat"
                        value={fields.beat ?? ""}
                        onChange={(value) =>
                            updateField("beat", value)
                        }
                    />

                    <Field
                        label="Location"
                        value={fields.location ?? ""}
                        onChange={(value) =>
                            updateField("location", value)
                        }
                    />

                    <Field
                        label="Offence Type"
                        value={fields.offence_type ?? ""}
                        onChange={(value) =>
                            updateField("offence_type", value)
                        }
                    />

                    <Field
                        label="Applicable Law"
                        value={fields.applicable_law ?? ""}
                        onChange={(value) =>
                            updateField("applicable_law", value)
                        }
                    />

                    <Field
                        label="Applicable Section"
                        value={fields.applicable_section ?? ""}
                        onChange={(value) =>
                            updateField("applicable_section", value)
                        }
                    />

                    <Field
                        label="Seizure Location"
                        value={fields.seizure_location ?? ""}
                        onChange={(value) =>
                            updateField("seizure_location", value)
                        }
                    />

                    <Field
                        label="Seizure Date"
                        type="date"
                        value={fields.seizure_date ?? ""}
                        onChange={(value) =>
                            updateField("seizure_date", value)
                        }
                    />

                    <Field
                        label="Seizure Time"
                        type="time"
                        value={(fields.seizure_time ?? "").slice(0, 5)}
                        onChange={(value) =>
                            updateField("seizure_time", value)
                        }
                    />
                </div>
            </section>

            {/* Vehicle */}
            <section>
                <h3 className="mb-4 text-base font-semibold text-gray-900">
                    Vehicle Details
                </h3>

                <div className="grid gap-4 md:grid-cols-2">
                    <Field
                        label="Vehicle Details"
                        value={fields.vehicle_details ?? ""}
                        onChange={(value) =>
                            updateField("vehicle_details", value)
                        }
                    />

                    <Field
                        label="Vehicle Registration Number"
                        value={fields.vehicle_registration_number ?? ""}
                        onChange={(value) =>
                            updateField(
                                "vehicle_registration_number",
                                value,
                            )
                        }
                    />
                </div>
            </section>

            {/* People / Material / Witnesses */}
            <section>
                <h3 className="mb-4 text-base font-semibold text-gray-900">
                    People, Seized Material & Witnesses
                </h3>

                <div className="space-y-4">
                    <JsonTextarea
                        label="Persons Involved"
                        value={personsText}
                        onChange={setPersonsText}
                    />

                    <JsonTextarea
                        label="Seized Material"
                        value={seizedMaterialText}
                        onChange={setSeizedMaterialText}
                    />

                    <JsonTextarea
                        label="Witnesses"
                        value={witnessesText}
                        onChange={setWitnessesText}
                    />
                </div>
            </section>

            {/* Action / Case */}
            <section>
                <h3 className="mb-4 text-base font-semibold text-gray-900">
                    Legal & Action Details
                </h3>

                <div className="grid gap-4 md:grid-cols-2">
                    <Field
                        label="Case Reference Number"
                        value={fields.case_reference_number ?? ""}
                        onChange={(value) =>
                            updateField("case_reference_number", value)
                        }
                    />

                    <Field
                        label="FIR Number"
                        value={fields.fir_number ?? ""}
                        onChange={(value) =>
                            updateField("fir_number", value)
                        }
                    />

                    <Field
                        label="Incident Reference ID"
                        value={fields.incident_reference_id ?? ""}
                        onChange={(value) =>
                            updateField("incident_reference_id", value)
                        }
                    />

                    <Field
                        label="Authorities Informed"
                        value={fields.authorities_informed ?? ""}
                        onChange={(value) =>
                            updateField("authorities_informed", value)
                        }
                    />
                </div>

                <div className="mt-4 space-y-4">
                    <TextAreaField
                        label="Action Taken"
                        value={fields.action_taken ?? ""}
                        onChange={(value) =>
                            updateField("action_taken", value)
                        }
                    />

                    <TextAreaField
                        label="Evidence Details"
                        value={fields.evidence_details ?? ""}
                        onChange={(value) =>
                            updateField("evidence_details", value)
                        }
                    />

                    <TextAreaField
                        label="Description"
                        value={fields.description ?? ""}
                        onChange={(value) =>
                            updateField("description", value)
                        }
                    />

                    {/* Evidence Attachments */}
                    <div className="md:col-span-2">
                        <div className="flex items-center justify-between mb-2">
                            <label className="text-sm font-medium text-gray-700">
                                Evidence Attachments
                            </label>

                            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                                {uploadingEvidence ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                    <Upload className="h-4 w-4" />
                                )}

                                {uploadingEvidence ? "Uploading..." : "Upload Evidence"}

                                <input
                                    type="file"
                                    className="hidden"
                                    accept=".jpg,.jpeg,.png,.webp,.pdf"
                                    onChange={handleEvidenceUpload}
                                    disabled={uploadingEvidence}
                                />
                            </label>
                        </div>

                        {evidenceFiles.length > 0 ? (
                            <div className="space-y-2">
                                {evidenceFiles.map((file) => (
                                    <div
                                        key={file.id}
                                        className="flex cursor-pointer items-center justify-between rounded-lg border border-gray-200 bg-gray-50 p-3 hover:bg-gray-100"
                                        onClick={() => handleEvidenceOpen(file)}
                                    >
                                        <div className="flex min-w-0 items-center gap-3">
                                            <ImageIcon className="h-5 w-5 shrink-0 text-gray-500" />

                                            <div className="min-w-0">
                                                <p className="truncate text-sm font-medium text-gray-800">
                                                    {file.file_name}
                                                </p>

                                                <p className="text-xs text-gray-500">
                                                    {file.file_type.toUpperCase()} ·{" "}
                                                    {(file.file_size / 1024).toFixed(1)} KB
                                                </p>
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                handleEvidenceDelete(file.id);
                                            }}
                                            className="rounded-lg p-2 text-red-600 hover:bg-red-50"
                                            title="Delete evidence"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p className="text-sm text-gray-500">
                                No evidence files attached yet.
                            </p>
                        )}
                    </div>

                    <TextAreaField
                        label="Additional Remarks"
                        value={fields.additional_remarks ?? ""}
                        onChange={(value) =>
                            updateField("additional_remarks", value)
                        }
                    />
                </div>
            </section>

            {/* Source */}
            {fields.source_text && (
                <section className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                    <div className="mb-2 flex items-center gap-2">
                        <AlertCircle className="h-4 w-4 text-gray-500" />
                        <h3 className="text-sm font-semibold text-gray-800">
                            Source Text
                        </h3>
                    </div>

                    <p className="whitespace-pre-wrap text-sm text-gray-600">
                        {fields.source_text}
                    </p>
                </section>
            )}

            {/* Actions */}
            <div className="flex flex-wrap gap-3 border-t border-gray-200 pt-5">
                <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving || submitting}
                    className="inline-flex items-center gap-2 rounded-lg border border-green-700 px-4 py-2.5 text-sm font-semibold text-green-700 hover:bg-green-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                    {saving ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                        <Save className="h-4 w-4" />
                    )}

                    {saving ? "Saving..." : "Save Draft"}
                </button>

                <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={
                        !reportId ||
                        saving ||
                        submitting
                    }
                    className="inline-flex items-center gap-2 rounded-lg bg-green-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                    {submitting ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                        <Send className="h-4 w-4" />
                    )}

                    {submitting
                        ? "Submitting..."
                        : "Submit Report"}
                </button>

                {reportId && (
                    <div className="flex items-center gap-2 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
                        <CheckCircle2 className="h-4 w-4" />
                        Draft ID: {reportId}
                    </div>
                )}
            </div>
        </div>
    );
}

function Field({
    label,
    value,
    onChange,
    type = "text",
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    type?: string;
}) {
    return (
        <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-gray-700">
                {label}
            </span>

            <input
                type={type}
                value={value}
                onChange={(event) =>
                    onChange(event.target.value)
                }
                className={inputClass}
            />
        </label>
    );
}

function TextAreaField({
    label,
    value,
    onChange,
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
}) {
    return (
        <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-gray-700">
                {label}
            </span>

            <textarea
                value={value}
                onChange={(event) =>
                    onChange(event.target.value)
                }
                className={textareaClass}
            />
        </label>
    );
}

function JsonTextarea({
    label,
    value,
    onChange,
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
}) {
    return (
        <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-gray-700">
                {label}
            </span>

            <textarea
                value={value}
                onChange={(event) =>
                    onChange(event.target.value)
                }
                className={`${textareaClass} min-h-32 font-mono text-xs`}
                placeholder='[{"name": "...", "role": "..."}]'
            />

            <span className="mt-1 block text-xs text-gray-500">
                Enter a JSON array. Example: name and role objects in an array.
            </span>
        </label>
    );
}