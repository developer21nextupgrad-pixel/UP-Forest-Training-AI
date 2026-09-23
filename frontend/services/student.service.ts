import { apiRequest } from "@/lib/api";

export type StudentSubject = {
  id: string;
  name: string;
  code: string;
  description: string | null;
  language: string;
  chapter_count: number;
  progress_percentage: number;
};

export type Chapter = {
  id: string;
  title: string;
  chapter_number: number;
  order_index: number;
  description: string | null;
  progress_percentage: number;
  completed: boolean;
};

export type Dashboard = {
  student: { name: string; preferred_language: string };
  summary: {
    subjects: number;
    chapters: number;
    completed_chapters: number;
    overall_progress: number;
    time_spent_seconds: number;
  };
  continue_learning: any;
  recent_activity: any[];
  subjects: StudentSubject[];
  progress_summary?: { mastery: number | null; coverage: number };
  mastery?: number | null;
  coverage?: number;
  weak_topics?: any[];
  due_reviews?: any[];
  recommendations?: any[];
};

interface DashboardRequestState {
  promise: ReturnType<typeof apiRequest<Dashboard>>;
  controller: AbortController;
  consumers: number;
}

let dashboardRequest: DashboardRequestState | null = null;

/**
 * Shared in-flight dashboard request.
 *
 * React Strict Mode intentionally mounts/effect-cleans/effect-remounts in
 * development. Sharing the in-flight request makes that lifecycle idempotent
 * without disabling Strict Mode or introducing a duplicate network call.
 */
export function getDashboard() {
  if (!dashboardRequest) {
    const controller = new AbortController();
    const promise = apiRequest<Dashboard>("/api/v1/student/dashboard", {
      signal: controller.signal,
      timeoutMs: 30_000,
    }).finally(() => {
      dashboardRequest = null;
    });
    dashboardRequest = { promise, controller, consumers: 0 };
  }

  dashboardRequest.consumers += 1;
  return dashboardRequest.promise;
}

export function releaseDashboardRequest() {
  const request = dashboardRequest;
  if (!request) return;

  request.consumers = Math.max(0, request.consumers - 1);
  if (request.consumers > 0) return;

  // Give a Strict Mode re-effect a chance to acquire the same request before
  // aborting. A real unmount still cancels the request on the next macrotask.
  setTimeout(() => {
    if (dashboardRequest === request && request.consumers === 0) {
      request.controller.abort();
    }
  }, 0);
}

export const getSubjects = () => apiRequest<StudentSubject[]>("/api/v1/student/subjects");
export const getSubject = (id: string) => apiRequest<any>(`/api/v1/student/subjects/${id}`);
export const getChapter = (id: string, page = 1, limit = 10) =>
  apiRequest<any>(`/api/v1/student/chapters/${id}?page=${page}&limit=${limit}`);
export const updateProgress = (id: string, completion_percentage: number, time_spent_seconds: number) =>
  apiRequest<any>(`/api/v1/student/chapters/${id}/progress`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ completion_percentage, time_spent_seconds }),
  });
export const getHistory = (limit = 20, offset = 0) =>
  apiRequest<any>(`/api/v1/student/history?limit=${limit}&offset=${offset}`);
export const getProfile = () => apiRequest<any>("/api/v1/student/profile");
export const updateProfile = (data: any) =>
  apiRequest<any>("/api/v1/student/profile", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
