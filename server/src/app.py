# SPDX-License-Identifier: MulanPSL-2.0
import json
import math
import sqlite3
import uuid
from dataclasses import MISSING, asdict, fields
from datetime import datetime, timezone
from pathlib import Path
from time import perf_counter
from typing import Any, TypeGuard, cast

from flask import Flask, Response, g, request, send_from_directory
from flask.json.provider import DefaultJSONProvider
from werkzeug.exceptions import HTTPException

from auth import PASSWORD_HASHER, TokenStore, password_matches
from config import Config
from database import connect, initialize
from entities import (AssetType, Currency, CurrencyExchangeRate, Entity, Institution, Report,
                      ReportRecord, Repository, UserAccount, UserSettings)
from events import OnReportDeletion, OnUserDeletion, deletion_events
from response import ApiError, ApiResponse, IResponse
from version import BUILD_TIME, VERSION_CODE, VERSION_TAG

type Resource = AssetType | Currency | Institution | Report | ReportRecord
type JsonObject = dict[str, Any]

RESOURCES: dict[str, type[Resource]] = {
    "currencies": Currency, "institutions": Institution,
    "asset-types": AssetType, "reports": Report, "records": ReportRecord,
}
JSON_FIELDS = {"settings", "custom_fields", "asset_custom_fields_data"}


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def decode(value: str) -> Any:
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return value


def serialize(entity: Entity) -> JsonObject:
    data = asdict(entity)
    data.pop("user_password", None)
    for key in JSON_FIELDS & data.keys():
        data[key] = decode(data[key])
    if isinstance(entity, Report):
        data["exchange_rates"] = [serialize(item) for item in repo(CurrencyExchangeRate).list(
            user_id=entity.user_id, report_id=entity.report_id
        )]
    return data


def payload() -> JsonObject:
    data = request.get_json()
    if not isinstance(data, dict):
        raise ApiError(400, "Expected a JSON object")
    return data


def text(data: JsonObject, key: str, required: bool = False) -> str:
    value = data.get(key, "")
    if not isinstance(value, str) or (required and not value.strip()):
        raise ApiError(400, f"{key} must be a nonempty string" if required else f"{key} must be a string")
    return value


def repo[T: Entity](entity: type[T]) -> Repository[T]:
    return Repository(g.db, entity)


def owned[T: Resource](entity: type[T], identifier: str) -> T:
    item = repo(entity).get(**{entity.keys[0]: identifier})
    if item is None:
        raise ApiError(404, "Entry not found")
    if item.user_id != g.user_id:
        raise ApiError(403, "This entry belongs to another user")
    return item


def ordered_fields(value: str) -> list[JsonObject] | None:
    value = decode(value)
    if not isinstance(value, list):
        return None
    if any(not isinstance(field, dict) or type(field.get("data_order")) is not int for field in value):
        return None
    if len({field["data_order"] for field in value}) != len(value):
        return None
    return sorted(value, key=lambda field: field["data_order"])


def migrate_custom_values(old: AssetType, new: AssetType) -> None:
    before, after = ordered_fields(old.custom_fields), ordered_fields(new.custom_fields)
    if before is None or after is None:
        return
    old_orders = [field["data_order"] for field in before]
    new_orders = [field["data_order"] for field in after]
    if old_orders == new_orders:
        return
    indexes = {order: index for index, order in enumerate(old_orders)}
    affected_reports = set()
    for record in repo(ReportRecord).list(user_id=g.user_id, asset_type_id=old.asset_type_id):
        values = decode(record.asset_custom_fields_data)
        if not isinstance(values, list):
            continue
        record.asset_custom_fields_data = json.dumps([
            values[indexes[order]] if order in indexes and indexes[order] < len(values) else None
            for order in new_orders
        ], ensure_ascii=False)
        repo(ReportRecord).update(record)
        affected_reports.add(record.report_id)
    for report_id in affected_reports:
        touch_report(report_id)


def touch_report(report_id: str) -> None:
    report = owned(Report, report_id)
    report.update_time = now()
    repo(Report).update(report)


