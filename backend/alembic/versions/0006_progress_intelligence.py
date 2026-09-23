"""progress intelligence, weak topics and spaced repetition

Revision ID: 0006_progress_intelligence
Revises: 0005_quiz_assessment
"""
from alembic import op
import sqlalchemy as sa

revision = "0006_progress_intelligence"
down_revision = "0005_quiz_assessment"
branch_labels = None
depends_on = None

def upgrade():
    op.add_column("weak_topics", sa.Column("coverage_percentage", sa.Float(), nullable=False, server_default="0"))
    op.add_column("weak_topics", sa.Column("priority", sa.Float(), nullable=False, server_default="0"))
    op.add_column("weak_topics", sa.Column("status", sa.String(length=30), nullable=False, server_default="WEAK"))
    op.add_column("weak_topics", sa.Column("reason", sa.Text(), nullable=True))
    op.add_column("weak_topics", sa.Column("evidence_count", sa.Integer(), nullable=False, server_default="0"))
    op.create_index("ix_weak_topics_status", "weak_topics", ["status"])

    op.add_column("review_schedules", sa.Column("mastery_at_schedule", sa.Float(), nullable=True))
    op.add_column("review_schedules", sa.Column("priority", sa.Float(), nullable=False, server_default="0"))
    op.add_column("review_schedules", sa.Column("status", sa.String(length=30), nullable=False, server_default="SCHEDULED"))
    op.add_column("review_schedules", sa.Column("scheduled_for", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_review_schedules_status", "review_schedules", ["status"])
    op.create_index("ix_review_schedules_student_status", "review_schedules", ["student_id", "status"])
    op.create_index("ix_review_schedules_student_chapter", "review_schedules", ["student_id", "chapter_id"])

    # Existing data has one row per student/chapter/topic. Keep it compatible.
    op.execute("UPDATE review_schedules SET scheduled_for = next_review_at WHERE scheduled_for IS NULL")
    op.execute("UPDATE review_schedules SET status = CASE WHEN next_review_at IS NULL THEN 'SCHEDULED' WHEN next_review_at <= CURRENT_TIMESTAMP THEN 'DUE' ELSE 'SCHEDULED' END")

def downgrade():
    op.drop_index("ix_review_schedules_student_chapter", table_name="review_schedules")
    op.drop_index("ix_review_schedules_student_status", table_name="review_schedules")
    op.drop_index("ix_review_schedules_status", table_name="review_schedules")
    op.drop_column("review_schedules", "scheduled_for")
    op.drop_column("review_schedules", "status")
    op.drop_column("review_schedules", "priority")
    op.drop_column("review_schedules", "mastery_at_schedule")

    op.drop_index("ix_weak_topics_status", table_name="weak_topics")
    op.drop_column("weak_topics", "evidence_count")
    op.drop_column("weak_topics", "reason")
    op.drop_column("weak_topics", "status")
    op.drop_column("weak_topics", "priority")
    op.drop_column("weak_topics", "coverage_percentage")
