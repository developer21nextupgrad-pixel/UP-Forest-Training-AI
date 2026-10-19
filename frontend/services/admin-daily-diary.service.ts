import { apiRequest } from "@/lib/api";

export const adminDailyDiaryApi = {
  listSubmittedDiaries: () =>
    apiRequest<any[]>("/api/v1/admin/users/field/daily-diaries"),

  getSubmittedDiary: (diaryId: string) =>
    apiRequest<any>(
      `/api/v1/admin/users/field/daily-diaries/${diaryId}`
    ),

  reviewDiary: (
    diaryId: string,
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
      `/api/v1/admin/users/field/daily-diaries/${diaryId}/review`,
      {
        method: "PATCH",
        body: JSON.stringify(payload),
      }
    ),
};