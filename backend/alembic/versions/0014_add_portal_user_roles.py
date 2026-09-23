"""Add Legal and Field Officer user roles.

Revision ID: 0014_add_portal_user_roles
Revises: 0013_add_legal_document_metadata
Create Date: 2026-09-18
"""

from alembic import op


revision = "0014_add_portal_user_roles"
down_revision = "0013_add_legal_document_metadata"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # User.role uses native_enum=False, so the database column is VARCHAR.
    # Add a constraint so only supported portal roles can be stored.
    op.create_check_constraint(
        "ck_users_role_valid",
        "users",
        """
        role IN (
            'ADMIN',
            'INSTRUCTOR',
            'STUDENT',
            'LEGAL_USER',
            'FIELD_OFFICER'
        )
        """,
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_users_role_valid",
        "users",
        type_="check",
    )