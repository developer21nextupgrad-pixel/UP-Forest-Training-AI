import { apiRequest } from "@/lib/api";

const DAILY_DIARY_LIST_PATH = "/api/v1/field/forms/daily-diary";

export async function loadDailyDiaryList<T>(): Promise<T[]> {
  const response = await apiRequest<{
    success: boolean;
    diaries: T[];
    total: number;
  }>(DAILY_DIARY_LIST_PATH);

  if (!response.success) {
    if (process.env.NODE_ENV === "development") {
      console.error("[Daily Diary] Failed to load diary list.", {
        path: DAILY_DIARY_LIST_PATH,
        status: response.status,
        code: response.code,
        message: response.message,
      });
    }
    const safeMessage =
      response.code === "AUTH_REQUIRED" || response.status === 401
        ? "Your session has expired. Please sign in again."
        : response.status === 403
          ? "You do not have permission to view these diaries."
          : response.status !== undefined && response.status >= 500
            ? "Unable to load daily diaries right now. Please try again."
            : response.code === "NETWORK"
              ? "Unable to connect to the server. Please try again."
              : "Unable to load daily diaries. Please try again.";
    throw new Error(safeMessage);
  }

  if (!Array.isArray(response.data.diaries)) {
    if (process.env.NODE_ENV === "development") {
      console.error("[Daily Diary] Diary list response has an invalid shape.", {
        path: DAILY_DIARY_LIST_PATH,
        status: response.status,
      });
    }
    throw new Error("The diary list could not be read. Please refresh and try again.");
  }

  return response.data.diaries;
}
