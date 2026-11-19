# SPDX-License-Identifier: MulanPSL-2.0
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from threading import Lock

from argon2 import PasswordHasher, Type
from argon2.exceptions import VerificationError, InvalidHashError

PASSWORD_HASHER = PasswordHasher(
    time_cost=3, memory_cost=65536, parallelism=4, hash_len=32,
    salt_len=16, encoding="utf-8", type=Type.ID,
)


def password_matches(encoded, password):
    try:
        return PASSWORD_HASHER.verify(encoded, password)
    except (VerificationError, InvalidHashError):
        return False


@dataclass(frozen=True)
class Session:
    user_id: str
    expires_at: datetime


class TokenStore:
    def __init__(self, lifetime):
        self.lifetime = lifetime
        self.tokens: dict[str, Session] = {}
        self.lock = Lock()

    def create(self, user_id):
        now = datetime.now(timezone.utc)
        token = f"{user_id[:16]}.{uuid.uuid7()}.{secrets.randbelow(0xF00000) + 0x100000:06X}"
        with self.lock:
            self.tokens = {key: value for key, value in self.tokens.items() if value.expires_at > now}
            self.tokens[token] = Session(user_id, now + timedelta(seconds=self.lifetime))
        return token

    def resolve(self, token):
        with self.lock:
            session = self.tokens.get(token)
            if session and session.expires_at <= datetime.now(timezone.utc):
                del self.tokens[token]
                return None
            return session

    def revoke(self, token):
        with self.lock:
            self.tokens.pop(token, None)

    def revoke_user(self, user_id):
        with self.lock:
            self.tokens = {key: value for key, value in self.tokens.items() if value.user_id != user_id}
