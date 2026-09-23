"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getStoredUser } from "@/lib/auth";
import { getWeakTopics } from "@/services/progress.service";

export default function WeakTopicsPage() {
  const router = useRouter(); const [items,setItems] = useState<any[]>();
  useEffect(()=>{ if(!getStoredUser()){router.replace("/login");return;} getWeakTopics().then(r=>r.success&&setItems(r.data||[])); },[router]);
  if(!items) return <main className="p-6">Loading weak topics…</main>;
  return <main className="mx-auto max-w-5xl space-y-5 p-6"><header><h1 className="text-3xl font-semibold">Weak Topics</h1><p className="text-muted-foreground">Topics with meaningful evidence and mastery below the weak threshold.</p></header>
    {items.length===0?<div className="rounded-xl border p-6">No weak topics detected.</div>:items.map(x=><div key={x.chapter_id} className="rounded-2xl border p-5">
      <div className="flex items-start justify-between gap-4"><div><h2 className="font-semibold">{x.topic}</h2><p className="mt-1 text-sm text-muted-foreground">{x.reason}</p></div><span className="rounded-full border px-3 py-1 text-sm">{x.priority} · {x.status}</span></div>
      <p className="mt-3 text-sm">Mastery {x.mastery}% · Coverage {x.coverage}%</p>
      <div className="mt-4 flex flex-wrap gap-2"><button onClick={()=>router.push(`/student/chapters/${x.chapter_id}`)} className="rounded-lg bg-primary px-3 py-2 text-primary-foreground">Review</button>{x.quiz_id&&<button onClick={()=>router.push(`/student/quizzes/${x.quiz_id}`)} className="rounded-lg border px-3 py-2">Take Quiz</button>}<button onClick={()=>router.push("/student/tutor")} className="rounded-lg border px-3 py-2">Ask Tutor</button></div>
    </div>)}
  </main>;
}
