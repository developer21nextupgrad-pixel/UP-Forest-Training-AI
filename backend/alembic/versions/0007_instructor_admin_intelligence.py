"""Prompt 8 instructor subject assignments and analytics indexes.

Revision ID: 0007_instructor_admin_intelligence
Revises: 0006_progress_intelligence
"""
from alembic import op
import sqlalchemy as sa


revision = "0007_instructor_admin_intelligence"
down_revision = "0006_progress_intelligence"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "instructor_subject_assignments",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("instructor_id", sa.Uuid(), nullable=False),
        sa.Column("subject_id", sa.Uuid(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.ForeignKeyConstraint(["instructor_id"], ["instructor_profiles.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["subject_id"], ["subjects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("instructor_id", "subject_id", name="uq_instructor_subject_assignment"),
    )
    op.create_index("ix_instructor_subject_assignments_instructor_id", "instructor_subject_assignments", ["instructor_id"])
    op.create_index("ix_instructor_subject_assignments_subject_id", "instructor_subject_assignments", ["subject_id"])

    # Add only indexes that are not already supplied by the model.
    op.create_index("ix_learning_history_subject_created", "learning_history", ["subject_id", "created_at"])
    op.create_index("ix_quiz_attempts_quiz_submitted", "quiz_attempts", ["quiz_id", "submitted_at"])
    op.create_index("ix_quiz_attempts_student_submitted", "quiz_attempts", ["student_id", "submitted_at"])
    op.create_index("ix_weak_topics_chapter_status", "weak_topics", ["chapter_id", "status"])
    op.create_index("ix_review_schedules_chapter_status", "review_schedules", ["chapter_id", "status"])


def downgrade() -> None:
    op.drop_index("ix_review_schedules_chapter_status", table_name="review_schedules")
    op.drop_index("ix_weak_topics_chapter_status", table_name="weak_topics")
    op.drop_index("ix_quiz_attempts_student_submitted", table_name="quiz_attempts")
    op.drop_index("ix_quiz_attempts_quiz_submitted", table_name="quiz_attempts")
    op.drop_index("ix_learning_history_subject_created", table_name="learning_history")
    op.drop_index("ix_instructor_subject_assignments_subject_id", table_name="instructor_subject_assignments")
    op.drop_index("ix_instructor_subject_assignments_instructor_id", table_name="instructor_subject_assignments")
    op.drop_table("instructor_subject_assignments")
