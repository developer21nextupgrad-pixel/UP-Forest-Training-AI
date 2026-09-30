"use client";

import { ChangeEvent, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { apiRequest } from "@/lib/api";
import { getStoredUser, AuthUser } from "@/lib/auth";

type Book = {
  id: string;
  title: string;
  author?: string | null;
  publisher?: string | null;
  language: string;
  edition?: string | null;
  publication_year?: number | null;
  description?: string | null;
  status: string;
};

type Doc = {
  id: string;
  file_name: string;
  mime_type?: string | null;
  file_size?: number | null;
  page_count?: number | null;
  processing_status: string;
  ocr_status: string;
  embedding_status: string;
  created_at: string;
};

type Chunk = {
  id: string;
  chunk_index: number;
  page_number?: number | null;
  chapter_title?: string | null;
  section_title?: string | null;
  content: string;
};

type Page = {
  id: string;
  page_number: number;
  markdown: string;
  plain_text: string;
};

export default function BookDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [user, setUser] = useState<AuthUser | null>(null);
  const [book, setBook] = useState<Book | null>(null);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [pages, setPages] = useState<Page[]>([]);

  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [reprocessingId, setReprocessingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [documentType, setDocumentType] = useState("");
  const [authority, setAuthority] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [rule, setRule] = useState("");

  const unwrap = (r: any) =>
    r?.success === false ? null : (r?.data ?? r);

  async function load() {
    const [b, d] = await Promise.all([
      apiRequest<any>(`/api/v1/books/${id}`),
      apiRequest<any>(`/api/v1/books/${id}/documents`),
    ]);

    const bookData = unwrap(b);
    const docData = unwrap(d);

    if (bookData) {
      setBook(bookData);
    } else {
      setError(b.message);
    }

    if (docData) {
      setDocs(docData);
    }
  }

  useEffect(() => {
    const u = getStoredUser();

    if (!u || u.role !== "ADMIN") {
      router.replace("/login");
      return;
    }

    setUser(u);
    void load();
  }, [id, router]);

  async function upload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];

    if (!file) {
      return;
    }

    if (
      documentType &&
      ![
        "ACT",
        "RULE",
        "ORDER",
        "CIRCULAR",
        "SOP",
        "JUDGMENT",
        "MANUAL",
      ].includes(documentType)
    ) {
      setError("Invalid document type.");
      e.target.value = "";
      return;
    }

    setUploading(true);
    setError("");

    try {
      const fd = new FormData();

      fd.append("file", file);
      fd.append("language", book?.language ?? "en");

      if (documentType) {
        fd.append("document_type", documentType);
      }

      if (authority.trim()) {
        fd.append("authority", authority.trim());
      }

      if (effectiveDate) {
        fd.append("effective_date", effectiveDate);
      }

      if (rule.trim()) {
        fd.append("rule", rule.trim());
      }

      const r = await apiRequest<any>(
        `/api/v1/books/${id}/documents`,
        {
          method: "POST",
          body: fd,
          timeoutMs: 30000,
        }
      );

      const data = unwrap(r);

      if (!data) {
        setError(r.message ?? "Upload failed");
        return;
      }

      setDocumentType("");
      setAuthority("");
      setEffectiveDate("");
      setRule("");

      await load();

      const documentId = data.id;

      if (documentId) {
        for (let i = 0; i < 120; i++) {
          await new Promise((resolve) =>
            setTimeout(resolve, 2000)
          );

          const response = await apiRequest<any>(
            `/api/v1/books/${id}/documents`
          );

          const documents = unwrap(response);

          if (!documents) {
            continue;
          }

          setDocs(documents);

          const currentDoc = documents.find(
            (doc: Doc) => doc.id === documentId
          );

          if (
            currentDoc?.processing_status === "READY" ||
            currentDoc?.processing_status === "FAILED"
          ) {
            break;
          }
        }
      }
    } catch (err) {
      console.error("Document upload failed:", err);

      setError(
        err instanceof Error
          ? err.message
          : "Document upload failed"
      );
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  async function inspect(documentId: string) {
    try {
      setError("");

      const [cr, pr] = await Promise.all([
        apiRequest<any>(
          `/api/v1/documents/${documentId}/chunks?limit=50`
        ),
        apiRequest<any>(
          `/api/v1/documents/${documentId}/pages?limit=50`
        ),
      ]);

      console.log("CHUNKS RESPONSE:", cr);
      console.log("PAGES RESPONSE:", pr);

      if (cr.success === false) {
        setError(cr.message ?? "Failed to load chunks");
        return;
      }

      if (pr.success === false) {
        setError(pr.message ?? "Failed to load pages");
        return;
      }

      const data = unwrap(cr);
      const pageData = unwrap(pr);

      setChunks(data?.items ?? []);
      setPages(pageData?.items ?? []);
    } catch (err) {
      console.error("Inspect failed:", err);

      setError(
        err instanceof Error
          ? err.message
          : "Failed to inspect document"
      );
    }
  }

  async function reprocess(documentId: string) {
    setReprocessingId(documentId);
    setError("");

    try {
      const r = await apiRequest<any>(
        `/api/v1/documents/${documentId}/reprocess`,
        {
          method: "POST",
        }
      );

      if (r.success === false) {
        setError(r.message ?? "Reprocess failed");
        return;
      }

      await load();

      for (let i = 0; i < 120; i++) {
        await new Promise((resolve) =>
          setTimeout(resolve, 2000)
        );

        const response = await apiRequest<any>(
          `/api/v1/books/${id}/documents`
        );

        const data = unwrap(response);

        if (data) {
          setDocs(data);

          const currentDoc = data.find(
            (d: Doc) => d.id === documentId
          );

          if (
            currentDoc?.processing_status === "READY" ||
            currentDoc?.processing_status === "FAILED"
          ) {
            break;
          }
        }
      }
    } catch (err: any) {
      setError(err?.message ?? "Reprocess failed");
    } finally {
      setReprocessingId(null);
    }
  }

  async function deleteDocument(
    documentId: string,
    fileName: string
  ) {
    const confirmed = window.confirm(
      `Are you sure you want to permanently delete "${fileName}"?\n\nThis will remove the PDF and its processed data, including pages, chunks and embeddings.`
    );

    if (!confirmed) {
      return;
    }

    setDeletingId(documentId);
    setError("");

    try {
      const r = await apiRequest<any>(
        `/api/v1/books/${id}/documents/${documentId}`,
        {
          method: "DELETE",
        }
      );

      if (r?.success === false) {
        setError(
          r.message ?? "Failed to delete document"
        );
        return;
      }

      // Remove from UI immediately
      setDocs((current) =>
        current.filter(
          (doc) => doc.id !== documentId
        )
      );

      // Clear inspection data
      setChunks([]);
      setPages([]);

      // Refresh from backend
      await load();
    } catch (err) {
      console.error("Document delete failed:", err);

      setError(
        err instanceof Error
          ? err.message
          : "Failed to delete document"
      );
    } finally {
      setDeletingId(null);
    }
  }

  if (!user || !book) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-10">
        <p>{error || "Loading…"}</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <button
        onClick={() => router.push("/admin")}
        className="mb-6 text-sm text-primary"
      >
        ← Back to content management
      </button>

      <div className="rounded-2xl border bg-card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm text-muted-foreground">
              Book
            </p>

            <h1 className="mt-1 text-3xl font-semibold">
              {book.title}
            </h1>

            <p className="mt-2 text-muted-foreground">
              {book.author || "Unknown author"} ·{" "}
              {book.language} ·{" "}
              {book.edition || "Edition not specified"}
            </p>
          </div>

          <div className="w-full max-w-2xl rounded-2xl border bg-background/40 p-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="text-sm font-medium">
                  Document type
                </label>

                <select
                  value={documentType}
                  onChange={(e) =>
                    setDocumentType(e.target.value)
                  }
                  disabled={uploading}
                  className="mt-1.5 w-full rounded-xl border bg-background px-3 py-2 text-sm"
                >
                  <option value="">
                    General / Training document
                  </option>
                  <option value="ACT">Act</option>
                  <option value="RULE">Rule</option>
                  <option value="ORDER">Order</option>
                  <option value="CIRCULAR">Circular</option>
                  <option value="SOP">SOP</option>
                  <option value="JUDGMENT">Judgment</option>
                  <option value="MANUAL">Manual</option>
                </select>
              </div>

              <div>
                <label className="text-sm font-medium">
                  Authority
                </label>

                <input
                  type="text"
                  value={authority}
                  onChange={(e) =>
                    setAuthority(e.target.value)
                  }
                  disabled={uploading}
                  maxLength={255}
                  placeholder="e.g. Government of India"
                  className="mt-1.5 w-full rounded-xl border bg-background px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="text-sm font-medium">
                  Effective date
                </label>

                <input
                  type="date"
                  value={effectiveDate}
                  onChange={(e) =>
                    setEffectiveDate(e.target.value)
                  }
                  disabled={uploading}
                  className="mt-1.5 w-full rounded-xl border bg-background px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="text-sm font-medium">
                  Rule / Reference
                </label>

                <input
                  type="text"
                  value={rule}
                  onChange={(e) =>
                    setRule(e.target.value)
                  }
                  disabled={uploading}
                  placeholder="Optional rule/reference"
                  className="mt-1.5 w-full rounded-xl border bg-background px-3 py-2 text-sm"
                />
              </div>
            </div>

            <label
              className={`mt-4 inline-flex cursor-pointer items-center rounded-xl bg-primary px-4 py-2 text-sm text-primary-foreground ${
                uploading
                  ? "cursor-not-allowed opacity-60"
                  : ""
              }`}
            >
              {uploading ? "Uploading…" : "Upload PDF"}

              <input
                type="file"
                accept=".pdf,application/pdf"
                className="hidden"
                disabled={uploading}
                onChange={upload}
              />
            </label>

            <p className="mt-2 text-xs text-muted-foreground">
              Select a legal document type only when this PDF
              belongs to the legal corpus. Leave it as General /
              Training document for normal training content.
            </p>
          </div>
        </div>

        {error && (
          <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">
            {error}
          </p>
        )}
      </div>

      <section className="mt-6 rounded-2xl border bg-card p-6">
        <h2 className="text-lg font-semibold">
          Documents
        </h2>

        <div className="mt-4 space-y-3">
          {docs.map((d) => (
            <div
              key={d.id}
              className="rounded-xl border p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-medium">
                    {d.file_name}
                  </p>

                  <p className="mt-1 text-xs text-muted-foreground">
                    {d.page_count ?? "?"} pages ·{" "}
                    {d.processing_status} · OCR{" "}
                    {d.ocr_status} · Embeddings{" "}
                    {d.embedding_status}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() =>
                      void inspect(d.id)
                    }
                    disabled={
                      deletingId === d.id ||
                      reprocessingId === d.id
                    }
                    className="rounded-lg border px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Inspect chunks
                  </button>

                  <button
                    onClick={() =>
                      void reprocess(d.id)
                    }
                    disabled={
                      reprocessingId === d.id ||
                      deletingId === d.id
                    }
                    className="rounded-lg border px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {reprocessingId === d.id
                      ? "Processing…"
                      : "Reprocess"}
                  </button>

                  <button
                    onClick={() =>
                      void deleteDocument(
                        d.id,
                        d.file_name
                      )
                    }
                    disabled={
                      deletingId === d.id ||
                      reprocessingId === d.id
                    }
                    className="rounded-lg border border-red-300 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {deletingId === d.id
                      ? "Deleting…"
                      : "Delete"}
                  </button>
                </div>
              </div>
            </div>
          ))}

          {!docs.length && (
            <p className="text-sm text-muted-foreground">
              No documents uploaded yet.
            </p>
          )}
        </div>
      </section>

      <section className="mt-6 rounded-2xl border bg-card p-6">
        <h2 className="text-lg font-semibold">
          OCR / page inspection
        </h2>

        <div className="mt-4 space-y-3">
          {pages.map((p) => (
            <article
              key={p.id}
              className="rounded-xl border p-4"
            >
              <div className="text-xs font-medium text-muted-foreground">
                Page {p.page_number}
              </div>

              <p className="mt-2 whitespace-pre-wrap text-sm">
                {p.plain_text}
              </p>
            </article>
          ))}

          {!pages.length && (
            <p className="text-sm text-muted-foreground">
              Select “Inspect chunks” on a processed
              document.
            </p>
          )}
        </div>
      </section>

      <section className="mt-6 rounded-2xl border bg-card p-6">
        <h2 className="text-lg font-semibold">
          Persisted chunks
        </h2>

        <div className="mt-4 space-y-3">
          {chunks.map((c) => (
            <article
              key={c.id}
              className="rounded-xl border p-4"
            >
              <div className="text-xs text-muted-foreground">
                Chunk {c.chunk_index} · page{" "}
                {c.page_number ?? "—"} ·{" "}
                {c.chapter_title ||
                  c.section_title ||
                  "No detected section"}
              </div>

              <p className="mt-2 whitespace-pre-wrap text-sm">
                {c.content}
              </p>
            </article>
          ))}

          {!chunks.length && (
            <p className="text-sm text-muted-foreground">
              No chunks to display.
            </p>
          )}
        </div>
      </section>
    </main>
  );
}