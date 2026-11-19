# SPDX-License-Identifier: MulanPSL-2.0
from dataclasses import dataclass

from entities import (AssetType, Currency, CurrencyExchangeRate, Institution, Report,
                      ReportRecord, Repository, UserAccount, UserSettings)


@dataclass(frozen=True)
class OnUserDeletion:
    account: UserAccount


@dataclass(frozen=True)
class OnReportDeletion:
    report: Report


class EventBus:
    def __init__(self):
        self.listeners = {}

    def subscribe(self, event_type, listener):
        self.listeners.setdefault(event_type, []).append(listener)

    def publish(self, event, connection):
        for listener in self.listeners.get(type(event), []):
            listener(event, connection)


def deletion_events():
    bus = EventBus()

    def delete_user_data(event, connection):
        for entity in (ReportRecord, CurrencyExchangeRate, Report, Currency,
                       Institution, AssetType, UserSettings):
            Repository(connection, entity).delete(user_id=event.account.user_id)

    def delete_report_records(event, connection):
        for entity in (ReportRecord, CurrencyExchangeRate):
            Repository(connection, entity).delete(
                user_id=event.report.user_id, report_id=event.report.report_id
            )

    bus.subscribe(OnUserDeletion, delete_user_data)
    bus.subscribe(OnReportDeletion, delete_report_records)
    return bus
