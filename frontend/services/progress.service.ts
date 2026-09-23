import { apiRequest } from "@/lib/api";

export const getProgress = () => apiRequest<any>("/api/v1/student/progress");
export const getSubjectProgress = (id: string) => apiRequest<any>(`/api/v1/student/progress/subjects/${id}`);
export const getChapterProgress = (id: string) => apiRequest<any>(`/api/v1/student/progress/chapters/${id}`);
export const getWeakTopics = () => apiRequest<any[]>("/api/v1/student/progress/weak-topics");
export const getStrongTopics = () => apiRequest<any[]>("/api/v1/student/progress/strong-topics");
export const getRecommendations = () => apiRequest<any>("/api/v1/student/recommendations");
export const getTodayReviews = () => apiRequest<any>("/api/v1/student/reviews/today");
export const getReviews = (limit = 20, offset = 0) =>
  apiRequest<any>(`/api/v1/student/reviews?limit=${limit}&offset=${offset}`);
export const completeReview = (id: string) =>
  apiRequest<any>(`/api/v1/student/reviews/${id}/complete`, { method: "POST" });
export const skipReview = (id: string) =>
  apiRequest<any>(`/api/v1/student/reviews/${id}/skip`, { method: "POST" });
