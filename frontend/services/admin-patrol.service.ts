import { apiRequest } from "@/lib/api";

export const adminPatrolApi = {
  listSubmittedReports: () =>
    apiRequest<any[]>("/api/v1/admin/users/field/patrol-reports"),

  getSubmittedReport: (reportId: string) =>
    apiRequest<any>(
      `/api/v1/admin/users/field/patrol-reports/${reportId}`
    ),

  reviewReport: (
    reportId: string,
    payload: {
      review_status:
        | "PENDING"
        | "APPROVED"
        | "REJECTED"
        | "CHANGES_REQUESTED";
      review_comment?: string | null;
    }
  ) =>
    apiRequest<any>(
      `/api/v1/admin/users/field/patrol-reports/${reportId}/review`,
      {
        method: "PATCH",
        body: JSON.stringify(payload),
      }
    ),
};