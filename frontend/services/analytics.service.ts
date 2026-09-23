import { apiRequest } from "@/lib/api";

export const analyticsApi: any = {
  instructorDashboard: () => apiRequest<any>("/api/v1/instructor/dashboard"),
  // instructorAnalytics: () => Promise.all([apiRequest<any>("/api/v1/instructor/dashboard")]),
  instructorAnalytics: () =>
  apiRequest<any>("/api/v1/instructor/dashboard"),
  instructorStudents: (params="") => apiRequest<any>(`/api/v1/instructor/students${params ? `?${params}` : ""}`),
  instructorStudent: (id:string) => apiRequest<any>(`/api/v1/instructor/students/${id}`),
  instructorSubjects: (params="") => apiRequest<any>(`/api/v1/instructor/subjects${params ? `?${params}` : ""}`),
  instructorSubject: (id:string) => apiRequest<any>(`/api/v1/instructor/subjects/${id}`),
  instructorChapter: (id:string) => apiRequest<any>(`/api/v1/instructor/chapters/${id}`),
  instructorWeakTopics: () => apiRequest<any>("/api/v1/instructor/weak-topics"),
  instructorRisk: () => apiRequest<any>("/api/v1/instructor/at-risk-students"),
  instructorQuizzes: () => apiRequest<any>("/api/v1/instructor/quizzes"),
  instructorQuiz: (id:string) => apiRequest<any>(`/api/v1/instructor/quizzes/${id}/analytics`),
  instructorActivity: () => apiRequest<any>("/api/v1/instructor/activity?page=1&page_size=20"),
  adminDashboard: () => apiRequest<any>("/api/v1/admin/dashboard"),
  adminUsers: (params="") => apiRequest<any>(`/api/v1/admin/users${params ? `?${params}` : ""}`),
  adminStudents: () => apiRequest<any[]>("/api/v1/admin/users/students"),
  adminEnrollStudent: (userId: string, payload: { subject_id: string; academy?: string | null; batch?: string | null; course?: string | null }) => apiRequest<any>(`/api/v1/admin/users/${userId}/enrollments`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
  adminAssignInstructorSubject: (userId: string, payload: { subject_id: string; active?: boolean }) => apiRequest<any>(`/api/v1/admin/instructors/${userId}/subjects`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subject_id: payload.subject_id, active: payload.active ?? true }) }),
  adminSubjects: () => apiRequest<any>("/api/v1/admin/subjects?page=1&page_size=50"),
  adminSubjectChapters: (id: string) =>
    apiRequest<any>(`/api/v1/admin/subjects/${id}/chapters`),
  adminContent: () => apiRequest<any>("/api/v1/admin/content"),
  adminQuizzes: () => apiRequest<any>("/api/v1/admin/quizzes"),
  adminLearning: () => apiRequest<any>("/api/v1/admin/learning-analytics"),
  adminReviews: () => apiRequest<any>("/api/v1/admin/reviews"),
  adminActivity: () => apiRequest<any>("/api/v1/admin/activity?page=1&page_size=20"),
  adminHealth: () => apiRequest<any>("/api/v1/admin/system-health"),
  adminWeakTopics: () => apiRequest<any>("/api/v1/admin/weak-topics"),
};
