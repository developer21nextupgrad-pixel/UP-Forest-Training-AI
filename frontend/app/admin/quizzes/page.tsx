// "use client";import{useEffect,useState}from"react";import{useRouter}from"next/navigation";import{getStoredUser}from"@/lib/auth";import{analyticsApi}from"@/services/analytics.service";export default function Page(){const router=useRouter();const[d,setD]=useState<any>();useEffect(()=>{const u=getStoredUser();if(!u||u.role!=="ADMIN"){router.replace("/login");return;}analyticsApi.adminQuizzes().then(setD)},[router]);if(!d)return <main className="p-8">Loading quiz analytics…</main>;return <main className="mx-auto max-w-6xl px-4 py-8"><h1 className="text-3xl font-semibold">Quiz analytics</h1><div className="mt-6 grid gap-4 sm:grid-cols-3"><div className="rounded-2xl border p-5">Attempts <b className="block text-3xl">{d.analytics.total_attempts}</b></div><div className="rounded-2xl border p-5">Average score <b className="block text-3xl">{d.analytics.average_score??"—"}%</b></div><div className="rounded-2xl border p-5">Pass rate <b className="block text-3xl">{d.analytics.pass_rate??"—"}%</b></div></div><pre className="mt-6 rounded-2xl border bg-card p-5 text-sm">{JSON.stringify(d.analytics.status,null,2)}</pre></main>}

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getStoredUser } from "@/lib/auth";
import { analyticsApi } from "@/services/analytics.service";
import {
  getManagedQuizzes,
  createQuiz,
  addQuestion,
  publishQuiz,
} from "@/services/quiz.service";

type Subject = {
  id: string;
  name: string;
  code: string;
};

type Chapter = {
  id: string;
  title: string;
  chapter_number: number;
};

type Quiz = {
  id: string;
  title: string;
  description?: string | null;
  subject_id: string;
  chapter_id?: string | null;
  status: string;
  language: string;
  difficulty?: string | null;
  time_limit_seconds?: number | null;
  passing_score: number;
  max_attempts?: number | null;
  is_published: boolean;
  question_count: number;
};

