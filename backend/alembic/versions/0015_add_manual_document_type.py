"""add MANUAL document type

Revision ID: 0015_add_manual_document_type
Revises: 0014_add_portal_user_roles
Create Date: 2026-09-21
"""

from alembic import op


# revision identifiers, used by Alembic.
revision = "0015_add_manual_document_type"
down_revision = "0014_add_portal_user_roles"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint(
        "ck_documents_document_type",
        "documents",
        type_="check",
    )

    op.create_check_constraint(
        "ck_documents_document_type",
        "documents",
        """
        document_type IS NULL
        OR document_type IN (
            'ACT',
            'RULE',
            'ORDER',
            'CIRCULAR',
            'SOP',
            'JUDGMENT',
            'MANUAL'
        )
        """,
    )

    # Existing Forest Manual is a legal/departmental manual.
    # Existing chunks/embeddings are intentionally preserved.
    op.execute(
        """
        UPDATE documents
        SET document_type = 'MANUAL'
        WHERE id = '105b2fa7-d679-4a9d-b30f-173cc1337fd0'
          AND file_name = 'Compilation_of_Forest_Manual.pdf'
          AND document_type IS NULL
        """
    )


def downgrade() -> None:
    # Remove MANUAL metadata before restoring the previous constraint.
    op.execute(
        """
        UPDATE documents
        SET document_type = NULL
        WHERE document_type = 'MANUAL'
        """
    )

    op.drop_constraint(
        "ck_documents_document_type",
        "documents",
        type_="check",
    )

    op.create_check_constraint(
        "ck_documents_document_type",
        "documents",
        """
        document_type IS NULL
        OR document_type IN (
            'ACT',
            'RULE',
            'ORDER',
            'CIRCULAR',
            'SOP',
            'JUDGMENT'
        )
        """,
    )