"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getStoredUser } from "@/lib/auth";
import { getProgress } from "@/services/progress.service";

export default function ProgressPage() {
  const router = useRouter();
  const [data, setData] = useState<any>();
  const [error, setError] = useState("");

  useEffect(() => {
    if (!getStoredUser()) { router.replace("/login"); return; }
    getProgress().then((r) => r.success ? setData(r.data) : setError(r.message));
  }, [router]);

  if (error) return <main className="mx-auto max-w-6xl p-6"><div className="rounded-xl border p-6">{error}</div></main>;
  if (!data) return <main className="mx-auto max-w-6xl p-6">Loading progress…</main>;

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-6">
      <header><p className="text-sm text-muted-foreground">Learning Intelligence</p><h1 className="text-3xl font-semibold">My Progress</h1></header>
      <section className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border p-6"><p className="text-sm text-muted-foreground">Overall Mastery</p><p className="mt-2 text-4xl font-semibold">{data.overall.mastery ?? "—"}%</p></div>
        <div className="rounded-2xl border p-6"><p className="text-sm text-muted-foreground">Overall Coverage</p><p className="mt-2 text-4xl font-semibold">{data.overall.coverage}%</p></div>
      </section>
      <section className="rounded-2xl border p-6">
        <h2 className="text-xl font-semibold">Subjects</h2>
        <div className="mt-4 space-y-5">
          {data.subjects.map((s:any) => (
            <button key={s.subject_id} onClick={() => router.push(`/student/progress/subjects/${s.subject_id}`)} className="block w-full rounded-xl border p-4 text-left hover:bg-muted">
              <div className="flex items-center justify-between"><b>{s.name}</b><span>{s.mastery ?? "—"}% mastery · {s.coverage}% coverage</span></div>
              <div className="mt-3 h-2 rounded bg-muted"><div className="h-2 rounded bg-primary" style={{width:`${s.coverage}%`}} /></div>
              <p className="mt-2 text-sm text-muted-foreground">{s.studied_chapter_count}/{s.chapter_count} chapters started</p>
            </button>
          ))}
        </div>
      </section>
      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border p-5"><h2 className="font-semibold">Weak Topics</h2>{data.weak_topics.slice(0,5).map((x:any)=><div key={x.chapter_id} className="mt-3 flex items-center justify-between"><span>{x.topic}</span><span className="text-sm">{x.mastery}% · {x.priority}</span></div>)}</div>
        <div className="rounded-2xl border p-5"><h2 className="font-semibold">Strong Topics</h2>{data.strong_topics.slice(0,5).map((x:any)=><div key={x.chapter_id} className="mt-3 flex items-center justify-between"><span>{x.topic}</span><span className="text-sm">{x.mastery}%</span></div>)}</div>
      </section>
    </main>
  );
}
