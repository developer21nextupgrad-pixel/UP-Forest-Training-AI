"use client";

import { useState } from "react";
import {
  ArrowLeft,
  Bot,
  CheckCircle2,
  FileText,
  Loader2,
  MessageSquareText,
  Send,
  ShieldCheck,
  Trees,
  Zap,
} from "lucide-react";
import { useRouter } from "next/navigation";

import { apiRequest } from "@/lib/api";

type FieldSource = {
  filename: string;
  page: number;
  score: number;
  snippet: string;
};

type FieldChatResponse = {
  success: boolean;
  answer: string;
  found: boolean;
  sources: FieldSource[];
};

type Message = {
  role: "user" | "assistant";
  content: string;
  sources?: FieldSource[];
};

const QUICK_PROMPTS = [
  {
    icon: Trees,
    label: "Patrolling",
    question: "What are the important procedures for forest patrolling?",
  },
  {
    icon: ShieldCheck,
    label: "Safety",
    question: "What safety procedures should a field officer follow?",
  },
  {
    icon: FileText,
    label: "SOPs",
    question: "What field SOPs are available in the knowledge base?",
  },
];

export default function FieldAssistant() {
  const router = useRouter();

  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);

  const sendMessage = async (prompt?: string) => {
    const value = (prompt ?? question).trim();

    if (!value || loading) return;

    setMessages((current) => [
      ...current,
      {
        role: "user",
        content: value,
      },
    ]);

    setQuestion("");
    setLoading(true);

    try {
      const response = (await apiRequest<FieldChatResponse>(
        "/api/v1/field/chat",
        {
          method: "POST",
          body: JSON.stringify({
            question: value,
          }),
        },
      )) as unknown as FieldChatResponse;

      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: response.answer,
          sources: response.sources,
        },
      ]);
    } catch (error) {
      console.error("Field Assistant request failed:", error);

      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content:
            "Unable to connect to the Field Officer Assistant. Please try again.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (
    event: React.KeyboardEvent<HTMLTextAreaElement>,
  ) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  };

  const hasMessages = messages.length > 0;

  return (
    <main className="min-h-[calc(100vh-80px)] bg-background text-foreground transition-colors duration-300">
      <div className="mx-auto w-full max-w-[1280px] px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
        {/* =========================================================
            PAGE HEADER
        ========================================================= */}
        <section className="mb-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-primary">
                <Trees className="h-3.5 w-3.5" />
                Field Operations
              </div>

              <h1 className="text-3xl font-bold tracking-tight sm:text-4xl lg:text-[42px]">
                Field Officer{" "}
                <span className="text-primary">Assistant</span>
              </h1>

              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-[15px]">
                Get document-grounded operational guidance from the verified
                Field Officer knowledge base.
              </p>
            </div>

            <button
              type="button"
              onClick={() => router.push("/")}
              className="inline-flex w-fit items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-medium text-foreground shadow-sm transition hover:border-primary/30 hover:bg-muted"
            >
              <ArrowLeft className="h-4 w-4" />
              Forest Library
            </button>
          </div>
        </section>

        {/* =========================================================
            ASSISTANT WORKSPACE
        ========================================================= */}
        <section className="overflow-hidden rounded-3xl border border-border bg-card shadow-[0_18px_60px_rgba(0,0,0,0.08)] dark:shadow-[0_18px_60px_rgba(0,0,0,0.35)]">
          {/* Assistant toolbar */}
          <header className="flex flex-col gap-4 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Bot className="h-5 w-5" />
              </div>

              <div>
                <h2 className="text-sm font-semibold">
                  Field Knowledge Assistant
                </h2>

                <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  Knowledge base connected
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5 text-primary" />
              Document-grounded answers
            </div>
          </header>

          <div className="grid lg:grid-cols-[1fr_280px]">
            {/* =====================================================
                CHAT AREA
            ====================================================== */}
            <div className="flex min-h-[600px] flex-col border-b border-border lg:border-b-0 lg:border-r">
              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6 sm:py-6">
                {!hasMessages ? (
                  <div className="flex min-h-[470px] flex-col items-center justify-center px-4 text-center">
                    <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10">
                      <MessageSquareText className="h-7 w-7 text-primary" />
                    </div>

                    <h3 className="text-xl font-semibold">
                      How can I help you today?
                    </h3>

                    <p className="mt-2 max-w-lg text-sm leading-6 text-muted-foreground">
                      Ask about field procedures, patrolling, plantation,
                      safety, SOPs or other information available in the Field
                      Officer knowledge base.
                    </p>

                    <div className="mt-7 grid w-full max-w-2xl grid-cols-1 gap-2 sm:grid-cols-3">
                      {QUICK_PROMPTS.map((item) => {
                        const Icon = item.icon;

                        return (
                          <button
                            key={item.label}
                            type="button"
                            onClick={() => void sendMessage(item.question)}
                            disabled={loading}
                            className="group rounded-xl border border-border bg-background p-3 text-left transition hover:border-primary/30 hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                              <Icon className="h-4 w-4" />
                            </div>

                            <p className="text-xs font-semibold">
                              {item.label}
                            </p>

                            <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-muted-foreground">
                              {item.question}
                            </p>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="mx-auto max-w-4xl space-y-5">
                    {messages.map((message, index) => (
                      <div
                        key={`${message.role}-${index}`}
                        className={
                          message.role === "user"
                            ? "flex justify-end"
                            : "flex justify-start"
                        }
                      >
                        <div
                          className={
                            message.role === "user"
                              ? "max-w-[88%] rounded-2xl rounded-br-md bg-primary px-4 py-3 text-sm leading-6 text-primary-foreground shadow-sm"
                              : "max-w-[92%] rounded-2xl rounded-bl-md border border-border bg-muted/50 px-4 py-4 text-sm leading-6 text-foreground"
                          }
                        >
                          <div className="flex items-start gap-3">
                            {message.role === "assistant" && (
                              <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                                <Bot className="h-3.5 w-3.5" />
                              </div>
                            )}

                            <div className="min-w-0 flex-1">
                              <p className="whitespace-pre-wrap">
                                {message.content}
                              </p>

                              {message.sources &&
                                message.sources.length > 0 && (
                                  <div className="mt-4 border-t border-border pt-3">
                                    <div className="mb-2 flex items-center gap-2">
                                      <CheckCircle2 className="h-3.5 w-3.5 text-primary" />

                                      <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-primary">
                                        Sources
                                      </span>
                                    </div>

                                    <div className="grid gap-2 sm:grid-cols-2">
                                      {message.sources.map(
                                        (source, sourceIndex) => (
                                          <div
                                            key={`${source.filename}-${source.page}-${sourceIndex}`}
                                            className="rounded-xl border border-border bg-background p-3"
                                          >
                                            <div className="flex gap-2.5">
                                              <FileText className="mt-0.5 h-4 w-4 shrink-0 text-primary" />

                                              <div className="min-w-0">
                                                <p className="truncate text-xs font-medium">
                                                  {source.filename}
                                                </p>

                                                <p className="mt-1 text-[11px] text-muted-foreground">
                                                  Page {source.page}
                                                </p>

                                                {source.snippet && (
                                                  <p className="mt-2 line-clamp-3 text-[11px] leading-5 text-muted-foreground">
                                                    {source.snippet}
                                                  </p>
                                                )}
                                              </div>
                                            </div>
                                          </div>
                                        ),
                                      )}
                                    </div>
                                  </div>
                                )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}

                    {loading && (
                      <div className="flex justify-start">
                        <div className="flex items-center gap-3 rounded-2xl rounded-bl-md border border-border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin text-primary" />
                          Searching the Field knowledge base...
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* ===================================================
                  INPUT
              ==================================================== */}
              <div className="border-t border-border bg-background/70 p-4 sm:p-5">
                <div className="mx-auto max-w-4xl">
                  <div className="flex items-end gap-2 rounded-2xl border border-input bg-card p-2 shadow-sm transition focus-within:border-primary/50 focus-within:ring-4 focus-within:ring-primary/10">
                    <textarea
                      value={question}
                      onChange={(event) => setQuestion(event.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder="Ask a field operations question..."
                      rows={2}
                      maxLength={4000}
                      disabled={loading}
                      className="min-h-[52px] flex-1 resize-none bg-transparent px-3 py-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-50"
                    />

                    <button
                      type="button"
                      onClick={() => void sendMessage()}
                      disabled={!question.trim() || loading}
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                      aria-label="Send question"
                    >
                      {loading ? (
                        <Loader2 className="h-5 w-5 animate-spin" />
                      ) : (
                        <Send className="h-5 w-5" />
                      )}
                    </button>
                  </div>

                  <div className="mt-2 flex items-center justify-between px-1 text-[10px] text-muted-foreground">
                    <span>Enter to send · Shift + Enter for new line</span>
                    <span>{question.length}/4000</span>
                  </div>
                </div>
              </div>
            </div>

            {/* =====================================================
                RIGHT SIDEBAR
            ====================================================== */}
            <aside className="hidden bg-muted/20 p-5 lg:block">
              <div className="sticky top-5">
                <div className="mb-5">
                  <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Zap className="h-4 w-4" />
                  </div>

                  <h3 className="text-sm font-semibold">
                    Quick questions
                  </h3>

                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    Start with a common field-operation question.
                  </p>
                </div>

                <div className="space-y-2">
                  {QUICK_PROMPTS.map((item) => {
                    const Icon = item.icon;

                    return (
                      <button
                        key={`side-${item.label}`}
                        type="button"
                        onClick={() => void sendMessage(item.question)}
                        disabled={loading}
                        className="flex w-full items-start gap-3 rounded-xl border border-border bg-card p-3 text-left transition hover:border-primary/30 hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                          <Icon className="h-4 w-4" />
                        </div>

                        <div className="min-w-0">
                          <p className="text-xs font-semibold">
                            {item.label}
                          </p>

                          <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                            {item.question}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>

                <div className="mt-6 rounded-xl border border-primary/15 bg-primary/5 p-4">
                  <div className="flex items-start gap-3">
                    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />

                    <div>
                      <p className="text-xs font-semibold">
                        Grounded responses
                      </p>

                      <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                        Responses are generated from the verified Field
                        Officer document collection.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="mt-3 rounded-xl border border-border bg-card p-4">
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                    Language
                  </p>

                  <div className="mt-2 flex items-center gap-2">
                    <span className="rounded-lg bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary">
                      English
                    </span>

                    <span className="rounded-lg bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary">
                      हिंदी
                    </span>
                  </div>
                </div>
              </div>
            </aside>
          </div>
        </section>

        {/* Footer note */}
        <div className="mt-4 flex items-center justify-center gap-2 text-center text-[11px] text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5 text-primary" />
          Field guidance is based on the available departmental knowledge base.
        </div>
      </div>
    </main>
  );
}