def finite_number(value: object) -> TypeGuard[int | float]:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def entity_data(entity: type[Resource], data: JsonObject) -> JsonObject:
    writable = {field.name for field in fields(entity)} - {
        "user_id", entity.keys[0], "create_time", "update_time",
    }
    result = {}
    for key in writable & data.keys():
        value = data[key]
        if key in JSON_FIELDS:
            value = json.dumps(value, ensure_ascii=False)
        elif key in {"amount", "effective_rate"}:
            if not finite_number(value):
                raise ApiError(400, f"{key} must be a finite number")
            value = float(value)
        elif not isinstance(value, str):
            raise ApiError(400, f"{key} must be a string")
        elif key == "report_time":
            try:
                timestamp = datetime.fromisoformat(value)
                if timestamp.tzinfo is None:
                    raise ValueError
                value = timestamp.astimezone(timezone.utc).isoformat()
            except (ValueError, OverflowError):
                raise ApiError(400, "report_time must be an ISO 8601 timestamp with a timezone")
        elif key == "content":
            value = value.replace("\r\n", "\n").replace("\r", "\n")
        result[key] = value
    return result


def create_app(config: Config, web_dir: str | Path | None = None) -> Flask:
    if not hasattr(uuid, "uuid7"):
        raise RuntimeError("Fortuna requires Python 3.14+ with builtin uuid.uuid7")
    initialize(config.database.db_file)
    app = Flask(__name__, static_folder=None)
    cast(DefaultJSONProvider, app.json).ensure_ascii = False
    tokens = TokenStore(config.web.user.session.fortuna_token_expire_time_seconds)
    events = deletion_events()
    app.extensions["fortuna_tokens"] = tokens
    public = {("GET", "/api/ping"), ("POST", "/api/account"), ("POST", "/api/login")}

    @app.before_request
    def prepare() -> ApiResponse | None:
        g.request_start = perf_counter()
        if request.method == "OPTIONS":
            return IResponse.ok()
        if not request.path.startswith("/api/"):
            return None
        g.db = connect(config.database.db_file)
        if (request.method, request.path) not in public:
            session = tokens.resolve(request.headers.get("Fortuna-Auth", ""))
            if session is None:
                raise ApiError(401, "Please log in")
            g.user_id = session.user_id
            if repo(UserAccount).get(user_id=g.user_id) is None:
                raise ApiError(401, "Account no longer exists")
        if request.method in {"POST", "PATCH", "PUT", "DELETE"}:
            g.db.execute("BEGIN IMMEDIATE")
        return None

    @app.after_request
    def finish(response: Response) -> Response:
        body = response.get_json(silent=True) if request.path.startswith("/api/") else None
        if hasattr(g, "db"):
            if isinstance(body, dict) and body.get("code", 500) < 400:
                g.db.commit()
            else:
                g.db.rollback()
        response.headers["Access-Control-Allow-Origin"] = "*"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type, Fortuna-Auth"
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, PATCH, PUT, DELETE, OPTIONS"
        if request.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
            code = body.get("code", response.status_code) if isinstance(body, dict) else response.status_code
            app.logger.info("%s %s http=%s api=%s elapsed_ms=%.1f", request.method,
                            request.path, response.status_code, code,
                            (perf_counter() - g.request_start) * 1000)
        return response

    @app.teardown_request
    def close(_error: BaseException | None) -> None:
        if hasattr(g, "db"):
            g.db.close()

    @app.errorhandler(ApiError)
    def api_error(error: ApiError) -> ApiResponse:
        app.logger.warning("%s %s: %s %s", request.method, request.path, error.code, error.msg)
        return IResponse.error(error.code, error.msg)

    @app.errorhandler(sqlite3.IntegrityError)
    def conflict(_error: sqlite3.IntegrityError) -> ApiResponse:
        return IResponse.error(409, "Duplicate entry or an entry still in use")

    @app.errorhandler(HTTPException)
    def http_error(error: HTTPException) -> ApiResponse:
        return IResponse.error(error.code or 500, error.description or error.name)

    @app.errorhandler(Exception)
    def unexpected(error: Exception) -> ApiResponse:
        app.logger.exception("Request failed", exc_info=error)
        return IResponse.error(500, "Server could not complete the request")

    @app.get("/api/ping")
    def ping() -> ApiResponse:
        return IResponse.ok({"app": "Fortuna", "version": VERSION_TAG,
                             "version_code": VERSION_CODE, "build_time": BUILD_TIME})

    @app.post("/api/account")
    def register() -> ApiResponse:
        data = payload()
        username = text(data, "username", True).strip()
        password = text(data, "password", True)
        if repo(UserAccount).get(username=username):
            raise ApiError(409, "Username is already taken")
        timestamp = now()
        user = UserAccount(str(uuid.uuid7()), username, timestamp, timestamp, PASSWORD_HASHER.hash(password))
        repo(UserAccount).insert(user)
        repo(UserSettings).insert(UserSettings(user.user_id))
        return IResponse.ok({"account": serialize(user), "token": tokens.create(user.user_id)})

    @app.post("/api/login")
    def login() -> ApiResponse:
        data = payload()
        user = repo(UserAccount).get(username=text(data, "username", True).strip())
        password = text(data, "password", True)
        if user is None or not password_matches(user.user_password, password):
            raise ApiError(401, "Incorrect username or password")
        user.last_login_time = now()
        repo(UserAccount).update(user)
        return IResponse.ok({"account": serialize(user), "token": tokens.create(user.user_id)})

    @app.post("/api/logout")
    def logout() -> ApiResponse:
        tokens.revoke(request.headers.get("Fortuna-Auth", ""))
        return IResponse.ok()

    @app.route("/api/account", methods=["GET", "PATCH", "DELETE"])
    def account() -> ApiResponse:
        user = repo(UserAccount).get(user_id=g.user_id)
        if user is None:
            raise ApiError(401, "Account no longer exists")
        if request.method == "GET":
            return IResponse.ok(serialize(user))
        data = payload()
        if not password_matches(user.user_password, text(data, "password", True)):
            raise ApiError(400, "Current password is incorrect")
        if request.method == "DELETE":
            events.publish(OnUserDeletion(user), g.db)
            repo(UserAccount).delete(user_id=g.user_id)
            tokens.revoke_user(g.user_id)
            return IResponse.ok()
        if "username" in data:
            user.username = text(data, "username", True).strip()
        if "new_password" in data:
            user.user_password = PASSWORD_HASHER.hash(text(data, "new_password", True))
        repo(UserAccount).update(user)
        if "new_password" in data:
            tokens.revoke_user(g.user_id)
            return IResponse.ok({"account": serialize(user), "token": tokens.create(g.user_id)})
        return IResponse.ok({"account": serialize(user)})

    @app.route("/api/settings", methods=["GET", "PUT"])
    def settings() -> ApiResponse:
        item = repo(UserSettings).get(user_id=g.user_id)
        if item is None:
            item = repo(UserSettings).insert(UserSettings(g.user_id))
        if request.method == "PUT":
            item.settings = json.dumps(payload().get("settings"), ensure_ascii=False)
            repo(UserSettings).update(item)
        return IResponse.ok(serialize(item))

    @app.get("/api/metadata")
    def metadata() -> ApiResponse:
        return IResponse.ok({
            "currencies": [serialize(item) for item in repo(Currency).list(user_id=g.user_id)],
            "institutions": [serialize(item) for item in repo(Institution).list(user_id=g.user_id)],
            "asset_types": [serialize(item) for item in repo(AssetType).list(user_id=g.user_id)],
            "settings": decode(item.settings) if (item := repo(UserSettings).get(user_id=g.user_id)) else {},
        })

    @app.route("/api/reports/<report_id>/exchange-rates", methods=["GET", "PUT", "DELETE"])
    def exchange_rates(report_id: str) -> ApiResponse:
        owned(Report, report_id)
        if request.method == "GET":
            return IResponse.ok([serialize(item) for item in repo(CurrencyExchangeRate).list(
                user_id=g.user_id, report_id=report_id
            )])
        data = payload()
        numerator = text(data, "numerator_currency_id", True)
        denominator = text(data, "denominator_currency_id", True)
        owned(Currency, numerator)
        owned(Currency, denominator)
        keys = dict(user_id=g.user_id, report_id=report_id,
                    numerator_currency_id=numerator, denominator_currency_id=denominator)
        if request.method == "DELETE":
            repo(CurrencyExchangeRate).delete(**keys)
            touch_report(report_id)
            return IResponse.ok()
        rate = data.get("exchange_rate")
        if numerator == denominator or not finite_number(rate) or rate <= 0:
            raise ApiError(400, "Choose different currencies and a positive finite exchange rate")
        item = CurrencyExchangeRate(g.user_id, report_id, numerator, denominator, float(rate))
        if repo(CurrencyExchangeRate).get(**keys):
            repo(CurrencyExchangeRate).update(item)
        else:
            repo(CurrencyExchangeRate).insert(item)
        touch_report(report_id)
        return IResponse.ok(serialize(item))

    @app.route("/api/<resource>", methods=["GET", "POST"])
    def collection(resource: str) -> ApiResponse:
        entity = RESOURCES.get(resource)
        if entity is None:
            raise ApiError(404, "Unknown resource")
        if request.method == "GET":
            filters = {"user_id": g.user_id}
            if entity is ReportRecord and request.args.get("report_id"):
                filters["report_id"] = request.args["report_id"]
                owned(Report, filters["report_id"])
            if entity is Report:
                rates: dict[str, list[JsonObject]] = {}
                for rate in repo(CurrencyExchangeRate).list(user_id=g.user_id):
                    rates.setdefault(rate.report_id, []).append(serialize(rate))
                reports = sorted(repo(Report).list(**filters), key=lambda r: (r.report_time, r.report_id), reverse=True)
                items = [asdict(report) | {"exchange_rates": rates.get(report.report_id, [])}
                         for report in reports]
            else:
                items = [serialize(item) for item in repo(entity).list(**filters)]
            if entity is Report and request.args.get("include_totals") == "true":
                grouped: dict[str, list[JsonObject]] = {}
                for row in g.db.execute(
                    "SELECT report_id, currency_id, SUM(amount) AS nominal, "
                    "SUM(amount * effective_rate) AS effective FROM report_record "
                    "WHERE user_id = ? GROUP BY report_id, currency_id", (g.user_id,)
                ):
                    grouped.setdefault(row["report_id"], []).append({
                        "currency_id": row["currency_id"],
                        "nominal": row["nominal"], "effective": row["effective"],
                    })
                for row_data in items:
                    row_data["currency_totals"] = grouped.get(row_data["report_id"], [])
            return IResponse.ok(items)
        data = entity_data(entity, payload())
        data.update(user_id=g.user_id, **{entity.keys[0]: str(uuid.uuid7())})
        if entity is Report:
            timestamp = now()
            data.update(create_time=timestamp, update_time=timestamp)
            data.setdefault("report_time", timestamp)
            data.setdefault("title", "")
        if entity is ReportRecord:
            for key, parent in (("report_id", Report), ("currency_id", Currency),
                                ("asset_type_id", AssetType), ("institution_id", Institution)):
                owned(parent, text(data, key, True))
        elif entity is not Report:
            text(data, "name", True)
        required = {field.name for field in fields(entity) if field.default is MISSING and field.default_factory is MISSING}
        if required - data.keys():
            raise ApiError(400, "Missing fields: " + ", ".join(sorted(required - data.keys())))
        item = repo(entity).insert(entity(**data))
        if isinstance(item, ReportRecord):
            touch_report(item.report_id)
        return IResponse.ok(serialize(item))

    @app.route("/api/<resource>/<identifier>", methods=["GET", "PATCH", "DELETE"])
    def entry(resource: str, identifier: str) -> ApiResponse:
        entity = RESOURCES.get(resource)
        if entity is None:
            raise ApiError(404, "Unknown resource")
        item = owned(entity, identifier)
        if request.method == "GET":
            return IResponse.ok(serialize(item))
        if request.method == "DELETE":
            if entity in (Currency, Institution, AssetType):
                if repo(ReportRecord).get(user_id=g.user_id, **{entity.keys[0]: identifier}):
                    raise ApiError(409, "Reassign or delete the report records using this entry first")
            if entity is Currency:
                settings = repo(UserSettings).get(user_id=g.user_id)
                value = decode(settings.settings) if settings else None
                if settings and isinstance(value, dict) and value.get("default_currency") == identifier:
                    value.pop("default_currency")
                    settings.settings = json.dumps(value, ensure_ascii=False)
                    repo(UserSettings).update(settings)
            if isinstance(item, Report):
                events.publish(OnReportDeletion(item), g.db)
            repo(entity).delete(**{entity.keys[0]: identifier})
            if isinstance(item, ReportRecord):
                touch_report(item.report_id)
            return IResponse.ok()
        data = entity_data(entity, payload())
        if "name" in data:
            text(data, "name", True)
        if entity is ReportRecord:
            for key, parent in (("report_id", Report), ("currency_id", Currency),
                                ("asset_type_id", AssetType), ("institution_id", Institution)):
                if key in data:
                    owned(parent, data[key])
        updated = entity(**(asdict(item) | data))
        if isinstance(item, AssetType) and isinstance(updated, AssetType):
            migrate_custom_values(item, updated)
        if isinstance(updated, Report):
            updated.update_time = now()
        repo(entity).update(updated)
        if isinstance(item, ReportRecord) and isinstance(updated, ReportRecord):
            for report_id in {item.report_id, updated.report_id}:
                touch_report(report_id)
        return IResponse.ok(serialize(updated))

    if web_dir:
        root = Path(web_dir).resolve()

        @app.get("/")
        def index() -> Response:
            return send_from_directory(root, "index.html")

        @app.get("/<path:filename>")
        def static_file(filename: str) -> Response:
            return send_from_directory(root, filename)

    return app
