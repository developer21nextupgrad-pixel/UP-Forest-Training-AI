"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getStoredUser } from "@/lib/auth";
import { analyticsApi } from "@/services/analytics.service";

export default function InstructorQuizzesPage() {
  const router = useRouter();

  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const user = getStoredUser();

    if (!user || user.role !== "INSTRUCTOR") {
      router.replace("/login");
      return;
    }

    const loadQuizzes = async () => {
      try {
        setLoading(true);
        setError("");

        const result = await analyticsApi.instructorQuizzes();

        if (!result.success) {
          setError(result.message || "Unable to load quizzes");
          return;
        }

        setData(result.items || []);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Unable to load quizzes"
        );
      } finally {
        setLoading(false);
      }
    };

    loadQuizzes();
  }, [router]);

  if (loading) {
    return (
      <main className="mx-auto max-w-7xl px-4 py-8">
        <h1 className="text-3xl font-semibold">Quizzes</h1>
        <p className="mt-4 text-muted-foreground">
          Loading quizzes...
        </p>
      </main>
    );
  }

  if (error) {
    return (
      <main className="mx-auto max-w-7xl px-4 py-8">
        <h1 className="text-3xl font-semibold">Quizzes</h1>

        <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">
          {error}
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            Instructor
          </p>

          <h1 className="text-3xl font-semibold">
            Quizzes
          </h1>

          <p className="mt-1 text-sm text-muted-foreground">
            View quizzes available across your assigned subjects.
          </p>
        </div>

        <button
          onClick={() => router.push("/instructor/analytics")}
          className="rounded-lg border px-4 py-2 text-sm hover:bg-muted"
        >
          Back to Analytics
        </button>
      </div>

      {data.length === 0 ? (
        <div className="mt-8 rounded-2xl border bg-card p-8 text-center">
          <h2 className="text-lg font-semibold">
            No quizzes available
          </h2>

          <p className="mt-2 text-sm text-muted-foreground">
            There are currently no quizzes available in your
            assigned subjects.
          </p>
        </div>
      ) : (
        <div className="mt-8 overflow-hidden rounded-2xl border bg-card">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="p-4 font-medium">Quiz</th>
                <th className="p-4 font-medium">Subject</th>
                <th className="p-4 font-medium">Status</th>
                <th className="p-4 font-medium">Published</th>
                <th className="p-4 font-medium">Action</th>
              </tr>
            </thead>

            <tbody>
              {data.map((quiz: any) => (
                <tr
                  key={quiz.id}
                  className="border-b last:border-0 hover:bg-muted/20"
                >
                  <td className="p-4">
                    <div className="font-medium">
                      {quiz.title || "Untitled quiz"}
                    </div>

                    <div className="mt-1 text-xs text-muted-foreground">
                      {quiz.id}
                    </div>
                  </td>

                  <td className="p-4">
                    {quiz.subject_name ||
                      quiz.subject ||
                      quiz.subject_id ||
                      "—"}
                  </td>

                  <td className="p-4">
                    {quiz.status || "—"}
                  </td>

                  <td className="p-4">
                    {quiz.published ? (
                      <span className="font-medium">
                        Published
                      </span>
                    ) : (
                      <span className="text-muted-foreground">
                        Not Published
                      </span>
                    )}
                  </td>

                  <td className="p-4">
                    <button
                      onClick={() =>
                        router.push(
                          `/instructor/quizzes/${quiz.id}`
                        )
                      }
                      className="rounded-lg border px-3 py-2 text-sm hover:bg-muted"
                    >
                      View Analytics
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}