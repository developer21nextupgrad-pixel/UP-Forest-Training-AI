"""Schema-aware helpers for adopting compatible objects predating Alembic tracking."""

from __future__ import annotations

import re
from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy import inspect
from sqlalchemy.engine import Connection

from alembic import op


def _bind() -> Connection:
    return op.get_bind()


def _offline() -> bool:
    return bool(op.get_context().as_sql)


def _type_matches(expected: sa.types.TypeEngine, actual: sa.types.TypeEngine) -> bool:
    dialect = _bind().dialect
    expected_sql = expected.dialect_impl(dialect).compile(dialect=dialect)
    actual_sql = actual.dialect_impl(dialect).compile(dialect=dialect)
    return expected_sql == actual_sql


def _default_matches(
    expected: sa.Column[object], actual_default: str | None
) -> bool:
    if expected.server_default is None:
        return True
    if actual_default is None:
        return False

    dialect = _bind().dialect
    expected_arg = expected.server_default.arg
    if isinstance(expected_arg, sa.sql.ClauseElement):
        expected_default = str(
            expected_arg.compile(
                dialect=dialect, compile_kwargs={"literal_binds": True}
            )
        )
    else:
        expected_default = str(expected_arg)

    def normalize(default: str) -> str:
        normalized = re.sub(r"\s+", "", default.lower())
        normalized = re.sub(
            r"::(?:character varying|varchar|text|timestamp with time zone)$",
            "",
            normalized,
        )
        while normalized.startswith("(") and normalized.endswith(")"):
            normalized = normalized[1:-1]
        if normalized in {"now()", "current_timestamp"}:
            return "current_timestamp"
        return normalized

    return normalize(expected_default) == normalize(actual_default)


def _schema_mismatch(message: str) -> RuntimeError:
    return RuntimeError(f"Existing database schema is incompatible: {message}")


def _index_matches(
    index: dict[str, object], columns: Sequence[str], unique: bool
) -> bool:
    options = index.get("dialect_options") or {}
    if not isinstance(options, dict):
        return False
    if any(
        options.get(name) is not None
        for name in ("postgresql_where", "sqlite_where")
    ):
        return False
    if any(
        value not in (None, False, [], {})
        for key, value in options.items()
        if key != "postgresql_using"
    ):
        return False
    return (
        index.get("column_names") == list(columns)
        and bool(index.get("unique")) == unique
        and not index.get("expressions")
        and not index.get("column_sorting")
        and options.get("postgresql_using", "btree") in (None, "btree")
    )


def _unique_constraint_matches(
    constraint: dict[str, object], columns: Sequence[str]
) -> bool:
    options = constraint.get("dialect_options") or {}
    if not isinstance(options, dict):
        return False
    return (
        constraint.get("column_names") == list(columns)
        and not constraint.get("deferrable")
        and not constraint.get("initially")
        and not options.get("postgresql_nulls_not_distinct")
    )


def _foreign_key_matches(
    foreign_key: dict[str, object],
    local_columns: Sequence[str],
    referent_table: str,
    remote_columns: Sequence[str],
    *,
    ondelete: str | None,
    onupdate: str | None = None,
) -> bool:
    options = foreign_key.get("options") or {}
    if not isinstance(options, dict):
        return False
    return (
        foreign_key.get("constrained_columns") == list(local_columns)
        and foreign_key.get("referred_table") == referent_table
        and foreign_key.get("referred_columns") == list(remote_columns)
        and (options.get("ondelete") or "").upper() == (ondelete or "").upper()
        and (options.get("onupdate") or "").upper() == (onupdate or "").upper()
        and not options.get("deferrable")
        and not options.get("initially")
    )


def refuse_unsafe_downgrade(revision: str) -> None:
    raise RuntimeError(
        f"Downgrade of {revision} is disabled because its upgrade can adopt "
        "pre-existing schema objects. Use a reviewed, data-preserving forward "
        "migration instead."
    )


