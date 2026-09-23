"""add content domain to books

Revision ID: 5cd7d0d9c1b7

Revises: 60226d546d14

Create Date: 2026-09-22 13:35:36.291317

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "5cd7d0d9c1b7"

down_revision: Union[str, Sequence[str], None] = "60226d546d14"

branch_labels: Union[str, Sequence[str], None] = None

depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "books",
        sa.Column(
            "domain",
            sa.String(length=20),
            nullable=False,
            server_default="TRAINING",
        ),
    )

    op.create_index(
        "ix_books_domain",
        "books",
        ["domain"],
    )

    # Existing books belong to the training corpus.
    op.alter_column(
        "books",
        "domain",
        server_default=None,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_books_domain",
        table_name="books",
    )

    op.drop_column(
        "books",
        "domain",
    )