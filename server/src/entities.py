# SPDX-License-Identifier: MulanPSL-2.0
from dataclasses import asdict, dataclass, fields
from typing import ClassVar


@dataclass
class Entity:
    table: ClassVar[str]
    keys: ClassVar[tuple[str, ...]]


@dataclass
class UserAccount(Entity):
    table = "user_account"
    keys = ("user_id",)
    user_id: str
    username: str
    create_time: str
    last_login_time: str
    user_password: str


@dataclass
class UserSettings(Entity):
    table = "user_settings"
    keys = ("user_id",)
    user_id: str
    settings: str = "{}"


@dataclass
class Currency(Entity):
    table = "currency"
    keys = ("currency_id",)
    currency_id: str
    user_id: str
    name: str
    note: str = ""


@dataclass
class CurrencyExchangeRate(Entity):
    table = "currency_exchange_rate"
    keys = ("user_id", "report_id", "numerator_currency_id", "denominator_currency_id")
    user_id: str
    report_id: str
    numerator_currency_id: str
    denominator_currency_id: str
    exchange_rate: float


@dataclass
class Institution(Entity):
    table = "institution"
    keys = ("institution_id",)
    institution_id: str
    user_id: str
    name: str
    note: str = ""


@dataclass
class AssetType(Entity):
    table = "asset_type"
    keys = ("asset_type_id",)
    asset_type_id: str
    user_id: str
    name: str
    color: str = "65AE73"
    note: str = ""
    custom_fields: str = "[]"


@dataclass
class Report(Entity):
    table = "report"
    keys = ("report_id",)
    report_id: str
    user_id: str
    title: str
    create_time: str
    update_time: str


@dataclass
class ReportRecord(Entity):
    table = "report_record"
    keys = ("record_id",)
    record_id: str
    user_id: str
    report_id: str
    currency_id: str
    asset_type_id: str
    institution_id: str
    content: str
    amount: float
    effective_rate: float = 1.0
    asset_custom_fields_data: str = "[]"


@dataclass
class SystemInfo(Entity):
    table = "system_info"
    keys = ("fortuna_server_version_code",)
    fortuna_server_version_tag: str
    fortuna_server_version_code: int


class Repository:
    def __init__(self, connection, entity_type):
        self.connection = connection
        self.entity_type = entity_type
        self.columns = {field.name for field in fields(entity_type)}
        self.table = entity_type.table

    def _where(self, filters):
        if not filters.keys() <= self.columns:
            raise ValueError("Unknown entity field")
        return " AND ".join(f"{key} = ?" for key in filters) or "1 = 1"

    def list(self, **filters):
        rows = self.connection.execute(
            f"SELECT * FROM {self.table} WHERE {self._where(filters)}", tuple(filters.values())
        )
        return [self.entity_type(**dict(row)) for row in rows]

    def get(self, **filters):
        rows = self.list(**filters)
        return rows[0] if rows else None

    def insert(self, entity):
        data = asdict(entity)
        self.connection.execute(
            f"INSERT INTO {self.table} ({', '.join(data)}) VALUES ({', '.join('?' for _ in data)})",
            tuple(data.values()),
        )
        return entity

    def update(self, entity):
        data = asdict(entity)
        keys = {key: data.pop(key) for key in self.entity_type.keys}
        self.connection.execute(
            f"UPDATE {self.table} SET {', '.join(f'{key} = ?' for key in data)} WHERE {self._where(keys)}",
            (*data.values(), *keys.values()),
        )
        return entity

    def delete(self, **filters):
        if not filters:
            raise ValueError("Deletion requires a filter")
        self.connection.execute(
            f"DELETE FROM {self.table} WHERE {self._where(filters)}", tuple(filters.values())
        )
