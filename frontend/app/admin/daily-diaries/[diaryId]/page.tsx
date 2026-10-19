"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  FileText,
  RefreshCw,
} from "lucide-react";

import { adminDailyDiaryApi } from "@/services/admin-daily-diary.service";

type ReviewStatus =
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "CHANGES_REQUESTED";

type DailyDiary = {
  id: string;
  officer_id: string;
  officer_name: string;
  officer_email: string;
  diary_date: string | null;
  subject: string | null;
  description: string | null;
  location: string | null;
  activities: string[];
  observations: string | null;
  additional_remarks: string | null;
  source_text: string | null;
  status: string;
  review_status: ReviewStatus | null;
  review_comment: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  submitted_at: string | null;
};

export default function AdminDailyDiaryDetailPage() {
  const router = useRouter();
  const params = useParams();

  const diaryId = params.diaryId as string;

  const [diary, setDiary] = useState<DailyDiary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Review state
  const [reviewStatus, setReviewStatus] =
    useState<ReviewStatus>("PENDING");

  const [reviewComment, setReviewComment] = useState("");
  const [savingReview, setSavingReview] = useState(false);

  const loadDiary = async () => {
    try {
      setLoading(true);
      setError("");

      const response =
        await adminDailyDiaryApi.getSubmittedDiary(diaryId);

      if ("data" in response) {
        setDiary(response.data);

        setReviewStatus(
          response.data.review_status || "PENDING"
        );

        setReviewComment(
          response.data.review_comment || ""
        );
      } else {
        throw new Error("Unable to load daily diary.");
      }
    } catch (err) {
      console.error("Failed to load daily diary:", err);
      setError("Failed to load daily diary.");
    } finally {
      setLoading(false);
    }
  };

  const handleSaveReview = async () => {
    if (!diary) return;

    try {
      setSavingReview(true);
      setError("");

      const response =
        await adminDailyDiaryApi.reviewDiary(
          diary.id,
          {
            review_status: reviewStatus,
            review_comment:
              reviewComment.trim() || null,
          }
        );

      if (!("data" in response)) {
        throw new Error("Unable to update review.");
      }

      setDiary((current) =>
        current
          ? {
              ...current,
              review_status:
                response.data.review_status,
              review_comment:
                response.data.review_comment,
              reviewed_by:
                response.data.reviewed_by,
              reviewed_at:
                response.data.reviewed_at,
            }
          : current
      );

      // Keep local form values in sync
      setReviewStatus(
        response.data.review_status || "PENDING"
      );

      setReviewComment(
        response.data.review_comment || ""
      );
    } catch (err) {
      console.error(
        "Failed to update diary review:",
        err
      );

      setError(
        "Unable to update daily diary review."
      );
    } finally {
      setSavingReview(false);
    }
  };

  useEffect(() => {
    if (diaryId) {
      void loadDiary();
    }
  }, [diaryId]);

  if (loading) {
    return (
      <div className="mx-auto max-w-[1100px] px-4 py-10 sm:px-6 lg:px-8">
        <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">
          <RefreshCw className="mr-2 size-4 animate-spin" />
          Loading daily diary...
        </div>
      </div>
    );
  }

  if (error || !diary) {
    return (
      <div className="mx-auto max-w-[1100px] px-4 py-10 sm:px-6 lg:px-8">
        <div className="rounded-2xl border border-red-200 bg-red-50 p-10 text-center">
          <p className="font-semibold text-red-700">
            Unable to load daily diary
          </p>

          <p className="mt-2 text-sm text-red-600">
            {error || "Daily diary not found."}
          </p>

          <button
            type="button"
            onClick={() => void loadDiary()}
            className="mt-5 inline-flex items-center gap-2 rounded-xl bg-[#08744f] px-4 py-2.5 text-sm font-semibold text-white"
          >
            <RefreshCw className="size-4" />
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1100px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">

      {/* Header */}
      <div className="mb-7">
        <button
          type="button"
          onClick={() =>
            router.push("/admin/daily-diaries")
          }
          className="mb-5 inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back to Daily Diaries
        </button>

        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-[#08744f]">
              Administration
            </p>

            <h1 className="mt-1 text-3xl font-bold tracking-tight">
              Daily Diary Details
            </h1>

            <p className="mt-2 text-sm text-muted-foreground">
              Review the daily diary submitted by the field officer.
            </p>
          </div>

          <span
            className={`inline-flex rounded-full px-3 py-1.5 text-xs font-semibold ${
              reviewStatus === "APPROVED"
                ? "bg-green-50 text-green-700"
                : reviewStatus === "REJECTED"
                  ? "bg-red-50 text-red-700"
                  : reviewStatus === "CHANGES_REQUESTED"
                    ? "bg-orange-50 text-orange-700"
                    : "bg-amber-50 text-amber-700"
            }`}
          >
            {reviewStatus}
          </span>
        </div>
      </div>

      {/* Officer Information */}
      <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="mb-5 flex items-center gap-2">
          <FileText className="size-5 text-[#08744f]" />

          <h2 className="text-lg font-semibold">
            Officer Information
          </h2>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs text-muted-foreground">
              Officer Name
            </p>

            <p className="mt-1 font-medium">
              {diary.officer_name || "—"}
            </p>
          </div>

          <div>
            <p className="text-xs text-muted-foreground">
              Email
            </p>

            <p className="mt-1 font-medium">
              {diary.officer_email || "—"}
            </p>
          </div>
        </div>
      </section>

      {/* Diary Information */}
      <section className="mt-5 rounded-2xl border border-border bg-card p-5 shadow-sm">
        <h2 className="mb-5 text-lg font-semibold">
          Diary Information
        </h2>

        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <p className="text-xs text-muted-foreground">
              Diary Date
            </p>

            <p className="mt-1 font-medium">
              {diary.diary_date || "—"}
            </p>
          </div>

          <div>
            <p className="text-xs text-muted-foreground">
              Location
            </p>

            <p className="mt-1 font-medium">
              {diary.location || "—"}
            </p>
          </div>

          <div className="sm:col-span-2">
            <p className="text-xs text-muted-foreground">
              Subject
            </p>

            <p className="mt-1 font-medium">
              {diary.subject || "—"}
            </p>
          </div>

          <div className="sm:col-span-2">
            <p className="text-xs text-muted-foreground">
              Description
            </p>

            <p className="mt-1 whitespace-pre-wrap text-sm leading-6">
              {diary.description || "—"}
            </p>
          </div>
        </div>
      </section>

      {/* Activities */}
      <section className="mt-5 rounded-2xl border border-border bg-card p-5 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold">
          Activities
        </h2>

        {diary.activities?.length ? (
          <ul className="space-y-2">
            {diary.activities.map(
              (activity, index) => (
                <li
                  key={`${activity}-${index}`}
                  className="rounded-xl border border-border bg-muted/30 px-4 py-3 text-sm"
                >
                  {activity}
                </li>
              )
            )}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            No activities recorded.
          </p>
        )}
      </section>

      {/* Observations */}
      <section className="mt-5 rounded-2xl border border-border bg-card p-5 shadow-sm">
        <h2 className="mb-5 text-lg font-semibold">
          Observations & Remarks
        </h2>

        <div className="space-y-5">
          <div>
            <p className="text-xs text-muted-foreground">
              Observations
            </p>

            <p className="mt-1 whitespace-pre-wrap text-sm leading-6">
              {diary.observations || "—"}
            </p>
          </div>

          <div>
            <p className="text-xs text-muted-foreground">
              Additional Remarks
            </p>

            <p className="mt-1 whitespace-pre-wrap text-sm leading-6">
              {diary.additional_remarks || "—"}
            </p>
          </div>
        </div>
      </section>

      {/* Review Information */}
      <section className="mt-5 rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="mb-5 flex items-center gap-2">
          <CheckCircle2 className="size-5 text-[#08744f]" />

          <h2 className="text-lg font-semibold">
            Review Information
          </h2>
        </div>

        <div className="space-y-5">

          {/* Review Status */}
          <div>
            <label className="mb-2 block text-sm font-medium">
              Review Status
            </label>

            <select
              value={reviewStatus}
              onChange={(e) =>
                setReviewStatus(
                  e.target.value as ReviewStatus
                )
              }
              disabled={savingReview}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none focus:border-green-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <option value="PENDING">
                PENDING
              </option>

              <option value="APPROVED">
                APPROVED
              </option>

              <option value="REJECTED">
                REJECTED
              </option>

              <option value="CHANGES_REQUESTED">
                CHANGES REQUESTED
              </option>
            </select>
          </div>

          {/* Admin Comment */}
          <div>
            <label className="mb-2 block text-sm font-medium">
              Admin Comment
            </label>

            <textarea
              value={reviewComment}
              onChange={(e) =>
                setReviewComment(e.target.value)
              }
              rows={4}
              disabled={savingReview}
              placeholder="Enter review comment..."
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-green-500 disabled:cursor-not-allowed disabled:opacity-60"
            />
          </div>

          {/* Save Review */}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() =>
                void handleSaveReview()
              }
              disabled={savingReview}
              className="inline-flex items-center gap-2 rounded-xl bg-[#08744f] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#065c3f] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {savingReview && (
                <RefreshCw className="size-4 animate-spin" />
              )}

              {savingReview
                ? "Saving..."
                : "Save Review"}
            </button>
          </div>

          {/* Error */}
          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {/* Existing Review Metadata */}
          <div className="grid gap-4 border-t border-border pt-5 sm:grid-cols-2">
            <div>
              <p className="text-xs text-muted-foreground">
                Reviewed By
              </p>

              <p className="mt-1 text-sm">
                {diary.reviewed_by ||
                  "Not reviewed yet"}
              </p>
            </div>

            <div>
              <p className="text-xs text-muted-foreground">
                Reviewed At
              </p>

              <p className="mt-1 text-sm">
                {diary.reviewed_at
                  ? new Date(
                      diary.reviewed_at
                    ).toLocaleString()
                  : "Not reviewed yet"}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Metadata */}
      <section className="mt-5 rounded-2xl border border-border bg-card p-5 shadow-sm">
        <h2 className="mb-5 text-lg font-semibold">
          Report Metadata
        </h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs text-muted-foreground">
              Status
            </p>

            <p className="mt-1 text-sm font-medium">
              {diary.status}
            </p>
          </div>

          <div>
            <p className="text-xs text-muted-foreground">
              Submitted At
            </p>

            <p className="mt-1 text-sm">
              {diary.submitted_at
                ? new Date(
                    diary.submitted_at
                  ).toLocaleString()
                : "—"}
            </p>
          </div>

          <div>
            <p className="text-xs text-muted-foreground">
              Created At
            </p>

            <p className="mt-1 text-sm">
              {diary.created_at
                ? new Date(
                    diary.created_at
                  ).toLocaleString()
                : "—"}
            </p>
          </div>

          <div>
            <p className="text-xs text-muted-foreground">
              Updated At
            </p>

            <p className="mt-1 text-sm">
              {diary.updated_at
                ? new Date(
                    diary.updated_at
                  ).toLocaleString()
                : "—"}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}