def create_table_if_compatible(
    table_name: str, *elements: sa.SchemaItem, **kwargs: object
) -> None:
    if _offline():
        op.create_table(table_name, *elements, **kwargs)
        return
    bind = _bind()
    inspector = inspect(bind)
    if not inspector.has_table(table_name):
        op.create_table(table_name, *elements, **kwargs)
        return

    expected = sa.Table(table_name, sa.MetaData(), *elements)
    expected_pk = set(expected.primary_key.columns.keys())
    actual_columns = {
        column["name"]: column for column in inspector.get_columns(table_name)
    }
    for column in expected.columns:
        actual = actual_columns.get(column.name)
        if actual is None:
            raise _schema_mismatch(f"{table_name}.{column.name} is missing")
        if not _type_matches(column.type, actual["type"]):
            raise _schema_mismatch(
                f"{table_name}.{column.name} has type {actual['type']}; "
                f"expected {column.type}"
            )
        if column.name not in expected_pk and actual["nullable"] != column.nullable:
            raise _schema_mismatch(
                f"{table_name}.{column.name} nullable={actual['nullable']}; "
                f"expected nullable={column.nullable}"
            )
        if not _default_matches(column, actual.get("default")):
            raise _schema_mismatch(
                f"{table_name}.{column.name} has default {actual.get('default')!r}; "
                f"expected {column.server_default.arg!s}"
            )

    actual_pk = set(
        inspector.get_pk_constraint(table_name).get("constrained_columns") or ()
    )
    if actual_pk != expected_pk:
        raise _schema_mismatch(
            f"{table_name} primary key is {sorted(actual_pk)}; "
            f"expected {sorted(expected_pk)}"
        )

    actual_fks = inspector.get_foreign_keys(table_name)
    for constraint in expected.constraints:
        if not isinstance(constraint, sa.ForeignKeyConstraint):
            continue
        columns = list(constraint.columns.keys())
        elements = list(constraint.elements)
        targets = [element.target_fullname.split(".") for element in elements]
        target_table = targets[0][-2]
        target_columns = [target[-1] for target in targets]
        options = constraint.ondelete
        matched = any(
            _foreign_key_matches(
                fk,
                columns,
                target_table,
                target_columns,
                ondelete=options,
                onupdate=constraint.onupdate,
            )
            for fk in actual_fks
        )
        if not matched:
            create_foreign_key_if_compatible(
                constraint.name,
                table_name,
                target_table,
                columns,
                target_columns,
                ondelete=constraint.ondelete,
                onupdate=constraint.onupdate,
            )

    actual_uniques = inspector.get_unique_constraints(table_name)
    actual_indexes = inspector.get_indexes(table_name)
    for constraint in expected.constraints:
        if not isinstance(constraint, sa.UniqueConstraint):
            continue
        columns = list(constraint.columns.keys())
        same_columns = [
            item
            for item in actual_uniques
            if item.get("column_names") == columns
        ]
        if any(not _unique_constraint_matches(item, columns) for item in same_columns):
            raise _schema_mismatch(
                f"{table_name} has an incompatible unique constraint on {columns}"
            )
        if not any(
            _unique_constraint_matches(item, columns) for item in actual_uniques
        ) and not any(
            _index_matches(item, columns, unique=True) for item in actual_indexes
        ):
            create_unique_constraint_if_compatible(
                constraint.name,
                table_name,
                columns,
            )


def add_column_if_compatible(table_name: str, column: sa.Column[object]) -> None:
    if _offline():
        op.add_column(table_name, column)
        return
    inspector = inspect(_bind())
    if not inspector.has_table(table_name):
        raise _schema_mismatch(f"table {table_name} is missing")
    columns = {item["name"]: item for item in inspector.get_columns(table_name)}
    actual = columns.get(column.name)
    if actual is None:
        op.add_column(table_name, column)
        return
    if not _type_matches(column.type, actual["type"]):
        raise _schema_mismatch(
            f"{table_name}.{column.name} has type {actual['type']}; "
            f"expected {column.type}"
        )
    if actual["nullable"] != column.nullable:
        raise _schema_mismatch(
            f"{table_name}.{column.name} nullable={actual['nullable']}; "
            f"expected nullable={column.nullable}"
        )
    if not _default_matches(column, actual.get("default")):
        raise _schema_mismatch(
            f"{table_name}.{column.name} has default {actual.get('default')!r}; "
            f"expected {column.server_default.arg!s}"
        )


def create_index_if_compatible(
    index_name: str,
    table_name: str,
    columns: Sequence[str],
    *,
    unique: bool = False,
    **kwargs: object,
) -> None:
    if _offline():
        op.create_index(index_name, table_name, list(columns), unique=unique, **kwargs)
        return
    inspector = inspect(_bind())
    if not inspector.has_table(table_name):
        raise _schema_mismatch(f"table {table_name} is missing")
    existing_columns = {
        column["name"] for column in inspector.get_columns(table_name)
    }
    missing_columns = set(columns) - existing_columns
    if missing_columns:
        raise _schema_mismatch(
            f"{table_name} lacks index columns {sorted(missing_columns)}"
        )
    indexes = inspector.get_indexes(table_name)
    found = next((index for index in indexes if index["name"] == index_name), None)
    if found is not None:
        if not _index_matches(found, columns, unique):
            raise _schema_mismatch(f"index {index_name} has an incompatible definition")
        return
    equivalent = next(
        (index for index in indexes if _index_matches(index, columns, unique)),
        None,
    )
    if equivalent is not None:
        return
    op.create_index(index_name, table_name, list(columns), unique=unique, **kwargs)


