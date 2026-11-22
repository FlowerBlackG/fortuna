# SPDX-License-Identifier: MulanPSL-2.0
import re
import secrets
import sqlite3
from contextlib import closing

from flask import request

from auth import BUILTIN_NAME
from config import Config
from database import connect, initialize
from embedded.accounts import ensure_builtin_account
from embedded.storage import open_existing_database
from entities import Repository, UserAccount
from response import ApiError


class EmbeddedRuntime:
    def __init__(self, config: Config, secret: str, *, selected_file: bool, create_file: bool):
        if config.environment != 'production' or not re.fullmatch(r'[0-9a-f]{64}', secret):
            raise ValueError('Invalid embedded runtime configuration')
        self._secret = secret.encode()
        self._local_user: str | None = None
        database = config.database.db_file
        if create_file:
            if not selected_file:
                raise ValueError('A new file requires database selection')
            with database.open('xb'):
                pass
        if create_file or (not selected_file and not database.exists()):
            initialize(database)
        else:
            open_existing_database(database)
        if not selected_file:
            with closing(connect(database)) as db:
                self._local_user = ensure_builtin_account(db)

    def verify_transport(self) -> None:
        supplied = request.headers.get('Fortuna-Desktop-Auth', '').encode()
        if not secrets.compare_digest(supplied, self._secret):
            raise ApiError(401, 'Local authentication required')

    def request_user(self, db: sqlite3.Connection) -> str | None:
        if self._local_user is None:
            return None
        if Repository(db, UserAccount).get(username=BUILTIN_NAME, user_id=self._local_user) is None:
            raise ApiError(403, 'Local account unavailable')
        if request.endpoint in {'register', 'login', 'logout'} or (request.endpoint == 'account' and request.method != 'GET'):
            raise ApiError(403, 'Unavailable for the local account')
        return self._local_user
