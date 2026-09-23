"""Prompt 9 content intelligence provenance fields."""
from alembic import op
import sqlalchemy as sa

revision = "0008_content_intelligence"
down_revision = "0007_instructor_admin_intelligence"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("document_chunks", sa.Column("page_end", sa.Integer(), nullable=True))
    op.add_column("document_chunks", sa.Column("source_reference", sa.String(length=1000), nullable=True))
    op.create_index("ix_document_chunks_version_hash", "document_chunks", ["document_version_id", "content_hash"])
    op.create_index("ix_document_chunks_language", "document_chunks", ["language"])
    op.create_index("ix_document_versions_current_hash", "document_versions", ["is_current", "source_hash"])


def downgrade() -> None:
    op.drop_index("ix_document_versions_current_hash", table_name="document_versions")
    op.drop_index("ix_document_chunks_language", table_name="document_chunks")
    op.drop_index("ix_document_chunks_version_hash", table_name="document_chunks")
    op.drop_column("document_chunks", "source_reference")
    op.drop_column("document_chunks", "page_end")
