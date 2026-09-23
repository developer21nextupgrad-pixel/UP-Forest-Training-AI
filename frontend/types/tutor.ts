export interface TutorCitation {
  source_id: string;
  document_id: string;
  book_title: string;
  page: number | null;
  section: string | null;
}
export interface TutorSession {
  id: string;
  title: string | null;
  subject_id: string | null;
  chapter_id: string | null;
  language: string;
  created_at: string;
  updated_at: string;
}
export interface TutorMessage {
  id: string;
  role: "USER" | "ASSISTANT" | "SYSTEM";
  content: string;
  created_at: string;
}
export interface TutorResponse {
  success: true;
  session_id: string;
  message_id: string;
  answer: string;
  language: string;
  key_points: string[];
  citations: TutorCitation[];
  grounded: boolean;
}
