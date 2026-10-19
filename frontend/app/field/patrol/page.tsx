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

            {/* Submitted Patrol Report Viewer */}
      {selectedSubmittedReport && (
        <SubmittedPatrolReport
          report={selectedSubmittedReport}
          onClose={() => {
            setSelectedSubmittedReport(null);

            window.setTimeout(() => {
              document
                .getElementById("patrol-report-history")
                ?.scrollIntoView({
                  behavior: "smooth",
                  block: "start",
                });
            }, 50);
          }}
        />
      )}
      {/* Patrol Report Form */}
      {showPatrolForm && (
        <PatrolReportForm
          initialDraft={selectedDraft}
          onSaved={handleDraftSaved}
          onClose={() => {
            setSelectedDraft(null);
            setShowPatrolForm(false);
          }}
        />
      )}

      {/* Patrol Drafts */}
      <PatrolDrafts
        refreshKey={patrolDraftRefreshKey}
        onOpenDraft={(draft) => {
          setSelectedDraft(draft);
          setShowPatrolForm(true);

          window.setTimeout(() => {
            document
              .getElementById("submitted-patrol-report")
              ?.scrollIntoView({
                behavior: "smooth",
                block: "start",
              });
          }, 50);
          toast.success(
            "Draft opened for editing.",
          );
        }}
        onViewSubmitted={(report) => {
          setSelectedSubmittedReport(report);

          window.setTimeout(() => {
            window.scrollTo({
              top: 0,
              behavior: "smooth",
            });
          }, 50);
        }}
      />
    </main>
  );
}