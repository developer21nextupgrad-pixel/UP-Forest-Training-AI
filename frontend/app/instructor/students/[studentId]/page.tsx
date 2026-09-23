"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import { getStoredUser } from "@/lib/auth";
import { analyticsApi } from "@/services/analytics.service";
import { MetricCard, Panel } from "@/components/analytics/metric-card";

export default function Page() {
  const p = useParams<{ studentId: string }>();
  const router = useRouter();

  const [d, setD] = useState<any>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const u = getStoredUser();

    if (!u || u.role !== "INSTRUCTOR") {
      router.replace("/login");
      return;
    }

    setError("");

    analyticsApi
      .instructorStudent(p.studentId)
      .then((response: any) => {
        /*
         * Handle both possible API wrapper shapes:
         *
         * 1. response = actual student detail
         * 2. response = { success, data, message }
         */

        const data =
          response?.data &&
          typeof response.data === "object"
            ? response.data
            : response;

        if (
          response?.success === false ||
          !data ||
          typeof data !== "object"
        ) {
          setError(
            response?.message ||
              "Unable to load student details."
          );
          return;
        }

        /*
         * Backend should provide student.
         * If it doesn't, don't crash the entire page.
         */
        if (!data.student) {
          console.error(
            "Instructor student detail response does not contain student:",
            data
          );

          setError(
            "Student details are not available for this account."
          );
          return;
        }

        setD(data);
      })
      .catch((err: any) => {
        console.error(
          "Failed to load student detail:",
          err
        );

        setError(
          err?.message ||
            "Unable to load student details."
        );
      });
  }, [p.studentId, router]);

  // =========================================================
  // LOADING
  // =========================================================

  if (!d && !error) {
    return (
      <main className="p-8">
        Loading student intelligence…
      </main>
    );
  }

  // =========================================================
  // ERROR
  // =========================================================

  if (error) {
    return (
      <main className="mx-auto max-w-7xl px-4 py-8">
        <button
          onClick={() => router.back()}
          className="mb-5 text-sm underline"
        >
          ← Back
        </button>

        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700">
          <h1 className="text-lg font-semibold">
            Unable to load student
          </h1>

          <p className="mt-2 text-sm">
            {error}
          </p>
        </div>
      </main>
    );
  }

  // =========================================================
  // SAFE DATA
  // =========================================================

  const s = d.student;

  const r = d.risk || {
    level: "LOW",
    score: 0,
    reasons: [],
  };

  const chapters = Array.isArray(d.chapters)
    ? d.chapters
    : [];

  const weakTopics = Array.isArray(
    d.weak_topics
  )
    ? d.weak_topics
    : [];

  const recentHistory = Array.isArray(
    d.recent_history
  )
    ? d.recent_history
    : [];

  // =========================================================
  // MASTERy
  // =========================================================

  const chaptersWithMastery = chapters.filter(
    (x: any) =>
      x &&
      x.mastery !== null &&
      x.mastery !== undefined
  );

  const mastery =
    chaptersWithMastery.length > 0
      ? `${Math.round(
          chaptersWithMastery.reduce(
            (total: number, x: any) =>
              total + Number(x.mastery || 0),
            0
          ) /
            Math.max(
              1,
              chaptersWithMastery.length
            )
        )}%`
      : "—";

  // =========================================================
  // COVERAGE
  // =========================================================

  const coverage =
    chapters.length > 0
      ? `${Math.round(
          chapters.reduce(
            (total: number, x: any) =>
              total + Number(x.coverage || 0),
            0
          ) /
            Math.max(1, chapters.length)
        )}%`
      : "0%";

  // =========================================================
  // RENDER
  // =========================================================

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">

      {/* BACK */}

      <button
        onClick={() => router.back()}
        className="mb-5 text-sm underline"
      >
        ← Back
      </button>

      {/* =====================================================
          STUDENT HEADER
      ====================================================== */}

      <div>
        <p className="text-sm text-muted-foreground">
          Student detail
        </p>

        <h1 className="text-3xl font-semibold">
          {s?.name || "Unknown Student"}
        </h1>

        <p className="text-muted-foreground">
          {s?.email || "Email unavailable"}
        </p>
      </div>

      {/* =====================================================
          METRICS
      ====================================================== */}

      <div className="mt-6 grid gap-4 sm:grid-cols-3">

        <MetricCard
          label="Mastery"
          value={mastery}
        />

        <MetricCard
          label="Coverage"
          value={coverage}
        />

        <MetricCard
          label="Learning risk"
          value={`${r?.level || "LOW"} · ${Math.round(
            Number(r?.score || 0)
          )}`}
        />

      </div>

      {/* =====================================================
          PANELS
      ====================================================== */}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">

        {/* ===================================================
            RISK EXPLANATION
        ==================================================== */}

        <Panel title="Risk explanation">

          <p className="font-medium">
            {r?.level || "LOW"}
          </p>

          {Array.isArray(r?.reasons) &&
          r.reasons.length > 0 ? (
            <ul className="mt-3 list-disc pl-5 text-sm text-muted-foreground">
              {r.reasons.map(
                (reason: string, index: number) => (
                  <li
                    key={`${reason}-${index}`}
                  >
                    {reason}
                  </li>
                )
              )}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">
              No risk indicators available.
            </p>
          )}

        </Panel>

        {/* ===================================================
            WEAK TOPICS
        ==================================================== */}

        <Panel title="Weak topics">

          <div className="space-y-2">

            {weakTopics.length > 0 ? (
              weakTopics.map(
                (x: any, index: number) => (
                  <div
                    key={
                      x?.chapter_id ||
                      `weak-topic-${index}`
                    }
                    className="rounded-lg border p-3"
                  >

                    <b>
                      {x?.topic ||
                        "Unknown topic"}
                    </b>

                    <p className="text-sm text-muted-foreground">
                      Mastery{" "}
                      {x?.mastery != null
                        ? `${Math.round(
                            Number(
                              x.mastery
                            )
                          )}%`
                        : "—"}{" "}
                      · priority{" "}
                      {x?.priority != null
                        ? Math.round(
                            Number(
                              x.priority
                            )
                          )
                        : "—"}
                    </p>

                    <p className="mt-1 text-xs">
                      {x?.reason ||
                        "No explanation available."}
                    </p>

                  </div>
                )
              )
            ) : (
              <p className="text-sm text-muted-foreground">
                No weak topics.
              </p>
            )}

          </div>

        </Panel>

        {/* ===================================================
            CHAPTER PERFORMANCE
        ==================================================== */}

        <Panel title="Chapter performance">

          <div className="space-y-2">

            {chapters.length > 0 ? (
              chapters.map(
                (x: any, index: number) => (
                  <div
                    key={
                      x?.chapter_id ||
                      `chapter-${index}`
                    }
                    className="flex justify-between gap-4 rounded-lg border p-3 text-sm"
                  >

                    <span>
                      {x?.chapter_title ||
                        "Unknown chapter"}
                    </span>

                    <span className="text-right">

                      {x?.mastery == null
                        ? "Not started"
                        : `${Math.round(
                            Number(
                              x.mastery
                            )
                          )}% · ${
                            x?.status ||
                            "UNKNOWN"
                          }`}

                    </span>

                  </div>
                )
              )
            ) : (
              <p className="text-sm text-muted-foreground">
                No chapter activity available.
              </p>
            )}

          </div>

        </Panel>

        {/* ===================================================
            RECENT HISTORY
        ==================================================== */}

        <Panel title="Recent history">

          <div className="space-y-2">

            {recentHistory.length > 0 ? (
              recentHistory.map(
                (x: any, index: number) => (
                  <div
                    key={
                      x?.id ||
                      `history-${index}`
                    }
                    className="rounded-lg border p-3 text-sm"
                  >

                    <b>
                      {x?.event ||
                        "Learning activity"}
                    </b>

                    {x?.timestamp && (
                      <span className="block text-xs text-muted-foreground">
                        {new Date(
                          x.timestamp
                        ).toLocaleString()}
                      </span>
                    )}

                  </div>
                )
              )
            ) : (
              <p className="text-sm text-muted-foreground">
                No learning activity yet.
              </p>
            )}

          </div>

        </Panel>

      </div>
    </main>
  );
}