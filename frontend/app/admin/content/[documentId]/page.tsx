"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { getStoredUser } from "@/lib/auth";
import { getDocumentStatus, getDocumentVersions, reprocessDocument } from "@/services/content.service";

export default function DocumentDetailPage() {
  const router = useRouter(); const params = useParams<{documentId:string}>();
  const [doc, setDoc] = useState<any>(); const [versions, setVersions] = useState<any[]>([]); const [busy, setBusy] = useState(false);
  async function load() { const [d,v] = await Promise.all([getDocumentStatus(params.documentId), getDocumentVersions(params.documentId)]); if (d.success === false) { router.replace("/admin/content"); return; } setDoc(d); setVersions(v.success === false ? [] : v); }
  useEffect(() => { const u=getStoredUser(); if(!u||u.role!=="ADMIN"){router.replace("/login");return;} void load(); }, [params.documentId, router]);
  async function reprocess(){ setBusy(true); await reprocessDocument(params.documentId); await load(); setBusy(false); }
  if(!doc) return <main className="p-8">Loading document…</main>;
  return <main className="mx-auto max-w-6xl px-4 py-8"><div className="flex items-center justify-between"><div><p className="text-sm text-muted-foreground">Document detail</p><h1 className="text-3xl font-semibold">{doc.file_name}</h1></div><button onClick={()=>void reprocess()} disabled={busy} className="rounded-xl bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50">{busy?"Reprocessing…":"Reprocess"}</button></div><div className="mt-6 grid gap-4 md:grid-cols-4">{[["Status",doc.processing_status],["OCR",doc.ocr_status],["Embedding",doc.embedding_status],["Pages",doc.page_count ?? "—"]].map(([k,v])=><div key={k} className="rounded-2xl border p-4"><div className="text-sm text-muted-foreground">{k}</div><div className="mt-1 text-xl font-semibold">{v}</div></div>)}</div><section className="mt-8 rounded-2xl border p-5"><h2 className="text-lg font-semibold">Versions</h2><div className="mt-4 space-y-2">{versions.map(v=><div key={v.id} className="flex items-center justify-between rounded-xl bg-muted p-3 text-sm"><span>v{v.version_number} · {v.version_label || "Version"}</span><span>{v.is_current?"CURRENT":"Historical"} · {v.source_hash?.slice(0,12) || "no hash"}</span></div>)}</div></section></main>;
}
