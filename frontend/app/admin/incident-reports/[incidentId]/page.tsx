"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  RefreshCw,
  Save,
} from "lucide-react";
import { toast } from "sonner";

import { adminIncidentReportApi } from "@/services/admin-incident-report.service";

type ReviewStatus =
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "CHANGES_REQUESTED";

type IncidentReport = {
  id: string;

  officer_id: string;
  officer_name?: string | null;
  officer_email?: string | null;

  incident_date?: string | null;
  incident_time?: string | null;
  division?: string | null;
  range_name?: string | null;
  beat?: string | null;
  location?: string | null;
  incident_type?: string | null;
  reported_by?: string | null;

  persons_involved?: string[];
  wildlife_involved?: string | null;

  incident_description?: string | null;
  immediate_action_taken?: string | null;
  authorities_informed?: string | null;
  injury_or_damage?: string | null;
  evidence_details?: string | null;
  additional_remarks?: string | null;

  source_text?: string | null;

  status: string;

  review_status?: ReviewStatus | null;
  review_comment?: string | null;
  reviewed_by?: string | null;
  reviewed_at?: string | null;

  created_at?: string | null;
  updated_at?: string | null;
  submitted_at?: string | null;
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

export default function AdminIncidentReportDetailPage() {
  const params = useParams();
  const router = useRouter();

  const incidentId = params.incidentId as string;

  const [report, setReport] = useState<IncidentReport | null>(null);

  const [loading, setLoading] = useState(true);
  const [savingReview, setSavingReview] = useState(false);

  const [reviewStatus, setReviewStatus] =
    useState<ReviewStatus>("PENDING");

  const [reviewComment, setReviewComment] = useState("");

  const loadReport = async () => {
    try {
      setLoading(true);

      const response =
        await adminIncidentReportApi.getSubmittedReport(
          incidentId,
        );

      if (!response.success) {
        throw new Error(
          "Unable to load incident report.",
        );
      }

      const data = response.data;

      setReport(data);

      setReviewStatus(
        data.review_status || "PENDING",
      );

      setReviewComment(
        data.review_comment || "",
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to load incident report.";

      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (incidentId) {
      loadReport();
    }
  }, [incidentId]);

  const handleSaveReview = async () => {
    try {
      setSavingReview(true);

      const response =
        await adminIncidentReportApi.reviewReport(
          incidentId,
          {
            review_status: reviewStatus,
            review_comment:
              reviewComment.trim() || null,
          },
        );

      if (!response.success) {
        throw new Error(
          "Unable to update incident report review.",
        );
      }

      toast.success(
        "Incident report review updated successfully.",
      );

      await loadReport();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to update incident report review.";

      toast.error(message);
    } finally {
      setSavingReview(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <RefreshCw className="h-7 w-7 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!report) {
    return (
      <div className="min-h-screen bg-background px-6 py-8">
        <div className="mx-auto max-w-5xl">
          <button
            type="button"
            onClick={() =>
              router.push("/admin/incident-reports")
            }
            className="mb-6 inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Incident Reports
          </button>

          <div className="rounded-xl border border-border bg-card p-10 text-center">
            <AlertTriangle className="mx-auto h-10 w-10 text-red-500" />

            <h2 className="mt-4 text-lg font-semibold text-foreground">
              Incident Report Not Found
            </h2>

            <p className="mt-1 text-sm text-muted-foreground">
              The requested incident report could not be found.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background px-6 py-8">
      <div className="mx-auto max-w-6xl">
        {/* Back */}
        <button
          type="button"
          onClick={() =>
            router.push("/admin/incident-reports")
          }
          className="mb-6 inline-flex items-center gap-2 text-sm font-medium text-muted-foreground transition hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Incident Reports
        </button>

        {/* Header */}
        <div className="mb-6 rounded-xl border border-border bg-card p-6 shadow-sm">
          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-red-100">
                <AlertTriangle className="h-6 w-6 text-red-600" />
              </div>

              <div>
                <h1 className="text-2xl font-bold text-foreground">
                  Incident Report
                </h1>

                <p className="mt-1 text-sm text-muted-foreground">
                  Review submitted field incident report.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span
                className={`rounded-full px-3 py-1 text-xs font-semibold ${getReviewClass(
                  report.review_status,
                )}`}
              >
                {getReviewLabel(
                  report.review_status,
                )}
              </span>

              <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-700">
                {report.status}
              </span>
            </div>
          </div>
        </div>

        {/* Officer Information */}
        <section className="mb-6 rounded-xl border border-border bg-card p-6 shadow-sm">
          <h2 className="mb-5 text-lg font-semibold text-foreground">
            Officer Information
          </h2>

          <div className="grid gap-5 md:grid-cols-2">
            <div>
              <p className="text-xs font-medium text-muted-foreground">
                Officer Name
              </p>

              <p className="mt-1 text-sm font-medium text-foreground">
                {report.officer_name || "—"}
              </p>
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground">
                Officer Email
              </p>

              <p className="mt-1 text-sm text-foreground">
                {report.officer_email || "—"}
              </p>
            </div>
          </div>
        </section>

        {/* Incident Information */}
        <section className="mb-6 rounded-xl border border-border bg-card p-6 shadow-sm">
          <h2 className="mb-5 text-lg font-semibold text-foreground">
            Incident Information
          </h2>

          <div className="grid gap-5 md:grid-cols-2">
            <div>
              <p className="text-xs font-medium text-muted-foreground">
                Incident Date
              </p>

              <p className="mt-1 text-sm text-foreground">
                {report.incident_date
                  ? new Date(
                      `${report.incident_date}T00:00:00`,
                    ).toLocaleDateString()
                  : "—"}
              </p>
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground">
                Incident Time
              </p>

              <p className="mt-1 text-sm text-foreground">
                {report.incident_time || "—"}
              </p>
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground">
                Incident Type
              </p>

              <p className="mt-1 text-sm font-medium text-foreground">
                {report.incident_type || "—"}
              </p>
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground">
                Reported By
              </p>

              <p className="mt-1 text-sm text-foreground">
                {report.reported_by || "—"}
              </p>
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground">
                Division
              </p>

              <p className="mt-1 text-sm text-foreground">
                {report.division || "—"}
              </p>
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground">
                Range
              </p>

              <p className="mt-1 text-sm text-foreground">
                {report.range_name || "—"}
              </p>
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground">
                Beat
              </p>

              <p className="mt-1 text-sm text-foreground">
                {report.beat || "—"}
              </p>
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground">
                Location
              </p>

              <p className="mt-1 text-sm text-foreground">
                {report.location || "—"}
              </p>
            </div>
          </div>
        </section>

        {/* People / Wildlife */}
        <section className="mb-6 rounded-xl border border-border bg-card p-6 shadow-sm">
          <h2 className="mb-5 text-lg font-semibold text-foreground">
            People & Wildlife
          </h2>

          <div className="space-y-5">
            <div>
              <p className="text-xs font-medium text-muted-foreground">
                Persons Involved
              </p>

              {report.persons_involved &&
              report.persons_involved.length > 0 ? (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-foreground">
                  {report.persons_involved.map(
                    (person, index) => (
                      <li key={index}>{person}</li>
                    ),
                  )}
                </ul>
              ) : (
                <p className="mt-1 text-sm text-muted-foreground">
                  No persons specified.
                </p>
              )}
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground">
                Wildlife Involved
              </p>

              <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">
                {report.wildlife_involved || "—"}
              </p>
            </div>
          </div>
        </section>

        {/* Description */}
        <section className="mb-6 rounded-xl border border-border bg-card p-6 shadow-sm">
          <h2 className="mb-5 text-lg font-semibold text-foreground">
            Incident Details
          </h2>

          <div className="space-y-5">
            <div>
              <p className="text-xs font-medium text-muted-foreground">
                Incident Description
              </p>

              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground">
                {report.incident_description || "—"}
              </p>
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground">
                Immediate Action Taken
              </p>

              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground">
                {report.immediate_action_taken || "—"}
              </p>
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground">
                Authorities Informed
              </p>

              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground">
                {report.authorities_informed || "—"}
              </p>
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground">
                Injury / Damage
              </p>

              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground">
                {report.injury_or_damage || "—"}
              </p>
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground">
                Evidence Details
              </p>

              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground">
                {report.evidence_details || "—"}
              </p>
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground">
                Additional Remarks
              </p>

              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground">
                {report.additional_remarks || "—"}
              </p>
            </div>
          </div>
        </section>

        {/* Original Source */}
        {report.source_text && (
          <section className="mb-6 rounded-xl border border-border bg-card p-6 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold text-foreground">
              Original Officer Description
            </h2>

            <div className="rounded-lg bg-muted/50 p-4">
              <p className="whitespace-pre-wrap text-sm leading-6 text-foreground">
                {report.source_text}
              </p>
            </div>
          </section>
        )}

        {/* Review */}
        <section className="mb-6 rounded-xl border border-border bg-card p-6 shadow-sm">
          <div className="mb-5 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-100">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
            </div>

            <div>
              <h2 className="text-lg font-semibold text-foreground">
                Admin Review
              </h2>

              <p className="text-sm text-muted-foreground">
                Review this incident report and provide feedback to the field officer.
              </p>
            </div>
          </div>

          <div className="space-y-5">
            {/* Review Status */}
            <div>
              <label
                htmlFor="review-status"
                className="mb-2 block text-sm font-medium text-foreground"
              >
                Review Status
              </label>

              <select
                id="review-status"
                value={reviewStatus}
                onChange={(event) =>
                  setReviewStatus(
                    event.target.value as ReviewStatus,
                  )
                }
                className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none transition focus:border-green-600 focus:ring-2 focus:ring-green-600/20"
              >
                <option value="PENDING">
                  Pending Review
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

            {/* Comment */}
            <div>
              <label
                htmlFor="review-comment"
                className="mb-2 block text-sm font-medium text-foreground"
              >
                Admin Comment
              </label>

              <textarea
                id="review-comment"
                value={reviewComment}
                onChange={(event) =>
                  setReviewComment(event.target.value)
                }
                rows={5}
                placeholder="Add review comments or instructions for the field officer..."
                className="w-full rounded-lg border border-border bg-background px-3 py-3 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-green-600 focus:ring-2 focus:ring-green-600/20"
              />
            </div>

            {/* Save */}
            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleSaveReview}
                disabled={savingReview}
                className="inline-flex items-center gap-2 rounded-lg bg-green-700 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-green-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {savingReview ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}

                {savingReview
                  ? "Saving..."
                  : "Save Review"}
              </button>
            </div>
          </div>
        </section>

        {/* Existing Review Metadata */}
        {report.reviewed_at && (
          <section className="rounded-xl border border-border bg-card p-6 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold text-foreground">
              Review History
            </h2>

            <div className="grid gap-5 md:grid-cols-2">
              <div>
                <p className="text-xs font-medium text-muted-foreground">
                  Reviewed By
                </p>

                <p className="mt-1 text-sm text-foreground">
                  {report.reviewed_by || "—"}
                </p>
              </div>

              <div>
                <p className="text-xs font-medium text-muted-foreground">
                  Reviewed At
                </p>

                <p className="mt-1 text-sm text-foreground">
                  {new Date(
                    report.reviewed_at,
                  ).toLocaleString()}
                </p>
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}