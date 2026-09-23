"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, BookOpen, CheckCircle2, RefreshCw } from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import { analyticsApi } from "@/services/analytics.service";
import { MetricCard, Panel } from "@/components/analytics/metric-card";
import { Skeleton } from "@/components/ui/skeleton";

export default function InstructorDashboard() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");

  const load = () => {
    if (authLoading || !user || user.role !== "INSTRUCTOR") return;
    setError("");
    void analyticsApi.instructorDashboard().then((result: { success: boolean; message: string }) => {
      if (result.success) setData(result);
      else setError(result.message);
    });
  };

  useEffect(() => { load(); }, [authLoading, user]);

  if (!data && !error) {
    return <div className="mx-auto max-w-[1400px] px-4 py-8 sm:px-6 lg:px-8"><Skeleton className="h-10 w-80" /><div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[1,2,3,4].map((x)=><Skeleton key={x} className="h-32 rounded-2xl" />)}</div></div>;
  }

  if (error) {
    return <div className="mx-auto max-w-[1400px] px-4 py-10 sm:px-6"><div className="rounded-2xl border bg-card p-10 text-center"><p className="font-semibold">Unable to load instructor intelligence</p><p className="mt-2 text-sm text-muted-foreground">{error}</p><button onClick={load} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-[#08744f] px-4 py-2.5 text-sm font-semibold text-white"><RefreshCw className="size-4" /> Retry</button></div></div>;
  }

  const s = data.summary;
  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <div className="mb-7"><p className="text-sm font-medium text-[#08744f]">Instructor Workspace</p><h1 className="mt-1 text-3xl font-bold tracking-tight">Learning command center</h1><p className="mt-2 text-sm text-muted-foreground">Monitor learner progress, identify risks, and guide subject-level learning.</p></div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><MetricCard label="Students" value={s.students}/><MetricCard label="Active students" value={s.active_students}/><MetricCard label="Average mastery" value={s.average_mastery==null?"—":`${s.average_mastery}%`}/><MetricCard label="Average coverage" value={`${s.average_coverage}%`}/><MetricCard label="Quiz completion" value={s.quiz_completion==null?"—":`${s.quiz_completion}%`}/><MetricCard label="Average quiz score" value={s.average_quiz_score==null?"—":`${s.average_quiz_score}%`}/><MetricCard label="At-risk students" value={s.at_risk_students}/><MetricCard label="Due reviews" value={s.due_reviews}/></div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Panel title="Students requiring attention"><div className="space-y-2">{data.at_risk_students?.length?data.at_risk_students.map((x:any)=><button key={x.student_id} onClick={()=>router.push(`/instructor/students/${x.student_id}`)} className="w-full rounded-xl border p-4 text-left hover:bg-muted/50"><div className="flex items-center gap-2"><AlertTriangle className="size-4 text-amber-600"/><span className="font-semibold">{x.name}</span><span className="ml-auto text-sm font-medium">{x.risk} · {Math.round(x.risk_score)}</span></div><p className="mt-2 text-sm text-muted-foreground">{x.reasons?.join(" ")}</p></button>):<div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">No students currently require attention.</div>}</div></Panel>
        <Panel title="Common weak topics"><div className="space-y-2">{data.weak_topics?.length?data.weak_topics.slice(0,8).map((x:any)=><div key={`${x.subject_id}-${x.chapter_id}`} className="flex items-center gap-3 rounded-xl border p-3"><span className="flex size-8 items-center justify-center rounded-lg bg-amber-50 text-amber-700"><BookOpen className="size-4"/></span><div className="min-w-0 flex-1"><p className="font-medium">{x.topic}</p><p className="text-xs text-muted-foreground">{x.affected_students} affected students · avg mastery {x.average_mastery}%</p></div><span className="text-sm font-semibold">{x.percentage_students}%</span></div>):<p className="text-sm text-muted-foreground">No weak topics reported yet.</p>}</div></Panel>
        <Panel title="Assigned subjects"><div className="space-y-2">{data.subject_overview?.length?data.subject_overview.map((x:any)=><button key={x.subject_id} onClick={()=>router.push(`/instructor/subjects/${x.subject_id}`)} className="w-full rounded-xl border p-4 text-left hover:bg-muted/50"><div className="flex items-center gap-2"><BookOpen className="size-4 text-[#08744f]"/><span className="font-semibold">{x.name}</span><span className="ml-auto font-semibold">{x.average_mastery==null?"—":`${x.average_mastery}%`}</span></div><p className="mt-1 text-sm text-muted-foreground">{x.students} students · {x.average_coverage}% coverage · {x.weak_topic_count} weak topics</p></button>):<p className="text-sm text-muted-foreground">No assigned subjects.</p>}</div></Panel>
        <Panel title="Recent learning activity"><div className="space-y-2">{data.recent_activity?.length?data.recent_activity.map((x:any)=><div key={x.id} className="rounded-xl border p-3 text-sm"><div className="flex gap-2"><CheckCircle2 className="mt-0.5 size-4 text-[#08744f]"/><div><b>{x.student}</b> · {x.event}<span className="block text-xs text-muted-foreground">{x.chapter||x.subject||"Learning"} · {new Date(x.timestamp).toLocaleString()}</span></div></div></div>):<p className="text-sm text-muted-foreground">No recent activity.</p>}</div></Panel>
      </div>
    </div>
  );
}
