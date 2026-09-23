"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  ExternalLink,
  FileText,
  Loader2,
  Scale,
  ShieldCheck,
} from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { apiRequest } from "@/lib/api";
import { getStoredUser } from "@/lib/auth";

type DocumentType =
  | ""
  | "ACT"
  | "RULE"
  | "ORDER"
  | "CIRCULAR"
  | "SOP"
  | "JUDGMENT"
  | "MANUAL";

type LegalCitation = {
  source_id: string;
  document_id: string;
  book_title: string;
  page: number | null;
  page_end: number | null;
  printed_page: number | null;
  printed_page_end: number | null;
  section: string | null;
  document_type: string | null;
  authority: string | null;
  effective_date: string | null;
};

type LegalResponse = {
  success: boolean;
  answer: string;
  language: "hi" | "en";
  grounded: boolean;
  key_points: string[];
  citations: LegalCitation[];
  message?: string;
};

const documentTypes: { value: DocumentType; label: string }[] = [
  { value: "", label: "All legal documents" },
  { value: "ACT", label: "Act" },
  { value: "RULE", label: "Rule" },
  { value: "ORDER", label: "Order" },
  { value: "CIRCULAR", label: "Circular" },
  { value: "SOP", label: "SOP" },
  { value: "JUDGMENT", label: "Judgment" },
  { value: "MANUAL", label: "Manual" },
];

const exampleQuestions = [
  "What is the Indian Forest Act, 1927?",
  "What does Section 1 of the Indian Forest Act, 1927 provide?",
  "What are the provisions relating to reserved forests?",
];

