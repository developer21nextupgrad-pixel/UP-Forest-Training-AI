from __future__ import annotations
from datetime import datetime
from uuid import UUID
from pydantic import BaseModel, Field, ConfigDict

class OptionCreate(BaseModel):
    option_text: str = Field(min_length=1)
    option_label: str = Field(min_length=1, max_length=20)
    order_index: int = Field(ge=0)
    is_correct: bool = False

class OptionResponse(BaseModel):
    id: UUID
    option_text: str
    option_label: str
    order_index: int

class QuestionCreate(BaseModel):
    question_text: str = Field(min_length=1)
    question_type: str = "MCQ_SINGLE"
    difficulty: str | None = None
    explanation: str | None = None
    points: float = Field(gt=0)
    order_index: int = Field(ge=0)
    options: list[OptionCreate] = Field(min_length=2)

class QuestionUpdate(BaseModel):
    question_text: str | None = None
    difficulty: str | None = None
    explanation: str | None = None
    points: float | None = Field(default=None, gt=0)
    order_index: int | None = Field(default=None, ge=0)
    options: list[OptionCreate] | None = None

class QuestionResponse(BaseModel):
    id: UUID
    question_text: str
    question_type: str
    difficulty: str | None
    explanation: str | None = None
    points: float
    order_index: int
    options: list[OptionResponse]

class QuizCreate(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    description: str | None = None
    subject_id: UUID
    chapter_id: UUID | None = None
    language: str = Field(default="en", pattern="^(en|hi)$")
    difficulty: str | None = None
    time_limit_seconds: int | None = Field(default=None, gt=0)
    passing_score: float = Field(default=60, ge=0, le=100)
    max_attempts: int | None = Field(default=None, gt=0)

class QuizUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    subject_id: UUID | None = None
    chapter_id: UUID | None = None
    language: str | None = Field(default=None, pattern="^(en|hi)$")
    difficulty: str | None = None
    time_limit_seconds: int | None = Field(default=None, gt=0)
    passing_score: float | None = Field(default=None, ge=0, le=100)
    max_attempts: int | None = Field(default=None, gt=0)

class QuizResponse(BaseModel):
    id: UUID
    title: str
    description: str | None
    subject_id: UUID | None
    chapter_id: UUID | None
    created_by: UUID | None
    status: str
    language: str
    difficulty: str | None
    time_limit_seconds: int | None
    passing_score: float
    max_attempts: int | None
    is_published: bool
    question_count: int = 0

class StudentQuizResponse(QuizResponse):
    attempts_used: int
    attempts_remaining: int | None
    best_score: float | None

class StudentQuestionResponse(BaseModel):
    id: UUID
    question_text: str
    question_type: str
    difficulty: str | None
    points: float
    order_index: int
    options: list[OptionResponse]

class StudentQuizDetail(BaseModel):
    quiz: StudentQuizResponse
    questions: list[StudentQuestionResponse]

class StartAttemptResponse(BaseModel):
    id: UUID
    quiz_id: UUID
    status: str
    started_at: datetime
    time_limit_seconds: int | None
    questions: list[StudentQuestionResponse]

class AnswerItem(BaseModel):
    question_id: UUID
    selected_option_id: UUID | None = None

class SubmitRequest(BaseModel):
    answers: list[AnswerItem]

class QuestionResult(BaseModel):
    question_id: UUID
    question_text: str
    selected_option: OptionResponse | None
    correct_option: OptionResponse | None
    is_correct: bool
    points_awarded: float
    points_possible: float
    explanation: str | None

class QuizResultResponse(BaseModel):
    attempt_id: UUID
    quiz_id: UUID
    status: str
    score: float
    percentage: float
    passed: bool
    time_taken_seconds: int
    results: list[QuestionResult]

class QuizHistoryItem(BaseModel):
    attempt_id: UUID
    quiz_id: UUID
    quiz_title: str
    attempt_number: int
    score: float | None
    percentage: float | None
    passed: bool | None
    status: str
    submitted_at: datetime | None

class GenerateQuizRequest(BaseModel):
    subject_id: UUID
    chapter_id: UUID | None = None
    number_of_questions: int = Field(default=10, ge=1, le=30)
    difficulty: str = Field(default="MEDIUM", pattern="^(EASY|MEDIUM|HARD)$")
    language: str = Field(default="en", pattern="^(en|hi)$")

class GeneratedOption(BaseModel):
    label: str
    text: str

class GeneratedQuestion(BaseModel):
    question: str
    options: list[GeneratedOption] = Field(min_length=4, max_length=4)
    correct_option: str
    explanation: str
    difficulty: str
    citations: list[str] = Field(min_length=1)

class GenerateQuizResponse(BaseModel):
    job_id: UUID
    status: str
    generated_count: int

class QuizGenerationJobResponse(BaseModel):
    job_id: UUID
    status: str
    progress: int
    generated_count: int
    target_count: int
    error_message: str | None = None
