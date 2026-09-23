"""quiz assessment engine

Revision ID: 0005_quiz_assessment
Revises: 0004_student_platform
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision="0005_quiz_assessment"
down_revision="0004_student_platform"
branch_labels=None
depends_on=None

def upgrade():
    op.create_table("quiz_generation_jobs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("subject_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("subjects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("chapter_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("chapters.id", ondelete="SET NULL")),
        sa.Column("number_of_questions", sa.Integer(), nullable=False),
        sa.Column("difficulty", sa.String(20), nullable=False), sa.Column("language", sa.String(10), nullable=False),
        sa.Column("status", sa.String(30), nullable=False, server_default="QUEUED"), sa.Column("progress", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("generated_count", sa.Integer(), nullable=False, server_default="0"), sa.Column("error_message", sa.Text()))
    op.create_index("ix_quiz_generation_jobs_created_by","quiz_generation_jobs",["created_by"])
    op.create_index("ix_quiz_generation_jobs_status","quiz_generation_jobs",["status"])
    op.add_column("quizzes", sa.Column("description", sa.Text(), nullable=True))
    op.add_column("quizzes", sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key("fk_quizzes_created_by_users","quizzes","users",["created_by"],["id"],ondelete="SET NULL")
    op.add_column("quizzes", sa.Column("status", sa.String(length=30), nullable=False, server_default="DRAFT"))
    op.add_column("quizzes", sa.Column("time_limit_seconds", sa.Integer(), nullable=True))
    op.add_column("quizzes", sa.Column("passing_score", sa.Float(), nullable=False, server_default="60"))
    op.add_column("quizzes", sa.Column("max_attempts", sa.Integer(), nullable=True))
    op.add_column("quizzes", sa.Column("is_published", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.create_index("ix_quizzes_created_by","quizzes",["created_by"])
    op.create_index("ix_quizzes_status","quizzes",["status"])
    op.create_index("ix_quizzes_is_published","quizzes",["is_published"])

    op.add_column("questions", sa.Column("points", sa.Float(), nullable=False, server_default="1"))
    op.add_column("questions", sa.Column("order_index", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("questions", sa.Column("source_metadata", sa.JSON(), nullable=True))
    op.add_column("quiz_options", sa.Column("option_label", sa.String(length=20), nullable=True))
    op.add_column("quiz_options", sa.Column("order_index", sa.Integer(), nullable=False, server_default="0"))
    op.execute("UPDATE quiz_options SET option_label = option_key WHERE option_label IS NULL")
    op.alter_column("quiz_options","option_label",nullable=False)

    op.add_column("quiz_attempts", sa.Column("status", sa.String(length=30), nullable=False, server_default="IN_PROGRESS"))
    op.add_column("quiz_attempts", sa.Column("percentage", sa.Float(), nullable=True))
    op.add_column("quiz_attempts", sa.Column("passed", sa.Boolean(), nullable=True))
    op.add_column("quiz_attempts", sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("quiz_attempts", sa.Column("time_taken_seconds", sa.Integer(), nullable=True))
    op.create_index("ix_quiz_attempts_status","quiz_attempts",["status"])
    op.create_index("ix_quiz_attempts_created_at","quiz_attempts",["created_at"])

    op.add_column("quiz_answers", sa.Column("selected_option_label", sa.String(length=20), nullable=True))
    op.add_column("quiz_answers", sa.Column("question_snapshot", sa.JSON(), nullable=True))
    op.add_column("quiz_answers", sa.Column("points_awarded", sa.Float(), nullable=True))
    op.create_unique_constraint("uq_quiz_answer_attempt_question","quiz_answers",["attempt_id","question_id"])

def downgrade():
    op.drop_index("ix_quiz_generation_jobs_status",table_name="quiz_generation_jobs"); op.drop_index("ix_quiz_generation_jobs_created_by",table_name="quiz_generation_jobs"); op.drop_table("quiz_generation_jobs")
    op.drop_constraint("uq_quiz_answer_attempt_question","quiz_answers",type_="unique")
    op.drop_column("quiz_answers","points_awarded"); op.drop_column("quiz_answers","question_snapshot"); op.drop_column("quiz_answers","selected_option_label")
    for n in ["ix_quiz_attempts_created_at","ix_quiz_attempts_status"]: op.drop_index(n,table_name="quiz_attempts")
    for c in ["time_taken_seconds","submitted_at","passed","percentage","status"]: op.drop_column("quiz_attempts",c)
    op.drop_column("quiz_options","order_index"); op.drop_column("quiz_options","option_label")
    for c in ["source_metadata","order_index","points"]: op.drop_column("questions",c)
    for n in ["ix_quizzes_is_published","ix_quizzes_status","ix_quizzes_created_by"]: op.drop_index(n,table_name="quizzes")
    op.drop_column("quizzes","is_published"); op.drop_column("quizzes","max_attempts"); op.drop_column("quizzes","passing_score"); op.drop_column("quizzes","time_limit_seconds"); op.drop_column("quizzes","status")
    op.drop_constraint("fk_quizzes_created_by_users","quizzes",type_="foreignkey"); op.drop_column("quizzes","created_by"); op.drop_column("quizzes","description")
