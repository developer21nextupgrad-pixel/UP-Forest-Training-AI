from pathlib import Path
from runpy import run_path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

from app.db import migration_compat


@pytest.fixture
def migration_connection():
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        with Operations.context(MigrationContext.configure(connection)):
            yield connection
    engine.dispose()


def test_create_table_adopts_matching_schema_and_allows_later_columns(
    migration_connection,
):
    connection = migration_connection
    connection.exec_driver_sql(
        "CREATE TABLE reports (id INTEGER PRIMARY KEY, officer_id INTEGER NOT NULL, "
        "status VARCHAR(30) NOT NULL, submitted_at DATETIME)"
    )
    connection.exec_driver_sql(
        "INSERT INTO reports (id, officer_id, status) VALUES (1, 7, 'OPEN')"
    )
    with Operations.context(MigrationContext.configure(connection)):
        migration_compat.create_table_if_compatible(
            "reports",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("officer_id", sa.Integer(), nullable=False),
            sa.Column("status", sa.String(30), nullable=False),
            sa.PrimaryKeyConstraint("id"),
        )

    assert {
        column["name"] for column in sa.inspect(connection).get_columns("reports")
    } == {"id", "officer_id", "status", "submitted_at"}
    assert connection.exec_driver_sql(
        "SELECT officer_id, status FROM reports WHERE id = 1"
    ).one() == (7, "OPEN")


def test_fresh_table_creation_can_be_repeated_without_duplicate_objects(
    migration_connection,
):
    connection = migration_connection
    with Operations.context(MigrationContext.configure(connection)):
        for _ in range(2):
            migration_compat.create_table_if_compatible(
                "reports",
                sa.Column("id", sa.Integer(), nullable=False),
                sa.Column("officer_id", sa.Integer(), nullable=True),
                sa.PrimaryKeyConstraint("id"),
                sa.UniqueConstraint("officer_id", name="uq_reports_officer"),
            )

    assert sa.inspect(connection).has_table("reports")


def test_create_table_rejects_incompatible_existing_column(migration_connection):
    connection = migration_connection
    connection.exec_driver_sql(
        "CREATE TABLE reports (id INTEGER PRIMARY KEY, status TEXT NOT NULL)"
    )
    with Operations.context(MigrationContext.configure(connection)):
        with pytest.raises(RuntimeError, match="incompatible"):
            migration_compat.create_table_if_compatible(
                "reports",
                sa.Column("id", sa.Integer(), nullable=False),
                sa.Column("status", sa.String(30), nullable=False),
                sa.PrimaryKeyConstraint("id"),
            )


def test_create_table_rejects_missing_required_column(migration_connection):
    connection = migration_connection
    connection.exec_driver_sql(
        "CREATE TABLE reports (id INTEGER PRIMARY KEY, status VARCHAR(30) NOT NULL)"
    )
    with Operations.context(MigrationContext.configure(connection)):
        with pytest.raises(RuntimeError, match="officer_id is missing"):
            migration_compat.create_table_if_compatible(
                "reports",
                sa.Column("id", sa.Integer(), nullable=False),
                sa.Column("officer_id", sa.Integer(), nullable=False),
                sa.Column("status", sa.String(30), nullable=False),
                sa.PrimaryKeyConstraint("id"),
            )


def test_create_table_rejects_incompatible_existing_default(migration_connection):
    connection = migration_connection
    connection.exec_driver_sql(
        "CREATE TABLE reports (id INTEGER PRIMARY KEY, status VARCHAR(30) "
        "NOT NULL DEFAULT 'OTHER')"
    )
    with Operations.context(MigrationContext.configure(connection)):
        with pytest.raises(RuntimeError, match="default"):
            migration_compat.create_table_if_compatible(
                "reports",
                sa.Column("id", sa.Integer(), nullable=False),
                sa.Column(
                    "status",
                    sa.String(30),
                    nullable=False,
                    server_default=sa.text("'PENDING'"),
                ),
                sa.PrimaryKeyConstraint("id"),
            )