def create_unique_constraint_if_compatible(
    name: str | None, table_name: str, columns: Sequence[str]
) -> None:
    if _offline():
        op.create_unique_constraint(name, table_name, list(columns))
        return
    inspector = inspect(_bind())
    if not inspector.has_table(table_name):
        raise _schema_mismatch(f"table {table_name} is missing")
    existing_columns = {
        column["name"] for column in inspector.get_columns(table_name)
    }
    missing_columns = set(columns) - existing_columns
    if missing_columns:
        raise _schema_mismatch(
            f"{table_name} lacks unique columns {sorted(missing_columns)}"
        )
    constraints = inspector.get_unique_constraints(table_name)
    indexes = inspector.get_indexes(table_name)
    same_columns = [
        item for item in constraints if item.get("column_names") == list(columns)
    ]
    if any(not _unique_constraint_matches(item, columns) for item in same_columns):
        raise _schema_mismatch(
            f"{table_name} has an incompatible unique constraint on {list(columns)}"
        )
    if name is not None:
        conflicting_index = next(
            (item for item in indexes if item.get("name") == name),
            None,
        )
        if conflicting_index is not None and not _index_matches(
            conflicting_index, columns, unique=True
        ):
            raise _schema_mismatch(
                f"index {name} conflicts with the expected unique constraint"
            )
    named = (
        next((item for item in constraints if item.get("name") == name), None)
        if name is not None
        else None
    )
    if named is not None:
        if not _unique_constraint_matches(named, columns):
            raise _schema_mismatch(f"unique constraint {name} has incompatible columns")
        return
    equivalent = next(
        (item for item in constraints if _unique_constraint_matches(item, columns)),
        None,
    )
    if equivalent is None:
        equivalent = next(
            (
                item for item in indexes if _index_matches(item, columns, unique=True)
            ),
            None,
        )
    if equivalent is not None:
        return
    table = sa.Table(table_name, sa.MetaData(), autoload_with=_bind())
    key_columns = [table.c[column] for column in columns]
    duplicate = _bind().execute(
        sa.select(*key_columns)
        .where(sa.and_(*(column.is_not(None) for column in key_columns)))
        .group_by(*key_columns)
        .having(sa.func.count() > 1)
        .limit(1)
    ).first()
    if duplicate is not None:
        raise _schema_mismatch(
            f"duplicate values prevent unique constraint on {table_name}{columns}"
        )
    op.create_unique_constraint(name, table_name, list(columns))


def create_foreign_key_if_compatible(
    name: str | None,
    source_table: str,
    referent_table: str,
    local_columns: Sequence[str],
    remote_columns: Sequence[str],
    *,
    ondelete: str | None = None,
    onupdate: str | None = None,
) -> None:
    if _offline():
        op.create_foreign_key(
            name,
            source_table,
            referent_table,
            list(local_columns),
            list(remote_columns),
            ondelete=ondelete,
            onupdate=onupdate,
        )
        return
    inspector = inspect(_bind())
    if not inspector.has_table(source_table):
        raise _schema_mismatch(f"table {source_table} is missing")
    if not inspector.has_table(referent_table):
        raise _schema_mismatch(f"referenced table {referent_table} is missing")
    source_columns = {
        column["name"] for column in inspector.get_columns(source_table)
    }
    target_columns = {
        column["name"] for column in inspector.get_columns(referent_table)
    }
    missing_source_columns = set(local_columns) - source_columns
    missing_target_columns = set(remote_columns) - target_columns
    if missing_source_columns or missing_target_columns:
        raise _schema_mismatch(
            f"foreign key {name} has missing columns: "
            f"{source_table} {sorted(missing_source_columns)}, "
            f"{referent_table} {sorted(missing_target_columns)}"
        )
    foreign_keys = inspector.get_foreign_keys(source_table)
    named = (
        next((fk for fk in foreign_keys if fk.get("name") == name), None)
        if name is not None
        else None
    )
    if named is not None:
        if not _foreign_key_matches(
            named,
            local_columns,
            referent_table,
            remote_columns,
            ondelete=ondelete,
            onupdate=onupdate,
        ):
            raise _schema_mismatch(f"foreign key {name} has an incompatible definition")
        return
    equivalent = any(
        _foreign_key_matches(
            fk,
            local_columns,
            referent_table,
            remote_columns,
            ondelete=ondelete,
            onupdate=onupdate,
        )
        for fk in foreign_keys
    )
    if equivalent:
        return
    structurally_equivalent = any(
        fk.get("constrained_columns") == list(local_columns)
        and fk.get("referred_table") == referent_table
        and fk.get("referred_columns") == list(remote_columns)
        for fk in foreign_keys
    )
    if structurally_equivalent:
        raise _schema_mismatch(
            f"foreign key on {source_table} has incompatible update/delete actions"
        )
    op.create_foreign_key(
        name,
        source_table,
        referent_table,
        list(local_columns),
        list(remote_columns),
        ondelete=ondelete,
        onupdate=onupdate,
    )
