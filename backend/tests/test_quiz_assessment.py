from types import SimpleNamespace
from unittest.mock import AsyncMock

from app.schemas.quiz import QuizCreate, QuestionCreate, OptionCreate, SubmitRequest, AnswerItem
from app.services.quiz_service import QuizError, QuizService
import pytest

def test_quiz_create_validation():
    q=QuizCreate(title="Silviculture",subject_id="00000000-0000-0000-0000-000000000001")
    assert q.passing_score == 60

def test_question_requires_points_and_options():
    with pytest.raises(Exception):
        QuestionCreate(question_text="Q",points=0,options=[])

def test_answer_does_not_accept_server_score():
    payload=SubmitRequest(answers=[AnswerItem(question_id="00000000-0000-0000-0000-000000000001",selected_option_id=None)])
    assert not hasattr(payload,"score")

def test_language_restricted():
    with pytest.raises(Exception):
        QuizCreate(title="x",subject_id="00000000-0000-0000-0000-000000000001",language="fr")


@pytest.mark.asyncio
async def test_quiz_scope_rejects_chapter_from_another_subject():
    subject_id = "00000000-0000-0000-0000-000000000001"
    chapter_id = "00000000-0000-0000-0000-000000000002"
    session = SimpleNamespace(
        get=AsyncMock(
            side_effect=[
                SimpleNamespace(id=subject_id),
                SimpleNamespace(subject_id="00000000-0000-0000-0000-000000000003"),
            ]
        )
    )

    with pytest.raises(QuizError, match="Chapter does not belong to subject"):
        await QuizService(session)._validate_subject_chapter_scope(subject_id, chapter_id)


@pytest.mark.asyncio
async def test_quiz_scope_accepts_chapter_from_selected_subject():
    subject_id = "00000000-0000-0000-0000-000000000001"
    chapter_id = "00000000-0000-0000-0000-000000000002"
    session = SimpleNamespace(
        get=AsyncMock(
            side_effect=[
                SimpleNamespace(id=subject_id),
                SimpleNamespace(subject_id=subject_id),
            ]
        )
    )

    await QuizService(session)._validate_subject_chapter_scope(subject_id, chapter_id)