def test_add_column_is_idempotent_but_rejects_incompatible_type(
    migration_connection,
):
    connection = migration_connection
    connection.exec_driver_sql(
        "CREATE TABLE reports (id INTEGER PRIMARY KEY, operation_id VARCHAR(100))"
    )
    with Operations.context(MigrationContext.configure(connection)):
        migration_compat.add_column_if_compatible(
            "reports", sa.Column("operation_id", sa.String(100), nullable=True)
        )
        with pytest.raises(RuntimeError, match="incompatible"):
            migration_compat.add_column_if_compatible(
                "reports", sa.Column("operation_id", sa.Integer(), nullable=True)
            )


def test_add_missing_column_to_existing_table(migration_connection):
    connection = migration_connection
    connection.exec_driver_sql("CREATE TABLE reports (id INTEGER PRIMARY KEY)")
    connection.exec_driver_sql("INSERT INTO reports (id) VALUES (1)")
    with Operations.context(MigrationContext.configure(connection)):
        migration_compat.add_column_if_compatible(
            "reports", sa.Column("operation_id", sa.String(100), nullable=True)
        )

    assert "operation_id" in {
        column["name"] for column in sa.inspect(connection).get_columns("reports")
    }
    assert connection.exec_driver_sql(
        "SELECT id, operation_id FROM reports"
    ).one() == (1, None)


def test_daily_diary_migration_adds_and_reuses_idempotency_column(
    migration_connection, monkeypatch
):
    connection = migration_connection
    connection.exec_driver_sql(
        "CREATE TABLE daily_diaries (officer_id INTEGER NOT NULL)"
    )
    connection.exec_driver_sql("INSERT INTO daily_diaries VALUES (7)")
    migration_path = (
        Path(__file__).resolve().parents[2]
        / "alembic"
        / "versions"
        / "9acb5ef27271_add_daily_diary_idempotency.py"
    )
    upgrade = run_path(str(migration_path))["upgrade"]
    created = []

    def create_unique_constraint(*args, **kwargs):
        created.append((args, kwargs))
        connection.exec_driver_sql(
            "CREATE UNIQUE INDEX uq_daily_diary_officer_operation "
            "ON daily_diaries (officer_id, client_operation_id)"
        )

    monkeypatch.setattr(
        migration_compat.op,
        "create_unique_constraint",
        create_unique_constraint,
    )

    with Operations.context(MigrationContext.configure(connection)):
        upgrade()
        upgrade()

    assert len(created) == 1
    assert connection.exec_driver_sql(
        "SELECT officer_id, client_operation_id FROM daily_diaries"
    ).one() == (7, None)
    unique_index = next(
        index
        for index in sa.inspect(connection).get_indexes("daily_diaries")
        if index["name"] == "uq_daily_diary_officer_operation"
    )
    assert bool(unique_index["unique"])
    assert unique_index["column_names"] == ["officer_id", "client_operation_id"]

    connection.exec_driver_sql(
        "INSERT INTO daily_diaries (officer_id, client_operation_id) "
        "VALUES (7, 'operation-1')"
    )
    with pytest.raises(sa.exc.IntegrityError):
        connection.exec_driver_sql(
            "INSERT INTO daily_diaries (officer_id, client_operation_id) "
            "VALUES (7, 'operation-1')"
        )


def test_create_index_is_idempotent_and_validates_definition(migration_connection):
    connection = migration_connection
    connection.exec_driver_sql(
        "CREATE TABLE reports (id INTEGER PRIMARY KEY, officer_id INTEGER NOT NULL)"
    )
    connection.exec_driver_sql(
        "CREATE INDEX ix_reports_officer_id ON reports (officer_id)"
    )
    with Operations.context(MigrationContext.configure(connection)):
        migration_compat.create_index_if_compatible(
            "ix_reports_officer_id", "reports", ["officer_id"]
        )
        with pytest.raises(RuntimeError, match="incompatible"):
            migration_compat.create_index_if_compatible(
                "ix_reports_officer_id", "reports", ["id"]
            )


