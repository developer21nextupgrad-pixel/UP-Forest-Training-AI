from __future__ import annotations
from datetime import datetime
from uuid import UUID
from pydantic import BaseModel, Field, ConfigDict
from app.services.rag_schemas import Citation

class TutorSessionCreateRequest(BaseModel):
    subject_id: UUID | None = None
    chapter_id: UUID | None = None
    language: str | None = Field(default=None, pattern="^(hi|en|auto)$")
    title: str | None = Field(default=None, max_length=300)

class TutorSessionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    title: str | None
    subject_id: UUID | None
    chapter_id: UUID | None
    language: str
    created_at: datetime
    updated_at: datetime

class TutorChatRequest(BaseModel):
    session_id: UUID | None = None
    message: str = Field(min_length=1, max_length=4000)
    language: str | None = Field(default=None, pattern="^(hi|en|auto)$")
    subject_id: UUID | None = None
    chapter_id: UUID | None = None

class TutorChatResponse(BaseModel):
    success: bool = True
    session_id: UUID
    message_id: UUID
    answer: str
    language: str
    key_points: list[str]
    citations: list[Citation]
    grounded: bool

class TutorMessageResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    role: str
    content: str
    created_at: datetime