export default function LegalAssistant() {
  const router = useRouter();

  useEffect(() => {
    const user = getStoredUser();

    if (!user || user.role !== "LEGAL_USER") {
      router.replace("/legal/login");
      return;
    }
  }, [router]);

  const [question, setQuestion] = useState("");
  const [language, setLanguage] = useState<"auto" | "hi" | "en">("auto");
  const [documentType, setDocumentType] = useState<DocumentType>("");
  const [authority, setAuthority] = useState("");

  const [response, setResponse] = useState<LegalResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function askLegalQuestion(e?: FormEvent) {
    e?.preventDefault();

    const trimmedQuestion = question.trim();

    if (!trimmedQuestion) {
      setError("Please enter a legal question.");
      return;
    }

    setLoading(true);
    setError("");
    setResponse(null);

    try {
      const payload: {
        question: string;
        language: "auto" | "hi" | "en";
        document_type?: string;
        authority?: string;
      } = {
        question: trimmedQuestion,
        language,
      };

      if (documentType) {
        payload.document_type = documentType;
      }

      payload.authority = authority.trim() || undefined;

      const result = await apiRequest<LegalResponse>(
        "/api/v1/legal/query",
        {
          method: "POST",
          body: JSON.stringify(payload),
        }
      );

      if (!result || result.success === false) {
        setError(result?.message ?? "Unable to get a legal answer.");
        return;
      }

      setResponse(result);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to connect to the Legal Assistant."
      );
    } finally {
      setLoading(false);
    }
  }

  async function openCitation(citation: LegalCitation) {
    if (!citation.document_id || citation.page == null) {
      return;
    }

    const popup = window.open("", "_blank");

    if (!popup) {
      setError("Please allow pop-ups to open the source document.");
      return;
    }

    popup.document.write(`
      <!doctype html>
      <html>
        <head>
          <title>Legal Source</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              padding: 32px;
              background: #0b1110;
              color: white;
            }
          </style>
        </head>
        <body>
          <p>Loading source page ${citation.page}...</p>
        </body>
      </html>
    `);

    try {
      const source = await apiRequest<any>(
        `/api/v1/content/documents/${citation.document_id}/source?page_number=${citation.page}`
      );

      if (source?.success === false) {
        throw new Error(source.message ?? "Unable to load source.");
      }

      const data = source?.data ?? source;

      const title =
        data?.file_name ??
        citation.book_title ??
        "Legal Source";

      const plainText =
        data?.plain_text ??
        data?.markdown ??
        "Source text is not available.";

      popup.document.open();
      popup.document.write(`
        <!doctype html>
        <html>
          <head>
            <meta charset="utf-8" />
            <title>${escapeHtml(title)} — Page ${citation.page}</title>
            <style>
              body {
                margin: 0;
                background: #07100d;
                color: #f5f7f6;
                font-family: Arial, sans-serif;
              }

              header {
                position: sticky;
                top: 0;
                padding: 18px 24px;
                background: #0b1914;
                border-bottom: 1px solid rgba(255,255,255,.12);
              }

              h1 {
                margin: 0 0 6px;
                font-size: 18px;
              }

              .meta {
                color: #8fd6b0;
                font-size: 13px;
              }

              main {
                max-width: 900px;
                margin: 0 auto;
                padding: 30px 24px 60px;
              }

              pre {
                white-space: pre-wrap;
                word-break: break-word;
                font-family: Arial, sans-serif;
                font-size: 15px;
                line-height: 1.75;
              }
            </style>
          </head>
          <body>
            <header>
              <h1>${escapeHtml(title)}</h1>
              <div class="meta">Page ${citation.page}</div>
            </header>
            <main>
              <pre id="source"></pre>
            </main>

            <script>
              document.getElementById("source").textContent =
                ${JSON.stringify(plainText)};
            </script>
          </body>
        </html>
      `);

      popup.document.close();
    } catch (err) {
      popup.close();
      setError(
        err instanceof Error
          ? err.message
          : "Unable to open the source document."
      );
    }
  }

  function escapeHtml(value: string) {
    return value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  return (
    <main className="relative min-h-[calc(100vh-80px)] overflow-x-hidden bg-black text-white">
      {/* Background */}
      <div className="fixed inset-0 -z-10">
        <Image
          src="/forest.jpg"
          alt=""
          fill
          priority
          className="object-cover object-center"
        />

        <div className="absolute inset-0 bg-black/75" />
        <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-black/75 to-black/95" />
      </div>

      <div className="relative z-10 mx-auto w-full max-w-[1220px] px-5 pb-12 pt-20 sm:px-7 lg:px-8">
        {/* Header */}
        <section className="mx-auto mb-7 max-w-5xl text-center">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-emerald-400/35 bg-black/50 px-4 py-1.5 text-[11px] font-bold uppercase tracking-[0.2em] text-emerald-300 backdrop-blur-md">
            <Scale className="h-3.5 w-3.5" />
            Legal Knowledge Assistant
          </div>

          <h1 className="text-3xl font-bold leading-tight tracking-tight sm:text-4xl lg:text-[42px]">
            Forest Laws{" "}
            <span className="text-emerald-400">& Compliance</span>
          </h1>

          <p className="mx-auto mt-3 max-w-3xl text-sm leading-6 text-slate-300 sm:text-[15px]">
            Ask questions about verified forest-law documents and receive
            document-grounded answers with source page references.
          </p>
        </section>

        {/* Main Card */}
        <section className="mx-auto overflow-hidden rounded-[24px] border border-white/15 bg-[#050a08]/95 shadow-[0_25px_80px_rgba(0,0,0,0.55)] backdrop-blur-xl">
          {/* Top information */}
          <div className="grid lg:grid-cols-[32%_68%]">
            <div className="relative hidden min-h-[260px] lg:block">
              <Image
                src="/legal.jpg"
                alt="Forest legal knowledge"
                fill
                sizes="32vw"
                className="object-cover"
              />

              <div className="absolute inset-0 bg-gradient-to-t from-[#030604] via-black/30 to-transparent" />

              <div className="absolute bottom-6 left-6 right-6">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-emerald-400/30 bg-emerald-500/10">
                  <ShieldCheck className="h-5 w-5 text-emerald-400" />
                </div>

                <h2 className="mt-4 text-xl font-bold">
                  Verified Legal Knowledge
                </h2>

                <p className="mt-2 text-sm leading-6 text-slate-300">
                  Answers are generated from the retrieved legal documents
                  available in the Forest Department knowledge base.
                </p>
              </div>
            </div>

            {/* Query area */}
            <div className="p-5 sm:p-7 lg:p-8">
              <div className="mb-5">
                <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-emerald-400">
                  Forest Department
                </p>

                <h2 className="mt-1 text-2xl font-bold">
                  Ask the Legal Assistant
                </h2>
              </div>

              <form onSubmit={askLegalQuestion}>
                <label className="mb-2 block text-sm font-semibold">
                  Your question
                </label>

                <textarea
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="e.g. What is the Indian Forest Act, 1927?"
                  rows={4}
                  className="w-full resize-y rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-emerald-400/50 focus:ring-1 focus:ring-emerald-400/30"
                  disabled={loading}
                />

                {/* Filters */}
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-slate-400">
                      Language
                    </label>

                    <select
                      value={language}
                      onChange={(e) =>
                        setLanguage(e.target.value as "auto" | "hi" | "en")
                      }
                      disabled={loading}
                      className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2.5 text-sm text-white outline-none focus:border-emerald-400/50"
                    >
                      <option value="auto">Auto detect</option>
                      <option value="en">English</option>
                      <option value="hi">Hindi</option>
                    </select>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-slate-400">
                      Document type
                    </label>

                    <select
                      value={documentType}
                      onChange={(e) =>
                        setDocumentType(e.target.value as DocumentType)
                      }
                      disabled={loading}
                      className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2.5 text-sm text-white outline-none focus:border-emerald-400/50"
                    >
                      {documentTypes.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-slate-400">
                      Authority
                    </label>

                    <input
                      value={authority}
                      onChange={(e) => setAuthority(e.target.value)}
                      placeholder="Optional"
                      disabled={loading}
                      className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2.5 text-sm text-white outline-none placeholder:text-slate-500 focus:border-emerald-400/50"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading || !question.trim()}
                  className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-5 text-sm font-bold text-black transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Searching legal documents...
                    </>
                  ) : (
                    <>
                      <Scale className="h-4 w-4" />
                      Ask Legal Assistant
                    </>
                  )}
                </button>
              </form>

              {/* Examples */}
              <div className="mt-5">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                  Try an example
                </p>

                <div className="flex flex-wrap gap-2">
                  {exampleQuestions.map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => setQuestion(item)}
                      disabled={loading}
                      className="rounded-lg border border-white/10 bg-white/[0.025] px-3 py-2 text-left text-xs text-slate-300 transition hover:border-emerald-400/30 hover:bg-emerald-950/20 hover:text-white disabled:opacity-50"
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="mx-5 mb-5 rounded-xl border border-red-400/20 bg-red-950/30 p-4 text-sm text-red-300 sm:mx-7 lg:mx-8">
              {error}
            </div>
          )}

          {/* Answer */}
          {response && (
            <div className="border-t border-white/10 bg-[#030604] p-5 sm:p-7 lg:p-8">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-400">
                    Legal Answer
                  </p>

                  <h3 className="mt-1 text-xl font-bold">
                    Document-grounded response
                  </h3>
                </div>

                <div
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                    response.grounded
                      ? "border-emerald-400/30 bg-emerald-950/40 text-emerald-300"
                      : "border-amber-400/30 bg-amber-950/30 text-amber-300"
                  }`}
                >
                  {response.grounded
                    ? "✓ Source grounded"
                    : "⚠ Not sufficiently grounded"}
                </div>
              </div>

              <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.025] p-5">
                <p className="whitespace-pre-wrap text-[15px] leading-7 text-slate-100">
                  {response.answer}
                </p>
              </div>

              {/* Key points */}
              {response.key_points?.length > 0 && (
                <div className="mt-5">
                  <h4 className="text-sm font-semibold text-white">
                    Key points
                  </h4>

                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {response.key_points.map((point, index) => (
                      <div
                        key={`${point}-${index}`}
                        className="flex items-start gap-2 rounded-xl border border-white/10 bg-white/[0.02] p-3 text-sm leading-6 text-slate-300"
                      >
                        <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-emerald-400" />
                        <span>{point}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Citations */}
              <div className="mt-6">
                <div className="flex items-center justify-between gap-3">
                  <h4 className="text-sm font-semibold text-white">
                    Sources & citations
                  </h4>

                  <span className="text-xs text-slate-500">
                    {response.citations?.length ?? 0} source
                    {(response.citations?.length ?? 0) === 1 ? "" : "s"}
                  </span>
                </div>

                {response.citations?.length > 0 ? (
                  <div className="mt-3 space-y-3">
                    {response.citations.map((citation, index) => (
                      <div
                        key={`${citation.source_id}-${citation.document_id}`}
                        className="rounded-2xl border border-white/10 bg-white/[0.02] p-4"
                      >
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                          <div className="flex items-start gap-3">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10">
                              <FileText className="h-4 w-4 text-emerald-400" />
                            </div>

                            <div>
                              <p className="text-sm font-semibold text-white">
                                Source {index + 1}
                              </p>

                              <p className="mt-1 text-sm text-slate-300">
                                {citation.book_title}
                              </p>

                              <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
                                {citation.document_type && (
                                  <span className="rounded-md bg-white/5 px-2 py-1">
                                    {citation.document_type}
                                  </span>
                                )}

                                {citation.authority && (
                                  <span className="rounded-md bg-white/5 px-2 py-1">
                                    {citation.authority}
                                  </span>
                                )}

                                {citation.page != null && (
                                  <span className="rounded-md bg-white/5 px-2 py-1">
                                    PDF page {citation.page}
                                    {citation.page_end &&
                                    citation.page_end !== citation.page
                                      ? `–${citation.page_end}`
                                      : ""}
                                  </span>
                                )}

                                {citation.printed_page != null && (
                                  <span className="rounded-md bg-white/5 px-2 py-1">
                                    Printed page {citation.printed_page}
                                    {citation.printed_page_end &&
                                    citation.printed_page_end !==
                                      citation.printed_page
                                      ? `–${citation.printed_page_end}`
                                      : ""}
                                  </span>
                                )}

                                {citation.section && (
                                  <span className="rounded-md bg-white/5 px-2 py-1">
                                    {citation.section}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => void openCitation(citation)}
                            disabled={citation.page == null}
                            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-emerald-400/30 bg-emerald-950/30 px-3 py-2 text-xs font-semibold text-emerald-300 transition hover:border-emerald-400/60 hover:bg-emerald-900/30 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                            Open source
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-3 rounded-xl border border-white/10 p-4 text-sm text-slate-500">
                    No validated source citations were returned.
                  </div>
                )}
              </div>
            </div>
          )}
        </section>

        {/* Back */}
        <div className="mt-5">
          <button
            type="button"
            onClick={() => router.push("/")}
            className="mx-auto flex items-center gap-2 rounded-xl border border-emerald-400/30 bg-emerald-950/20 px-4 py-2.5 text-sm font-semibold text-white transition hover:border-emerald-400/60 hover:bg-emerald-900/30"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Forest Library
          </button>
        </div>

        <div className="mt-5 text-center">
          <span className="text-[11px] text-slate-500">
            Verified knowledge • Source-based assistance • Forest Department
          </span>
        </div>
      </div>
    </main>
  );
}