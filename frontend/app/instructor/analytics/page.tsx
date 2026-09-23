"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  BookOpen,
  CheckCircle2,
  ClipboardCheck,
  RefreshCw,
  Users,
} from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import { analyticsApi } from "@/services/analytics.service";
import { Skeleton } from "@/components/ui/skeleton";

export default function InstructorAnalyticsPage() {
  const { user, loading: authLoading } = useAuth();

  const [data, setData] = useState<any>(null);
  const [quizData, setQuizData] = useState<any[]>([]);
  const [error, setError] = useState("");

  const load = async () => {
    if (authLoading || !user || user.role !== "INSTRUCTOR") return;

    setError("");

  try {
    const dashboardResult =
      await analyticsApi.instructorAnalytics();

    if (!dashboardResult.success) {
      setError(
        dashboardResult.message ||
          "Unable to load instructor analytics"
      );
      return;
    }

    const resultData = dashboardResult?.data ?? dashboardResult;
    setData(resultData);

    const quizResult = await analyticsApi.instructorQuizzes();

    console.log("INSTRUCTOR QUIZZES RESPONSE:", quizResult);

    const quizItems =
      quizResult?.items ??
      quizResult?.data?.items ??
      [];

    setQuizData(quizItems);

    console.log("INSTRUCTOR ANALYTICS RESPONSE:", dashboardResult);
    } catch (err) {
      console.error("INSTRUCTOR ANALYTICS ERROR:", err);

      setError(
        err instanceof Error
          ? err.message
          : "Unable to load instructor analytics"
      );
    }
  }
  useEffect(() => {
    load();
  }, [authLoading, user]);

  if (!data && !error) {
    return (
      <div className="mx-auto max-w-[1400px] px-4 py-8 sm:px-6 lg:px-8">
        <Skeleton className="h-10 w-80" />

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((x) => (
            <Skeleton key={x} className="h-32 rounded-2xl" />
          ))}
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          {[1, 2, 3, 4].map((x) => (
            <Skeleton key={x} className="h-72 rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-[1400px] px-4 py-10 sm:px-6 lg:px-8">
        <div className="rounded-2xl border bg-card p-10 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-red-50 text-red-600">
            <AlertTriangle className="size-6" />
          </div>

          <p className="mt-4 font-semibold">
            Unable to load instructor analytics
          </p>

          <p className="mt-2 text-sm text-muted-foreground">
            {error}
          </p>

          <button
            onClick={load}
            className="mt-5 inline-flex items-center gap-2 rounded-xl bg-[#08744f] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#075f42]"
          >
            <RefreshCw className="size-4" />
            Retry
          </button>
        </div>
      </div>
    );
  }

  const subjects = data.subject_overview || [];
  const weakTopics = data.weak_topics || [];
  const risks = data.at_risk_students || [];
  console.log("INSTRUCTOR RISK DATA:", risks);
  const quizzes = quizData.map((quiz: any) => ({
  ...quiz,
  subject_name:
    quiz.subject_name ||
    subjects.find(
      (subject: any) => subject.subject_id === quiz.subject_id
    )?.name ||
    quiz.subject_id ||
    "—",
}));
  const activity = data.recent_activity || [];

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium text-[#08744f]">
              <BarChart3 className="size-4" />
              Instructor Analytics
            </div>

            <h1 className="mt-2 text-3xl font-bold tracking-tight">
              Learning Performance
            </h1>

            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Analyze subject performance, learner risks, quiz activity,
              weak topics, and recent learning engagement.
            </p>
          </div>

          <button
            onClick={load}
            className="inline-flex items-center justify-center gap-2 rounded-xl border bg-background px-4 py-2.5 text-sm font-medium hover:bg-muted"
          >
            <RefreshCw className="size-4" />
            Refresh data
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex size-10 items-center justify-center rounded-xl bg-emerald-50 text-[#08744f]">
              <BookOpen className="size-5" />
            </div>

            <span className="text-xs font-medium text-muted-foreground">
              Assigned
            </span>
          </div>

          <p className="mt-5 text-3xl font-bold">
            {subjects.length}
          </p>

          <p className="mt-1 text-sm text-muted-foreground">
            Subjects
          </p>
        </div>

        <div className="rounded-2xl border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex size-10 items-center justify-center rounded-xl bg-blue-50 text-blue-700">
              <ClipboardCheck className="size-5" />
            </div>

            <span className="text-xs font-medium text-muted-foreground">
              Available
            </span>
          </div>

          <p className="mt-5 text-3xl font-bold">
            {quizzes.length}
          </p>

          <p className="mt-1 text-sm text-muted-foreground">
            Quizzes
          </p>
        </div>

        <div className="rounded-2xl border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex size-10 items-center justify-center rounded-xl bg-amber-50 text-amber-700">
              <AlertTriangle className="size-5" />
            </div>

            <span className="text-xs font-medium text-muted-foreground">
              Attention
            </span>
          </div>

          <p className="mt-5 text-3xl font-bold">
            {risks.length}
          </p>

          <p className="mt-1 text-sm text-muted-foreground">
            At-risk students
          </p>
        </div>

        <div className="rounded-2xl border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex size-10 items-center justify-center rounded-xl bg-purple-50 text-purple-700">
              <BarChart3 className="size-5" />
            </div>

            <span className="text-xs font-medium text-muted-foreground">
              Learning gaps
            </span>
          </div>

          <p className="mt-5 text-3xl font-bold">
            {weakTopics.length}
          </p>

          <p className="mt-1 text-sm text-muted-foreground">
            Weak topics
          </p>
        </div>
      </div>

      {/* Subject Performance */}
      <section className="mt-6 rounded-2xl border bg-card shadow-sm">
        <div className="border-b px-5 py-5 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-emerald-50 text-[#08744f]">
              <BookOpen className="size-5" />
            </div>

            <div>
              <h2 className="font-semibold">
                Subject Performance
              </h2>

              <p className="text-sm text-muted-foreground">
                Compare mastery, coverage, and learning gaps across subjects.
              </p>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          {subjects.length ? (
            <table className="w-full min-w-[700px] text-sm">
              <thead>
                <tr className="border-b bg-muted/30 text-left">
                  <th className="px-6 py-4 font-medium text-muted-foreground">
                    Subject
                  </th>
                  <th className="px-6 py-4 font-medium text-muted-foreground">
                    Students
                  </th>
                  <th className="px-6 py-4 font-medium text-muted-foreground">
                    Mastery
                  </th>
                  <th className="px-6 py-4 font-medium text-muted-foreground">
                    Coverage
                  </th>
                  <th className="px-6 py-4 font-medium text-muted-foreground">
                    Weak Topics
                  </th>
                </tr>
              </thead>

              <tbody>
                {subjects.map((subject: any) => (
                  <tr
                    key={subject.subject_id}
                    className="border-b last:border-0 hover:bg-muted/20"
                  >
                    <td className="px-6 py-4">
                      <div className="font-semibold">
                        {subject.name}
                      </div>
                    </td>

                    <td className="px-6 py-4 text-muted-foreground">
                      {subject.students ?? 0}
                    </td>

                    <td className="px-6 py-4">
                      <span className="font-semibold">
                        {subject.average_mastery == null
                          ? "—"
                          : `${subject.average_mastery}%`}
                      </span>
                    </td>

                    <td className="px-6 py-4">
                      <span className="font-medium">
                        {subject.average_coverage == null
                          ? "—"
                          : `${subject.average_coverage}%`}
                      </span>
                    </td>

                    <td className="px-6 py-4">
                      <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
                        {subject.weak_topic_count ?? 0}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No subject analytics available.
            </div>
          )}
        </div>
      </section>

      {/* Two Column Analytics */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* Risk Analysis */}
        <section className="rounded-2xl border bg-card shadow-sm">
          <div className="border-b px-5 py-5">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-amber-50 text-amber-700">
                <AlertTriangle className="size-5" />
              </div>

              <div>
                <h2 className="font-semibold">
                  Risk Analysis
                </h2>

                <p className="text-sm text-muted-foreground">
                  Students requiring attention.
                </p>
              </div>
            </div>
          </div>

          <div className="p-5">
            {risks.length ? (
              <div className="space-y-3">
                {risks.slice(0, 8).map((student: any) => (
                  <div
                    key={student.student_id}
                    onClick={() => {
                      if (student.student_id) {
                        window.location.href = `/instructor/students/${student.student_id}`;
                      }
                    }}
                    className="cursor-pointer rounded-xl border p-4 transition hover:bg-muted/20 hover:shadow-sm"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="flex size-9 items-center justify-center rounded-full bg-muted">
                          <Users className="size-4" />
                        </div>

                        <div>
                          <p className="font-semibold">
                            {student.name}
                          </p>

                          <p className="text-xs text-muted-foreground">
                            Risk score:{" "}
                            {student.risk_score == null
                              ? "—"
                              : Math.round(student.risk_score)}
                          </p>
                        </div>
                      </div>

                      <span className="rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700">
                        {student.risk || "HIGH"}
                      </span>
                    </div>

                    {student.reasons?.length ? (
                      <p className="mt-3 text-sm text-muted-foreground">
                        {student.reasons.join(" ")}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                No students currently at risk.
              </div>
            )}
          </div>
        </section>

        {/* Weak Topics */}
        <section className="rounded-2xl border bg-card shadow-sm">
          <div className="border-b px-5 py-5">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-purple-50 text-purple-700">
                <BarChart3 className="size-5" />
              </div>

              <div>
                <h2 className="font-semibold">
                  Learning Gaps
                </h2>

                <p className="text-sm text-muted-foreground">
                  Topics where learners need improvement.
                </p>
              </div>
            </div>
          </div>

          <div className="p-5">
            {weakTopics.length ? (
              <div className="space-y-3">
                {weakTopics.slice(0, 10).map((topic: any, index: number) => (
                  <div
                    key={`${topic.subject_id || "subject"}-${
                      topic.chapter_id || index
                    }`}
                    className="rounded-xl border p-4"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-semibold">
                        {topic.topic || topic.chapter_title || "Unknown topic"}
                      </p>

                      <span className="text-sm font-semibold">
                        {topic.average_mastery == null
                          ? "—"
                          : `${topic.average_mastery}%`}
                      </span>
                    </div>

                    <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                      <span>
                        {topic.affected_students ?? 0} affected students
                      </span>

                      {topic.percentage_students != null ? (
                        <span>
                          {topic.percentage_students}% of students
                        </span>
                      ) : null}
                    </div>

                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-[#08744f]"
                        style={{
                          width: `${Math.min(
                            100,
                            Math.max(0, Number(topic.average_mastery) || 0)
                          )}%`,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                No weak topics reported yet.
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Quiz Analytics */}
      <section className="mt-6 rounded-2xl border bg-card shadow-sm">
        <div className="border-b px-5 py-5 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-blue-50 text-blue-700">
              <ClipboardCheck className="size-5" />
            </div>

            <div>
              <h2 className="font-semibold">
                Quiz Analytics
              </h2>

              <p className="text-sm text-muted-foreground">
                Overview of quizzes available across your assigned subjects.
              </p>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          {quizzes.length ? (
            <table className="w-full min-w-[700px] text-sm">
              <thead>
                <tr className="border-b bg-muted/30 text-left">
                  <th className="px-6 py-4 font-medium text-muted-foreground">
                    Quiz
                  </th>
                  <th className="px-6 py-4 font-medium text-muted-foreground">
                    Subject
                  </th>
                  <th className="px-6 py-4 font-medium text-muted-foreground">
                    Status
                  </th>
                  <th className="px-6 py-4 font-medium text-muted-foreground">
                    Published
                  </th>
                </tr>
              </thead>

              <tbody>
                {quizzes.slice(0, 20).map((quiz: any) => (
                  <tr
                    key={quiz.id}
                    className="border-b last:border-0 hover:bg-muted/20"
                  >
                    <td className="px-6 py-4 font-semibold">
                      {quiz.title || "Untitled quiz"}
                    </td>

                    <td className="px-6 py-4 text-muted-foreground">
                      {quiz.subject_name || quiz.subject || quiz.subject_id || "—"}
                    </td>

                    <td className="px-6 py-4">
                      <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium">
                        {quiz.status || "—"}
                      </span>
                    </td>

                    <td className="px-6 py-4">
                      {quiz.published ? (
                        <span className="inline-flex items-center gap-1.5 text-sm font-medium text-[#08744f]">
                          <CheckCircle2 className="size-4" />
                          Published
                        </span>
                      ) : (
                        <span className="text-sm text-muted-foreground">
                          Draft
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No quizzes available.
            </div>
          )}
        </div>
      </section>

      {/* Recent Activity */}
      <section className="mt-6 rounded-2xl border bg-card shadow-sm">
        <div className="border-b px-5 py-5 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-emerald-50 text-[#08744f]">
              <CheckCircle2 className="size-5" />
            </div>

            <div>
              <h2 className="font-semibold">
                Recent Learning Activity
              </h2>

              <p className="text-sm text-muted-foreground">
                Latest learning events from your students.
              </p>
            </div>
          </div>
        </div>

        <div className="p-5">
          {activity.length ? (
            <div className="grid gap-3 md:grid-cols-2">
              {activity.slice(0, 12).map((item: any) => (
                <div
                  key={item.id}
                  className="rounded-xl border p-4"
                >
                  <div className="flex gap-3">
                    <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                      <CheckCircle2 className="size-4 text-[#08744f]" />
                    </div>

                    <div className="min-w-0">
                      <p className="text-sm">
                        <span className="font-semibold">
                          {item.student || "Student"}
                        </span>{" "}
                        · {item.event || item.event_type || "Learning activity"}
                      </p>

                      <p className="mt-1 text-xs text-muted-foreground">
                        {item.chapter ||
                          item.subject ||
                          "Learning"}{" "}
                        ·{" "}
                        {item.timestamp
                          ? new Date(item.timestamp).toLocaleString()
                          : "—"}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
              No recent learning activity.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
