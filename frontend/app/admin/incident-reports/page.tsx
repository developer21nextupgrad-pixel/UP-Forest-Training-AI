"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Eye,
  RefreshCw,
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
  incident_type?: string | null;
  location?: string | null;
  division?: string | null;
  range_name?: string | null;
  beat?: string | null;

  status: string;
  submitted_at?: string | null;

  review_status?: ReviewStatus | null;
  review_comment?: string | null;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
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

export default function AdminIncidentReportsPage() {
  const router = useRouter();

  const [reports, setReports] = useState<IncidentReport[]>([]);
  const [loading, setLoading] = useState(true);

  const loadReports = async () => {
    try {
      setLoading(true);

      const response =
        await adminIncidentReportApi.listSubmittedReports();

      if (!response.success) {
        throw new Error("Unable to load incident reports.");
      }

      setReports(response.data ?? []);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to load incident reports.";

      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReports();
  }, []);

  return (
    <div className="min-h-screen bg-background px-6 py-8">
      <div className="mx-auto max-w-7xl">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-red-100">
                <AlertTriangle className="h-6 w-6 text-red-600" />
              </div>

              <div>
                <h1 className="text-2xl font-bold text-foreground">
                  Incident Reports
                </h1>

                <p className="mt-1 text-sm text-muted-foreground">
                  Review and manage submitted field incident reports.
                </p>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={loadReports}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw
              className={`h-4 w-4 ${
                loading ? "animate-spin" : ""
              }`}
            />
            Refresh
          </button>
        </div>

        {/* Reports */}
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : reports.length === 0 ? (
            <div className="py-16 text-center">
              <AlertTriangle className="mx-auto h-10 w-10 text-muted-foreground" />

              <h2 className="mt-4 text-lg font-semibold text-foreground">
                No Incident Reports
              </h2>

              <p className="mt-1 text-sm text-muted-foreground">
                No submitted incident reports are available for review.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border bg-muted/50">
                  <tr>
                    <th className="px-5 py-4 font-semibold text-foreground">
                      Officer
                    </th>

                    <th className="px-5 py-4 font-semibold text-foreground">
                      Incident
                    </th>

                    <th className="px-5 py-4 font-semibold text-foreground">
                      Date / Time
                    </th>

                    <th className="px-5 py-4 font-semibold text-foreground">
                      Location
                    </th>

                    <th className="px-5 py-4 font-semibold text-foreground">
                      Division
                    </th>

                    <th className="px-5 py-4 font-semibold text-foreground">
                      Review Status
                    </th>

                    <th className="px-5 py-4 text-right font-semibold text-foreground">
                      Action
                    </th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-border">
                  {reports.map((report) => (
                    <tr
                      key={report.id}
                      className="transition hover:bg-muted/30"
                    >
                      {/* Officer */}
                      <td className="px-5 py-4">
                        <div className="font-medium text-foreground">
                          {report.officer_name || "Unknown Officer"}
                        </div>

                        {report.officer_email && (
                          <div className="mt-1 text-xs text-muted-foreground">
                            {report.officer_email}
                          </div>
                        )}
                      </td>

                      {/* Incident */}
                      <td className="px-5 py-4">
                        <div className="font-medium text-foreground">
                          {report.incident_type || "Not specified"}
                        </div>

                        <div className="mt-1 text-xs text-muted-foreground">
                          {report.range_name || "Range not specified"}
                        </div>

                        {report.beat && (
                          <div className="text-xs text-muted-foreground">
                            Beat: {report.beat}
                          </div>
                        )}
                      </td>

                      {/* Date / Time */}
                      <td className="px-5 py-4">
                        <div className="text-foreground">
                          {report.incident_date
                            ? new Date(
                                `${report.incident_date}T00:00:00`,
                              ).toLocaleDateString()
                            : "—"}
                        </div>

                        {report.incident_time && (
                          <div className="mt-1 text-xs text-muted-foreground">
                            {report.incident_time}
                          </div>
                        )}
                      </td>

                      {/* Location */}
                      <td className="px-5 py-4 text-foreground">
                        {report.location || "—"}
                      </td>

                      {/* Division */}
                      <td className="px-5 py-4 text-foreground">
                        {report.division || "—"}
                      </td>

                      {/* Review */}
                      <td className="px-5 py-4">
                        <span
                          className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${getReviewClass(
                            report.review_status,
                          )}`}
                        >
                          {getReviewLabel(report.review_status)}
                        </span>
                      </td>

                      {/* Action */}
                      <td className="px-5 py-4 text-right">
                        <button
                          type="button"
                          onClick={() =>
                            router.push(
                              `/admin/incident-reports/${report.id}`,
                            )
                          }
                          className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition hover:bg-muted"
                        >
                          <Eye className="h-4 w-4" />
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
    </div>
  );
}