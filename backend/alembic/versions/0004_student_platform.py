"""student platform indexes

Revision ID: 0004_student_platform
Revises: 0003_ingestion
"""
from alembic import op

revision = "0004_student_platform"
down_revision = "0003_ingestion"
branch_labels = None
depends_on = None

def upgrade():
    op.create_index("ix_learning_progress_student_chapter", "learning_progress", ["student_id","chapter_id"])
    op.create_index("ix_learning_progress_student_subject", "learning_progress", ["student_id","subject_id"])
    op.create_index("ix_learning_history_student_created", "learning_history", ["student_id","created_at"])

def downgrade():
    op.drop_index("ix_learning_history_student_created", table_name="learning_history")
    op.drop_index("ix_learning_progress_student_subject", table_name="learning_progress")
    op.drop_index("ix_learning_progress_student_chapter", table_name="learning_progress")
