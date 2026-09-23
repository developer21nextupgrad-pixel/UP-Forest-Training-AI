"""Explicit development/demo seed entry point.

Production never imports or executes this script. Run it only when you want
sample users/subjects/chapters for local UI development.
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1] / "backend"
sys.path.insert(0, str(BACKEND))

from app.db.seed import seed  # noqa: E402


if __name__ == "__main__":
    asyncio.run(seed())
