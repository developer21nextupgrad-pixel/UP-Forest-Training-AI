"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { getStoredUser } from "@/lib/auth";
import { analyticsApi } from "@/services/analytics.service";

export default function QuizAnalyticsPage() {
  const router = useRouter();
  const params = useParams();
  const quizId = params?.quizId as string;

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const user = getStoredUser();

    if (!user || user.role !== "INSTRUCTOR") {
      router.replace("/login");
      return;
    }

    if (!quizId) return;

    setLoading(true);
    setError("");

    analyticsApi
      .instructorQuiz(quizId)
      .then((response: any) => {
        setData(response?.analytics ?? response);
      })
      .catch((err: any) => {
        setError(err?.message || "Unable to load quiz analytics.");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [router, quizId]);

  if (loading) {
    return (
      <main className="mx-auto max-w-7xl px-4 py-8">
        <p>Loading quiz analytics...</p>
      </main>
    );
  }

  if (error) {
    return (
      <main className="mx-auto max-w-7xl px-4 py-8">
        <button
          onClick={() => router.push("/instructor/quizzes")}
          className="mb-6 rounded-xl border px-4 py-2"
        >
          ← Back to Quizzes
        </button>

        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-6">
          <h1 className="text-xl font-semibold">Unable to load analytics</h1>
          <p className="mt-2 text-sm">{error}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">Instructor</p>

          <h1 className="mt-1 text-3xl font-semibold">
            {data?.title || "Quiz Analytics"}
          </h1>

          <p className="mt-2 text-muted-foreground">
            Detailed performance analytics for this quiz.
          </p>
        </div>

        <button
          onClick={() => router.push("/instructor/quizzes")}
          className="rounded-xl border px-4 py-2"
        >
          ← Back to Quizzes
        </button>
      </div>

      {/* SUMMARY */}
      <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        <MetricCard
          title="Attempts"
          value={data?.total_attempts ?? 0}
        />

        <MetricCard
          title="Completion Rate"
          value={`${data?.completion_rate ?? 0}%`}
        />

        <MetricCard
          title="Average Score"
          value={
            data?.average_score == null
              ? "—"
              : `${data.average_score}%`
          }
        />

        <MetricCard
          title="Pass Rate"
          value={
            data?.pass_rate == null
              ? "—"
              : `${data.pass_rate}%`
          }
        />

        <MetricCard
          title="Questions"
          value={data?.question_count ?? 0}
        />
      </section>

      {/* QUESTIONS */}
      <section className="mt-8 rounded-2xl border bg-card p-6">
        <div className="mb-5">
          <h2 className="text-xl font-semibold">
            Question Performance
          </h2>

          <p className="mt-1 text-sm text-muted-foreground">
            See which questions students found difficult.
          </p>
        </div>

        {!data?.questions?.length ? (
          <div className="rounded-xl border p-6 text-center text-muted-foreground">
            No question performance data available yet.
          </div>
        ) : (
          <div className="space-y-4">
            {data.questions.map((question: any, index: number) => (
              <div
                key={question.question_id || index}
                className="rounded-xl border p-5"
              >
                <div className="flex flex-col justify-between gap-4 md:flex-row">
                  <div className="max-w-3xl">
                    <p className="text-sm font-medium text-muted-foreground">
                      Question {index + 1}
                    </p>

                    <p className="mt-2 font-medium">
                      {question.question}
                    </p>
                  </div>

                  <div className="flex gap-6">
                    <div>
                      <p className="text-xs text-muted-foreground">
                        Attempts
                      </p>

                      <p className="mt-1 text-lg font-semibold">
                        {question.attempt_count}
                      </p>
                    </div>

                    <div>
                      <p className="text-xs text-muted-foreground">
                        Correct
                      </p>

                      <p className="mt-1 text-lg font-semibold">
                        {question.correct_percentage}%
                      </p>
                    </div>

                    <div>
                      <p className="text-xs text-muted-foreground">
                        Incorrect
                      </p>

                      <p className="mt-1 text-lg font-semibold">
                        {question.incorrect_percentage}%
                      </p>
                    </div>
                  </div>
                </div>

                <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{
                      width: `${Math.min(
                        100,
                        Math.max(0, question.correct_percentage || 0)
                      )}%`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function MetricCard({
  title,
  value,
}: {
  title: string;
  value: string | number;
}) {
  return (
    <div className="rounded-2xl border bg-card p-5">
      <p className="text-sm text-muted-foreground">{title}</p>

      <p className="mt-2 text-2xl font-semibold">
        {value}
      </p>
    </div>
  );
}