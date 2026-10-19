"use client";

import {
  CalendarDays,
  CheckCircle2,
  Clock3,
  FileText,
  Loader2,
  MapPin,
  RefreshCw,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { apiRequest } from "@/lib/api";

type PatrolReport = {
  report_id: string;
  form_type: string;
  status: string;

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

  source_text: string | null;
  ai_confidence: number | null;

  created_at: string | null;
  updated_at: string | null;
  submitted_at: string | null;
};

type PatrolReportsResponse = {
  success: boolean;
  reports: PatrolReport[];
  total: number;
};

type Props = {
  onOpenDraft?: (draft: PatrolReport) => void;
  onViewSubmitted?: (report: PatrolReport) => void;
  refreshKey?: number;
};


export function PatrolDrafts({
  onOpenDraft,
  onViewSubmitted,
  refreshKey = 0,
}: Props) {
  const [reports, setReports] = useState<PatrolReport[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadReports = useCallback(async () => {
    setIsLoading(true);

    try {
      const result = await apiRequest<PatrolReportsResponse>(
        "/api/v1/field/forms/patrol",
      );

      if (!result.success) {
        throw new Error("Unable to load patrol reports.");
      }

      setReports(result.reports || []);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to load patrol reports.";

      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

 useEffect(() => {
  void loadReports();
}, [loadReports, refreshKey]);

  const draftReports = useMemo(
    () => reports.filter((report) => report.status === "DRAFT"),
    [reports],
  );

  const submittedReports = useMemo(
    () => reports.filter((report) => report.status === "SUBMITTED"),
    [reports],
  );

  const formatDate = (value: string | null) => {
    if (!value) return "Date not available";

    const date = new Date(`${value}T00:00:00`);

    if (Number.isNaN(date.getTime())) {
      return value;
    }

    return date.toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  };

  const formatTime = (value: string | null) => {
    if (!value) return "--";

    return value.slice(0, 5);
  };

  const formatUpdatedAt = (value: string | null) => {
    if (!value) return "Not available";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return value;
    }

    return date.toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const ReportCard = ({
    report,
    submitted,
  }: {
    report: PatrolReport;
    submitted: boolean;
  }) => {
    return (
      <article
        className={[
          "rounded-2xl border bg-background p-4 transition",
          submitted
            ? "border-emerald-500/30 hover:border-emerald-500/50"
            : "border-border hover:border-amber-500/40",
        ].join(" ")}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              {submitted ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              ) : (
                <FileText className="h-4 w-4 text-amber-600" />
              )}

              <h3 className="font-semibold">Patrol Report</h3>
            </div>

            <p className="mt-1 text-xs text-muted-foreground">
              ID: {report.report_id}
            </p>
          </div>

          {submitted ? (
            <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300">
              SUBMITTED
            </span>
          ) : (
            <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
              DRAFT
            </span>
          )}
        </div>

        {/* Basic details */}
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="flex items-center gap-2 text-sm">
            <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" />

            <div>
              <p className="text-xs text-muted-foreground">
                Patrol Date
              </p>

              <p className="font-medium">
                {formatDate(report.patrol_date)}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 text-sm">
            <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />

            <div>
              <p className="text-xs text-muted-foreground">
                Beat / Location
              </p>

              <p className="font-medium">
                {report.beat || "--"}
                {report.location
                  ? ` • ${report.location}`
                  : ""}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 text-sm">
            <Clock3 className="h-4 w-4 shrink-0 text-muted-foreground" />

            <div>
              <p className="text-xs text-muted-foreground">
                Patrol Time
              </p>

              <p className="font-medium">
                {formatTime(report.start_time)}
                {" → "}
                {formatTime(report.end_time)}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 text-sm">
            <Users className="h-4 w-4 shrink-0 text-muted-foreground" />

            <div>
              <p className="text-xs text-muted-foreground">
                Team Members
              </p>

              <p className="font-medium">
                {report.team_members?.length
                  ? report.team_members.join(", ")
                  : "None"}
              </p>
            </div>
          </div>
        </div>

        {/* Range / Division */}
        {(report.range_name || report.division) && (
          <div className="mt-4 rounded-xl bg-muted/50 px-3 py-2.5">
            <div className="grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <span className="text-xs text-muted-foreground">
                  Range
                </span>

                <p className="font-medium">
                  {report.range_name || "--"}
                </p>
              </div>

              <div>
                <span className="text-xs text-muted-foreground">
                  Division
                </span>

                <p className="font-medium">
                  {report.division || "--"}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Purpose */}
        {report.purpose && (
          <div className="mt-4">
            <p className="text-xs text-muted-foreground">
              Purpose
            </p>

            <p className="mt-1 text-sm">
              {report.purpose}
            </p>
          </div>
        )}

        {/* Observations */}
        {report.observations && (
          <div className="mt-3">
            <p className="text-xs text-muted-foreground">
              Observations
            </p>

            <p className="mt-1 line-clamp-2 text-sm">
              {report.observations}
            </p>
          </div>
        )}

        {/* AI confidence */}
        {!submitted && report.ai_confidence !== null && (
          <div className="mt-4">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">
                AI extraction confidence
              </span>

              <span className="font-medium">
                {Math.round(report.ai_confidence * 100)}%
              </span>
            </div>

            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-emerald-600"
                style={{
                  width: `${Math.min(
                    100,
                    Math.max(
                      0,
                      report.ai_confidence * 100,
                    ),
                  )}%`,
                }}
              />
            </div>
          </div>
        )}

        {/* Submitted info */}
        {submitted && (
          <div className="mt-4 rounded-xl bg-emerald-50 px-3 py-2.5 dark:bg-emerald-900/10">
            <p className="text-xs text-emerald-700 dark:text-emerald-300">
              This report has been submitted and is now read-only.
            </p>
          </div>
        )}

        {/* Last updated */}
        <p className="mt-4 text-xs text-muted-foreground">
          Last updated: {formatUpdatedAt(report.updated_at)}
        </p>

        {/* Action */}
        <div className="mt-4 border-t border-border pt-4">
          {submitted ? (
            <button
              type="button"
              onClick={() => onViewSubmitted?.(report)}
              disabled={!onViewSubmitted}
              className="w-full rounded-xl border border-emerald-600 px-4 py-2.5 text-sm font-medium text-emerald-700 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-emerald-400 dark:hover:bg-emerald-900/20"
            >
              View Submitted Report
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onOpenDraft?.(report)}
              disabled={!onOpenDraft}
              className="w-full rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Open Draft
            </button>
          )}
        </div>
      </article>
    );
  };

  return (
    <section className="rounded-2xl border border-border bg-card text-card-foreground shadow-sm">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-emerald-600" />

            <h2 className="text-lg font-semibold">
              Patrol Report History
            </h2>
          </div>

          <p className="mt-1 text-sm text-muted-foreground">
            Manage your draft and submitted patrol reports.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void loadReports()}
          disabled={isLoading}
          className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm font-medium text-foreground transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw
            className={[
              "h-4 w-4",
              isLoading ? "animate-spin" : "",
            ].join(" ")}
          />

          Refresh
        </button>
      </div>

      <div className="p-5">
        {/* Loading */}
        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              Loading patrol reports...
            </div>
          </div>
        )}

        {!isLoading && (
          <div className="space-y-8">
            {/* Drafts */}
            <section>
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h3 className="text-base font-semibold">
                    Draft Reports
                  </h3>

                  <p className="mt-1 text-sm text-muted-foreground">
                    Reports that can still be edited and submitted.
                  </p>
                </div>

                <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                  {draftReports.length}
                </span>
              </div>

              {draftReports.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border px-5 py-8 text-center">
                  <FileText className="mx-auto h-7 w-7 text-muted-foreground" />

                  <p className="mt-2 text-sm font-medium">
                    No draft reports
                  </p>

                  <p className="mt-1 text-sm text-muted-foreground">
                    Saved patrol drafts will appear here.
                  </p>
                </div>
              ) : (
                <div className="grid gap-4 lg:grid-cols-2">
                  {draftReports.map((report) => (
                    <ReportCard
                      key={report.report_id}
                      report={report}
                      submitted={false}
                    />
                  ))}
                </div>
              )}
            </section>

            {/* Submitted */}
            <section>
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h3 className="text-base font-semibold">
                    Submitted Reports
                  </h3>

                  <p className="mt-1 text-sm text-muted-foreground">
                    Reports that have been submitted and are read-only.
                  </p>
                </div>

                <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300">
                  {submittedReports.length}
                </span>
              </div>

              {submittedReports.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border px-5 py-8 text-center">
                  <CheckCircle2 className="mx-auto h-7 w-7 text-muted-foreground" />

                  <p className="mt-2 text-sm font-medium">
                    No submitted reports
                  </p>

                  <p className="mt-1 text-sm text-muted-foreground">
                    Submitted patrol reports will appear here.
                  </p>
                </div>
              ) : (
                <div className="grid gap-4 lg:grid-cols-2">
                  {submittedReports.map((report) => (
                    <ReportCard
                      key={report.report_id}
                      report={report}
                      submitted
                    />
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </section>
  );
}