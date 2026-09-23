"""Add document ingestion jobs and ingestion lifecycle fields.

Revision ID: 0003_ingestion
Revises: 0002_authentication
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0003_ingestion"
down_revision: Union[str, Sequence[str], None] = "0002_authentication"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("documents", sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True))
    op.create_table(
        "document_pages",
        sa.Column("document_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("document_version_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("page_number", sa.Integer(), nullable=False),
        sa.Column("markdown", sa.Text(), nullable=False),
        sa.Column("plain_text", sa.Text(), nullable=False),
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.ForeignKeyConstraint(["document_id"], ["documents.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["document_version_id"], ["document_versions.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("document_version_id", "page_number", name="uq_document_page"),
    )
    op.create_index("ix_document_pages_document_id", "document_pages", ["document_id"])
    op.create_index("ix_document_pages_document_version_id", "document_pages", ["document_version_id"])
    op.create_table(
        "document_ingestion_jobs",
        sa.Column("document_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("document_version_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("stage", sa.String(length=50), nullable=False),
        sa.Column("progress_percentage", sa.Float(), nullable=False, server_default="0"),
        sa.Column("total_pages", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("processed_pages", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_chunks", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("processed_chunks", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.ForeignKeyConstraint(["document_id"], ["documents.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["document_version_id"], ["document_versions.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_document_ingestion_jobs_document_id", "document_ingestion_jobs", ["document_id"])
    op.create_index("ix_document_ingestion_jobs_document_version_id", "document_ingestion_jobs", ["document_version_id"])
    op.create_index("ix_document_ingestion_jobs_status", "document_ingestion_jobs", ["status"])


def downgrade() -> None:
    op.drop_index("ix_document_ingestion_jobs_status", table_name="document_ingestion_jobs")
    op.drop_index("ix_document_ingestion_jobs_document_version_id", table_name="document_ingestion_jobs")
    op.drop_index("ix_document_ingestion_jobs_document_id", table_name="document_ingestion_jobs")
    op.drop_table("document_ingestion_jobs")
    op.drop_index("ix_document_pages_document_version_id", table_name="document_pages")
    op.drop_index("ix_document_pages_document_id", table_name="document_pages")
    op.drop_table("document_pages")
    op.drop_column("documents", "archived_at")
