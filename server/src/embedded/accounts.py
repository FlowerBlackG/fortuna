# SPDX-License-Identifier: MulanPSL-2.0
import secrets
import sqlite3

from auth import BUILTIN_NAME, create_account
from entities import Repository, UserAccount


def ensure_builtin_account(db: sqlite3.Connection) -> str:
    with db:
        db.execute("BEGIN IMMEDIATE")
        user = Repository(db, UserAccount).get(username=BUILTIN_NAME)
        if user is None:
            user = create_account(db, BUILTIN_NAME, secrets.token_urlsafe(32))
        return user.user_id