def test_create_index_rejects_partial_index(migration_connection):
    connection = migration_connection
    connection.exec_driver_sql(
        "CREATE TABLE reports (id INTEGER PRIMARY KEY, officer_id INTEGER)"
    )
    connection.exec_driver_sql(
        "CREATE UNIQUE INDEX ix_reports_officer_id ON reports (officer_id) "
        "WHERE officer_id IS NOT NULL"
    )
    with Operations.context(MigrationContext.configure(connection)):
        with pytest.raises(RuntimeError, match="incompatible"):
            migration_compat.create_index_if_compatible(
                "ix_reports_officer_id", "reports", ["officer_id"], unique=True
            )


def test_unique_constraint_helper_accepts_matching_existing_constraint(
    migration_connection,
):
    connection = migration_connection
    connection.exec_driver_sql(
        "CREATE TABLE reports (officer_id INTEGER NOT NULL, operation_id VARCHAR(100), "
        "CONSTRAINT uq_reports_officer_operation UNIQUE (officer_id, operation_id))"
    )
    with Operations.context(MigrationContext.configure(connection)):
        migration_compat.create_unique_constraint_if_compatible(
            "uq_reports_officer_operation",
            "reports",
            ["officer_id", "operation_id"],
        )


def test_create_unique_constraint_detects_duplicate_values(
    migration_connection, monkeypatch
):
    connection = migration_connection
    connection.exec_driver_sql(
        "CREATE TABLE reports (officer_id INTEGER NOT NULL, operation_id VARCHAR(100))"
    )
    connection.exec_driver_sql(
        "INSERT INTO reports VALUES (7, 'duplicate'), (7, 'duplicate')"
    )
    created = []
    monkeypatch.setattr(
        migration_compat.op,
        "create_unique_constraint",
        lambda *args, **kwargs: created.append((args, kwargs)),
    )
    with Operations.context(MigrationContext.configure(connection)):
        with pytest.raises(RuntimeError, match="duplicate values"):
            migration_compat.create_unique_constraint_if_compatible(
                "uq_reports_officer_operation",
                "reports",
                ["officer_id", "operation_id"],
            )

    assert created == []


def test_create_missing_unique_constraint_after_duplicate_check(
    migration_connection, monkeypatch
):
    connection = migration_connection
    connection.exec_driver_sql(
        "CREATE TABLE reports (officer_id INTEGER NOT NULL, operation_id VARCHAR(100))"
    )
    created = []
    monkeypatch.setattr(
        migration_compat.op,
        "create_unique_constraint",
        lambda *args, **kwargs: created.append((args, kwargs)),
    )
    with Operations.context(MigrationContext.configure(connection)):
        migration_compat.create_unique_constraint_if_compatible(
            "uq_reports_officer_operation",
            "reports",
            ["officer_id", "operation_id"],
        )

    assert len(created) == 1


def test_create_table_adds_missing_unique_constraint(migration_connection, monkeypatch):
    connection = migration_connection
    connection.exec_driver_sql(
        "CREATE TABLE reports (officer_id INTEGER NOT NULL, operation_id VARCHAR(100))"
    )
    created = []
    monkeypatch.setattr(
        migration_compat.op,
        "create_unique_constraint",
        lambda *args, **kwargs: created.append((args, kwargs)),
    )
    with Operations.context(MigrationContext.configure(connection)):
        migration_compat.create_table_if_compatible(
            "reports",
            sa.Column("officer_id", sa.Integer(), nullable=False),
            sa.Column("operation_id", sa.String(100), nullable=True),
            sa.UniqueConstraint(
                "officer_id",
                "operation_id",
                name="uq_reports_officer_operation",
            ),
        )

    assert len(created) == 1


