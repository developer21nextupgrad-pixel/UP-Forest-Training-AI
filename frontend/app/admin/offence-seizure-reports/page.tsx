
"use client";

import { useCallback, useEffect, useState } from "react";
import {
    ArrowLeft,
    Download,
    Eye,
    FileText,
    RefreshCw,
    Save,
} from "lucide-react";

import { apiUrl } from "@/lib/api";
import { getAccessToken } from "@/lib/auth";
import { adminOffenceSeizureApi } from "@/services/admin-offence-seizure.service";

type ReviewStatus =
    | "PENDING"
    | "APPROVED"
    | "REJECTED"
    | "CHANGES_REQUESTED";

type OffenceSeizureReport = {
    id: string;
    officer_id?: string;
    officer_name?: string | null;
    officer_email?: string | null;
    offence_date?: string | null;
    offence_time?: string | null;
    division?: string | null;
    range_name?: string | null;
    beat?: string | null;
    location?: string | null;
    offence_type?: string | null;
    status?: string;
    submitted_at?: string | null;
    review_status?: ReviewStatus;
    review_comment?: string | null;
    reviewed_by?: string | null;
    reviewed_at?: string | null;
};

type OffenceSeizureReportDetail = OffenceSeizureReport & {
    applicable_law?: string | null;
    applicable_section?: string | null;
    persons_involved?: unknown[] | null;
    seized_material?: unknown[] | null;
    seizure_location?: string | null;
    seizure_date?: string | null;
    seizure_time?: string | null;
    vehicle_details?: string | null;
    vehicle_registration_number?: string | null;
    evidence_details?: string | null;
    witnesses?: unknown[] | null;
    action_taken?: string | null;
    authorities_informed?: string | null;
    case_reference_number?: string | null;
    fir_number?: string | null;
    incident_reference_id?: string | null;
    description?: string | null;
    additional_remarks?: string | null;
    source_text?: string | null;
    ai_confidence?: number | null;
    created_at?: string | null;
    updated_at?: string | null;
};

type AdminEvidenceFile = {
    id: string;
    file_name: string;
    file_type: string;
    file_size: number;
    mime_type: string;
    description: string | null;
    uploaded_at: string | null;
};

const REVIEW_OPTIONS: ReviewStatus[] = [
    "PENDING",
    "APPROVED",
    "REJECTED",
    "CHANGES_REQUESTED",
];

const inputClass =
    "w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none focus:border-gray-500 focus:ring-1 focus:ring-gray-500";

function displayValue(value: unknown): string {
    if (value === null || value === undefined || value === "") {
        return "-";
    }

    if (typeof value === "string") {
        return value;
    }

    if (typeof value === "number" || typeof value === "boolean") {
        return String(value);
    }

    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
}

function formatDate(value?: string | null): string {
    if (!value) return "-";

    const date = new Date(value);

    return Number.isNaN(date.getTime())
        ? value
        : date.toLocaleString();
}

