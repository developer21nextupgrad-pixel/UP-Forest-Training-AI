"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { apiRequest } from "@/lib/api";
import { getStoredUser } from "@/lib/auth";

import {
  askTutor,
  createTutorSession,
  getTutorSession,
  listTutorSessions,
} from "@/services/tutor.service";

import type {
  TutorCitation,
  TutorMessage,
  TutorSession,
} from "@/types/tutor";

type Message = {
  role: "USER" | "ASSISTANT";
  content: string;
  citations?: TutorCitation[];
  grounded?: boolean;
};

type SourceResponse = {
  document_id: string;
  version_id: string;
  page_number: number;
  printed_page_number: number | null;
  chapter_id: string | null;
  section_id: string | null;
  section: string | null;
  markdown: string | null;
  plain_text: string | null;
};

export default function TutorPage() {
  const router = useRouter();

  const [sessions, setSessions] = useState<TutorSession[]>([]);
  const [sessionId, setSessionId] = useState<string>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [language, setLanguage] = useState("auto");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [scope, setScope] = useState<{
    subject_id?: string;
    chapter_id?: string;
  }>({});

  // =========================================================
  // LOAD SESSIONS
  // =========================================================

  async function loadSessions() {
    try {
      setError("");

      const response = await listTutorSessions();

      if (!response.success) {
        setError(response.message);
        return;
      }

      setSessions(response.data || []);
    } catch (err) {
      console.error("Failed to load tutor sessions:", err);
      setError("Failed to load tutor sessions.");
    }
  }

  // =========================================================
  // INITIAL LOAD
  // =========================================================

  useEffect(() => {
    const user = getStoredUser();

    if (!user) {
      router.push("/login");
      return;
    }

    void loadSessions();
  }, [router]);

  // =========================================================
  // OPEN EXISTING SESSION
  // =========================================================

  async function openSession(id: string) {
    try {
      setError("");
      setLoading(true);

      /*
       * Get session metadata from the sessions list.
       *
       * IMPORTANT:
       * getTutorSession() returns TutorMessage[],
       * not TutorSession.
       */
      const selectedSession = sessions.find(
        (session) => session.id === id
      );

      if (selectedSession) {
        setSessionId(selectedSession.id);

        setScope({
          subject_id:
            selectedSession.subject_id ?? undefined,
          chapter_id:
            selectedSession.chapter_id ?? undefined,
        });
      } else {
        setSessionId(id);
      }

      /*
       * Backend returns TutorMessage[]
       */
      const response = await getTutorSession(id);

      if (!response.success) {
        setError(response.message);
        return;
      }

      const tutorMessages = response.data || [];

      /*
       * UI only supports USER and ASSISTANT messages.
       * SYSTEM messages are ignored.
       */
      const mappedMessages: Message[] = tutorMessages
        .filter(
          (message: TutorMessage) =>
            message.role === "USER" ||
            message.role === "ASSISTANT"
        )
        .map((message: TutorMessage) => ({
          role: message.role as "USER" | "ASSISTANT",
          content: message.content,
        }));

      setMessages(mappedMessages);
    } catch (err) {
      console.error("Failed to open tutor session:", err);
      setError("Failed to open tutor session.");
    } finally {
      setLoading(false);
    }
  }

  // =========================================================
  // CLEAN ALL CHATS
  // =========================================================

  async function cleanAllChats() {
    if (loading || sessions.length === 0) {
      return;
    }

    const confirmed = window.confirm(
      "Are you sure you want to clear all tutor chats? This cannot be undone."
    );

    if (!confirmed) {
      return;
    }

    try {
      setError("");
      setLoading(true);

      // Delete each session using the existing backend delete endpoint.
      for (const session of sessions) {
        const response = await apiRequest<any>(
          `/api/v1/tutor/sessions/${session.id}`,
          { method: "DELETE" }
        );

        if (!response.success) {
          throw new Error(response.message || "Failed to delete tutor chat.");
        }
      }

      setSessions([]);
      setSessionId(undefined);
      setMessages([]);
      setInput("");
      setScope({});
    } catch (err) {
      console.error("Failed to clean tutor chats:", err);
      setError("Failed to clear all tutor chats.");
      await loadSessions();
    } finally {
      setLoading(false);
    }
  }

  // =========================================================
  // CREATE NEW CHAT
  // =========================================================

  async function newChat() {
    try {
      setError("");
      setLoading(true);

      const response = await createTutorSession({
        subject_id: scope.subject_id,
        chapter_id: scope.chapter_id,
        language:
          language === "auto" ? undefined : language,
      });

      if (!response.success) {
        setError(response.message);
        return;
      }

      const session = response.data;

      setSessionId(session.id);

      setMessages([]);

      setScope({
        subject_id: session.subject_id ?? undefined,
        chapter_id: session.chapter_id ?? undefined,
      });

      await loadSessions();
    } catch (err) {
      console.error("Failed to create tutor session:", err);
      setError("Failed to create new chat.");
    } finally {
      setLoading(false);
    }
  }

  // =========================================================
  // SEND MESSAGE
  // =========================================================

  async function send() {
    const question = input.trim();

    if (!question || loading) {
      return;
    }

    setError("");

    let activeSessionId = sessionId;

    try {
      setLoading(true);

      // -----------------------------------------------------
      // CREATE SESSION IF NEEDED
      // -----------------------------------------------------

      if (!activeSessionId) {
        const createResponse = await createTutorSession({
          subject_id: scope.subject_id,
          chapter_id: scope.chapter_id,
          language:
            language === "auto" ? undefined : language,
        });

        if (!createResponse.success) {
          setError(createResponse.message);
          return;
        }

        activeSessionId = createResponse.data.id;

        setSessionId(activeSessionId);

        setScope({
          subject_id:
            createResponse.data.subject_id ?? undefined,
          chapter_id:
            createResponse.data.chapter_id ?? undefined,
        });

        await loadSessions();
      }

      // -----------------------------------------------------
      // ADD USER MESSAGE TO UI
      // -----------------------------------------------------

      const userMessage: Message = {
        role: "USER",
        content: question,
      };

      setMessages((previous) => [
        ...previous,
        userMessage,
      ]);

      setInput("");

      // -----------------------------------------------------
      // ASK AI TUTOR
      // -----------------------------------------------------

      const response = await askTutor({
        session_id: activeSessionId,
        message: question,
        language,
        subject_id: scope.subject_id,
        chapter_id: scope.chapter_id,
      });

      if (!response.success) {
        setError(response.message);
        return;
      }

      // -----------------------------------------------------
      // ADD ASSISTANT RESPONSE
      // -----------------------------------------------------

      const assistantMessage: Message = {
        role: "ASSISTANT",
        content: response.data.answer,
        citations: response.data.citations || [],
        grounded: response.data.grounded,
      };

      setMessages((previous) => [
        ...previous,
        assistantMessage,
      ]);

      // Refresh session list because updated_at/title may change.
      await loadSessions();
    } catch (err) {
      console.error("Tutor request failed:", err);
      setError(
        "Unable to get an answer from AI Tutor."
      );
    } finally {
      setLoading(false);
    }
  }

  // =========================================================
  // OPEN SOURCE
  // =========================================================

  async function openSource(citation: TutorCitation) {
    if (!citation.page) {
      return;
    }

    /*
     * Open window immediately because browsers can block
     * popups if window.open() happens after await.
     */
    const sourceWindow = window.open(
      "",
      "_blank"
    );

    if (!sourceWindow) {
      setError(
        "Please allow pop-ups to open the source."
      );
      return;
    }

    // -------------------------------------------------------
    // LOADING PAGE
    // -------------------------------------------------------

    sourceWindow.document.open();

    sourceWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8" />
          <meta
            name="viewport"
            content="width=device-width, initial-scale=1.0"
          />
          <title>Loading Source...</title>

          <style>
            body {
              margin: 0;
              background: #f8fafc;
              font-family:
                Arial,
                Helvetica,
                sans-serif;
              color: #334155;
            }

            .loading {
              max-width: 900px;
              margin: 80px auto;
              padding: 24px;
              text-align: center;
            }
          </style>
        </head>

        <body>
          <div class="loading">
            Loading source...
          </div>
        </body>
      </html>
    `);

    sourceWindow.document.close();

    try {
      setError("");

      // -----------------------------------------------------
      // AUTHENTICATED API REQUEST
      // -----------------------------------------------------

      const response = await apiRequest<SourceResponse>(
        `/api/v1/content/documents/${citation.document_id}/source?page_number=${citation.page}`
      );

      if (!response.success) {
        sourceWindow.document.open();

        sourceWindow.document.write(`
          <!DOCTYPE html>
          <html>
            <head>
              <meta charset="UTF-8" />
              <title>Source Error</title>
            </head>

            <body>
              <div
                style="
                  font-family: Arial, sans-serif;
                  max-width: 800px;
                  margin: 60px auto;
                  padding: 24px;
                  color: #b91c1c;
                "
              >
                Unable to load source.
              </div>
            </body>
          </html>
        `);

        sourceWindow.document.close();

        setError(response.message);
        return;
      }

      const source = response.data;

      const content =
        source.plain_text ||
        source.markdown ||
        "No source content available.";

      // -----------------------------------------------------
      // SOURCE PAGE
      // -----------------------------------------------------

      sourceWindow.document.open();

      sourceWindow.document.write(`
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="UTF-8" />

            <meta
              name="viewport"
              content="width=device-width, initial-scale=1.0"
            />

            <title>Source Document</title>

            <style>
              * {
                box-sizing: border-box;
              }

              body {
                margin: 0;
                background: #f8fafc;
                color: #1e293b;
                font-family:
                  Arial,
                  Helvetica,
                  sans-serif;
              }

              .page {
                max-width: 1000px;
                margin: 40px auto;
                padding:
                  0 24px 60px;
              }

              .header {
                background: white;
                border: 1px solid #e2e8f0;
                border-radius: 12px;
                padding: 24px;
                margin-bottom: 20px;
                box-shadow:
                  0 2px 8px
                  rgba(15, 23, 42, 0.05);
              }

              .title {
                font-size: 24px;
                font-weight: 700;
                margin:
                  0 0 10px;
              }

              .meta {
                color: #64748b;
                font-size: 14px;
                line-height: 1.6;
              }

              .content-card {
                background: white;
                border: 1px solid #e2e8f0;
                border-radius: 12px;
                padding: 32px;
                box-shadow:
                  0 2px 8px
                  rgba(15, 23, 42, 0.05);
              }

              .content {
                white-space: pre-wrap;
                word-break: break-word;
                font-size: 16px;
                line-height: 1.8;
              }
            </style>
          </head>

          <body>
            <div class="page">

              <div class="header">
                <h1
                  class="title"
                  id="source-title"
                ></h1>

                <div
                  class="meta"
                  id="source-meta"
                ></div>
              </div>

              <div class="content-card">
                <div
                  class="content"
                  id="source-content"
                ></div>
              </div>

            </div>
          </body>
        </html>
      `);

      sourceWindow.document.close();

      // -----------------------------------------------------
      // SAFELY INSERT DYNAMIC CONTENT
      // -----------------------------------------------------

      const titleElement =
        sourceWindow.document.getElementById(
          "source-title"
        );

      const metaElement =
        sourceWindow.document.getElementById(
          "source-meta"
        );

      const contentElement =
        sourceWindow.document.getElementById(
          "source-content"
        );

      if (titleElement) {
        titleElement.textContent =
          citation.book_title ||
          "Source Document";
      }

      if (metaElement) {
        const printedPage =
          source.printed_page_number !== null
            ? ` · Printed Page ${source.printed_page_number}`
            : "";

        const section =
          source.section ||
          citation.section
            ? ` · ${
                source.section ||
                citation.section
              }`
            : "";

        metaElement.textContent =
          `Page ${source.page_number}` +
          printedPage +
          section;
      }

      if (contentElement) {
        /*
         * textContent is intentional.
         *
         * We don't inject OCR/markdown as raw HTML.
         */
        contentElement.textContent = content;
      }
    } catch (err) {
      console.error(
        "Failed to open source:",
        err
      );

      sourceWindow.document.open();

      sourceWindow.document.write(`
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="UTF-8" />
            <title>Source Error</title>
          </head>

          <body>
            <div
              style="
                font-family: Arial, sans-serif;
                max-width: 800px;
                margin: 60px auto;
                padding: 24px;
                color: #b91c1c;
              "
            >
              Failed to load source document.
            </div>
          </body>
        </html>
      `);

      sourceWindow.document.close();

      setError(
        "Failed to load source document."
      );
    }
  }

  // =========================================================
  // ENTER KEY
  // =========================================================

  function handleKeyDown(
    event: React.KeyboardEvent<HTMLTextAreaElement>
  ) {
    if (
      event.key === "Enter" &&
      !event.shiftKey
    ) {
      event.preventDefault();
      void send();
    }
  }

  // =========================================================
  // UI
  // =========================================================

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto flex min-h-screen max-w-7xl">

        {/* =================================================
            SIDEBAR
        ================================================== */}

        <aside className="hidden w-72 border-r bg-card p-4 lg:block">

          <div className="mb-6 flex items-center justify-between">

            <div>
              <h2 className="text-lg font-semibold">
                AI Tutor
              </h2>

              <p className="text-sm text-muted-foreground">
                Forest Learning Assistant
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void newChat()}
                disabled={loading}
                className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
              >
                New Chat
              </button>

              {sessions.length > 0 && (
                <button
                  type="button"
                  onClick={() => void cleanAllChats()}
                  disabled={loading}
                  className="rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading ? "Cleaning..." : "Clean"}
                </button>
              )}
            </div>

          </div>

          <div className="space-y-2">

            {sessions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No previous chats.
              </p>
            ) : (
              sessions.map((session) => (
                <button
                  key={session.id}
                  type="button"
                  onClick={() =>
                    void openSession(session.id)
                  }
                  className={`w-full rounded-lg border p-3 text-left transition hover:bg-muted ${
                    session.id === sessionId
                      ? "bg-muted"
                      : "bg-background"
                  }`}
                >
                  <p className="truncate text-sm font-medium">
                    {session.title ||
                      "New Conversation"}
                  </p>

                  <p className="mt-1 text-xs text-muted-foreground">
                    {session.updated_at
                      ? new Date(
                          session.updated_at
                        ).toLocaleDateString()
                      : ""}
                  </p>
                </button>
              ))
            )}

          </div>
        </aside>

        {/* =================================================
            MAIN
        ================================================== */}

        <section className="flex min-h-screen flex-1 flex-col">

          {/* HEADER */}

          <header className="border-b bg-card px-4 py-4 sm:px-6">

            <div className="flex flex-wrap items-center justify-between gap-4">

              <div>
                <h1 className="text-xl font-semibold">
                  AI Tutor
                </h1>

                <p className="text-sm text-muted-foreground">
                  Ask questions from your forest
                  training material.
                </p>
              </div>

              <div className="flex items-center gap-2">

                <label
                  htmlFor="language"
                  className="text-sm text-muted-foreground"
                >
                  Language
                </label>

                <select
                  id="language"
                  value={language}
                  onChange={(event) =>
                    setLanguage(
                      event.target.value
                    )
                  }
                  className="rounded-md border bg-background px-3 py-2 text-sm"
                >
                  <option value="auto">
                    Auto
                  </option>

                  <option value="en">
                    English
                  </option>

                  <option value="hi">
                    Hindi
                  </option>
                </select>

              </div>

            </div>
          </header>

          {/* ERROR */}

          {error && (
            <div className="mx-4 mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 sm:mx-6">
              {error}
            </div>
          )}

          {/* =================================================
              MESSAGES
          ================================================== */}

          <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-6">

            {messages.length === 0 ? (

              <div className="mx-auto flex min-h-[60vh] max-w-3xl flex-col items-center justify-center text-center">

                <div className="mb-4 rounded-full border bg-card p-4">
                  <span className="text-2xl">
                    🤖
                  </span>
                </div>

                <h2 className="text-2xl font-semibold">
                  How can I help you?
                </h2>

                <p className="mt-2 max-w-xl text-muted-foreground">
                  Ask anything about the uploaded
                  Forest Department learning material.
                </p>

                <div className="mt-6 grid w-full max-w-2xl gap-3 sm:grid-cols-2">

                  <button
                    type="button"
                    onClick={() =>
                      setInput(
                        "What are the main principles discussed in this document?"
                      )
                    }
                    className="rounded-lg border bg-card p-4 text-left text-sm hover:bg-muted"
                  >
                    What are the main principles
                    discussed in this document?
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      setInput(
                        "Explain the important points from this chapter."
                      )
                    }
                    className="rounded-lg border bg-card p-4 text-left text-sm hover:bg-muted"
                  >
                    Explain the important points
                    from this chapter.
                  </button>

                </div>

              </div>

            ) : (

              <div className="mx-auto max-w-4xl space-y-6">

                {messages.map(
                  (message, index) => (

                    <div
                      key={`${message.role}-${index}`}
                      className={`flex ${
                        message.role === "USER"
                          ? "justify-end"
                          : "justify-start"
                      }`}
                    >

                      <div
                        className={`max-w-[90%] rounded-2xl px-4 py-3 sm:max-w-[80%] ${
                          message.role === "USER"
                            ? "bg-primary text-primary-foreground"
                            : "border bg-card"
                        }`}
                      >

                        {/* MESSAGE */}

                        <div className="whitespace-pre-wrap text-sm leading-7">
                          {message.content}
                        </div>

                        {/* GROUNDED */}

                        {message.role ===
                          "ASSISTANT" &&
                          message.grounded !==
                            undefined && (
                            <div className="mt-3 text-xs text-muted-foreground">
                              {message.grounded
                                ? "✓ Grounded in learning material"
                                : "Answer generated without a matching source"}
                            </div>
                          )}

                        {/* SOURCES */}

                        {message.role ===
                          "ASSISTANT" &&
                          message.citations &&
                          message.citations.length >
                            0 && (

                            <div className="mt-4 rounded-lg border bg-muted/40 p-3">

                              <p className="mb-3 text-sm font-semibold">
                                Sources
                              </p>

                              <div className="space-y-3">

                                {message.citations.map(
                                  (citation) => (

                                    <div
                                      key={
                                        citation.source_id
                                      }
                                      className="rounded-md border bg-background p-3"
                                    >

                                      <p className="text-sm">
                                        [
                                        {
                                          citation.source_id
                                        }
                                        ]{" "}
                                        {
                                          citation.book_title
                                        }

                                        {citation.page
                                          ? ` — Pages ${citation.page}`
                                          : ""}

                                        {citation.section
                                          ? ` — ${citation.section}`
                                          : ""}
                                      </p>

                                      {/* AUTHENTICATED SOURCE BUTTON */}

                                      {citation.page && (
                                        <button
                                          type="button"
                                          onClick={() =>
                                            void openSource(
                                              citation
                                            )
                                          }
                                          className="mt-2 text-sm font-medium text-primary underline underline-offset-2 hover:opacity-80"
                                        >
                                          Open Source
                                        </button>
                                      )}

                                    </div>

                                  )
                                )}

                              </div>

                            </div>

                          )}

                      </div>

                    </div>

                  )
                )}

                {/* LOADING */}

                {loading && (
                  <div className="flex justify-start">

                    <div className="rounded-2xl border bg-card px-4 py-3">

                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <span>
                          AI Tutor is thinking
                        </span>

                        <span className="animate-pulse">
                          ...
                        </span>
                      </div>

                    </div>

                  </div>
                )}

              </div>

            )}

          </div>

          {/* =================================================
              INPUT
          ================================================== */}

          <div className="border-t bg-card px-4 py-4 sm:px-6">

            <div className="mx-auto max-w-4xl">

              <div className="flex items-end gap-2 rounded-xl border bg-background p-2">

                <textarea
                  value={input}
                  onChange={(event) =>
                    setInput(
                      event.target.value
                    )
                  }
                  onKeyDown={handleKeyDown}
                  placeholder="Ask AI Tutor..."
                  rows={1}
                  disabled={loading}
                  className="min-h-[44px] flex-1 resize-none bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50"
                />

                <button
                  type="button"
                  onClick={() => void send()}
                  disabled={
                    loading ||
                    !input.trim()
                  }
                  className="rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading
                    ? "Sending..."
                    : "Send"}
                </button>

              </div>

              <p className="mt-2 text-center text-xs text-muted-foreground">
                Press Enter to send · Shift +
                Enter for a new line
              </p>

            </div>

          </div>

        </section>
      </div>
    </main>
  );
}