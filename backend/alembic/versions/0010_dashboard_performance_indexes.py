"""Add composite indexes used by student dashboard hot paths.

Revision ID: 0010_dashboard_indexes
Revises: 0009_password_reset
"""
from typing import Sequence, Union

from alembic import op

revision: str = "0010_dashboard_indexes"
down_revision: Union[str, Sequence[str], None] = "0009_password_reset"
branch_labels = None
depends_on = None


# def upgrade() -> None:
#     op.create_index(
#         "ix_enrollments_student_status_subject",
#         "enrollments",
#         ["student_id", "status", "subject_id"],
#     )
#     op.create_index(
#         "ix_learning_progress_student_subject_completion",
#         "learning_progress",
#         ["student_id", "subject_id", "completion_percentage"],
#     )
#     op.create_index(
#         "ix_learning_history_student_created",
#         "learning_history",
#         ["student_id", "created_at"],
#     )
#     op.create_index(
#         "ix_learning_history_student_chapter_event",
#         "learning_history",
#         ["student_id", "chapter_id", "event_type"],
#     )
#     op.create_index(
#         "ix_quiz_attempts_student_status_quiz",
#         "quiz_attempts",
#         ["student_id", "status", "quiz_id"],
#     )
#     op.create_index(
#         "ix_quizzes_subject_published_active",
#         "quizzes",
#         ["subject_id", "is_published", "is_active"],
#     )
#     op.create_index(
#         "ix_weak_topics_student_priority",
#         "weak_topics",
#         ["student_id", "priority"],
#     )
#     op.create_index(
#         "ix_review_schedules_student_next_review",
#         "review_schedules",
#         ["student_id", "next_review_at"],
#     )

def upgrade() -> None:
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_enrollments_student_status_subject
        ON enrollments (student_id, status, subject_id)
    """)

    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_learning_progress_student_subject_completion
        ON learning_progress (student_id, subject_id, completion_percentage)
    """)

    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_learning_history_student_created
        ON learning_history (student_id, created_at)
    """)

    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_learning_history_student_chapter_event
        ON learning_history (student_id, chapter_id, event_type)
    """)

    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_quiz_attempts_student_status_quiz
        ON quiz_attempts (student_id, status, quiz_id)
    """)

    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_quizzes_subject_published_active
        ON quizzes (subject_id, is_published, is_active)
    """)

    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_weak_topics_student_priority
        ON weak_topics (student_id, priority)
    """)

    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_review_schedules_student_next_review
        ON review_schedules (student_id, next_review_at)
    """)


def downgrade() -> None:
    op.execute("""
        DROP INDEX IF EXISTS ix_review_schedules_student_next_review
    """)

    op.execute("""
        DROP INDEX IF EXISTS ix_weak_topics_student_priority
    """)

    op.execute("""
        DROP INDEX IF EXISTS ix_quizzes_subject_published_active
    """)

    op.execute("""
        DROP INDEX IF EXISTS ix_quiz_attempts_student_status_quiz
    """)

    op.execute("""
        DROP INDEX IF EXISTS ix_learning_history_student_chapter_event
    """)

    op.execute("""
        DROP INDEX IF EXISTS ix_learning_history_student_created
    """)

    op.execute("""
        DROP INDEX IF EXISTS ix_learning_progress_student_subject_completion
    """)

    op.execute("""
        DROP INDEX IF EXISTS ix_enrollments_student_status_subject
    """)


def downgrade() -> None:
    op.drop_index("ix_review_schedules_student_next_review", table_name="review_schedules")
    op.drop_index("ix_weak_topics_student_priority", table_name="weak_topics")
    op.drop_index("ix_quizzes_subject_published_active", table_name="quizzes")
    op.drop_index("ix_quiz_attempts_student_status_quiz", table_name="quiz_attempts")
    op.drop_index("ix_learning_history_student_chapter_event", table_name="learning_history")
    op.drop_index("ix_learning_history_student_created", table_name="learning_history")
    op.drop_index("ix_learning_progress_student_subject_completion", table_name="learning_progress")
    op.drop_index("ix_enrollments_student_status_subject", table_name="enrollments")
