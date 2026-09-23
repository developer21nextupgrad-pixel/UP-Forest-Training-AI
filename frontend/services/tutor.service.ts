import { apiRequest } from "@/lib/api";
import type { TutorMessage, TutorResponse, TutorSession } from "@/types/tutor";

export function createTutorSession(payload: { subject_id?: string; chapter_id?: string; language?: string; title?: string }) {
  return apiRequest<TutorSession>("/api/v1/tutor/sessions", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
  });
}
export function listTutorSessions() {
  return apiRequest<TutorSession[]>("/api/v1/tutor/sessions");
}
export function getTutorSession(id: string) {
  return apiRequest<TutorMessage[]>(`/api/v1/tutor/sessions/${id}`);
}
export function deleteTutorSession(id: string) {
  return apiRequest<void>(`/api/v1/tutor/sessions/${id}`, { method: "DELETE" });
}
export function askTutor(payload: {
  session_id?: string; message: string; language?: string; subject_id?: string; chapter_id?: string;
}) {
  return apiRequest<TutorResponse>("/api/v1/tutor/chat", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload), timeoutMs: 120_000,
  });
}
