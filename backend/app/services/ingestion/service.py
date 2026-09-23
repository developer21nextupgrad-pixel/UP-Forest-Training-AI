from __future__ import annotations

import hashlib
import logging
import os
import socket
from datetime import datetime, timedelta, timezone
from uuid import NAMESPACE_URL, UUID, uuid5

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.models import (Book, Chapter, Document, DocumentChunk, DocumentIngestionJob, DocumentPage, DocumentSection, DocumentVersion, IngestionJobStatus, IngestionStage, ProcessingStatus)
from app.services import mistral_ocr
from .embedding import MistralEmbeddingProvider
from .storage import StorageProvider, get_storage_provider
from .text_processing import analyze_document_pages, clean_text, chunk_text, detect_language, language_confidence
from .vector_store import get_vector_store

logger=logging.getLogger(__name__)

class IngestionService:
    def __init__(self, session:AsyncSession, settings:Settings, storage:StorageProvider|None=None)->None:
        self.session=session; self.settings=settings; self.storage=storage or get_storage_provider(settings.storage_root)
        self.worker_id=f"{socket.gethostname()}:{os.getpid()}"

    async def _claim_job(self, job_id:UUID)->DocumentIngestionJob|None:
        now=datetime.now(timezone.utc)
        result=await self.session.execute(select(DocumentIngestionJob).where(DocumentIngestionJob.id==job_id).with_for_update())
        job=result.scalar_one_or_none()
        if not job or job.status==IngestionJobStatus.COMPLETE:return None
        if job.status==IngestionJobStatus.PROCESSING and job.lease_expires_at and job.lease_expires_at>now:return None
        job.status=IngestionJobStatus.PROCESSING; job.attempt_count+=1; job.worker_id=self.worker_id; job.claimed_at=now; job.lease_expires_at=now+timedelta(seconds=self.settings.ingestion_job_timeout_seconds); job.started_at=job.started_at or now
        await self.session.commit(); return job

    async def update_job(self, job:DocumentIngestionJob, *, status=None, stage=None, progress=None, processed_pages=None, total_pages=None, total_chunks=None, processed_chunks=None, error=None, failed_pages=None, completed_pages=None)->None:
        if status is not None: job.status=status
        if stage is not None: job.stage=stage
        if progress is not None: job.progress_percentage=max(0,min(100,progress))
        if processed_pages is not None: job.processed_pages=processed_pages
        if total_pages is not None: job.total_pages=total_pages
        if total_chunks is not None: job.total_chunks=total_chunks
        if processed_chunks is not None: job.processed_chunks=processed_chunks
        if error is not None: job.error_message=error
        if failed_pages is not None: job.failed_pages=failed_pages
        if completed_pages is not None: job.completed_page_indices=completed_pages
        if job.status==IngestionJobStatus.PROCESSING:
            job.lease_expires_at=datetime.now(timezone.utc)+timedelta(seconds=self.settings.ingestion_job_timeout_seconds)
        await self.session.flush(); await self.session.commit()

    async def _chapter_for(self, subject_id:UUID, title:str, number:int|None)->Chapter:
        normalized=" ".join(title.split()).strip().lower()
        rows=(await self.session.execute(select(Chapter).where(Chapter.subject_id==subject_id,Chapter.is_active.is_(True)))).scalars().all()
        for row in rows:
            if " ".join(row.title.split()).strip().lower()==normalized:return row
        used={int(x.chapter_number) for x in rows}
        chapter_number=number if number and number>0 and number not in used else (max(used or {0})+1)
        chapter=Chapter(subject_id=subject_id,title=title,chapter_number=chapter_number,description="Document-derived chapter",order_index=chapter_number,is_active=True)
        self.session.add(chapter); await self.session.flush(); return chapter

    async def process_job(self, job_id:UUID)->None:
        job=await self._claim_job(job_id)
        if not job:return
        document=await self.session.get(Document,job.document_id); version=await self.session.get(DocumentVersion,job.document_version_id) if job.document_version_id else None
        if not document or not version or not document.storage_key:
            await self.update_job(job,status=IngestionJobStatus.FAILED,error="Document storage or version is unavailable."); return
        try:
            version.processing_status="PROCESSING"; document.processing_status=ProcessingStatus.PROCESSING; await self.update_job(job,stage=IngestionStage.FILE_VALIDATION,progress=2)
            if not await self.storage.exists(document.storage_key): raise RuntimeError("Stored document file is unavailable.")
            content=await self.storage.get(document.storage_key)
            if hashlib.sha256(content).hexdigest()!=version.source_hash: raise RuntimeError("Stored document checksum does not match the registered source hash.")
            job.stage=IngestionStage.OCR_PROCESSING; document.ocr_status=ProcessingStatus.OCR_PROCESSING; await self.session.commit()
            final_result=None
            async for event in mistral_ocr.extract_text_batched(filename=document.file_name,content_type=document.mime_type or "application/pdf",content=content,settings=self.settings):
                if event.kind=="total_pages": job.total_pages=event.total_pages or 0; document.page_count=event.total_pages or 0
                elif event.kind=="progress": job.processed_pages=event.pages_done or 0; job.completed_page_indices=event.completed_pages or []; job.failed_pages=event.failed_pages or []; job.progress_percentage=min(55,(job.processed_pages/max(1,job.total_pages))*55)
                elif event.kind=="done": final_result=event.result
                await self.session.commit()
            if final_result is None: raise RuntimeError("OCR did not produce a result.")
            document.ocr_status=ProcessingStatus.READY if not final_result.failed_pages else ProcessingStatus.PARTIAL; job.failed_pages=final_result.failed_pages or []
            pages_data=[(p.index+1,clean_text(p.plain_text or p.markdown)) for p in final_result.page_contents]
            structures=analyze_document_pages(pages_data)
            book=await self.session.get(Book,document.book_id)
            if not book or not book.subject_id: raise RuntimeError("Parent book has no subject.")
            # Create/reuse only explicit document-derived chapters. No fallback/demo chapters are invented.
            chapter_map:{}={}; section_map:{}={}
            for st in structures:
                if st.chapter_title:
                    key=(book.subject_id," ".join(st.chapter_title.split()).lower())
                    if key not in chapter_map: chapter_map[key]=await self._chapter_for(book.subject_id,st.chapter_title,st.chapter_number)
            # Remove only this version's derived structure on retry; keep previous versions intact.
            await self.session.execute(delete(DocumentSection).where(DocumentSection.document_version_id==version.id))
            await self.session.execute(delete(DocumentPage).where(DocumentPage.document_version_id==version.id))
            await self.session.execute(delete(DocumentChunk).where(DocumentChunk.document_version_id==version.id))
            current_section=None; current_chapter_id=None; section_counter=0
            for st in structures:
                ch=chapter_map.get((book.subject_id," ".join(st.chapter_title.split()).lower())) if st.chapter_title else None
                if ch and current_chapter_id != ch.id:
                    current_section=None; current_chapter_id=ch.id
                if st.section_title and ch:
                    key=(str(ch.id),st.section_title.strip().lower())
                    if key not in section_map:
                        section_counter+=1
                        section_map[key]=DocumentSection(document_id=document.id,document_version_id=version.id,chapter_id=ch.id,section_number=st.section_number or section_counter,title=st.section_title.strip(),order_index=section_counter,page_start=st.page_number,page_end=st.page_number,printed_page_start=st.printed_page_number,printed_page_end=st.printed_page_number,source_reference=f"document:{document.id}/version:{version.id}/page:{st.page_number}")
                        self.session.add(section_map[key]); await self.session.flush()
                    current_section=section_map[key]
                if current_section and current_section.page_end is not None: current_section.page_end=max(current_section.page_end,st.page_number); current_section.printed_page_end=st.printed_page_number or current_section.printed_page_end
                page_obj=DocumentPage(document_id=document.id,document_version_id=version.id,page_number=st.page_number,printed_page_number=st.printed_page_number,chapter_id=ch.id if ch else None,section_id=current_section.id if current_section else None,markdown=next((p.markdown for p in final_result.page_contents if p.index+1==st.page_number),""),plain_text=next((clean_text(p.plain_text or p.markdown) for p in final_result.page_contents if p.index+1==st.page_number),""))
                self.session.add(page_obj)
            await self.session.flush(); await self.session.commit()
            # Build semantic-ish paragraph chunks while carrying current chapter/section and page provenance.
            page_chunks=[]
            for st in structures:
                page_text=next((p.plain_text for p in final_result.page_contents if p.index+1==st.page_number),"")
                ch=chapter_map.get((book.subject_id," ".join(st.chapter_title.split()).lower())) if st.chapter_title else None
                sec=None
                if ch:
                    matches=[v for (cid,_),v in section_map.items() if cid==str(ch.id) and v.page_start<=st.page_number and (v.page_end or st.page_number)>=st.page_number]
                    sec=matches[-1] if matches else None
                for local_idx, txt in enumerate(chunk_text(page_text,self.settings.rag_chunk_size,self.settings.rag_chunk_overlap)):
                    page_chunks.append((st,txt,local_idx,ch,sec))
            job.stage=IngestionStage.PERSIST_CHUNKS; job.total_chunks=len(page_chunks); document.processing_status=ProcessingStatus.CHUNKING; await self.session.commit()
            vector_inputs=[]
            for idx,(st,txt,local_idx,ch,sec) in enumerate(page_chunks):
                cid=uuid5(NAMESPACE_URL,f"{version.id}:{idx}"); source=f"document:{document.id}/version:{version.id}/pdf-page:{st.page_number}"
                chunk=DocumentChunk(id=cid,document_id=document.id,document_version_id=version.id,chunk_index=idx,page_number=st.page_number,page_end=st.page_number,printed_page_start=st.printed_page_number,printed_page_end=st.printed_page_number,chapter_id=ch.id if ch else None,section_id=sec.id if sec else None,source_reference=source,section_title=sec.title if sec else None,chapter_title=ch.title if ch else None,content=txt,content_hash=hashlib.sha256(txt.encode()).hexdigest(),language=detect_language(txt),metadata_json={"pdf_page_start":st.page_number,"pdf_page_end":st.page_number,"printed_page_start":st.printed_page_number,"printed_page_end":st.printed_page_number,"local_index":local_idx,"language_confidence":language_confidence(txt)})
                self.session.add(chunk)
                vector_inputs.append({"id":str(cid),"document_id":str(document.id),"document_version_id":str(version.id),"book_id":str(book.id),"book_title":book.title,"filename":document.file_name,"page":st.page_number,"page_end":st.page_number,"printed_page_start":st.printed_page_number,"printed_page_end":st.printed_page_number,"source_reference":source,"chunk_index":idx,"chapter_title":chunk.chapter_title,"section_title":chunk.section_title,"language":chunk.language,"content":txt})
            await self.session.flush(); await self.session.commit()
            if not vector_inputs: raise RuntimeError("No text was available to create document chunks.")
            job.stage=IngestionStage.VECTOR_INDEXING; document.embedding_status=ProcessingStatus.EMBEDDING; version.processing_status="EMBEDDING"; await self.session.commit()
            indexed=await get_vector_store(self.settings,MistralEmbeddingProvider(self.settings),self.session).index(vector_inputs)
            job.processed_chunks=indexed; document.embedding_status=ProcessingStatus.READY;
            try:
                from app.services.rag_retrieval import BM25Manager
                BM25Manager.instance(self.settings).invalidate()
            except Exception: logger.exception("Failed to invalidate BM25 cache")
            if final_result.failed_pages:
                version.processing_status="PARTIAL"; version.error_message=f"OCR completed partially; failed PDF pages: {final_result.failed_pages}"; document.processing_status=ProcessingStatus.READY if (await self.session.execute(select(DocumentVersion.id).where(DocumentVersion.document_id==document.id,DocumentVersion.is_current.is_(True),DocumentVersion.id!=version.id))).first() else ProcessingStatus.FAILED
                job.status=IngestionJobStatus.FAILED; job.error_message=version.error_message; job.completed_at=datetime.now(timezone.utc); job.stage=IngestionStage.COMPLETE; job.progress_percentage=min(99,job.progress_percentage); await self.session.commit(); return
            current_rows=(await self.session.execute(select(DocumentVersion).where(DocumentVersion.document_id==document.id,DocumentVersion.is_current.is_(True),DocumentVersion.id!=version.id))).scalars().all()
            for old in current_rows: old.is_current=False
            version.is_current=True; version.processing_status="READY"; version.processed_at=datetime.now(timezone.utc); version.error_message=None; document.processing_status=ProcessingStatus.READY; document.ocr_status=ProcessingStatus.READY; document.embedding_status=ProcessingStatus.READY; job.stage=IngestionStage.COMPLETE; job.status=IngestionJobStatus.COMPLETE; job.progress_percentage=100; job.completed_at=datetime.now(timezone.utc); job.lease_expires_at=None; await self.session.commit()
            logger.info("Ingestion complete job_id=%s document_id=%s indexed=%s",job.id,document.id,indexed)
        except Exception as exc:
            logger.exception("Ingestion failed job_id=%s",job_id)
            await self.session.rollback()
            job=await self.session.get(DocumentIngestionJob,job_id); document=await self.session.get(Document,job.document_id) if job else None; version=await self.session.get(DocumentVersion,job.document_version_id) if job and job.document_version_id else None
            if job:
                job.error_message=str(exc)[:2000]; job.last_error_code=type(exc).__name__; job.lease_expires_at=None
                if job.attempt_count < job.max_attempts:
                    job.status=IngestionJobStatus.QUEUED; job.progress_percentage=min(job.progress_percentage,95); await self.session.commit(); logger.warning("Ingestion job %s re-queued attempt %s/%s",job.id,job.attempt_count,job.max_attempts); return
                job.status=IngestionJobStatus.FAILED; job.completed_at=datetime.now(timezone.utc)
                if version: version.processing_status="FAILED"; version.error_message="Document ingestion failed after bounded retries."
                if document:
                    current=await self.session.scalar(select(DocumentVersion).where(DocumentVersion.document_id==document.id,DocumentVersion.is_current.is_(True)))
                    document.processing_status=ProcessingStatus.READY if current and current.id!=job.document_version_id else ProcessingStatus.FAILED
                    if current and current.id!=job.document_version_id:
                        document.ocr_status=ProcessingStatus.READY; document.embedding_status=ProcessingStatus.READY
                    else:
                        document.ocr_status=ProcessingStatus.FAILED; document.embedding_status=ProcessingStatus.FAILED
                await self.session.commit()
                return
            raise
