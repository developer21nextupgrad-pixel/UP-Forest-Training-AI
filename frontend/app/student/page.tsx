"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  Bot,
  CheckCircle2,
  ChevronRight,
  Clock3,
  FileText,
  Library,
  RefreshCw,
  Sparkles,
  Target,
} from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useAuth } from "@/components/auth/auth-provider";
import { getDashboard, releaseDashboardRequest, type Dashboard } from "@/services/student.service";

function StatCard({ icon: Icon, label, value, detail, onClick }: { icon: React.ElementType; label: string; value: string | number; detail: string; onClick?: () => void }) {
  const content = (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
        <p className="mt-2 text-2xl font-bold tracking-tight">{value}</p>
        <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
      </div>
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-[#08744f] dark:bg-emerald-950/40 dark:text-emerald-300">
        <Icon className="size-5" />
      </span>
    </div>
  );

  return onClick ? (
    <button onClick={onClick} className="group rounded-2xl border border-border/80 bg-card p-5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-emerald-200 hover:shadow-md dark:hover:border-emerald-900">
      {content}
    </button>
  ) : (
    <div className="rounded-2xl border border-border/80 bg-card p-5 shadow-sm">{content}</div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-9 w-80 max-w-full" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[1, 2, 3, 4].map((item) => (
          <Skeleton key={item} className="h-32 rounded-2xl" />
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-[1.45fr_1fr]">
        <Skeleton className="h-72 rounded-2xl" />
        <Skeleton className="h-72 rounded-2xl" />
      </div>
    </div>
  );
}

export default function StudentDashboard() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const loadDashboard = useCallback(() => {
    if (authLoading || !user || user.role !== "STUDENT") return () => {};

    let active = true;
    setLoading(true);
    setError("");

    void getDashboard().then((result) => {
      if (!active) return;
      if (result.success) setData(result);
      else setError(result.message);
      setLoading(false);
    });

    return () => {
      active = false;
      releaseDashboardRequest();
    };
  }, [authLoading, user]);

  useEffect(() => loadDashboard(), [loadDashboard]);

  const progress = Math.max(0, Math.min(100, Number(data?.summary.overall_progress ?? 0)));
  const subjects = data?.subjects ?? [];
  const recommendations = data?.recommendations ?? [];
  const weakTopics = data?.weak_topics ?? [];
  const recentActivity = data?.recent_activity ?? [];

  const hours = useMemo(() => {
    const seconds = Number(data?.summary.time_spent_seconds ?? 0);
    return seconds >= 3600 ? `${(seconds / 3600).toFixed(1)}h` : `${Math.round(seconds / 60)}m`;
  }, [data?.summary.time_spent_seconds]);

  if (!authLoading && user && user.role !== "STUDENT") return null;

  return (
    <div className="mx-auto max-w-[1500px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      {loading && !data ? (
        <DashboardSkeleton />
      ) : error && !data ? (
        <section className="flex min-h-[65vh] items-center justify-center">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
            <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
              <Clock3 className="size-6" />
            </div>
            <h1 className="mt-5 text-xl font-bold">Unable to load your dashboard</h1>
            <p className="mt-2 text-sm text-muted-foreground">{error}</p>
            <button onClick={() => loadDashboard()} className="mt-6 inline-flex items-center gap-2 rounded-xl bg-[#08744f] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#06623f]">
              <RefreshCw className="size-4" />
              Try again
            </button>
          </div>
        </section>
      ) : data ? (
        <div className="space-y-6">
          <section className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm font-medium text-[#08744f]">Forest Department Learning Portal</p>
              <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">Welcome back, {data.student.name}</h1>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground sm:text-base">Continue learning, strengthen your subjects, and explore the forest knowledge library.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => router.push("/student/quizzes")} className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-semibold shadow-sm hover:bg-muted">
                <Target className="size-4 text-[#08744f]" />
                Take a Quiz
              </button>
              <button onClick={() => router.push("/student/tutor")} className="inline-flex items-center gap-2 rounded-xl bg-[#08744f] px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#06623f]">
                <Bot className="size-4" />
                Ask AI Study Bot
              </button>
            </div>
          </section>
          {error && (
            <div className="flex items-center justify-between gap-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
              <span>{error}</span>
              <button onClick={() => loadDashboard()} className="font-semibold underline">Retry</button>
            </div>
          )}
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard icon={Library} label="Subjects" value={data.summary.subjects} detail="Assigned learning areas" onClick={() => router.push("/student/subjects")} />
            <StatCard icon={BookOpen} label="Chapters" value={data.summary.chapters} detail={`${data.summary.completed_chapters} completed`} onClick={() => router.push("/student/subjects")} />
            <StatCard icon={BarChart3} label="Overall progress" value={`${progress}%`} detail="Based on completed learning" onClick={() => router.push("/student/progress")} />
            <StatCard icon={Clock3} label="Learning time" value={hours} detail="Recorded study time" onClick={() => router.push("/student/history")} />
          </section>
          <section className="grid gap-6 xl:grid-cols-[1.45fr_1fr]">
            <div className="rounded-2xl border border-border/80 bg-card p-6 shadow-sm">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Continue Reading</p>
                  <h2 className="mt-1 text-xl font-bold">Pick up where you left off</h2>
                </div>
                <span className="flex size-10 items-center justify-center rounded-xl bg-emerald-50 text-[#08744f] dark:bg-emerald-950/40 dark:text-emerald-300"><BookOpen className="size-5" /></span>
              </div>
              {data.continue_learning ? (
                <div className="mt-6 rounded-2xl bg-[#f2f8f5] p-5 dark:bg-emerald-950/20">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-xs font-medium text-[#08744f]">{data.continue_learning.subject_name}</p>
                      <h3 className="mt-1 text-lg font-bold">{data.continue_learning.chapter_title}</h3>
                      <p className="mt-1 text-sm text-muted-foreground">{data.continue_learning.progress_percentage}% complete</p>
                    </div>
                    <button onClick={() => router.push(`/student/chapters/${data.continue_learning.chapter_id}`)} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-[#08744f] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#06623f]">
                      Continue <ArrowRight className="size-4" />
                    </button>
                  </div>
                  <div className="mt-5 h-2 overflow-hidden rounded-full bg-white dark:bg-black/20">
                    <div className="h-full rounded-full bg-[#08744f] transition-all" style={{ width: `${Math.max(0, Math.min(100, Number(data.continue_learning.progress_percentage || 0)))}%` }} />
                  </div>
                </div>
              ) : (
                <div className="mt-6 rounded-2xl border border-dashed p-8 text-center">
                  <BookOpen className="mx-auto size-7 text-muted-foreground" />
                  <p className="mt-3 font-semibold">No learning activity yet</p>
                  <p className="mt-1 text-sm text-muted-foreground">Choose a subject or book to start learning.
                  </p>
                  <button onClick={() => router.push("/student/subjects")} className="mt-4 rounded-xl border px-4 py-2 text-sm font-semibold hover:bg-muted">Explore subjects</button>
                </div>
              )}
            </div>
            <div className="rounded-2xl border border-border/80 bg-card p-6 shadow-sm">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Quick Access</p>
                </div>
              </div>
            </div>
          </section>
          <section className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
            <div className="rounded-2xl border border-border/80 bg-card p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">My Library</p>
                  <h2 className="mt-1 text-xl font-bold">Subjects you are studying</h2>
                </div>
                <button onClick={() => router.push("/student/subjects")} className="text-sm font-semibold text-[#08744f] hover:underline">View all</button>
              </div>
              {subjects.length ? (
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  {subjects.slice(0, 6).map((subject) => (
                    <button key={subject.id} onClick={() => router.push(`/student/subjects/${subject.id}`)} className="group rounded-2xl border p-4 text-left hover:border-emerald-200 hover:shadow-sm dark:hover:border-emerald-900">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0"><p className="truncate font-semibold">{subject.name}</p><p className="mt-1 text-xs text-muted-foreground">{subject.chapter_count} chapters · {subject.code}</p></div>
                        <ChevronRight className="size-4 shrink-0 text-muted-foreground group-hover:text-[#08744f]" />
                      </div>
                      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-[#08744f]" style={{ width: `${Math.max(0, Math.min(100, Number(subject.progress_percentage || 0)))}%` }} /></div>
                      <p className="mt-2 text-xs text-muted-foreground">{subject.progress_percentage}% complete</p>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="mt-5 rounded-xl border border-dashed p-7 text-center text-sm text-muted-foreground">No subjects assigned yet.</div>
              )}
            </div>
            <div className="rounded-2xl border border-border/80 bg-card p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Progress Intelligence</p>
                  <h2 className="mt-1 text-xl font-bold">Your current picture</h2>
                </div>
                <BarChart3 className="size-5 text-[#08744f]" />
              </div>
              <div className="mt-5 space-y-4">
                <div><div className="flex justify-between text-sm"><span>Content completion</span><strong>{progress}%</strong></div><div className="mt-2 h-2 rounded-full bg-muted"><div className="h-full rounded-full bg-[#08744f]" style={{ width: `${progress}%` }} /></div></div>
                {data.mastery != null ? (
                  <div>
                    <div className="flex justify-between text-sm"><span>Mastery</span><strong>{data.mastery}%</strong></div>
                    <div className="mt-2 h-2 rounded-full bg-muted"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.max(0, Math.min(100, Number(data.mastery)))}%` }} /></div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">Mastery will appear after enough assessment evidence is available.</div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl bg-muted/60 p-3"><p className="text-xs text-muted-foreground">Weak topics</p><p className="mt-1 text-xl font-bold">{weakTopics.length}</p></div>
                  <div className="rounded-xl bg-muted/60 p-3"><p className="text-xs text-muted-foreground">Due reviews</p><p className="mt-1 text-xl font-bold">{data.due_reviews?.length ?? 0}</p></div>
                </div>
                <button onClick={() => router.push("/student/progress")} className="inline-flex items-center gap-1 text-sm font-semibold text-[#08744f] hover:underline">Open detailed progress <ArrowRight className="size-4" /></button>
              </div>
            </div>
          </section>
          <section className="grid gap-6 xl:grid-cols-2">
            <div className="rounded-2xl border border-border/80 bg-card p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Recommendations</p>
                  <h2 className="mt-1 text-xl font-bold">What to focus on next</h2>
                </div>
                <Sparkles className="size-5 text-[#08744f]" />
              </div>
              <div className="mt-5 space-y-3">
                {recommendations.length ? recommendations.slice(0, 5).map((item: any) => (
                  <button key={item.id} onClick={() => item.chapter_id && router.push(`/student/chapters/${item.chapter_id}`)} className="flex w-full items-start gap-3 rounded-xl border p-3 text-left hover:bg-muted/50">
                    <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-[#08744f] dark:bg-emerald-950/40"><Target className="size-4" /></span>
                    <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{item.title}</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">{item.reason}</span></span>
                  </button>
                )) : (
                  <div className="rounded-xl border border-dashed p-7 text-center text-sm text-muted-foreground">No recommendations yet. Keep learning to build more evidence.</div>
                )}
              </div>
            </div>
            <div className="rounded-2xl border border-border/80 bg-card p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Recent Activity</p>
                  <h2 className="mt-1 text-xl font-bold">Your latest learning</h2>
                </div>
                <FileText className="size-5 text-[#08744f]" />
              </div>
              <div className="mt-5 space-y-1">
                {recentActivity.length ? recentActivity.map((item: any) => (
                  <div key={item.id} className="flex items-start gap-3 rounded-xl px-2 py-3 hover:bg-muted/50">
                    <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted"><CheckCircle2 className="size-4 text-[#08744f]" /></span>
                    <div className="min-w-0"><p className="text-sm font-semibold capitalize">{String(item.event || "Learning activity").replaceAll("_", " ")}</p><p className="mt-0.5 truncate text-xs text-muted-foreground">{item.chapter_title || item.subject_name || "Learning activity"}</p></div>
                  </div>
                )) : (
                  <div className="rounded-xl border border-dashed p-7 text-center text-sm text-muted-foreground">No recent activity.</div>
                )}
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
