"use client";

import { useCallback, useEffect, useState } from "react";
import { Activity, AlertTriangle, BarChart3, BookOpen, CheckCircle2, RefreshCw, Server, Users } from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import { analyticsApi } from "@/services/analytics.service";
import { MetricCard, Panel } from "@/components/analytics/metric-card";
import { Skeleton } from "@/components/ui/skeleton";

export default function AdminDashboard() {
  const { user, loading: authLoading } = useAuth();
  const [d, setD] = useState<any>(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    if (authLoading || !user || user.role !== "ADMIN") return;
    setError("");
    void Promise.all([
      analyticsApi.adminDashboard(),
      analyticsApi.adminHealth(),
      analyticsApi.adminContent(),
      analyticsApi.adminQuizzes(),
      analyticsApi.adminReviews(),
      analyticsApi.adminWeakTopics(),
    ]).then(([a,h,c,q,r,w]) => {
      const failed = [a,h,c,q,r,w].find((x) => !x.success);
      if (failed && !failed.success) { setError(failed.message); return; }
      setD({summary:a.summary,health:h.health,content:c.content,quizzes:q.analytics,reviews:r.analytics,weak:w.items||w});
    }).catch(() => setError("Unable to load the admin dashboard. Please try again."));
  }, [authLoading, user]);

  useEffect(() => load(), [load]);

  if (!d && !error) return <div className="mx-auto max-w-[1400px] px-4 py-8 sm:px-6 lg:px-8"><Skeleton className="h-10 w-72"/><div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[1,2,3,4,5,6,7,8].map((x)=><Skeleton key={x} className="h-32 rounded-2xl"/>)}</div></div>;
  if (error) return <div className="mx-auto max-w-[1400px] px-4 py-10 sm:px-6"><div className="rounded-2xl border bg-card p-10 text-center"><p className="font-semibold">Unable to load admin intelligence</p><p className="mt-2 text-sm text-muted-foreground">{error}</p><button onClick={load} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-[#08744f] px-4 py-2.5 text-sm font-semibold text-white"><RefreshCw className="size-4"/> Retry</button></div></div>;

  const s=d.summary;
  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <div className="mb-7"><p className="text-sm font-medium text-[#08744f]">Administration</p><h1 className="mt-1 text-3xl font-bold tracking-tight">Platform command center</h1><p className="mt-2 text-sm text-muted-foreground">Organization-wide learning, content, quiz and system overview.</p></div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><MetricCard label="Total users" value={s.students+s.instructors}/><MetricCard label="Total books" value={s.books}/><MetricCard label="Total quizzes" value={s.quizzes}/><MetricCard label="Subjects" value={s.subjects}/><MetricCard label="Chapters" value={s.chapters}/><MetricCard label="Documents" value={s.documents}/><MetricCard label="Average mastery" value={s.average_mastery==null?"—":`${s.average_mastery}%`}/><MetricCard label="At-risk students" value={s.at_risk_students}/></div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Panel title="System health"><div className="grid gap-2 sm:grid-cols-2">{Object.entries(d.health).map(([k,v]:any)=><div key={k} className="flex items-center gap-3 rounded-xl border p-3"><span className="flex size-8 items-center justify-center rounded-lg bg-emerald-50 text-[#08744f]"><Server className="size-4"/></span><div><p className="text-xs text-muted-foreground">{k}</p><b className="text-sm">{v.status}</b></div></div>)}</div></Panel>
        <Panel title="Quiz overview"><div className="grid grid-cols-3 gap-3"><div className="rounded-xl bg-muted/60 p-3"><p className="text-xs text-muted-foreground">Attempts</p><b className="mt-1 block text-xl">{d.quizzes.total_attempts}</b></div><div className="rounded-xl bg-muted/60 p-3"><p className="text-xs text-muted-foreground">Avg score</p><b className="mt-1 block text-xl">{d.quizzes.average_score??"—"}%</b></div><div className="rounded-xl bg-muted/60 p-3"><p className="text-xs text-muted-foreground">Pass rate</p><b className="mt-1 block text-xl">{d.quizzes.pass_rate??"—"}%</b></div></div></Panel>
        <Panel title="Content status"><div className="space-y-3"><div className="flex items-center gap-3 rounded-xl border p-3"><BookOpen className="size-5 text-[#08744f]"/><span>Books</span><b className="ml-auto">{d.content.books}</b></div><div className="flex items-center gap-3 rounded-xl border p-3"><Activity className="size-5 text-[#08744f]"/><span>Documents</span><b className="ml-auto">{d.content.documents}</b></div><pre className="max-h-48 overflow-auto rounded-xl bg-muted p-3 text-xs">{JSON.stringify(d.content.processing,null,2)}</pre></div></Panel>
        <Panel title="Review analytics"><div className="grid grid-cols-2 gap-3"><div className="rounded-xl border p-4"><p className="text-xs text-muted-foreground">Schedules</p><b className="text-xl">{d.reviews.total}</b></div><div className="rounded-xl border p-4"><p className="text-xs text-muted-foreground">Overdue</p><b className="text-xl">{d.reviews.overdue}</b></div><div className="rounded-xl border p-4"><p className="text-xs text-muted-foreground">Completed</p><b className="text-xl">{d.reviews.completed}</b></div><div className="rounded-xl border p-4"><p className="text-xs text-muted-foreground">Completion rate</p><b className="text-xl">{d.reviews.completion_rate}%</b></div></div></Panel>
        <Panel title="Common weak topics"><div className="space-y-2">{d.weak?.length?d.weak.slice(0,10).map((x:any)=><div key={x.chapter_id} className="flex items-center gap-3 rounded-xl border p-3"><AlertTriangle className="size-4 text-amber-600"/><span className="flex-1 text-sm font-medium">{x.topic}</span><span className="text-xs text-muted-foreground">{x.affected_students} students</span></div>):<p className="text-sm text-muted-foreground">No weak topics reported yet.</p>}</div></Panel>
        <Panel title="Operational snapshot"><div className="space-y-3"><div className="flex items-center gap-3"><Users className="size-5 text-[#08744f]"/><span>Active students</span><b className="ml-auto">{s.active_students}</b></div><div className="flex items-center gap-3"><BarChart3 className="size-5 text-[#08744f]"/><span>Average coverage</span><b className="ml-auto">{s.average_coverage}%</b></div><div className="flex items-center gap-3"><CheckCircle2 className="size-5 text-[#08744f]"/><span>Due reviews</span><b className="ml-auto">{s.due_reviews}</b></div></div></Panel>
      </div>
    </div>
  );
}
