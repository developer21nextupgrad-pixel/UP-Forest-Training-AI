"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { getSubjectProgress } from "@/services/progress.service";

export default function SubjectProgressPage() {
  const { subjectId } = useParams<{subjectId:string}>();
  const [data,setData]=useState<any>();
  useEffect(()=>{getSubjectProgress(subjectId).then(r=>r.success&&setData(r.data));},[subjectId]);
  if(!data)return <main className="p-6">Loading subject progress…</main>;
  const s=data.subject;
  return <main className="mx-auto max-w-5xl space-y-6 p-6">
    <header><p className="text-sm text-muted-foreground">Subject Progress</p><h1 className="text-3xl font-semibold">{s.name}</h1><p className="mt-2">{s.mastery??"—"}% mastery · {s.coverage}% coverage</p></header>
    <section className="space-y-3">{s.chapters.map((c:any)=><div key={c.chapter_id} className="rounded-2xl border p-5"><div className="flex justify-between"><b>{c.chapter_title}</b><span>{c.mastery??"—"}% · {c.status}</span></div><p className="mt-2 text-sm text-muted-foreground">{c.explanation}</p><p className="mt-2 text-sm">Completion {c.completion}% · Priority {c.review_priority}</p></div>)}</section>
  </main>;
}
