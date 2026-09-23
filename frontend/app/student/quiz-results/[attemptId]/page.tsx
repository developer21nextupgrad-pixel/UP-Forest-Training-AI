"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { getAttempt } from "@/services/quiz.service";

export default function Result() {
  const params = useParams();

  const rawAttemptId = params?.attemptId;
  const attemptId = Array.isArray(rawAttemptId)
    ? rawAttemptId[0]
    : rawAttemptId;

  const [d, setD] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!attemptId || typeof attemptId !== "string") {
      setError("Attempt ID is missing.");
      setLoading(false);
      return;
    }

    getAttempt(attemptId)
      .then((x) => {
        if (x.success) {
          setD(x.data);
        } else {
          setError(x.message || "Failed to load result.");
        }
      })
      .catch((err) => {
        console.error("Failed to load result:", err);
        setError("Failed to load result.");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [attemptId]);

  if (loading) {
    return <main className="p-6">Loading result…</main>;
  }

  if (error) {
    return (
      <main className="p-6">
        <p className="text-red-500">{error}</p>
      </main>
    );
  }

  if (!d) {
    return <main className="p-6">Result not found.</main>;
  }

  return (
    <main className="mx-auto max-w-4xl p-6">
      <h1 className="text-3xl font-semibold">
        {d.percentage}%
      </h1>

      <p className="mt-2">
        {d.passed ? "PASSED" : "FAILED"} · {d.score} points
      </p>

      <div className="mt-6 space-y-3">
        {d.results.map((x: any) => (
          <div
            key={x.question_id}
            className="rounded-xl border p-4"
          >
            <b>{x.question_text}</b>

            <p className="mt-2">
              {x.is_correct ? "✓ Correct" : "✗ Incorrect"}
            </p>

            <p className="mt-2 text-sm">
              {x.explanation}
            </p>
          </div>
        ))}
      </div>
    </main>
  );
}