def test_unique_constraint_rejects_incompatible_same_columns(
    migration_connection, monkeypatch
):
    connection = migration_connection
    connection.exec_driver_sql(
        "CREATE TABLE reports (officer_id INTEGER NOT NULL, operation_id VARCHAR(100))"
    )
    created = []

    class Inspector:
        def has_table(self, table_name):
            return table_name == "reports"

        def get_columns(self, table_name):
            return [
                {"name": "officer_id"},
                {"name": "operation_id"},
            ]

        def get_unique_constraints(self, table_name):
            return [
                {
                    "name": "uq_reports_officer_operation",
                    "column_names": ["officer_id", "operation_id"],
                    "deferrable": True,
                    "initially": "DEFERRED",
                    "dialect_options": {},
                }
            ]

        def get_indexes(self, table_name):
            return []

    monkeypatch.setattr(migration_compat, "inspect", lambda bind: Inspector())
    monkeypatch.setattr(
        migration_compat.op,
        "create_unique_constraint",
        lambda *args, **kwargs: created.append((args, kwargs)),
    )
    with Operations.context(MigrationContext.configure(connection)):
        with pytest.raises(RuntimeError, match="incompatible unique constraint"):
            migration_compat.create_unique_constraint_if_compatible(
                "uq_reports_officer_operation",
                "reports",
                ["officer_id", "operation_id"],
            )

    assert created == []


def test_existing_table_adds_missing_foreign_key(migration_connection, monkeypatch):
    connection = migration_connection
    connection.exec_driver_sql("CREATE TABLE users (id INTEGER PRIMARY KEY)")
    connection.exec_driver_sql(
        "CREATE TABLE reports (officer_id INTEGER NOT NULL)"
    )
    created = []
    monkeypatch.setattr(
        migration_compat.op,
        "create_foreign_key",
        lambda *args, **kwargs: created.append((args, kwargs)),
    )
    with Operations.context(MigrationContext.configure(connection)):
        migration_compat.create_table_if_compatible(
            "reports",
            sa.Column("officer_id", sa.Integer(), nullable=False),
            sa.ForeignKeyConstraint(
                ["officer_id"], ["users.id"], ondelete="CASCADE"
            ),
        )

    assert len(created) == 1


def test_foreign_key_rejects_existing_constraint_with_different_action(
    migration_connection, monkeypatch
):
    connection = migration_connection
    connection.exec_driver_sql("CREATE TABLE users (id INTEGER PRIMARY KEY)")
    connection.exec_driver_sql(
        "CREATE TABLE reports (officer_id INTEGER NOT NULL)"
    )
    created = []

    class Inspector:
        def has_table(self, table_name):
            return table_name in {"reports", "users"}

        def get_columns(self, table_name):
            if table_name == "reports":
                return [{"name": "officer_id"}]
            return [{"name": "id"}]

        def get_foreign_keys(self, table_name):
            return [
                {
                    "name": "fk_reports_officer_existing",
                    "constrained_columns": ["officer_id"],
                    "referred_table": "users",
                    "referred_columns": ["id"],
                    "options": {"ondelete": "SET NULL"},
                }
            ]

    monkeypatch.setattr(migration_compat, "inspect", lambda bind: Inspector())
    monkeypatch.setattr(
        migration_compat.op,
        "create_foreign_key",
        lambda *args, **kwargs: created.append((args, kwargs)),
    )
    with Operations.context(MigrationContext.configure(connection)):
        with pytest.raises(RuntimeError, match="incompatible update/delete actions"):
            migration_compat.create_foreign_key_if_compatible(
                "fk_reports_officer",
                "reports",
                "users",
                ["officer_id"],
                ["id"],
                ondelete="CASCADE",
            )

    assert created == []


def test_foreign_key_helper_adopts_equivalent_constraint_with_different_name(
    migration_connection,
):
    connection = migration_connection
    connection.exec_driver_sql("CREATE TABLE users (id INTEGER PRIMARY KEY)")
    connection.exec_driver_sql(
        "CREATE TABLE reports (officer_id INTEGER CONSTRAINT fk_existing "
        "REFERENCES users(id))"
    )
    with Operations.context(MigrationContext.configure(connection)):
        migration_compat.create_foreign_key_if_compatible(
            "fk_expected",
            "reports",
            "users",
            ["officer_id"],
            ["id"],
        )


def test_unsafe_downgrade_is_refused():
    with pytest.raises(RuntimeError, match="disabled"):
        migration_compat.refuse_unsafe_downgrade("example_revision")
