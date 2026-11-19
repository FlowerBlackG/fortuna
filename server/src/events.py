# SPDX-License-Identifier: MulanPSL-2.0
from collections.abc import Callable
from dataclasses import dataclass
from sqlite3 import Connection
from typing import Any

from entities import (AssetType, Currency, CurrencyExchangeRate, Institution, Report,
                      ReportRecord, Repository, UserAccount, UserSettings)


@dataclass(frozen=True)
class OnUserDeletion:
    account: UserAccount


@dataclass(frozen=True)
class OnReportDeletion:
    report: Report


type Deletion = OnUserDeletion | OnReportDeletion


class EventBus:
    def __init__(self) -> None:
        self.listeners: dict[type[Deletion], list[Callable[[Any, Connection], None]]] = {}

    def subscribe[E: Deletion](self, event_type: type[E], listener: Callable[[E, Connection], None]) -> None:
        self.listeners.setdefault(event_type, []).append(listener)

    def publish(self, event: Deletion, connection: Connection) -> None:
        for listener in self.listeners.get(type(event), []):
            listener(event, connection)


def deletion_events() -> EventBus:
    bus = EventBus()

    def delete_user_data(event: OnUserDeletion, connection: Connection) -> None:
        for entity in (ReportRecord, CurrencyExchangeRate, Report, Currency,
                       Institution, AssetType, UserSettings):
            Repository(connection, entity).delete(user_id=event.account.user_id)

    def delete_report_records(event: OnReportDeletion, connection: Connection) -> None:
        for entity in (ReportRecord, CurrencyExchangeRate):
            Repository(connection, entity).delete(
                user_id=event.report.user_id, report_id=event.report.report_id
            )

    bus.subscribe(OnUserDeletion, delete_user_data)
    bus.subscribe(OnReportDeletion, delete_report_records)
    return bus
