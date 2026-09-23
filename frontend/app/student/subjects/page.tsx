"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, BookOpen, RefreshCw, Search } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/components/auth/auth-provider";
import { getSubjects, type StudentSubject } from "@/services/student.service";

export default function Subjects() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [data, setData] = useState<StudentSubject[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (authLoading || !user || user.role !== "STUDENT") return;
    let active = true;
    setLoading(true);
    void getSubjects().then((result) => {
      if (!active) return;
      if (result.success) setData(result);
      else setError(result.message);
      setLoading(false);
    });
    return () => { active = false; };
  }, [authLoading, user]);

  const filtered = useMemo(() => {
    const value = query.trim().toLowerCase();
    if (!value) return data;
    return data.filter((subject) => `${subject.name} ${subject.code} ${subject.description ?? ""}`.toLowerCase().includes(value));
  }, [data, query]);

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-medium text-[#08744f]">Library</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">My Subjects</h1>
          <p className="mt-2 text-sm text-muted-foreground">Explore the subjects assigned to your Forest Department learning profile.</p>
        </div>
        <div className="flex w-full max-w-sm items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5">
          <Search className="size-4 text-muted-foreground" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground" placeholder="Search subjects..." aria-label="Search subjects" />
        </div>
      </div>

      {loading ? (
        <div className="mt-7 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[1,2,3,4,5,6].map((x) => <Skeleton key={x} className="h-48 rounded-2xl" />)}
        </div>
      ) : error ? (
        <div className="mt-7 rounded-2xl border bg-card p-8 text-center shadow-sm">
          <p className="font-semibold">Unable to load your subjects</p>
          <p className="mt-2 text-sm text-muted-foreground">{error}</p>
          <button onClick={() => window.location.reload()} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-[#08744f] px-4 py-2.5 text-sm font-semibold text-white"><RefreshCw className="size-4" /> Try again</button>
        </div>
      ) : filtered.length ? (
        <div className="mt-7 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((subject) => {
            const progress = Math.max(0, Math.min(100, Number(subject.progress_percentage || 0)));
            return (
              <button key={subject.id} onClick={() => router.push(`/student/subjects/${subject.id}`)} className="group rounded-2xl border border-border/80 bg-card p-5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-emerald-200 hover:shadow-md dark:hover:border-emerald-900">
                <div className="flex items-start justify-between gap-3">
                  <span className="flex size-11 items-center justify-center rounded-xl bg-emerald-50 text-[#08744f] dark:bg-emerald-950/40 dark:text-emerald-300"><BookOpen className="size-5" /></span>
                  <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-[#08744f]" />
                </div>
                <h2 className="mt-5 text-lg font-bold">{subject.name}</h2>
                <p className="mt-1 text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground">{subject.code}</p>
                <p className="mt-3 line-clamp-2 min-h-10 text-sm text-muted-foreground">{subject.description || "Forest Department learning subject."}</p>
                <div className="mt-5 flex items-center justify-between text-xs"><span>{subject.chapter_count} chapters</span><strong>{progress}% complete</strong></div>
                <div className="mt-2 h-1.5 rounded-full bg-muted"><div className="h-full rounded-full bg-[#08744f]" style={{ width: `${progress}%` }} /></div>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="mt-7 rounded-2xl border border-dashed bg-card p-12 text-center">
          <BookOpen className="mx-auto size-8 text-muted-foreground" />
          <p className="mt-3 font-semibold">{query ? "No matching subjects" : "No subjects assigned yet"}</p>
          <p className="mt-1 text-sm text-muted-foreground">{query ? "Try a different search term." : "Your assigned learning content will appear here."}</p>
        </div>
      )}
    </div>
  );
}
