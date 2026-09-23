"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiRequest } from "@/lib/api";
import { getStoredUser } from "@/lib/auth";

type Subject = {
  id: string;
  name: string;
  code: string;
  description?: string | null;
  language: string;
  is_active: boolean;
};

export default function Page() {
  const router = useRouter();

  const [books, setBooks] = useState<any[]>([]);
  const [jobs, setJobs] = useState<any[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);

  const [form, setForm] = useState<any>({
    title: "",
    author: "",
    publisher: "",
    language: "en",
    edition: "",
    publication_year: "",
    description: "",
    subject_id: "",
  });

  const [error, setError] = useState("");

  async function load() {
    const [b, j, s] = await Promise.all([
      apiRequest<any>("/api/v1/books?limit=50"),
      apiRequest<any>("/api/v1/ingestion/jobs?limit=50"),
      apiRequest<any>("/api/v1/admin/subjects"),
    ]);

    if (b.success !== false) {
      setBooks(b.items ?? b.data?.items ?? []);
    }

    if (j.success !== false) {
      setJobs(j.items ?? j.data?.items ?? []);
    }

    if (s.success !== false) {
      setSubjects(s.items ?? s.data?.items ?? []);
    }
  }

  useEffect(() => {
    const u = getStoredUser();

    if (!u || u.role !== "ADMIN") {
      router.replace("/login");
      return;
    }

    void load();
  }, [router]);

  async function create(e: FormEvent) {
    e.preventDefault();
    setError("");

    if (!form.subject_id) {
      setError("Please select a subject.");
      return;
    }

    const r = await apiRequest<any>("/api/v1/books", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...form,
        publication_year: form.publication_year
          ? Number(form.publication_year)
          : null,
        subject_id: form.subject_id,
      }),
    });

    if (r.success === false) {
      setError(r.message);
      return;
    }

    setForm({
      title: "",
      author: "",
      publisher: "",
      language: "en",
      edition: "",
      publication_year: "",
      description: "",
      subject_id: "",
    });

    await load();
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-6">
        <p className="text-sm text-muted-foreground">
          Admin · existing content management
        </p>

        <h1 className="text-3xl font-semibold">
          Books & ingestion
        </h1>
      </div>

      {error && (
        <p className="mb-4 text-sm text-red-600">
          {error}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">

        <form
          onSubmit={create}
          className="rounded-2xl border bg-card p-5"
        >
          <h2 className="font-semibold">
            Add book
          </h2>

          {[
            "title",
            "author",
            "publisher",
            "edition",
            "publication_year",
            "language",
          ].map((k) => (
            <input
              key={k}
              required={k === "title"}
              value={form[k]}
              onChange={(e) =>
                setForm({
                  ...form,
                  [k]: e.target.value,
                })
              }
              placeholder={k.replace("_", " ")}
              className="mt-3 w-full rounded-xl border bg-background px-3 py-2 text-sm"
            />
          ))}

          {/* SUBJECT */}
          <select
            required
            value={form.subject_id}
            onChange={(e) =>
              setForm({
                ...form,
                subject_id: e.target.value,
              })
            }
            className="mt-3 w-full rounded-xl border bg-background px-3 py-2 text-sm"
          >
            <option value="">
              Select subject
            </option>

            {subjects
              .filter((s) => s.is_active)
              .map((subject) => (
                <option
                  key={subject.id}
                  value={subject.id}
                >
                  {subject.name} ({subject.code})
                </option>
              ))}
          </select>

          <textarea
            value={form.description}
            onChange={(e) =>
              setForm({
                ...form,
                description: e.target.value,
              })
            }
            placeholder="description"
            className="mt-3 min-h-24 w-full rounded-xl border p-3"
          />

          <button
            type="submit"
            className="mt-3 w-full rounded-xl bg-primary px-4 py-2 text-primary-foreground"
          >
            Create book
          </button>
        </form>

        <section className="rounded-2xl border bg-card p-5">
          <h2 className="font-semibold">
            Books
          </h2>

          <div className="mt-4 space-y-2">
            {books.map((b) => (
              <div
                key={b.id}
                className="flex items-center justify-between rounded-xl border p-3"
              >
                <span>
                  <b>{b.title}</b>

                  <span className="block text-xs text-muted-foreground">
                    {b.language} · {b.status}
                  </span>
                </span>

                <button
                  onClick={() =>
                    router.push(`/admin/books/${b.id}`)
                  }
                  className="rounded-lg border px-3 py-1.5 text-sm"
                >
                  Manage
                </button>
              </div>
            ))}
          </div>

          <h2 className="mt-8 font-semibold">
            Ingestion jobs
          </h2>

          <div className="mt-3 space-y-2">
            {jobs.map((j) => (
              <div
                key={j.id}
                className="rounded-lg border p-3 text-sm"
              >
                {j.id.slice(0, 8)}… · {j.stage} ·{" "}
                {Math.round(j.progress_percentage)}% ·{" "}
                {j.status}
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}