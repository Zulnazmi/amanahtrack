"""Bring any database up to the current schema without losing data.

Runs when the server starts. Handles a new database, one that is already
versioned, and one made by an older release, which created tables directly and
recorded no version.
"""

from __future__ import annotations

from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import inspect
from sqlalchemy.engine import Engine

BACKEND = Path(__file__).resolve().parents[2]
FIRST = "13fa679c302e"


def upgrade(engine: Engine, to: str = "head") -> None:
    cfg = Config()
    cfg.set_main_option("script_location", str(BACKEND / "migrations").replace("%", "%%"))
    with engine.begin() as conn:
        cfg.attributes["connection"] = conn
        tables = inspect(conn).get_table_names()
        if "institutions" in tables and "alembic_version" not in tables:
            command.stamp(cfg, FIRST)
        command.upgrade(cfg, to)
