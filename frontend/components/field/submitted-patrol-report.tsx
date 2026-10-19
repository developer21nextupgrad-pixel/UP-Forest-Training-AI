"use client";

import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  Clock3,
  FileText,
  MapPin,
  Printer,
  Users,
} from "lucide-react";

type SubmittedPatrolReport = {
  report_id: string;
  form_type: string;
  status: string;

  review_status?:
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "CHANGES_REQUESTED";
  review_comment?: string | null;
  reviewed_by?: string | null;
  reviewed_at?: string | null;

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
  submitted_at?: string | null;
};

type Props = {
  report: SubmittedPatrolReport;
  onClose?: () => void;
};

function formatDate(value: string | null) {
  if (!value) return "Not available";

  const date = new Date(`${value}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatDateTime(value: string | null) {
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
}

function formatTime(value: string | null) {
  if (!value) return "--";
  return value.slice(0, 5);
}

function Field({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div className="rounded-xl border border-border bg-background/60 p-4">
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>

      <p className="text-sm font-medium text-foreground">
        {value?.trim() || "Not provided"}
      </p>
    </div>
  );
}

function LargeField({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div className="rounded-xl border border-border bg-background/60 p-4">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>

      <p className="whitespace-pre-wrap text-sm leading-6 text-foreground">
        {value?.trim() || "Not provided"}
      </p>
    </div>
  );
}

export function SubmittedPatrolReport({
  report,
  onClose,
}: Props) {
  const handlePrint = () => {
    const reportElement = document.getElementById(
      "submitted-patrol-report",
    );

    if (!reportElement) {
      return;
    }

    const printWindow = window.open(
      "",
      "_blank",
      "width=1000,height=800",
    );

    if (!printWindow) {
      alert(
        "Print window was blocked. Please allow pop-ups for this site.",
      );
      return;
    }

    const clonedReport = reportElement.cloneNode(
      true,
    ) as HTMLElement;

    // Remove buttons / interactive controls from printed copy.
    clonedReport
      .querySelectorAll(
        "[data-print-hide], button",
      )
      .forEach((element) => {
        element.remove();
      });

    // Collect the application's loaded styles so the
    // printed report keeps the same visual appearance.
    const styles = Array.from(
      document.querySelectorAll(
        'style, link[rel="stylesheet"]',
      ),
    )
      .map((element) => element.outerHTML)
      .join("\n");

    printWindow.document.open();

    printWindow.document.write(`
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8" />
        <title>Submitted Patrol Report</title>

        ${styles}

        <style>
          @page {
            size: A4;
            margin: 12mm;
          }

          html,
          body {
            margin: 0;
            padding: 0;
            background: white !important;
          }

          body {
            color: black !important;
            font-family: Arial, Helvetica, sans-serif;
          }

          #submitted-patrol-report {
            width: 100% !important;
            max-width: none !important;
            margin: 0 !important;
            padding: 0 !important;
            border: none !important;
            box-shadow: none !important;
            background: white !important;
            color: black !important;
          }

          #submitted-patrol-report * {
            color: black !important;
          }

          #submitted-patrol-report .bg-card,
          #submitted-patrol-report .bg-background,
          #submitted-patrol-report .bg-muted\\/20,
          #submitted-patrol-report .bg-muted\\/30,
          #submitted-patrol-report .bg-muted\\/40,
          #submitted-patrol-report .bg-background\\/60 {
            background: white !important;
          }

          #submitted-patrol-report .border-border {
            border-color: #d1d5db !important;
          }

          #submitted-patrol-report .print\\:hidden {
            display: none !important;
          }

          .print-only-hidden {
            display: none !important;
          }
        </style>
      </head>

      <body>
        ${clonedReport.outerHTML}
      </body>
    </html>
  `);

    printWindow.document.close();

    printWindow.focus();

    // Wait for styles/fonts/layout to settle before opening
    // the native print dialog.
    setTimeout(() => {
      printWindow.print();

      // Close automatically after printing/canceling.
      setTimeout(() => {
        printWindow.close();
      }, 500);
    }, 500);
  };
  return (


    <section id="submitted-patrol-report" className="mx-auto mb-6 w-full max-w-7xl px-4 sm:px-6 lg:px-8 print:mx-0 print:mb-0 print:w-full print:max-w-none print:px-0">
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        {/* Header */}
        <div className="flex flex-col gap-4 border-b border-border px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10">
              <FileText className="size-5 text-primary" />
            </div>

            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-bold tracking-tight">
                  Submitted Patrol Report
                </h2>

                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="size-3.5" />
                  Submitted
                </span>
              </div>

              <p className="mt-1 text-sm text-muted-foreground">
                Report ID: {report.report_id}
              </p>
            </div>
          </div>

          <div data-print-hide className="flex flex-wrap items-center gap-2 print:hidden">
            <button
              type="button"
              onClick={handlePrint}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-background px-4 py-2.5 text-sm font-medium transition hover:bg-muted"
            >
              <Printer className="size-4" />
              Print / Save PDF
            </button>

            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-background px-4 py-2.5 text-sm font-medium transition hover:bg-muted"
              >
                <ArrowLeft className="size-4" />
                Back to Reports
              </button>
            )}
          </div>
        </div>

        {/* Submission metadata */}
        <div className="grid gap-4 border-b border-border p-5 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl bg-muted/40 p-4">
            <div className="mb-2 flex items-center gap-2 text-muted-foreground">
              <CalendarDays className="size-4" />
              <span className="text-xs font-medium">
                Patrol Date
              </span>
            </div>

            <p className="text-sm font-semibold">
              {formatDate(report.patrol_date)}
            </p>
          </div>

          <div className="rounded-xl bg-muted/40 p-4">
            <div className="mb-2 flex items-center gap-2 text-muted-foreground">
              <Clock3 className="size-4" />
              <span className="text-xs font-medium">
                Patrol Time
              </span>
            </div>

            <p className="text-sm font-semibold">
              {formatTime(report.start_time)} —{" "}
              {formatTime(report.end_time)}
            </p>
          </div>

          <div className="rounded-xl bg-muted/40 p-4">
            <div className="mb-2 flex items-center gap-2 text-muted-foreground">
              <MapPin className="size-4" />
              <span className="text-xs font-medium">
                Location
              </span>
            </div>

            <p className="text-sm font-semibold">
              {report.location || "Not provided"}
            </p>
          </div>

          <div className="rounded-xl bg-muted/40 p-4">
            <div className="mb-2 flex items-center gap-2 text-muted-foreground">
              <Users className="size-4" />
              <span className="text-xs font-medium">
                Team Members
              </span>
            </div>

            <p className="text-sm font-semibold">
              {report.team_members?.length
                ? report.team_members.join(", ")
                : "Not provided"}
            </p>
          </div>
        </div>

        {/* Report content */}
        <div className="space-y-6 p-5">
          {/* Basic Information */}
          <div>
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Basic Information
            </h3>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              <Field
                label="Beat"
                value={report.beat}
              />

              <Field
                label="Range"
                value={report.range_name}
              />

              <Field
                label="Division"
                value={report.division}
              />
            </div>
          </div>

          {/* Patrol Details */}
          <div>
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Patrol Details
            </h3>

            <div className="space-y-4">
              <LargeField
                label="Purpose"
                value={report.purpose}
              />

              <LargeField
                label="Observations"
                value={report.observations}
              />

              <LargeField
                label="Wildlife Sighting"
                value={report.wildlife_sighting}
              />

              <LargeField
                label="Illegal Activity"
                value={report.illegal_activity}
              />

              <LargeField
                label="Action Taken"
                value={report.action_taken}
              />

              <LargeField
                label="Incident Details"
                value={report.incident_details}
              />

              <LargeField
                label="Additional Remarks"
                value={report.additional_remarks}
              />
            </div>
          </div>

          {/* Review Status */}
          <div>
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Review Status
            </h3>

            <div
              className={`rounded-xl border p-4 ${report.review_status === "APPROVED"
                  ? "border-green-200 bg-green-50 dark:border-green-900/40 dark:bg-green-900/10"
                  : report.review_status === "REJECTED"
                    ? "border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-900/10"
                    : report.review_status === "CHANGES_REQUESTED"
                      ? "border-orange-200 bg-orange-50 dark:border-orange-900/40 dark:bg-orange-900/10"
                      : "border-yellow-200 bg-yellow-50 dark:border-yellow-900/40 dark:bg-yellow-900/10"
                }`}
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Status
                  </p>

                  <p className="mt-1 text-base font-semibold">
                    {report.review_status || "PENDING"}
                  </p>
                </div>

                <span
                  className={`inline-flex w-fit rounded-full px-3 py-1 text-xs font-semibold ${report.review_status === "APPROVED"
                      ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
                      : report.review_status === "REJECTED"
                        ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300"
                        : report.review_status === "CHANGES_REQUESTED"
                          ? "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300"
                          : "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300"
                    }`}
                >
                  {report.review_status || "PENDING"}
                </span>
              </div>

              {report.review_comment && (
                <div className="mt-4 border-t border-black/10 pt-4 dark:border-white/10">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Admin Comment
                  </p>

                  <p className="mt-1 whitespace-pre-wrap text-sm leading-6">
                    {report.review_comment}
                  </p>
                </div>
              )}

              {report.reviewed_at && (
                <p className="mt-3 text-xs text-muted-foreground">
                  Reviewed: {formatDateTime(report.reviewed_at)}
                </p>
              )}
            </div>
          </div>

          {/* AI metadata */}
          <div>
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Report Metadata
            </h3>

            <div className="grid gap-4 md:grid-cols-2">
              <Field
                label="AI Confidence"
                value={
                  report.ai_confidence !== null &&
                    report.ai_confidence !== undefined
                    ? `${Math.round(
                      report.ai_confidence * 100,
                    )}%`
                    : null
                }
              />

              <Field
                label="Submitted At"
                value={
                  report.submitted_at
                    ? formatDateTime(
                      report.submitted_at,
                    )
                    : report.updated_at
                      ? formatDateTime(
                        report.updated_at,
                      )
                      : null
                }
              />
            </div>
          </div>

          {/* Original source */}
          {report.source_text && (
            <div>
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Original Field Description
              </h3>

              <div className="rounded-xl border border-border bg-muted/30 p-4">
                <p className="whitespace-pre-wrap text-sm leading-6 text-foreground">
                  {report.source_text}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-border bg-muted/20 px-5 py-4">
          <div className="flex flex-col gap-2 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span>
              Created: {formatDateTime(report.created_at)}
            </span>

            <span>
              Last updated: {formatDateTime(report.updated_at)}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

