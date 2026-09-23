import { apiRequest } from "@/lib/api";

export function searchContent(params: Record<string, string | number | undefined>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") q.set(k, String(v));
  return apiRequest<any>(`/api/v1/admin/content/search?${q.toString()}`);
}

export function getDocumentStatus(documentId: string) {
  return apiRequest<any>(`/api/v1/documents/${documentId}/status`);
}

export function getDocumentVersions(documentId: string) {
  return apiRequest<any[]>(`/api/v1/documents/${documentId}/versions`);
}

export function reprocessDocument(documentId: string) {
  return apiRequest<any>(`/api/v1/documents/${documentId}/reprocess`, { method: "POST" });
}
