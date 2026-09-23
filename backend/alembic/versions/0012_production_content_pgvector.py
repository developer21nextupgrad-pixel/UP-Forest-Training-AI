"""Production document hierarchy, provenance, durable jobs and pgvector."""
from alembic import op
import sqlalchemy as sa

revision="0012_production_content_pgvector"
down_revision="0011_widen_status_columns"
branch_labels=None
depends_on=None

def upgrade():
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.create_table(
        "document_sections",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True),
        sa.Column("document_id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("document_version_id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("chapter_id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("section_number", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=500), nullable=False),
        sa.Column("order_index", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("page_start", sa.Integer()), sa.Column("page_end", sa.Integer()),
        sa.Column("printed_page_start", sa.Integer()), sa.Column("printed_page_end", sa.Integer()),
        sa.Column("source_reference", sa.String(length=1000)),
        sa.ForeignKeyConstraint(["document_id"],["documents.id"],ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["document_version_id"],["document_versions.id"],ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["chapter_id"],["chapters.id"],ondelete="CASCADE"),
        sa.UniqueConstraint("document_version_id","chapter_id","section_number",name="uq_document_section"),
    )
    for name,table,col in [("ix_document_sections_document_id","document_sections","document_id"),("ix_document_sections_version_id","document_sections","document_version_id"),("ix_document_sections_chapter_id","document_sections","chapter_id")]: op.create_index(name,table,[col])
    op.add_column("document_versions", sa.Column("processing_status", sa.String(length=30), nullable=False, server_default="PENDING"))
    op.add_column("document_versions", sa.Column("error_message", sa.Text()))
    op.add_column("document_versions", sa.Column("processed_at", sa.DateTime(timezone=True)))
    op.execute("UPDATE document_versions SET processing_status = CASE WHEN is_current THEN 'READY' ELSE 'SUPERSEDED' END")
    op.add_column("document_pages", sa.Column("printed_page_number", sa.Integer()))
    op.add_column("document_pages", sa.Column("chapter_id", sa.UUID(as_uuid=True)))
    op.add_column("document_pages", sa.Column("section_id", sa.UUID(as_uuid=True)))
    op.create_foreign_key("fk_document_pages_chapter","document_pages","chapters",["chapter_id"],["id"],ondelete="SET NULL")
    op.create_foreign_key("fk_document_pages_section","document_pages","document_sections",["section_id"],["id"],ondelete="SET NULL")
    op.create_index("ix_document_pages_printed_page_number","document_pages",["printed_page_number"])
    op.create_index("ix_document_pages_chapter_id","document_pages",["chapter_id"])
    op.create_index("ix_document_pages_section_id","document_pages",["section_id"])
    for name, col in [("printed_page_start", sa.Integer()), ("printed_page_end", sa.Integer()), ("chapter_id", sa.UUID(as_uuid=True)), ("section_id", sa.UUID(as_uuid=True)), ("embedding_dimension", sa.Integer())]:
        op.add_column("document_chunks", sa.Column(name, col, nullable=True))
    op.add_column("document_chunks", sa.Column("embedding", sa.Text(), nullable=True))
    op.execute("ALTER TABLE document_chunks ALTER COLUMN embedding TYPE vector USING embedding::vector")
    op.create_foreign_key("fk_document_chunks_chapter","document_chunks","chapters",["chapter_id"],["id"],ondelete="SET NULL")
    op.create_foreign_key("fk_document_chunks_section","document_chunks","document_sections",["section_id"],["id"],ondelete="SET NULL")
    op.create_index("ix_document_chunks_chapter_id","document_chunks",["chapter_id"])
    op.create_index("ix_document_chunks_section_id","document_chunks",["section_id"])
    op.create_index("ix_document_chunks_embedding_dimension","document_chunks",["embedding_dimension"])
    for name,col,type_ in [("attempt_count","attempt_count",sa.Integer()),("max_attempts","max_attempts",sa.Integer()),("worker_id","worker_id",sa.String(200)),("claimed_at","claimed_at",sa.DateTime(timezone=True)),("lease_expires_at","lease_expires_at",sa.DateTime(timezone=True)),("last_error_code","last_error_code",sa.String(100)),("failed_pages","failed_pages",sa.JSON()),("completed_page_indices","completed_page_indices",sa.JSON()),("idempotency_key","idempotency_key",sa.String(200))]: op.add_column("document_ingestion_jobs",sa.Column(col,type_,nullable=(col not in {"attempt_count","max_attempts"}),server_default=("0" if col=="attempt_count" else "3" if col=="max_attempts" else None)))
    op.create_index("ix_document_ingestion_jobs_lease_expires_at","document_ingestion_jobs",["lease_expires_at"])
    op.create_index("ix_document_ingestion_jobs_idempotency_key","document_ingestion_jobs",["idempotency_key"],unique=True)
    op.add_column("questions",sa.Column("source_document_version_id",sa.UUID(as_uuid=True)))
    op.add_column("questions",sa.Column("source_chunk_id",sa.UUID(as_uuid=True)))
    op.create_foreign_key("fk_questions_source_version","questions","document_versions",["source_document_version_id"],["id"],ondelete="SET NULL")
    op.create_foreign_key("fk_questions_source_chunk","questions","document_chunks",["source_chunk_id"],["id"],ondelete="SET NULL")
    op.create_index("ix_questions_source_document_version_id","questions",["source_document_version_id"])
    op.create_index("ix_questions_source_chunk_id","questions",["source_chunk_id"])
    op.execute("ALTER TABLE document_chunks ADD CONSTRAINT ck_document_chunk_embedding_dimension CHECK (embedding IS NULL OR embedding_dimension = vector_dims(embedding))")

def downgrade():
    op.execute("ALTER TABLE document_chunks DROP CONSTRAINT IF EXISTS ck_document_chunk_embedding_dimension")
    for name in ["ix_questions_source_chunk_id","ix_questions_source_document_version_id"]: op.drop_index(name,table_name="questions")
    op.drop_constraint("fk_questions_source_chunk","questions",type_="foreignkey"); op.drop_constraint("fk_questions_source_version","questions",type_="foreignkey")
    op.drop_column("questions","source_chunk_id"); op.drop_column("questions","source_document_version_id")
    op.drop_index("ix_document_ingestion_jobs_idempotency_key",table_name="document_ingestion_jobs"); op.drop_index("ix_document_ingestion_jobs_lease_expires_at",table_name="document_ingestion_jobs")
    for col in ["idempotency_key","completed_page_indices","failed_pages","last_error_code","lease_expires_at","claimed_at","worker_id","max_attempts","attempt_count"]: op.drop_column("document_ingestion_jobs",col)
    for name in ["ix_document_chunks_embedding_dimension","ix_document_chunks_section_id","ix_document_chunks_chapter_id"]: op.drop_index(name,table_name="document_chunks")
    op.drop_constraint("fk_document_chunks_section","document_chunks",type_="foreignkey"); op.drop_constraint("fk_document_chunks_chapter","document_chunks",type_="foreignkey")
    op.drop_column("document_chunks","embedding"); op.drop_column("document_chunks","embedding_dimension"); op.drop_column("document_chunks","section_id"); op.drop_column("document_chunks","chapter_id"); op.drop_column("document_chunks","printed_page_end"); op.drop_column("document_chunks","printed_page_start")
    for name in ["ix_document_pages_section_id","ix_document_pages_chapter_id","ix_document_pages_printed_page_number"]: op.drop_index(name,table_name="document_pages")
    op.drop_constraint("fk_document_pages_section","document_pages",type_="foreignkey"); op.drop_constraint("fk_document_pages_chapter","document_pages",type_="foreignkey")
    op.drop_column("document_pages","section_id"); op.drop_column("document_pages","chapter_id"); op.drop_column("document_pages","printed_page_number")
    op.drop_column("document_versions","processed_at"); op.drop_column("document_versions","error_message"); op.drop_column("document_versions","processing_status")
    for name in ["ix_document_sections_chapter_id","ix_document_sections_version_id","ix_document_sections_document_id"]: op.drop_index(name,table_name="document_sections")
    op.drop_table("document_sections")
