"use client";

import {
  Bot,
  CheckCircle2,
  Loader2,
  MessageSquareText,
  Mic,
  MicOff,
  Send,
  ShieldCheck,
  Square,
  Trees,
  Volume2,
  Zap,
} from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { DailyDiary } from "@/components/field/daily-diary";
import IncidentReport from "@/components/field/incident-report";
import SpeciesIdentification from "@/components/field/species-identification";
import { OffenceSeizureReport } from "@/components/field/offence-seizure-report";

import { apiRequest } from "@/lib/api";
import { useSpeech } from "@/hooks/useSpeech";
import { PatrolReportForm } from "@/components/field/patrol-report-form";
import { PatrolDrafts } from "@/components/field/patrol-drafts";
import { SubmittedPatrolReport } from "@/components/field/submitted-patrol-report";

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
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: FieldSource[];
};

type ReviewStatus =
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "CHANGES_REQUESTED";

type PatrolReportDraft = {
  report_id: string;
  form_type: string;
  status: string;

  review_status?: ReviewStatus;
  review_comment?: string | null;
  reviewed_by?: string | null;
  reviewed_at?: string | null;

  patrol_date: string | null;
  beat: string | null;
  range_name: string | null;
  division: string | null;

  start_time: string | null;
  end_time: string | null;

  location: string | null;
  team_members: string[];

  purpose: string | null;
  observations: string | null;
  wildlife_sighting: string | null;
  illegal_activity: string | null;
  action_taken: string | null;
  incident_details: string | null;
  additional_remarks: string | null;

  source_text: string | null;
  ai_confidence: number | null;

  created_at: string | null;
  updated_at: string | null;
  submitted_at: string | null;
};

function createMessageId() {
  return `${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`;
}

/**
 * Detect whether the supplied text contains Devanagari characters.
 */
function isHindiText(text: string): boolean {
  return /[\u0900-\u097F]/.test(text);
}

/**
 * Wait for browser speech voices to become available.
 */
async function getAvailableVoices(): Promise<
  SpeechSynthesisVoice[]
> {
  if (
    typeof window === "undefined" ||
    !("speechSynthesis" in window)
  ) {
    return [];
  }

  const synth = window.speechSynthesis;
  const initialVoices = synth.getVoices();

  if (initialVoices.length > 0) {
    return initialVoices;
  }

  return new Promise((resolve) => {
    let settled = false;

    const finish = () => {
      if (settled) return;

      settled = true;

      synth.removeEventListener(
        "voiceschanged",
        finish,
      );

      resolve(synth.getVoices());
    };

    synth.addEventListener(
      "voiceschanged",
      finish,
    );

    window.setTimeout(finish, 1000);
  });
}

/**
 * Find the best browser voice for Hindi/English.
 */
function findVoice(
  voices: SpeechSynthesisVoice[],
  language: "hi-IN" | "en-IN",
): SpeechSynthesisVoice | null {
  const normalizedLanguage =
    language.toLowerCase();

  const languagePrefix =
    normalizedLanguage.split("-")[0];

  const exact = voices.find(
    (voice) =>
      voice.lang.toLowerCase() ===
      normalizedLanguage,
  );

  if (exact) {
    return exact;
  }

  const sameLanguage = voices.find((voice) =>
    voice.lang
      .toLowerCase()
      .startsWith(languagePrefix),
  );

  if (sameLanguage) {
    return sameLanguage;
  }

  if (language === "en-IN") {
    return (
      voices.find((voice) =>
        voice.lang
          .toLowerCase()
          .startsWith("en"),
      ) ?? null
    );
  }

  return null;
}

