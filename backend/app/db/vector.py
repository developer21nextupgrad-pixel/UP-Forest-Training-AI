from __future__ import annotations

import json
from typing import Any

from sqlalchemy.types import UserDefinedType


class Vector(UserDefinedType):
    """PostgreSQL pgvector type without requiring a Python pgvector package.

    The database column intentionally has no hard-coded dimension. The first
    successful embedding batch establishes the model dimension and every
    subsequent write is validated against it. This avoids guessing a provider
    dimension while still using the native PostgreSQL ``vector`` type.
    """
    cache_ok = True

    def get_col_spec(self, **kw: Any) -> str:
        return "vector"

    @staticmethod
    def _encode(value: Any) -> str | None:
        if value is None:
            return None
        if isinstance(value, str):
            return value
        return "[" + ",".join(format(float(x), ".10g") for x in value) + "]"

    def bind_processor(self, dialect):
        return self._encode

    def literal_processor(self, dialect):
        return lambda value: "'" + self._encode(value).replace("'", "''") + "'"

    def result_processor(self, dialect, coltype):
        def parse(value):
            if value is None or isinstance(value, list):
                return value
            try:
                return json.loads(value)
            except Exception:
                return value
        return parse
