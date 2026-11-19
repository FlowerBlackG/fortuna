# SPDX-License-Identifier: MulanPSL-2.0
import sqlite3
from contextlib import closing
from pathlib import Path

from entities import Repository, SystemInfo
from version import VERSION_CODE, VERSION_TAG

SCHEMA_FILE = Path(__file__).resolve().parent / "sql" / "schema.sql"


def connect(filename: str | Path) -> sqlite3.Connection:
    connection = sqlite3.connect(filename, timeout=15)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def initialize(filename: str | Path) -> None:
    Path(filename).parent.mkdir(parents=True, exist_ok=True)
    with closing(connect(filename)) as connection, connection:
        connection.executescript(SCHEMA_FILE.read_text(encoding="utf-8"))
        connection.execute("BEGIN IMMEDIATE")
        if not any(row["name"] == "report_time" for row in connection.execute("PRAGMA table_info(report)")):
            connection.execute("ALTER TABLE report ADD COLUMN report_time TEXT NOT NULL DEFAULT ''")
            connection.execute("UPDATE report SET report_time = create_time")
        connection.execute("DELETE FROM system_info")
        Repository(connection, SystemInfo).insert(SystemInfo(VERSION_TAG, VERSION_CODE))