async function speakFieldAnswer(
  text: string,
  messageId: string,
  setSpeakingMessageId: React.Dispatch<
    React.SetStateAction<string | null>
  >,
) {
  if (
    typeof window === "undefined" ||
    !("speechSynthesis" in window)
  ) {
    toast.error(
      "Voice output is not supported in this browser.",
    );
    return;
  }

  const cleanedText = text.trim();

  if (!cleanedText) {
    toast.error(
      "There is no text available to speak.",
    );
    return;
  }

  const synth = window.speechSynthesis;

  synth.cancel();
  setSpeakingMessageId(null);

  const isHindi = isHindiText(cleanedText);

  const targetLanguage: "hi-IN" | "en-IN" =
    isHindi ? "hi-IN" : "en-IN";

  const voices = await getAvailableVoices();

  const matchingVoice = findVoice(
    voices,
    targetLanguage,
  );

  const utterance =
    new SpeechSynthesisUtterance(cleanedText);

  utterance.lang = targetLanguage;

  if (matchingVoice) {
    utterance.voice = matchingVoice;
  }

  utterance.rate = 0.9;
  utterance.pitch = 1;
  utterance.volume = 1;

  utterance.onstart = () => {
    setSpeakingMessageId(messageId);
  };

  utterance.onend = () => {
    setSpeakingMessageId(null);
  };

  utterance.onerror = (event) => {
    console.error(
      "Speech synthesis error:",
      event,
    );

    setSpeakingMessageId(null);

    toast.error(
      isHindi
        ? "Hindi voice playback failed. Please check that a Hindi speech voice is installed."
        : "Voice playback failed.",
    );
  };

  setSpeakingMessageId(messageId);

  window.setTimeout(() => {
    synth.speak(utterance);
  }, 0);
}

const quickPrompts = [
  {
    title: "Patrolling",
    prompt:
      "What are the important things I should check during forest patrolling?",
  },
  {
    title: "Safety",
    prompt:
      "What should I do immediately after a snake bite during field duty?",
  },
  {
    title: "SOPs",
    prompt:
      "Explain the important field procedures I should follow during an incident.",
  },
];

