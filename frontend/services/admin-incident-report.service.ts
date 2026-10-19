import { apiRequest } from "@/lib/api";

export const adminIncidentReportApi = {
  listSubmittedReports: () =>
    apiRequest<any[]>(
      "/api/v1/admin/users/field/incident-reports",
    ),

  getSubmittedReport: (incidentId: string) =>
    apiRequest<any>(
      `/api/v1/admin/users/field/incident-reports/${incidentId}`,
    ),

  reviewReport: (
    incidentId: string,
    payload: {
      review_status:
        | "PENDING"
        | "APPROVED"
        | "REJECTED"
        | "CHANGES_REQUESTED";
      review_comment?: string | null;
    },
  ) =>
    apiRequest<any>(
      `/api/v1/admin/users/field/incident-reports/${incidentId}/review`,
      {
        method: "PATCH",
        body: JSON.stringify(payload),
      },
    ),
};