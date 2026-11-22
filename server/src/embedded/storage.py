# SPDX-License-Identifier: MulanPSL-2.0
import os
import sqlite3
import tempfile
from contextlib import closing
from dataclasses import fields
from pathlib import Path

from database import connect
from entities import (AssetType, Currency, CurrencyExchangeRate, Institution, Report, ReportRecord,
                      SystemInfo, UserAccount, UserSettings)
from version import VERSION_CODE


def open_existing_database(filename: Path) -> None:
    with closing(connect(filename, existing_only=True)) as connection, connection:
        connection.execute('BEGIN')
        for entity in (UserAccount, UserSettings, SystemInfo, Currency, Institution, AssetType, Report, ReportRecord, CurrencyExchangeRate):
            columns = {row['name'] for row in connection.execute(f'PRAGMA table_info({entity.table})')}
            required = {field.name for field in fields(entity)}
            if not required <= columns:
                raise ValueError('The selected file is not a compatible Fortuna database')
        version = connection.execute('SELECT MAX(fortuna_server_version_code) FROM system_info').fetchone()[0]
        if version is not None and version > VERSION_CODE:
            raise ValueError('The database requires a newer version of Fortuna')


def backup(database: Path, destination: Path) -> None:
    if not destination.is_absolute() or destination.exists() or destination.suffix.lower() != '.sqlite3':
        raise ValueError("Choose a new filename ending in .sqlite3 for the database backup")
    with tempfile.NamedTemporaryFile(dir=destination.parent, prefix=".fortuna-", delete=False) as file:
        temporary = Path(file.name)
    try:
        with closing(sqlite3.connect(database.as_uri() + "?mode=ro", uri=True)) as source, \
             closing(sqlite3.connect(temporary)) as target:
            source.backup(target)
        with destination.open("xb"):
            pass
        os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)