export default function FieldOfficerPage() {
  const [messages, setMessages] =
    React.useState<Message[]>([]);

  const [input, setInput] =
    React.useState("");

  const [isSending, setIsSending] =
    React.useState(false);

  const [
    speakingMessageId,
    setSpeakingMessageId,
  ] = React.useState<string | null>(null);

  /*
   * Selected patrol draft for edit mode.
   *
   * null = new patrol report
   * object = existing draft being edited
   */
  const [
    selectedDraft,
    setSelectedDraft,
  ] =
    React.useState<PatrolReportDraft | null>(
      null,
    );

  const [showPatrolForm, setShowPatrolForm] =
    React.useState(true);
  
  const [patrolDraftRefreshKey, setPatrolDraftRefreshKey] = React.useState(0);

  const [
    selectedSubmittedReport,
    setSelectedSubmittedReport,
  ] = React.useState<PatrolReportDraft | null>(
    null,
  );

  const messagesEndRef =
    React.useRef<HTMLDivElement | null>(
      null,
    );

  const stopSpeaking =
    React.useCallback(() => {
      if (
        typeof window !== "undefined" &&
        "speechSynthesis" in window
      ) {
        window.speechSynthesis.cancel();
      }

      setSpeakingMessageId(null);
    }, []);

  const sendMessage =
    React.useCallback(
      async (question: string) => {
        const trimmed = question.trim();

        if (!trimmed || isSending) {
          return;
        }

        stopSpeaking();

        setInput("");
        setIsSending(true);

        const userMessage: Message = {
          id: createMessageId(),
          role: "user",
          content: trimmed,
        };

        setMessages((previous) => [
          ...previous,
          userMessage,
        ]);

        try {
          const result =
            await apiRequest<FieldChatResponse>(
              "/api/v1/field/chat",
              {
                method: "POST",
                body: JSON.stringify({
                  question: trimmed,
                }),
              },
            );

          if (!result.success) {
            throw new Error(
              "Field Assistant request failed.",
            );
          }

          const response = result;

          const assistantMessage: Message = {
            id: createMessageId(),
            role: "assistant",
            content:
              response.answer ||
              "I could not generate a response.",
            sources: response.sources ?? [],
          };

          setMessages((previous) => [
            ...previous,
            assistantMessage,
          ]);
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "Unable to get a response from the Field Assistant.";

          toast.error(message);
        } finally {
          setIsSending(false);
        }
      },
      [isSending, stopSpeaking],
    );

  const handleTranscriptReady =
    React.useCallback(
      (transcriptText: string) => {
        const cleaned =
          transcriptText.trim();

        if (!cleaned) {
          toast.error(
            "No speech was detected.",
          );
          return;
        }

        setInput(cleaned);

        void sendMessage(cleaned);
      },
      [sendMessage],
    );

  const {
    permission,
    connectionState,
    transcript,
    language,
    errorMessage,
    start,
    stop,
  } = useSpeech({
    onTranscriptReady:
      handleTranscriptReady,
  });

  const isRecording =
    connectionState === "connecting" ||
    connectionState === "listening" ||
    connectionState === "streaming" ||
    connectionState === "paused";

  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: "smooth",
    });
  }, [messages, isSending]);

  React.useEffect(() => {
    return () => {
      if (
        typeof window !== "undefined" &&
        "speechSynthesis" in window
      ) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const handleSubmit = (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();

    void sendMessage(input);
  };

  const handleMic = () => {
    if (isRecording) {
      stop();
      return;
    }

    void start();
  };

  /**
   * Called after the selected draft is successfully
   * updated from PatrolReportForm.
   *
   * Keeping the selected draft means the form remains
   * in edit mode until the user explicitly resets/closes it.
   */
  const handleDraftSaved = React.useCallback(() => {
    setPatrolDraftRefreshKey((prev) => prev + 1);
    toast.success("Patrol draft saved successfully.");
  }, []);

  return (
    <main className="min-h-[calc(100vh-64px)] bg-background text-foreground">


      <div className="mx-auto flex min-h-[calc(100vh-64px)] max-w-7xl flex-col px-4 py-6 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2">
              <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10">
                <Trees className="size-5 text-primary" />
              </div>

              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                  UP Forest Department
                </p>

                <h1 className="text-2xl font-bold tracking-tight">
                  Field Officer Assistant
                </h1>
              </div>
            </div>

            <p className="max-w-2xl text-sm text-muted-foreground">
              Ask operational, safety and forest-related
              questions using text or your voice. Responses
              are grounded in the Forest Department knowledge
              base.
            </p>
          </div>

          <div className="flex items-center gap-2 self-start rounded-full border border-border bg-card px-3 py-2 text-xs text-muted-foreground shadow-sm">
            <span className="size-2 rounded-full bg-emerald-500" />
            AI Assistant Online
          </div>
        </div>

        {/* Main */}
        <div className="grid flex-1 gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
          {/* Chat */}
          <section className="flex min-h-[650px] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
            {/* Chat header */}
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-xl bg-primary">
                  <Bot className="size-5 text-primary-foreground" />
                </div>

                <div>
                  <p className="font-semibold">
                    Forest Field AI
                  </p>

                  <p className="text-xs text-muted-foreground">
                    Grounded field assistance
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary">
                <ShieldCheck className="size-3.5" />
                Verified Knowledge
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-5">
              {messages.length === 0 ? (
                <div className="flex min-h-[500px] items-center justify-center">
                  <div className="max-w-xl text-center">
                    <div className="mx-auto mb-5 flex size-16 items-center justify-center rounded-2xl bg-primary/10">
                      <MessageSquareText className="size-8 text-primary" />
                    </div>

                    <h2 className="text-xl font-semibold">
                      How can I help you in the field?
                    </h2>

                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      Ask a question by typing or use the
                      microphone to speak naturally in Hindi or
                      English.
                    </p>

                    <div className="mt-6 grid gap-3 sm:grid-cols-3">
                      {quickPrompts.map(
                        (item) => (
                          <button
                            key={item.title}
                            type="button"
                            onClick={() =>
                              void sendMessage(
                                item.prompt,
                              )
                            }
                            disabled={
                              isSending ||
                              isRecording
                            }
                            className="rounded-xl border border-border bg-background p-4 text-left transition hover:border-primary/40 hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <p className="text-sm font-semibold">
                              {item.title}
                            </p>

                            <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                              {item.prompt}
                            </p>
                          </button>
                        ),
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-5">
                  {messages.map(
                    (message) => (
                      <div
                        key={message.id}
                        className={`flex ${message.role ===
                            "user"
                            ? "justify-end"
                            : "justify-start"
                          }`}
                      >
                        <div
                          className={`max-w-[85%] ${message.role ===
                              "user"
                              ? "rounded-2xl rounded-br-md bg-primary px-4 py-3 text-primary-foreground"
                              : "rounded-2xl rounded-bl-md border border-border bg-background px-4 py-3"
                            }`}
                        >
                          <div className="flex items-center gap-2">
                            {message.role ===
                              "assistant" && (
                                <Bot className="size-4 text-primary" />
                              )}

                            <span className="text-xs font-semibold opacity-80">
                              {message.role ===
                                "user"
                                ? "You"
                                : "Field AI"}
                            </span>
                          </div>

                          <p className="mt-2 whitespace-pre-wrap text-sm leading-6">
                            {message.content}
                          </p>

                          {message.role ===
                            "assistant" && (
                              <div className="mt-3 flex items-center">
                                {speakingMessageId ===
                                  message.id ? (
                                  <button
                                    type="button"
                                    onClick={
                                      stopSpeaking
                                    }
                                    className="inline-flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary transition hover:bg-primary/15"
                                  >
                                    <Square className="size-3.5" />
                                    Stop voice
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void speakFieldAnswer(
                                        message.content,
                                        message.id,
                                        setSpeakingMessageId,
                                      )
                                    }
                                    className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:border-primary/30 hover:bg-primary/5 hover:text-primary"
                                  >
                                    <Volume2 className="size-3.5" />
                                    Listen
                                  </button>
                                )}
                              </div>
                            )}

                          {message.sources &&
                            message.sources
                              .length > 0 && (
                              <div className="mt-4 border-t border-border/70 pt-3">
                                <p className="mb-2 text-xs font-semibold text-muted-foreground">
                                  Sources
                                </p>

                                <div className="space-y-2">
                                  {message.sources.map(
                                    (
                                      source,
                                      index,
                                    ) => (
                                      <div
                                        key={`${source.filename}-${source.page}-${index}`}
                                        className="rounded-lg border border-border bg-card px-3 py-2"
                                      >
                                        <p className="text-xs font-medium">
                                          {source.filename ||
                                            "Forest Department Source"}
                                        </p>

                                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                                          {source.page
                                            ? `Page ${source.page}`
                                            : "Reference source"}
                                        </p>
                                      </div>
                                    ),
                                  )}
                                </div>
                              </div>
                            )}
                        </div>
                      </div>
                    ),
                  )}

                  {isSending && (
                    <div className="flex justify-start">
                      <div className="flex items-center gap-2 rounded-2xl rounded-bl-md border border-border bg-background px-4 py-3">
                        <Loader2 className="size-4 animate-spin text-primary" />

                        <span className="text-sm text-muted-foreground">
                          Searching Forest Department
                          knowledge...
                        </span>
                      </div>
                    </div>
                  )}

                  <div ref={messagesEndRef} />
                </div>
              )}
            </div>

            {/* Voice transcript status */}
            {(isRecording ||
              transcript) && (
                <div className="border-t border-border bg-primary/5 px-5 py-3">
                  <div className="flex items-start gap-3">
                    <div
                      className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full ${isRecording
                          ? "bg-red-500/10"
                          : "bg-primary/10"
                        }`}
                    >
                      {isRecording ? (
                        <Mic className="size-4 text-red-500" />
                      ) : (
                        <MessageSquareText className="size-4 text-primary" />
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-xs font-semibold">
                          {isRecording
                            ? "Listening..."
                            : "Voice transcript"}
                        </p>

                        {language && (
                          <span className="rounded-full bg-background px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                            {language.toUpperCase()}
                          </span>
                        )}
                      </div>

                      <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                        {transcript ||
                          "Speak your question..."}
                      </p>
                    </div>
                  </div>
                </div>
              )}

            {/* Composer */}
            <form
              onSubmit={handleSubmit}
              className="border-t border-border p-4"
            >
              {errorMessage && (
                <p className="mb-2 text-xs text-destructive">
                  {errorMessage}
                </p>
              )}

              {permission ===
                "denied" && (
                  <p className="mb-2 text-xs text-destructive">
                    Microphone permission is blocked. Allow
                    microphone access in your browser settings.
                  </p>
                )}

              <div className="flex items-end gap-2">
                <button
                  type="button"
                  onClick={handleMic}
                  disabled={isSending}
                  aria-label={
                    isRecording
                      ? "Stop recording"
                      : "Start voice input"
                  }
                  className={`flex size-11 shrink-0 items-center justify-center rounded-xl border transition ${isRecording
                      ? "border-red-500/30 bg-red-500/10 text-red-500"
                      : "border-border bg-background text-foreground hover:border-primary/40 hover:bg-primary/5"
                    } disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  {isRecording ? (
                    <MicOff className="size-5" />
                  ) : (
                    <Mic className="size-5" />
                  )}
                </button>

                <textarea
                  value={input}
                  onChange={(event) =>
                    setInput(
                      event.target.value,
                    )
                  }
                  onKeyDown={(event) => {
                    if (
                      event.key ===
                      "Enter" &&
                      !event.shiftKey
                    ) {
                      event.preventDefault();

                      void sendMessage(
                        input,
                      );
                    }
                  }}
                  placeholder="Ask a field-related question..."
                  rows={1}
                  disabled={
                    isSending ||
                    isRecording
                  }
                  className="min-h-11 flex-1 resize-none rounded-xl border border-border bg-background px-4 py-3 text-sm outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/10 disabled:cursor-not-allowed disabled:opacity-60"
                />

                <button
                  type="submit"
                  disabled={
                    !input.trim() ||
                    isSending ||
                    isRecording
                  }
                  className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label="Send message"
                >
                  {isSending ? (
                    <Loader2 className="size-5 animate-spin" />
                  ) : (
                    <Send className="size-5" />
                  )}
                </button>
              </div>

              <div className="mt-2 flex items-center justify-between px-1">
                <p className="text-[11px] text-muted-foreground">
                  Press Enter to send • Shift + Enter for a new
                  line
                </p>

                <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Zap className="size-3" />
                  <span>RAG grounded</span>
                </div>
              </div>
            </form>
          </section>

          {/* Right panel */}
          <aside className="space-y-4">
            <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10">
                  <Mic className="size-5 text-primary" />
                </div>

                <div>
                  <h3 className="font-semibold">
                    Voice Assistant
                  </h3>

                  <p className="text-xs text-muted-foreground">
                    Hindi + English
                  </p>
                </div>
              </div>

              <div className="mt-5 space-y-3">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />

                  <p className="text-xs leading-5 text-muted-foreground">
                    Speak naturally from the field.
                  </p>
                </div>

                <div className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />

                  <p className="text-xs leading-5 text-muted-foreground">
                    Live transcription while speaking.
                  </p>
                </div>

                <div className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />

                  <p className="text-xs leading-5 text-muted-foreground">
                    Refined transcript is sent to the RAG
                    assistant.
                  </p>
                </div>

                <div className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />

                  <p className="text-xs leading-5 text-muted-foreground">
                    Answers include knowledge-base sources
                    when available.
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-primary/20 bg-primary/5 p-5">
              <div className="flex items-center gap-2">
                <Volume2 className="size-4 text-primary" />

                <h3 className="text-sm font-semibold">
                  Field Workflow
                </h3>
              </div>

              <div className="mt-4 space-y-3">
                {[
                  "Speak your question",
                  "AI transcribes the query",
                  "RAG searches approved content",
                  "Field-ready answer is returned",
                ].map((step, index) => (
                  <div
                    key={step}
                    className="flex items-center gap-3"
                  >
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                      {index + 1}
                    </span>

                    <span className="text-xs text-muted-foreground">
                      {step}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}