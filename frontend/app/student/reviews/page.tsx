"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getStoredUser } from "@/lib/auth";
import { completeReview, getReviews } from "@/services/progress.service";

export default function ReviewsPage() {
  const router = useRouter(); const [data,setData]=useState<any>(); const [error,setError]=useState("");
  async function load(){ const r=await getReviews(100,0); if(r.success)setData(r.data); else setError(r.message); }
  useEffect(()=>{if(getStoredUser()) load();},[]);
  if(error)return <main className="p-6">{error}</main>;
  if(!data)return <main className="p-6">Loading reviews…</main>;
  const due=data.items.filter((x:any)=>x.status==="DUE"), upcoming=data.items.filter((x:any)=>x.status!=="DUE");
  async function finish(id:string){await completeReview(id);await load();}
  const card=(x:any)=><div key={x.review_id} className="rounded-2xl border p-5"><div className="flex justify-between gap-3"><div><h3 className="font-semibold">{x.chapter}</h3><p className="text-sm text-muted-foreground">Mastery {x.mastery}% · Priority {x.priority}</p></div><span className="text-sm">{x.status}</span></div><p className="mt-2 text-sm">Next review: {x.next_review_at?new Date(x.next_review_at).toLocaleDateString():"—"}</p>{x.status==="DUE"&&<div className="mt-4 flex gap-2"><button onClick={()=>router.push(`/student/chapters/${x.chapter_id}`)} className="rounded-lg bg-primary px-4 py-2 text-primary-foreground">Review Now</button><button onClick={()=>finish(x.review_id)} className="rounded-lg border px-4 py-2">Complete Review</button></div>}</div>;
  return <main className="mx-auto max-w-5xl space-y-6 p-6"><header><h1 className="text-3xl font-semibold">Reviews</h1><p className="text-muted-foreground">{due.length} due now.</p></header><section><h2 className="mb-3 text-xl font-semibold">Due Today</h2>{due.length?due.map(card):<div className="rounded-xl border p-5">Nothing is due right now.</div>}</section><section><h2 className="mb-3 text-xl font-semibold">Upcoming</h2><div className="space-y-3">{upcoming.map(card)}</div></section></main>;
}
