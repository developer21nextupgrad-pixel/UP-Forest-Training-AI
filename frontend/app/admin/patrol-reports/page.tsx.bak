"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Eye, RefreshCw, Save } from "lucide-react";
import { adminPatrolApi } from "@/services/admin-patrol.service";

type ReviewStatus =
    | "PENDING"
    | "APPROVED"
    | "REJECTED"
    | "CHANGES_REQUESTED";

type PatrolReport = {
    id: string;
    officer_id: string;
    officer_name: string;
    officer_email: string;
    patrol_date: string;
    beat: string | null;
    division: string | null;
    status: string;
    submitted_at: string | null;
    review_status?: ReviewStatus;
    review_comment?: string | null;
    reviewed_by?: string | null;
    reviewed_at?: string | null;
};

type PatrolReportDetail = PatrolReport & {
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
    source_text: string | null;
    ai_confidence: number | null;
    created_at: string | null;
    updated_at: string | null;
};

export default function AdminPatrolReportsPage() {
    const [reports, setReports] = useState<PatrolReport[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const [selectedReport, setSelectedReport] =
        useState<PatrolReportDetail | null>(null);

    const [detailLoading, setDetailLoading] = useState(false);

    // ============================================================
    // REVIEW STATE
    // ============================================================

    const [reviewStatus, setReviewStatus] =
        useState<ReviewStatus>("PENDING");

    const [reviewComment, setReviewComment] = useState("");

    const [reviewSaving, setReviewSaving] = useState(false);

    const [reviewMessage, setReviewMessage] = useState("");

    const [reviewError, setReviewError] = useState("");

    const loadReports = async () => {
        try {
            setLoading(true);
            setError("");

            const data = await adminPatrolApi.listSubmittedReports();

            const reportsData = Array.isArray(data)
                ? data
                : (data as any)?.data;

            setReports(reportsData || []);
        } catch (err) {
            console.error("Failed to load patrol reports:", err);
            setError("Failed to load submitted patrol reports.");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadReports();
    }, []);

    const handleViewReport = async (reportId: string) => {
        try {
            setDetailLoading(true);
            setError("");
            setReviewMessage("");
            setReviewError("");

            const response = await adminPatrolApi.getSubmittedReport(reportId);

            const reportData = Array.isArray(response)
                ? response[0]
                : (response as any)?.data ?? response;

            setSelectedReport(reportData);

            // Load existing review information
            setReviewStatus(
                reportData?.review_status || "PENDING"
            );

            setReviewComment(
                reportData?.review_comment || ""
            );
        } catch (err) {
            console.error("Failed to load patrol report:", err);
            setError("Failed to load patrol report details.");
        } finally {
            setDetailLoading(false);
        }
    };

    // ============================================================
    // SAVE REVIEW
    // ============================================================

    const handleSaveReview = async () => {
        if (!selectedReport) {
            return;
        }

        try {
            setReviewSaving(true);
            setReviewMessage("");
            setReviewError("");

            const response = await adminPatrolApi.reviewReport(
                selectedReport.id,
                {
                    review_status: reviewStatus,
                    review_comment: reviewComment.trim() || null,
                }
            );

            const responseData =
                (response as any)?.data ?? response;

            // Update selected report immediately
            setSelectedReport((current) =>
                current
                    ? {
                        ...current,
                        review_status:
                            responseData.review_status ||
                            reviewStatus,
                        review_comment:
                            responseData.review_comment ??
                            (reviewComment.trim() || null),
                        reviewed_by:
                            responseData.reviewed_by ??
                            current.reviewed_by ??
                            null,
                        reviewed_at:
                            responseData.reviewed_at ??
                            current.reviewed_at ??
                            null,
                    }
                    : current
            );

            setReviewMessage("Review saved successfully.");
        } catch (err) {
            console.error("Failed to save patrol report review:", err);
            setReviewError(
                "Failed to save review. Please try again."
            );
        } finally {
            setReviewSaving(false);
        }
    };

    if (selectedReport) {
        return (
            <div className="min-h-screen bg-gray-50 p-6">
                <div className="mx-auto max-w-5xl">
                    <button
                        type="button"
                        onClick={() => {
                            setSelectedReport(null);
                            setReviewMessage("");
                            setReviewError("");
                        }}
                        className="mb-6 inline-flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-gray-900"
                    >
                        <ArrowLeft className="h-4 w-4" />
                        Back to Submitted Reports
                    </button>

                    <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
                        {/* Header */}
                        <div className="border-b bg-gray-50 px-6 py-5">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                <div>
                                    <h1 className="text-2xl font-bold text-gray-900">
                                        Patrol Report
                                    </h1>

                                    <p className="mt-1 text-sm text-gray-500">
                                        Report ID: {selectedReport.id}
                                    </p>
                                </div>

                                <span className="inline-flex w-fit rounded-full bg-yellow-100 px-3 py-1 text-xs font-semibold text-yellow-800">
                                    {selectedReport.status}
                                </span>
                            </div>
                        </div>

                        {/* Officer Information */}
                        <div className="border-b px-6 py-6">
                            <h2 className="mb-4 text-lg font-semibold text-gray-900">
                                Officer Information
                            </h2>

                            <div className="grid gap-4 sm:grid-cols-2">
                                <div>
                                    <p className="text-xs font-medium uppercase text-gray-500">
                                        Officer Name
                                    </p>

                                    <p className="mt-1 text-sm text-gray-900">
                                        {selectedReport.officer_name || "-"}
                                    </p>
                                </div>

                                <div>
                                    <p className="text-xs font-medium uppercase text-gray-500">
                                        Email
                                    </p>

                                    <p className="mt-1 text-sm text-gray-900">
                                        {selectedReport.officer_email || "-"}
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Patrol Information */}
                        <div className="border-b px-6 py-6">
                            <h2 className="mb-4 text-lg font-semibold text-gray-900">
                                Patrol Information
                            </h2>

                            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                                <div>
                                    <p className="text-xs font-medium uppercase text-gray-500">
                                        Patrol Date
                                    </p>

                                    <p className="mt-1 text-sm text-gray-900">
                                        {selectedReport.patrol_date || "-"}
                                    </p>
                                </div>

                                <div>
                                    <p className="text-xs font-medium uppercase text-gray-500">
                                        Start Time
                                    </p>

                                    <p className="mt-1 text-sm text-gray-900">
                                        {selectedReport.start_time || "-"}
                                    </p>
                                </div>

                                <div>
                                    <p className="text-xs font-medium uppercase text-gray-500">
                                        End Time
                                    </p>

                                    <p className="mt-1 text-sm text-gray-900">
                                        {selectedReport.end_time || "-"}
                                    </p>
                                </div>

                                <div>
                                    <p className="text-xs font-medium uppercase text-gray-500">
                                        Location
                                    </p>

                                    <p className="mt-1 text-sm text-gray-900">
                                        {selectedReport.location || "-"}
                                    </p>
                                </div>

                                <div>
                                    <p className="text-xs font-medium uppercase text-gray-500">
                                        Beat
                                    </p>

                                    <p className="mt-1 text-sm text-gray-900">
                                        {selectedReport.beat || "-"}
                                    </p>
                                </div>

                                <div>
                                    <p className="text-xs font-medium uppercase text-gray-500">
                                        Division
                                    </p>

                                    <p className="mt-1 text-sm text-gray-900">
                                        {selectedReport.division || "-"}
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Team Members */}
                        <div className="border-b px-6 py-6">
                            <h2 className="mb-4 text-lg font-semibold text-gray-900">
                                Team Members
                            </h2>

                            {selectedReport.team_members?.length ? (
                                <div className="flex flex-wrap gap-2">
                                    {selectedReport.team_members.map(
                                        (member, index) => (
                                            <span
                                                key={`${member}-${index}`}
                                                className="rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-800"
                                            >
                                                {member}
                                            </span>
                                        )
                                    )}
                                </div>
                            ) : (
                                <p className="text-sm text-gray-500">-</p>
                            )}
                        </div>

                        {/* Patrol Details */}
                        <div className="border-b px-6 py-6">
                            <h2 className="mb-4 text-lg font-semibold text-gray-900">
                                Patrol Details
                            </h2>

                            <div className="space-y-5">
                                <div>
                                    <p className="text-xs font-medium uppercase text-gray-500">
                                        Purpose
                                    </p>

                                    <p className="mt-1 whitespace-pre-wrap text-sm text-gray-900">
                                        {selectedReport.purpose || "-"}
                                    </p>
                                </div>

                                <div>
                                    <p className="text-xs font-medium uppercase text-gray-500">
                                        Observations
                                    </p>

                                    <p className="mt-1 whitespace-pre-wrap text-sm text-gray-900">
                                        {selectedReport.observations || "-"}
                                    </p>
                                </div>

                                <div>
                                    <p className="text-xs font-medium uppercase text-gray-500">
                                        Wildlife Sighting
                                    </p>

                                    <p className="mt-1 whitespace-pre-wrap text-sm text-gray-900">
                                        {selectedReport.wildlife_sighting || "-"}
                                    </p>
                                </div>

                                <div>
                                    <p className="text-xs font-medium uppercase text-gray-500">
                                        Illegal Activity
                                    </p>

                                    <p className="mt-1 whitespace-pre-wrap text-sm text-gray-900">
                                        {selectedReport.illegal_activity || "-"}
                                    </p>
                                </div>

                                <div>
                                    <p className="text-xs font-medium uppercase text-gray-500">
                                        Action Taken
                                    </p>

                                    <p className="mt-1 whitespace-pre-wrap text-sm text-gray-900">
                                        {selectedReport.action_taken || "-"}
                                    </p>
                                </div>

                                <div>
                                    <p className="text-xs font-medium uppercase text-gray-500">
                                        Incident Details
                                    </p>

                                    <p className="mt-1 whitespace-pre-wrap text-sm text-gray-900">
                                        {selectedReport.incident_details || "-"}
                                    </p>
                                </div>

                                <div>
                                    <p className="text-xs font-medium uppercase text-gray-500">
                                        Additional Remarks
                                    </p>

                                    <p className="mt-1 whitespace-pre-wrap text-sm text-gray-900">
                                        {selectedReport.additional_remarks || "-"}
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* AI Information */}
                        <div className="border-b px-6 py-6">
                            <h2 className="mb-4 text-lg font-semibold text-gray-900">
                                AI Information
                            </h2>

                            <div>
                                <p className="text-xs font-medium uppercase text-gray-500">
                                    AI Confidence
                                </p>

                                <p className="mt-1 text-sm text-gray-900">
                                    {selectedReport.ai_confidence !== null &&
                                        selectedReport.ai_confidence !== undefined
                                        ? `${(
                                            selectedReport.ai_confidence * 100
                                        ).toFixed(1)}%`
                                        : "-"}
                                </p>
                            </div>
                        </div>

                        {/* Original Field Description */}
                        <div className="border-b px-6 py-6">
                            <h2 className="mb-4 text-lg font-semibold text-gray-900">
                                Original Field Description
                            </h2>

                            <div className="rounded-lg bg-gray-50 p-4">
                                <p className="whitespace-pre-wrap text-sm leading-6 text-gray-700">
                                    {selectedReport.source_text || "-"}
                                </p>
                            </div>
                        </div>

                        {/* ====================================================== */}
                        {/* REVIEW SECTION */}
                        {/* ====================================================== */}

                        <div className="border-b px-6 py-6">
                            <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                <div>
                                    <h2 className="text-lg font-semibold text-gray-900">
                                        Review
                                    </h2>

                                    <p className="mt-1 text-sm text-gray-500">
                                        Review and update the status of this patrol report.
                                    </p>
                                </div>

                                <span
                                    className={`inline-flex w-fit rounded-full px-3 py-1 text-xs font-semibold ${reviewStatus === "APPROVED"
                                        ? "bg-green-100 text-green-800"
                                        : reviewStatus === "REJECTED"
                                            ? "bg-red-100 text-red-800"
                                            : reviewStatus === "CHANGES_REQUESTED"
                                                ? "bg-orange-100 text-orange-800"
                                                : "bg-yellow-100 text-yellow-800"
                                        }`}
                                >
                                    {reviewStatus}
                                </span>
                            </div>

                            <div className="space-y-5">
                                {/* Review Status */}
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
                                        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none focus:border-gray-500 focus:ring-1 focus:ring-gray-500"
                                    >
                                        <option value="PENDING">
                                            Pending
                                        </option>

                                        <option value="APPROVED">
                                            Approved
                                        </option>

                                        <option value="REJECTED">
                                            Rejected
                                        </option>

                                        <option value="CHANGES_REQUESTED">
                                            Changes Requested
                                        </option>
                                    </select>
                                </div>

                                {/* Review Comment */}
                                <div>
                                    <label
                                        htmlFor="review-comment"
                                        className="mb-2 block text-sm font-medium text-gray-700"
                                    >
                                        Review Comment
                                    </label>

                                    <textarea
                                        id="review-comment"
                                        value={reviewComment}
                                        onChange={(event) =>
                                            setReviewComment(event.target.value)
                                        }
                                        disabled={reviewSaving}
                                        rows={4}
                                        placeholder="Add review comments..."
                                        className="w-full resize-y rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-gray-500 focus:ring-1 focus:ring-gray-500"
                                    />
                                </div>

                                {/* Existing Review Metadata */}
                                {(selectedReport.reviewed_by ||
                                    selectedReport.reviewed_at) && (
                                        <div className="rounded-lg bg-gray-50 p-4">
                                            <p className="text-xs font-medium uppercase text-gray-500">
                                                Last Reviewed
                                            </p>

                                            <div className="mt-2 space-y-1 text-sm text-gray-700">
                                                {selectedReport.reviewed_by && (
                                                    <p>
                                                        Reviewer ID:{" "}
                                                        {selectedReport.reviewed_by}
                                                    </p>
                                                )}

                                                {selectedReport.reviewed_at && (
                                                    <p>
                                                        Reviewed At:{" "}
                                                        {new Date(
                                                            selectedReport.reviewed_at
                                                        ).toLocaleString()}
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                    )}

                                {/* Success Message */}
                                {reviewMessage && (
                                    <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700">
                                        {reviewMessage}
                                    </div>
                                )}

                                {/* Error Message */}
                                {reviewError && (
                                    <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                                        {reviewError}
                                    </div>
                                )}

                                {/* Save Button */}
                                <div className="flex justify-end">
                                    <button
                                        type="button"
                                        onClick={handleSaveReview}
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
                        </div>

                        {/* Metadata */}
                        <div className="px-6 py-6">
                            <h2 className="mb-4 text-lg font-semibold text-gray-900">
                                Report Metadata
                            </h2>

                            <div className="grid gap-4 sm:grid-cols-2">
                                <div>
                                    <p className="text-xs font-medium uppercase text-gray-500">
                                        Created At
                                    </p>

                                    <p className="mt-1 text-sm text-gray-900">
                                        {selectedReport.created_at
                                            ? new Date(
                                                selectedReport.created_at
                                            ).toLocaleString()
                                            : "-"}
                                    </p>
                                </div>

                                <div>
                                    <p className="text-xs font-medium uppercase text-gray-500">
                                        Updated At
                                    </p>

                                    <p className="mt-1 text-sm text-gray-900">
                                        {selectedReport.updated_at
                                            ? new Date(
                                                selectedReport.updated_at
                                            ).toLocaleString()
                                            : "-"}
                                    </p>
                                </div>

                                <div>
                                    <p className="text-xs font-medium uppercase text-gray-500">
                                        Submitted At
                                    </p>

                                    <p className="mt-1 text-sm text-gray-900">
                                        {selectedReport.submitted_at
                                            ? new Date(
                                                selectedReport.submitted_at
                                            ).toLocaleString()
                                            : "-"}
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50 p-6">
            <div className="mx-auto max-w-7xl">
                <div className="mb-6 flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">
                            Submitted Patrol Reports
                        </h1>

                        <p className="mt-1 text-sm text-gray-500">
                            Review patrol reports submitted by field officers.
                        </p>
                    </div>

                    <button
                        onClick={loadReports}
                        disabled={loading}
                        className="flex items-center gap-2 rounded-lg border bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    >
                        <RefreshCw
                            className={`h-4 w-4 ${loading ? "animate-spin" : ""
                                }`}
                        />

                        Refresh
                    </button>
                </div>

                {error && !selectedReport && (
                    <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-600">
                        {error}
                    </div>
                )}

                <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
                    {loading ? (
                        <div className="p-8 text-center text-sm text-gray-500">
                            Loading submitted reports...
                        </div>
                    ) : reports.length === 0 ? (
                        <div className="p-8 text-center text-sm text-gray-500">
                            No submitted patrol reports found.
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-sm">
                                <thead className="border-b bg-gray-50">
                                    <tr>
                                        <th className="px-6 py-4 font-semibold text-gray-700">
                                            Officer
                                        </th>

                                        <th className="px-6 py-4 font-semibold text-gray-700">
                                            Patrol Date
                                        </th>

                                        <th className="px-6 py-4 font-semibold text-gray-700">
                                            Beat
                                        </th>

                                        <th className="px-6 py-4 font-semibold text-gray-700">
                                            Division
                                        </th>

                                        <th className="px-6 py-4 font-semibold text-gray-700">
                                            Status
                                        </th>

                                        <th className="px-6 py-4 font-semibold text-gray-700">
                                            Review Status
                                        </th>

                                        <th className="px-6 py-4 font-semibold text-gray-700">
                                            Submitted At
                                        </th>

                                        <th className="px-6 py-4 text-right font-semibold text-gray-700">
                                            Action
                                        </th>
                                    </tr>
                                </thead>

                                <tbody className="divide-y">
                                    {reports.map((report) => (
                                        <tr
                                            key={report.id}
                                            className="hover:bg-gray-50"
                                        >
                                            <td className="px-6 py-4">
                                                <div className="font-medium text-gray-900">
                                                    {report.officer_name}
                                                </div>

                                                <div className="text-xs text-gray-500">
                                                    {report.officer_email}
                                                </div>
                                            </td>

                                            <td className="px-6 py-4 text-gray-700">
                                                {report.patrol_date || "-"}
                                            </td>

                                            <td className="px-6 py-4 text-gray-700">
                                                {report.beat || "-"}
                                            </td>

                                            <td className="px-6 py-4 text-gray-700">
                                                {report.division || "-"}
                                            </td>

                                            {/* Submission Status */}
                                            <td className="px-6 py-4">
                                                <span className="inline-flex rounded-full bg-yellow-100 px-3 py-1 text-xs font-medium text-yellow-800">
                                                    {report.status}
                                                </span>
                                            </td>

                                            {/* Review Status */}
                                            <td className="px-6 py-4">
                                                <span
                                                    className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${report.review_status === "APPROVED"
                                                            ? "bg-green-100 text-green-800"
                                                            : report.review_status === "REJECTED"
                                                                ? "bg-red-100 text-red-800"
                                                                : report.review_status ===
                                                                    "CHANGES_REQUESTED"
                                                                    ? "bg-orange-100 text-orange-800"
                                                                    : "bg-yellow-100 text-yellow-800"
                                                        }`}
                                                >
                                                    {report.review_status || "PENDING"}
                                                </span>
                                            </td>

                                            <td className="px-6 py-4 text-gray-600">
                                                {report.submitted_at
                                                    ? new Date(
                                                        report.submitted_at
                                                    ).toLocaleString()
                                                    : "-"}
                                            </td>

                                            <td className="px-6 py-4 text-right">
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        handleViewReport(report.id)
                                                    }
                                                    disabled={detailLoading}
                                                    className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                                                >
                                                    <Eye className="h-4 w-4" />

                                                    {detailLoading
                                                        ? "Loading..."
                                                        : "View"}
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
        </div>
    );
}