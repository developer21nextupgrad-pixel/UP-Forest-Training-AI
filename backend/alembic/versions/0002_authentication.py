"""authentication refresh sessions

Revision ID: 0002_authentication
Revises: 0001_foundation
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0002_authentication"
down_revision: Union[str, Sequence[str], None] = "0001_foundation"
branch_labels = None
depends_on = None

def upgrade() -> None:
    op.create_table(
        "refresh_token_sessions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("token_hash", sa.String(length=128), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("token_hash"),
    )
    op.create_index("ix_refresh_token_sessions_user_id", "refresh_token_sessions", ["user_id"])
    op.create_index("ix_refresh_token_sessions_token_hash", "refresh_token_sessions", ["token_hash"])

def downgrade() -> None:
    op.drop_index("ix_refresh_token_sessions_token_hash", table_name="refresh_token_sessions")
    op.drop_index("ix_refresh_token_sessions_user_id", table_name="refresh_token_sessions")
    op.drop_table("refresh_token_sessions")
