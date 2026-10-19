import { apiRequest } from "@/lib/api";

export const adminOffenceSeizureApi = {
  listSubmittedReports: () =>
    apiRequest<any[]>("/api/v1/admin/users/field/offence-seizure-reports"),

  getSubmittedReport: (reportId: string) =>
    apiRequest<any>(
      `/api/v1/admin/users/field/offence-seizure-reports/${reportId}`
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
      `/api/v1/admin/users/field/offence-seizure-reports/${reportId}/review`,
      {
        method: "PATCH",
        body: JSON.stringify(payload),
      }
    ),

  listEvidence: (reportId: string) =>
    apiRequest<{
      success: boolean;
      report_id: string;
      count: number;
      evidence: {
        id: string;
        file_name: string;
        file_type: string;
        file_size: number;
        mime_type: string;
        description: string | null;
        uploaded_at: string | null;
      }[];
    }>(
      `/api/v1/admin/users/field/offence-seizure-reports/${reportId}/evidence`
    ),
};