function formatFileSize(bytes?: number): string {
    if (bytes === undefined || bytes === null || bytes < 0) {
        return "Size unavailable";
    }

    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} KB`;
    }

    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function statusClass(status?: string) {
    switch (status) {
        case "APPROVED":
            return "bg-green-100 text-green-800";
        case "REJECTED":
            return "bg-red-100 text-red-800";
        case "CHANGES_REQUESTED":
            return "bg-orange-100 text-orange-800";
        default:
            return "bg-yellow-100 text-yellow-800";
    }
}

function DetailField({
    label,
    value,
}: {
    label: string;
    value: unknown;
}) {
    return (
        <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                {label}
            </p>
            <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-gray-900">
                {displayValue(value)}
            </p>
        </div>
    );
}

function DetailSection({
    title,
    children,
}: {
    title: string;
    children: React.ReactNode;
}) {
    return (
        <section className="border-b px-5 py-6 sm:px-6">
            <h2 className="mb-4 text-lg font-semibold text-gray-900">
                {title}
            </h2>
            {children}
        </section>
    );
}

export default function AdminOffenceSeizureReportsPage() {
    const [reports, setReports] = useState<OffenceSeizureReport[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const [selectedReport, setSelectedReport] =
        useState<OffenceSeizureReportDetail | null>(null);

    const [detailLoading, setDetailLoading] = useState(false);

    const [evidenceFiles, setEvidenceFiles] =
        useState<AdminEvidenceFile[]>([]);
    const [evidenceLoading, setEvidenceLoading] = useState(false);
    const [evidenceError, setEvidenceError] = useState("");
    const [fileActionId, setFileActionId] = useState<string | null>(null);

    const [reviewStatus, setReviewStatus] =
        useState<ReviewStatus>("PENDING");
    const [reviewComment, setReviewComment] = useState("");
    const [reviewSaving, setReviewSaving] = useState(false);
    const [reviewMessage, setReviewMessage] = useState("");
    const [reviewError, setReviewError] = useState("");

    const loadReports = useCallback(async () => {
        try {
            setLoading(true);
            setError("");

            const response =
                await adminOffenceSeizureApi.listSubmittedReports();

            const result = Array.isArray(response)
                ? response
                : (response as any)?.data;

            setReports(Array.isArray(result) ? result : []);
        } catch (err) {
            console.error("Failed to load Offence & Seizure reports:", err);
            setError(
                err instanceof Error
                    ? err.message
                    : "Failed to load submitted reports."
            );
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadReports();
    }, [loadReports]);

    const loadEvidence = async (reportId: string) => {
        try {
            setEvidenceLoading(true);
            setEvidenceError("");
            setEvidenceFiles([]);

            const response =
                await adminOffenceSeizureApi.listEvidence(reportId);

            const result = (response as any)?.data ?? response;
            const files = Array.isArray(result)
                ? result
                : result?.evidence;

            setEvidenceFiles(Array.isArray(files) ? files : []);
        } catch (err) {
            console.error("Failed to load evidence files:", err);
            setEvidenceError(
                err instanceof Error
                    ? err.message
                    : "Unable to load evidence files."
            );
        } finally {
            setEvidenceLoading(false);
        }
    };

    const handleViewReport = async (reportId: string) => {
        try {
            setDetailLoading(true);
            setError("");
            setReviewMessage("");
            setReviewError("");
            setEvidenceFiles([]);
            setEvidenceError("");

            const response =
                await adminOffenceSeizureApi.getSubmittedReport(reportId);

            const reportData = (response as any)?.data ?? response;

            const report = Array.isArray(reportData)
                ? reportData[0]
                : reportData;

            if (!report?.id) {
                throw new Error("The report details could not be found.");
            }

            setSelectedReport(report as OffenceSeizureReportDetail);
            setReviewStatus(report.review_status || "PENDING");
            setReviewComment(report.review_comment || "");

            // Load evidence associated with this report.
            await loadEvidence(reportId);
        } catch (err) {
            console.error("Failed to load report details:", err);
            setError(
                err instanceof Error
                    ? err.message
                    : "Failed to load report details."
            );
        } finally {
            setDetailLoading(false);
        }
    };

    const fetchEvidenceBlob = async (evidenceId: string) => {
        const token = getAccessToken();

        if (!token) {
            throw new Error(
                "Your login session is unavailable. Please sign in again."
            );
        }

        const response = await fetch(
            apiUrl(
                `/api/v1/admin/users/field/offence-seizure-evidence/${encodeURIComponent(
                    evidenceId
                )}/file`
            ),
            {
                method: "GET",
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            }
        );

        if (!response.ok) {
            let message = `Unable to retrieve file (HTTP ${response.status}).`;

            try {
                const body = await response.json();
                message = body.detail || body.message || message;
            } catch {
                // Keep the default error message if the response is not JSON.
            }

            throw new Error(message);
        }

        return response.blob();
    };

    const handleOpenEvidence = async (file: AdminEvidenceFile) => {
        // Open a tab immediately so the browser does not block the popup
        // while the authenticated file request is running.
        const previewTab = window.open("about:blank", "_blank");

        try {
            setFileActionId(file.id);
            setEvidenceError("");

            const blob = await fetchEvidenceBlob(file.id);
            const objectUrl = URL.createObjectURL(blob);

            if (previewTab) {
                previewTab.location.href = objectUrl;
            } else {
                // If the browser blocks new tabs, open the file in this tab.
                window.location.href = objectUrl;
            }

            window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
        } catch (err) {
            previewTab?.close();

            console.error("Failed to open evidence:", err);
            setEvidenceError(
                err instanceof Error
                    ? err.message
                    : "Unable to open this evidence file."
            );
        } finally {
            setFileActionId(null);
        }
    };

    const handleDownloadEvidence = async (file: AdminEvidenceFile) => {
        try {
            setFileActionId(file.id);
            setEvidenceError("");

            const blob = await fetchEvidenceBlob(file.id);
            const objectUrl = URL.createObjectURL(blob);
            const anchor = document.createElement("a");

            anchor.href = objectUrl;
            anchor.download = file.file_name || "evidence-file";
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();

            window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
        } catch (err) {
            console.error("Failed to download evidence:", err);
            setEvidenceError(
                err instanceof Error
                    ? err.message
                    : "Unable to download this evidence file."
            );
        } finally {
            setFileActionId(null);
        }
    };

    const handleSaveReview = async () => {
        if (!selectedReport) return;

        try {
            setReviewSaving(true);
            setReviewMessage("");
            setReviewError("");

            const response = await adminOffenceSeizureApi.reviewReport(
                selectedReport.id,
                {
                    review_status: reviewStatus,
                    review_comment: reviewComment.trim() || null,
                }
            );

            const result = (response as any)?.data ?? response;

            setSelectedReport((current) =>
                current
                    ? {
                          ...current,
                          review_status:
                              result?.review_status || reviewStatus,
                          review_comment:
                              result?.review_comment ??
                              (reviewComment.trim() || null),
                          reviewed_by:
                              result?.reviewed_by ??
                              current.reviewed_by ??
                              null,
                          reviewed_at:
                              result?.reviewed_at ??
                              current.reviewed_at ??
                              null,
                      }
                    : current
            );

            setReports((current) =>
                current.map((report) =>
                    report.id === selectedReport.id
                        ? {
                              ...report,
                              review_status: reviewStatus,
                              review_comment: reviewComment.trim() || null,
                          }
                        : report
                )
            );

            setReviewMessage("Review saved successfully.");
        } catch (err) {
            console.error("Failed to save report review:", err);
            setReviewError(
                err instanceof Error
                    ? err.message
                    : "Failed to save review. Please try again."
            );
        } finally {
            setReviewSaving(false);
        }
    };

    if (selectedReport) {
        return (
            <main className="min-h-screen bg-gray-50 p-4 sm:p-6">
                <div className="mx-auto max-w-5xl">
                    <button
                        type="button"
                        onClick={() => {
                            setSelectedReport(null);
                            setEvidenceFiles([]);
                            setEvidenceError("");
                            setReviewMessage("");
                            setReviewError("");
                            setError("");
                        }}
                        className="mb-5 inline-flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-gray-950"
                    >
                        <ArrowLeft className="h-4 w-4" />
                        Back to Submitted Reports
                    </button>

                    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                        <header className="border-b bg-gray-50 px-5 py-5 sm:px-6">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                <div>
                                    <h1 className="text-xl font-bold text-gray-900 sm:text-2xl">
                                        Offence &amp; Seizure Report
                                    </h1>
                                    <p className="mt-2 break-all text-sm text-gray-500">
                                        Report ID: {selectedReport.id}
                                    </p>
                                    {selectedReport.case_reference_number && (
                                        <p className="mt-1 text-sm text-gray-600">
                                            Case Reference:{" "}
                                            {selectedReport.case_reference_number}
                                        </p>
                                    )}
                                </div>

                                <div className="flex flex-wrap gap-2">
                                    <span
                                        className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${statusClass(
                                            selectedReport.status
                                        )}`}
                                    >
                                        {selectedReport.status || "UNKNOWN"}
                                    </span>
                                    <span
                                        className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${statusClass(
                                            reviewStatus
                                        )}`}
                                    >
                                        {reviewStatus}
                                    </span>
                                </div>
                            </div>
                        </header>

                        <DetailSection title="Officer Information">
                            <div className="grid gap-5 sm:grid-cols-2">
                                <DetailField
                                    label="Officer Name"
                                    value={selectedReport.officer_name}
                                />
                                <DetailField
                                    label="Officer Email"
                                    value={selectedReport.officer_email}
                                />
                                <DetailField
                                    label="Officer ID"
                                    value={selectedReport.officer_id}
                                />
                                <DetailField
                                    label="Division"
                                    value={selectedReport.division}
                                />
                            </div>
                        </DetailSection>

                        <DetailSection title="Offence Information">
                            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                                <DetailField
                                    label="Offence Date"
                                    value={selectedReport.offence_date}
                                />
                                <DetailField
                                    label="Offence Time"
                                    value={selectedReport.offence_time}
                                />
                                <DetailField
                                    label="Offence Type"
                                    value={selectedReport.offence_type}
                                />
                                <DetailField
                                    label="Range"
                                    value={selectedReport.range_name}
                                />
                                <DetailField
                                    label="Beat"
                                    value={selectedReport.beat}
                                />
                                <DetailField
                                    label="Location"
                                    value={selectedReport.location}
                                />
                                <DetailField
                                    label="Applicable Law"
                                    value={selectedReport.applicable_law}
                                />
                                <DetailField
                                    label="Applicable Section"
                                    value={selectedReport.applicable_section}
                                />
                                <DetailField
                                    label="Incident Reference ID"
                                    value={selectedReport.incident_reference_id}
                                />
                                <DetailField
                                    label="FIR Number"
                                    value={selectedReport.fir_number}
                                />
                                <DetailField
                                    label="Case Reference Number"
                                    value={selectedReport.case_reference_number}
                                />
                            </div>
                        </DetailSection>

                        <DetailSection title="Persons Involved">
                            <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-gray-50 p-4 text-sm text-gray-800">
                                {displayValue(selectedReport.persons_involved)}
                            </pre>
                        </DetailSection>

                        <DetailSection title="Seized Material">
                            <div className="grid gap-5 sm:grid-cols-2">
                                <div className="sm:col-span-2">
                                    <DetailField
                                        label="Seized Material Details"
                                        value={selectedReport.seized_material}
                                    />
                                </div>
                                <DetailField
                                    label="Seizure Location"
                                    value={selectedReport.seizure_location}
                                />
                                <DetailField
                                    label="Seizure Date"
                                    value={selectedReport.seizure_date}
                                />
                                <DetailField
                                    label="Seizure Time"
                                    value={selectedReport.seizure_time}
                                />
                                <DetailField
                                    label="Vehicle Details"
                                    value={selectedReport.vehicle_details}
                                />
                                <DetailField
                                    label="Vehicle Registration Number"
                                    value={
                                        selectedReport.vehicle_registration_number
                                    }
                                />
                            </div>
                        </DetailSection>

                        <DetailSection title="Witnesses & Actions">
                            <div className="grid gap-5 sm:grid-cols-2">
                                <div className="sm:col-span-2">
                                    <DetailField
                                        label="Witnesses"
                                        value={selectedReport.witnesses}
                                    />
                                </div>
                                <DetailField
                                    label="Action Taken"
                                    value={selectedReport.action_taken}
                                />
                                <DetailField
                                    label="Authorities Informed"
                                    value={selectedReport.authorities_informed}
                                />
                            </div>
                        </DetailSection>

                        <DetailSection title="Description & Remarks">
                            <div className="space-y-5">
                                <DetailField
                                    label="Description"
                                    value={selectedReport.description}
                                />
                                <DetailField
                                    label="Additional Remarks"
                                    value={selectedReport.additional_remarks}
                                />
                                <DetailField
                                    label="Evidence Details"
                                    value={selectedReport.evidence_details}
                                />
                                <DetailField
                                    label="Original Field Text"
                                    value={selectedReport.source_text}
                                />
                            </div>
                        </DetailSection>

                        <DetailSection title="Uploaded Evidence Files">
                            {evidenceLoading ? (
                                <div className="flex items-center gap-2 py-4 text-sm text-gray-500">
                                    <RefreshCw className="h-4 w-4 animate-spin" />
                                    Loading evidence files...
                                </div>
                            ) : evidenceError ? (
                                <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                                    {evidenceError}
                                    <button
                                        type="button"
                                        onClick={() =>
                                            void loadEvidence(selectedReport.id)
                                        }
                                        className="ml-2 font-semibold underline"
                                    >
                                        Retry
                                    </button>
                                </div>
                            ) : evidenceFiles.length === 0 ? (
                                <p className="rounded-lg bg-gray-50 p-4 text-sm text-gray-500">
                                    No uploaded evidence files found for this report.
                                </p>
                            ) : (
                                <div className="space-y-3">
                                    {evidenceFiles.map((file) => (
                                        <div
                                            key={file.id}
                                            className="flex flex-col gap-4 rounded-lg border border-gray-200 p-4 sm:flex-row sm:items-center sm:justify-between"
                                        >
                                            <div className="flex min-w-0 items-start gap-3">
                                                <div className="rounded-lg bg-gray-100 p-2">
                                                    <FileText className="h-5 w-5 text-gray-700" />
                                                </div>

                                                <div className="min-w-0">
                                                    <p className="break-words text-sm font-semibold text-gray-900">
                                                        {file.file_name}
                                                    </p>
                                                    <p className="mt-1 text-xs text-gray-500">
                                                        {file.mime_type ||
                                                            file.file_type ||
                                                            "File type unavailable"}{" "}
                                                        ·{" "}
                                                        {formatFileSize(
                                                            file.file_size
                                                        )}
                                                    </p>
                                                    {file.description && (
                                                        <p className="mt-2 whitespace-pre-wrap text-sm text-gray-700">
                                                            {file.description}
                                                        </p>
                                                    )}
                                                    <p className="mt-1 text-xs text-gray-500">
                                                        Uploaded:{" "}
                                                        {formatDate(
                                                            file.uploaded_at
                                                        )}
                                                    </p>
                                                </div>
                                            </div>

                                            <div className="flex shrink-0 gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        void handleOpenEvidence(file)
                                                    }
                                                    disabled={fileActionId !== null}
                                                    className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                                                >
                                                    {fileActionId === file.id ? (
                                                        <RefreshCw className="h-4 w-4 animate-spin" />
                                                    ) : (
                                                        <Eye className="h-4 w-4" />
                                                    )}
                                                    Open
                                                </button>

                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        void handleDownloadEvidence(
                                                            file
                                                        )
                                                    }
                                                    disabled={fileActionId !== null}
                                                    className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
                                                >
                                                    <Download className="h-4 w-4" />
                                                    Download
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </DetailSection>

                        <DetailSection title="AI Information">
                            <div className="grid gap-5 sm:grid-cols-2">
                                <DetailField
                                    label="AI Confidence"
                                    value={
                                        selectedReport.ai_confidence !== null &&
                                        selectedReport.ai_confidence !== undefined
                                            ? `${(
                                                  selectedReport.ai_confidence *
                                                  100
                                              ).toFixed(1)}%`
                                            : "-"
                                    }
                                />
                            </div>
                        </DetailSection>

                        <DetailSection title="Review Report">
                            <div className="space-y-5">
                                <div>
                                    <label
                                        htmlFor="review-status"
                                        className="mb-2 block text-sm font-medium text-gray-700"
                                    >
                                        Review Status
                                    </label>
                                    <select
                                        id="review-status"
                                        value={reviewStatus}
                                        onChange={(event) =>
                                            setReviewStatus(
                                                event.target.value as ReviewStatus
                                            )
                                        }
                                        disabled={reviewSaving}
                                        className={inputClass}
                                    >
                                        {REVIEW_OPTIONS.map((status) => (
                                            <option
                                                key={status}
                                                value={status}
                                            >
                                                {status.replaceAll("_", " ")}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <label
                                        htmlFor="review-comment"
                                        className="mb-2 block text-sm font-medium text-gray-700"
                                    >
                                        Review Comment
                                    </label>
                                    <textarea
                                        id="review-comment"
                                        rows={4}
                                        value={reviewComment}
                                        onChange={(event) =>
                                            setReviewComment(event.target.value)
                                        }
                                        disabled={reviewSaving}
                                        placeholder="Add review comments..."
                                        className={inputClass}
                                    />
                                </div>

                                {(selectedReport.reviewed_by ||
                                    selectedReport.reviewed_at) && (
                                    <div className="rounded-lg bg-gray-50 p-4 text-sm text-gray-600">
                                        <p>
                                            <strong>Reviewed By:</strong>{" "}
                                            {selectedReport.reviewed_by || "-"}
                                        </p>
                                        <p className="mt-1">
                                            <strong>Reviewed At:</strong>{" "}
                                            {formatDate(
                                                selectedReport.reviewed_at
                                            )}
                                        </p>
                                    </div>
                                )}

                                {reviewMessage && (
                                    <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700">
                                        {reviewMessage}
                                    </div>
                                )}

                                {reviewError && (
                                    <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                                        {reviewError}
                                    </div>
                                )}

                                <div className="flex justify-end">
                                    <button
                                        type="button"
                                        onClick={() => void handleSaveReview()}
                                        disabled={reviewSaving}
                                        className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        {reviewSaving ? (
                                            <RefreshCw className="h-4 w-4 animate-spin" />
                                        ) : (
                                            <Save className="h-4 w-4" />
                                        )}
                                        {reviewSaving
                                            ? "Saving..."
                                            : "Save Review"}
                                    </button>
                                </div>
                            </div>
                        </DetailSection>

                        <DetailSection title="Report Metadata">
                            <div className="grid gap-5 sm:grid-cols-2">
                                <DetailField
                                    label="Created At"
                                    value={formatDate(selectedReport.created_at)}
                                />
                                <DetailField
                                    label="Updated At"
                                    value={formatDate(selectedReport.updated_at)}
                                />
                                <DetailField
                                    label="Submitted At"
                                    value={formatDate(selectedReport.submitted_at)}
                                />
                            </div>
                        </DetailSection>
                    </div>
                </div>
            </main>
        );
    }

    return (
        <main className="min-h-screen bg-gray-50 p-4 sm:p-6">
            <div className="mx-auto max-w-7xl">
                <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">
                            Offence &amp; Seizure Reports
                        </h1>
                        <p className="mt-1 text-sm text-gray-500">
                            Review submitted reports and inspect uploaded evidence.
                        </p>
                    </div>

                    <button
                        type="button"
                        onClick={() => void loadReports()}
                        disabled={loading}
                        className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    >
                        <RefreshCw
                            className={`h-4 w-4 ${
                                loading ? "animate-spin" : ""
                            }`}
                        />
                        Refresh
                    </button>
                </div>

                {error && (
                    <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                        {error}
                    </div>
                )}

                <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                    {loading ? (
                        <div className="flex items-center justify-center gap-2 p-10 text-sm text-gray-500">
                            <RefreshCw className="h-4 w-4 animate-spin" />
                            Loading submitted reports...
                        </div>
                    ) : reports.length === 0 ? (
                        <div className="p-10 text-center">
                            <FileText className="mx-auto h-8 w-8 text-gray-400" />
                            <p className="mt-3 text-sm font-medium text-gray-700">
                                No submitted reports found.
                            </p>
                            <p className="mt-1 text-sm text-gray-500">
                                Submitted Offence &amp; Seizure Reports will appear here.
                            </p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[900px] text-left text-sm">
                                <thead className="border-b bg-gray-50">
                                    <tr>
                                        <th className="px-5 py-4 font-semibold text-gray-700">
                                            Officer
                                        </th>
                                        <th className="px-5 py-4 font-semibold text-gray-700">
                                            Offence Date
                                        </th>
                                        <th className="px-5 py-4 font-semibold text-gray-700">
                                            Offence Type
                                        </th>
                                        <th className="px-5 py-4 font-semibold text-gray-700">
                                            Range / Beat
                                        </th>
                                        <th className="px-5 py-4 font-semibold text-gray-700">
                                            Status
                                        </th>
                                        <th className="px-5 py-4 font-semibold text-gray-700">
                                            Review
                                        </th>
                                        <th className="px-5 py-4 font-semibold text-gray-700">
                                            Submitted At
                                        </th>
                                        <th className="px-5 py-4 text-right font-semibold text-gray-700">
                                            Action
                                        </th>
                                    </tr>
                                </thead>

                                <tbody className="divide-y divide-gray-100">
                                    {reports.map((report) => (
                                        <tr
                                            key={report.id}
                                            className="hover:bg-gray-50"
                                        >
                                            <td className="px-5 py-4">
                                                <p className="font-medium text-gray-900">
                                                    {report.officer_name ||
                                                        report.officer_id ||
                                                        "Unknown officer"}
                                                </p>
                                                {report.officer_email && (
                                                    <p className="mt-1 text-xs text-gray-500">
                                                        {report.officer_email}
                                                    </p>
                                                )}
                                            </td>

                                            <td className="px-5 py-4 text-gray-700">
                                                {report.offence_date || "-"}
                                            </td>

                                            <td className="px-5 py-4 text-gray-700">
                                                {report.offence_type || "-"}
                                            </td>

                                            <td className="px-5 py-4 text-gray-700">
                                                <p>{report.range_name || "-"}</p>
                                                <p className="mt-1 text-xs text-gray-500">
                                                    Beat: {report.beat || "-"}
                                                </p>
                                            </td>

                                            <td className="px-5 py-4">
                                                <span
                                                    className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${statusClass(
                                                        report.status
                                                    )}`}
                                                >
                                                    {report.status || "UNKNOWN"}
                                                </span>
                                            </td>

                                            <td className="px-5 py-4">
                                                <span
                                                    className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${statusClass(
                                                        report.review_status
                                                    )}`}
                                                >
                                                    {report.review_status ||
                                                        "PENDING"}
                                                </span>
                                            </td>

                                            <td className="px-5 py-4 text-gray-600">
                                                {formatDate(report.submitted_at)}
                                            </td>

                                            <td className="px-5 py-4 text-right">
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        void handleViewReport(
                                                            report.id
                                                        )
                                                    }
                                                    disabled={detailLoading}
                                                    className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
                                                >
                                                    {detailLoading ? (
                                                        <RefreshCw className="h-4 w-4 animate-spin" />
                                                    ) : (
                                                        <Eye className="h-4 w-4" />
                                                    )}
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
        </main>
    );
}
