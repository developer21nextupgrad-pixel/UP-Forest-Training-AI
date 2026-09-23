from __future__ import annotations
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.api.dependencies import require_admin
from app.db.session import get_db_session
from app.models import Chapter, Subject, User

router=APIRouter(prefix="/admin/subjects",tags=["Subject Management"])
class SubjectWrite(BaseModel):
    name:str=Field(min_length=1,max_length=200); code:str=Field(min_length=1,max_length=100); description:str|None=None; language:str=Field(default="en",min_length=2,max_length=10); is_active:bool=True
@router.get("")
async def list_subjects(user:User=Depends(require_admin),session:AsyncSession=Depends(get_db_session)):
    rows=(await session.execute(select(Subject).order_by(Subject.name))).scalars().all()
    return {"items":[{"id":x.id,"name":x.name,"code":x.code,"description":x.description,"language":x.language,"is_active":x.is_active} for x in rows]}

@router.get("/{subject_id}/chapters")
async def list_subject_chapters(subject_id: UUID, user: User = Depends(require_admin), session: AsyncSession = Depends(get_db_session)):
    subject = await session.get(Subject, subject_id)
    if not subject or not subject.is_active:
        raise HTTPException(404, "Subject not found")
    rows = (
        await session.execute(
            select(Chapter)
            .where(Chapter.subject_id == subject_id, Chapter.is_active.is_(True))
            .order_by(Chapter.order_index, Chapter.chapter_number)
        )
    ).scalars().all()
    return {
        "items": [
            {"id": chapter.id, "title": chapter.title, "chapter_number": chapter.chapter_number}
            for chapter in rows
        ]
    }
@router.post("")
async def create_subject(payload:SubjectWrite,user:User=Depends(require_admin),session:AsyncSession=Depends(get_db_session)):
    if await session.scalar(select(Subject).where(Subject.code==payload.code.strip())): raise HTTPException(409,"Subject code already exists")
    item=Subject(name=payload.name.strip(),code=payload.code.strip(),description=payload.description,language=payload.language,is_active=payload.is_active); session.add(item); await session.commit(); await session.refresh(item); return {"id":item.id,"name":item.name,"code":item.code,"description":item.description,"language":item.language,"is_active":item.is_active}
@router.patch("/{subject_id}")
async def update_subject(subject_id:UUID,payload:SubjectWrite,user:User=Depends(require_admin),session:AsyncSession=Depends(get_db_session)):
    item=await session.get(Subject,subject_id)
    if not item: raise HTTPException(404,"Subject not found")
    conflict=await session.scalar(select(Subject).where(Subject.code==payload.code.strip(),Subject.id!=subject_id))
    if conflict: raise HTTPException(409,"Subject code already exists")
    for key,value in payload.model_dump().items(): setattr(item,key,value.strip() if isinstance(value,str) else value)
    await session.commit(); await session.refresh(item); return {"id":item.id,"name":item.name,"code":item.code,"description":item.description,"language":item.language,"is_active":item.is_active}
@router.delete("/{subject_id}")
async def archive_subject(subject_id:UUID,user:User=Depends(require_admin),session:AsyncSession=Depends(get_db_session)):
    item=await session.get(Subject,subject_id)
    if not item: raise HTTPException(404,"Subject not found")
    item.is_active=False; await session.commit(); return {"message":"Subject archived"}