export default function Page() {
  const router = useRouter();

  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [selectedQuiz, setSelectedQuiz] = useState<Quiz | null>(null);

  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [addingQuestion, setAddingQuestion] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const [quizForm, setQuizForm] = useState({
    title: "",
    description: "",
    subject_id: "",
    chapter_id: "",
    language: "en",
    difficulty: "MEDIUM",
    time_limit_seconds: "600",
    passing_score: "60",
    max_attempts: "2",
  });

  const [questionForm, setQuestionForm] = useState({
    question_text: "",
    explanation: "",
    points: "1",
    options: [
      { label: "A", text: "", correct: true },
      { label: "B", text: "", correct: false },
      { label: "C", text: "", correct: false },
      { label: "D", text: "", correct: false },
    ],
  });

  async function loadData() {
  try {
    setLoading(true);
    setError("");

    const [subjectResponse, quizResponse] = await Promise.all([
      analyticsApi.adminSubjects(),
      getManagedQuizzes(),
    ]);


    setSubjects(subjectResponse?.items || []);
    setQuizzes(Array.isArray(quizResponse) ? quizResponse : []);
  } catch (err: any) {
    setError(err?.message || "Unable to load quiz data");
  } finally {
    setLoading(false);
  }
}

  useEffect(() => {
    const user = getStoredUser();

    if (!user || user.role !== "ADMIN") {
      router.replace("/login");
      return;
    }

    loadData();
  }, [router]);

  useEffect(() => {
    if (!quizForm.subject_id) {
      setChapters([]);
      return;
    }

    analyticsApi.adminSubjectChapters(quizForm.subject_id).then((response: any) => {
      if (!response?.success) {
        setChapters([]);
        setError(response?.message || "Unable to load chapters for this subject.");
        return;
      }
      setChapters(response.items || response.data?.items || []);
    });
  }, [quizForm.subject_id]);

  async function handleCreateQuiz(e: React.FormEvent) {
    e.preventDefault();

    try {
      setCreating(true);
      setError("");
      setMessage("");

      if (!quizForm.title.trim()) {
        throw new Error("Quiz title is required.");
      }

      if (!quizForm.subject_id) {
        throw new Error("Please select a subject.");
      }

      if (!quizForm.chapter_id) {
        throw new Error("Please select a chapter.");
      }

      const payload = {
        title: quizForm.title.trim(),
        description: quizForm.description.trim() || null,
        subject_id: quizForm.subject_id,

        chapter_id: quizForm.chapter_id,

        language: quizForm.language,
        difficulty: quizForm.difficulty,
        time_limit_seconds: quizForm.time_limit_seconds
          ? Number(quizForm.time_limit_seconds)
          : null,
        passing_score: Number(quizForm.passing_score),
        max_attempts: quizForm.max_attempts
          ? Number(quizForm.max_attempts)
          : null,
      };

      const response = await createQuiz(payload);

      if (!response?.success) {
        throw new Error(response?.message || "Quiz creation failed.");
      }

      const newQuiz = response as any;

      setMessage("Quiz created successfully.");

      setQuizForm({
        title: "",
        description: "",
        subject_id: "",
        chapter_id: "",
        language: "en",
        difficulty: "MEDIUM",
        time_limit_seconds: "600",
        passing_score: "60",
        max_attempts: "2",
      });

      await loadData();

      setSelectedQuiz(newQuiz);
    } catch (err: any) {
      setError(err?.message || "Unable to create quiz.");
    } finally {
      setCreating(false);
    }
  }

  function updateOption(index: number, text: string) {
    setQuestionForm((prev) => ({
      ...prev,
      options: prev.options.map((option, i) =>
        i === index ? { ...option, text } : option
      ),
    }));
  }

  function selectCorrectOption(index: number) {
    setQuestionForm((prev) => ({
      ...prev,
      options: prev.options.map((option, i) => ({
        ...option,
        correct: i === index,
      })),
    }));
  }

  async function handleAddQuestion(e: React.FormEvent) {
    e.preventDefault();

    if (!selectedQuiz) {
      setError("Please select a quiz first.");
      return;
    }

    try {
      setAddingQuestion(true);
      setError("");
      setMessage("");

      if (!questionForm.question_text.trim()) {
        throw new Error("Question text is required.");
      }

      const options = questionForm.options.map((option, index) => ({
        option_text: option.text.trim(),
        option_label: option.label,
        order_index: index,
        is_correct: option.correct,
      }));

      if (options.some((option) => !option.option_text)) {
        throw new Error("All four options are required.");
      }

      if (options.filter((option) => option.is_correct).length !== 1) {
        throw new Error("Exactly one correct option is required.");
      }

      const payload = {
        question_text: questionForm.question_text.trim(),
        question_type: "MCQ_SINGLE",
        difficulty: selectedQuiz.difficulty || "MEDIUM",
        explanation: questionForm.explanation.trim() || null,
        points: Number(questionForm.points),
        order_index: selectedQuiz.question_count || 0,
        options,
      };

      const response = await addQuestion(selectedQuiz.id, payload);

      if (!response?.success) {
        throw new Error(response?.message || "Failed to add question.");
      }

      setMessage("Question added successfully.");

      setQuestionForm({
        question_text: "",
        explanation: "",
        points: "1",
        options: [
          { label: "A", text: "", correct: true },
          { label: "B", text: "", correct: false },
          { label: "C", text: "", correct: false },
          { label: "D", text: "", correct: false },
        ],
      });

      await loadData();

      const updatedQuiz = {
        ...selectedQuiz,
        question_count: selectedQuiz.question_count + 1,
      };

      setSelectedQuiz(updatedQuiz);
    } catch (err: any) {
      setError(err?.message || "Unable to add question.");
    } finally {
      setAddingQuestion(false);
    }
  }

  async function handlePublishQuiz() {
    if (!selectedQuiz) return;

    try {
      setPublishing(true);
      setError("");
      setMessage("");

      if (selectedQuiz.question_count < 1) {
        throw new Error(
          "Add at least one question before publishing the quiz."
        );
      }

      const response = await publishQuiz(selectedQuiz.id);

      if (!response?.success) {
        throw new Error(response?.message || "Failed to publish quiz.");
      }

      setMessage("Quiz published successfully.");

      const publishedQuiz = response as any;
      setSelectedQuiz(publishedQuiz);

      await loadData();
    } catch (err: any) {
      setError(err?.message || "Unable to publish quiz.");
    } finally {
      setPublishing(false);
    }
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-7xl px-4 py-8">
        <p>Loading quiz management...</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-semibold">Quiz Management</h1>
        <p className="mt-2 text-muted-foreground">
          Create quizzes, add questions and publish them for students.
        </p>
      </div>

      {message && (
        <div className="mb-6 rounded-xl border border-green-500/30 bg-green-500/10 p-4 text-green-700">
          {message}
        </div>
      )}

      {error && (
        <div className="mb-6 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-red-700">
          {error}
        </div>
      )}

      {/* CREATE QUIZ */}
      <section className="rounded-2xl border bg-card p-6">
        <h2 className="text-xl font-semibold">Create Quiz</h2>

        <form
          onSubmit={handleCreateQuiz}
          className="mt-6 grid gap-5 md:grid-cols-2"
        >
          <div className="md:col-span-2">
            <label className="mb-2 block text-sm font-medium">
              Quiz Title
            </label>
            <input
              value={quizForm.title}
              onChange={(e) =>
                setQuizForm({
                  ...quizForm,
                  title: e.target.value,
                })
              }
              placeholder="e.g. Forest Conservation Quiz"
              className="w-full rounded-xl border bg-background px-4 py-3"
            />
          </div>

          <div className="md:col-span-2">
            <label className="mb-2 block text-sm font-medium">
              Description
            </label>
            <textarea
              value={quizForm.description}
              onChange={(e) =>
                setQuizForm({
                  ...quizForm,
                  description: e.target.value,
                })
              }
              placeholder="Quiz description"
              rows={3}
              className="w-full rounded-xl border bg-background px-4 py-3"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium">
              Subject
            </label>

            <select
              value={quizForm.subject_id}
              onChange={(e) =>
                setQuizForm({
                  ...quizForm,
                  subject_id: e.target.value,
                  chapter_id: "",
                })
              }
              className="w-full rounded-xl border bg-background px-4 py-3"
            >
              <option value="">Select subject</option>

              {subjects.map((subject, index) => (
                <option
                  key={`${subject.id}-${index}`}
                  value={subject.id}
                >
                  {subject.name} ({subject.code})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium">
              Chapter
            </label>
            <select
              value={quizForm.chapter_id}
              onChange={(e) =>
                setQuizForm({
                  ...quizForm,
                  chapter_id: e.target.value,
                })
              }
              disabled={!quizForm.subject_id}
              className="w-full rounded-xl border bg-background px-4 py-3 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="">
                {quizForm.subject_id ? "Select chapter" : "Select a subject first"}
              </option>
              {chapters.map((chapter) => (
                <option key={chapter.id} value={chapter.id}>
                  Chapter {chapter.chapter_number}: {chapter.title}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium">
              Language
            </label>

            <select
              value={quizForm.language}
              onChange={(e) =>
                setQuizForm({
                  ...quizForm,
                  language: e.target.value,
                })
              }
              className="w-full rounded-xl border bg-background px-4 py-3"
            >
              <option value="en">English</option>
              <option value="hi">Hindi</option>
            </select>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium">
              Difficulty
            </label>

            <select
              value={quizForm.difficulty}
              onChange={(e) =>
                setQuizForm({
                  ...quizForm,
                  difficulty: e.target.value,
                })
              }
              className="w-full rounded-xl border bg-background px-4 py-3"
            >
              <option value="EASY">Easy</option>
              <option value="MEDIUM">Medium</option>
              <option value="HARD">Hard</option>
            </select>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium">
              Time Limit (seconds)
            </label>

            <input
              type="number"
              min="1"
              value={quizForm.time_limit_seconds}
              onChange={(e) =>
                setQuizForm({
                  ...quizForm,
                  time_limit_seconds: e.target.value,
                })
              }
              className="w-full rounded-xl border bg-background px-4 py-3"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium">
              Passing Score (%)
            </label>

            <input
              type="number"
              min="0"
              max="100"
              value={quizForm.passing_score}
              onChange={(e) =>
                setQuizForm({
                  ...quizForm,
                  passing_score: e.target.value,
                })
              }
              className="w-full rounded-xl border bg-background px-4 py-3"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium">
              Max Attempts
            </label>

            <input
              type="number"
              min="1"
              value={quizForm.max_attempts}
              onChange={(e) =>
                setQuizForm({
                  ...quizForm,
                  max_attempts: e.target.value,
                })
              }
              className="w-full rounded-xl border bg-background px-4 py-3"
            />
          </div>

          <div className="md:col-span-2">
            <button
              type="submit"
              disabled={creating}
              className="rounded-xl bg-primary px-6 py-3 font-medium text-primary-foreground disabled:opacity-50"
            >
              {creating ? "Creating..." : "Create Quiz"}
            </button>
          </div>
        </form>
      </section>

      {/* EXISTING QUIZZES */}
      <section className="mt-8 rounded-2xl border bg-card p-6">
        <h2 className="text-xl font-semibold">Existing Quizzes</h2>

        <div className="mt-5 space-y-3">
          {quizzes.length === 0 ? (
            <p className="text-muted-foreground">
              No quizzes created yet.
            </p>
          ) : (
            quizzes.map((quiz) => (
              <button
                key={quiz.id}
                onClick={() => setSelectedQuiz(quiz)}
                className={`w-full rounded-xl border p-4 text-left transition ${
                  selectedQuiz?.id === quiz.id
                    ? "border-primary"
                    : ""
                }`}
              >
                <div className="flex flex-col justify-between gap-2 md:flex-row">
                  <div>
                    <h3 className="font-semibold">{quiz.title}</h3>

                    <p className="mt-1 text-sm text-muted-foreground">
                      Questions: {quiz.question_count} · Passing:{" "}
                      {quiz.passing_score}%
                    </p>
                  </div>

                  <div className="text-sm">
                    <span
                      className={`rounded-full px-3 py-1 ${
                        quiz.is_published
                          ? "bg-green-500/10 text-green-700"
                          : "bg-yellow-500/10 text-yellow-700"
                      }`}
                    >
                      {quiz.is_published
                        ? "PUBLISHED"
                        : quiz.status}
                    </span>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </section>

      {/* ADD QUESTION */}
      {selectedQuiz && (
        <section className="mt-8 rounded-2xl border bg-card p-6">
          <div className="flex flex-col justify-between gap-4 md:flex-row">
            <div>
              <h2 className="text-xl font-semibold">
                Add Question
              </h2>

              <p className="mt-1 text-sm text-muted-foreground">
                Quiz: {selectedQuiz.title}
              </p>

              <p className="mt-1 text-sm text-muted-foreground">
                Questions: {selectedQuiz.question_count}
              </p>
            </div>

            <button
              type="button"
              onClick={handlePublishQuiz}
              disabled={
                publishing ||
                selectedQuiz.question_count < 1 ||
                selectedQuiz.is_published
              }
              className="rounded-xl bg-green-600 px-5 py-3 font-medium text-white disabled:opacity-50"
            >
              {selectedQuiz.is_published
                ? "Published"
                : publishing
                  ? "Publishing..."
                  : "Publish Quiz"}
            </button>
          </div>

          {!selectedQuiz.is_published && (
            <form
              onSubmit={handleAddQuestion}
              className="mt-6 space-y-5"
            >
              <div>
                <label className="mb-2 block text-sm font-medium">
                  Question
                </label>

                <textarea
                  value={questionForm.question_text}
                  onChange={(e) =>
                    setQuestionForm({
                      ...questionForm,
                      question_text: e.target.value,
                    })
                  }
                  placeholder="Enter question"
                  rows={3}
                  className="w-full rounded-xl border bg-background px-4 py-3"
                />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                {questionForm.options.map((option, index) => (
                  <div
                    key={option.label}
                    className="rounded-xl border p-4"
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <label className="font-medium">
                        Option {option.label}
                      </label>

                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="radio"
                          name="correct-option"
                          checked={option.correct}
                          onChange={() =>
                            selectCorrectOption(index)
                          }
                        />
                        Correct
                      </label>
                    </div>

                    <input
                      value={option.text}
                      onChange={(e) =>
                        updateOption(index, e.target.value)
                      }
                      placeholder={`Enter option ${option.label}`}
                      className="w-full rounded-xl border bg-background px-4 py-3"
                    />
                  </div>
                ))}
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium">
                  Explanation
                </label>

                <textarea
                  value={questionForm.explanation}
                  onChange={(e) =>
                    setQuestionForm({
                      ...questionForm,
                      explanation: e.target.value,
                    })
                  }
                  placeholder="Optional explanation"
                  rows={3}
                  className="w-full rounded-xl border bg-background px-4 py-3"
                />
              </div>

              <div className="max-w-xs">
                <label className="mb-2 block text-sm font-medium">
                  Points
                </label>

                <input
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={questionForm.points}
                  onChange={(e) =>
                    setQuestionForm({
                      ...questionForm,
                      points: e.target.value,
                    })
                  }
                  className="w-full rounded-xl border bg-background px-4 py-3"
                />
              </div>

              <button
                type="submit"
                disabled={addingQuestion}
                className="rounded-xl bg-primary px-6 py-3 font-medium text-primary-foreground disabled:opacity-50"
              >
                {addingQuestion
                  ? "Adding..."
                  : "Add Question"}
              </button>
            </form>
          )}
        </section>
      )}
    </main>
  );
}
