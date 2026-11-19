# SPDX-License-Identifier: MulanPSL-2.0
import json
import math
import sqlite3
import uuid
from dataclasses import MISSING, asdict, fields
from datetime import datetime, timezone
from pathlib import Path
from time import perf_counter

from flask import Flask, g, request, send_from_directory
from werkzeug.exceptions import HTTPException

from auth import PASSWORD_HASHER, TokenStore, password_matches
from database import VERSION_TAG, connect, initialize
from entities import (AssetType, Currency, CurrencyExchangeRate, Institution, Report,
                      ReportRecord, Repository, UserAccount, UserSettings)
from events import OnReportDeletion, OnUserDeletion, deletion_events
from response import ApiError, IResponse

RESOURCES = {
    "currencies": Currency, "institutions": Institution,
    "asset-types": AssetType, "reports": Report, "records": ReportRecord,
}
JSON_FIELDS = {"settings", "custom_fields", "asset_custom_fields_data"}


def now():
    return datetime.now(timezone.utc).isoformat()


def decode(value):
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return value


def serialize(entity):
    data = asdict(entity)
    data.pop("user_password", None)
    for key in JSON_FIELDS & data.keys():
        data[key] = decode(data[key])
    if isinstance(entity, Report):
        data["exchange_rates"] = [serialize(item) for item in repo(CurrencyExchangeRate).list(
            user_id=entity.user_id, report_id=entity.report_id
        )]
    return data


def payload():
    data = request.get_json()
    if not isinstance(data, dict):
        raise ApiError(400, "Expected a JSON object")
    return data


def text(data, key, required=False):
    value = data.get(key, "")
    if not isinstance(value, str) or (required and not value.strip()):
        raise ApiError(400, f"{key} must be a nonempty string" if required else f"{key} must be a string")
    return value


def repo(entity):
    return Repository(g.db, entity)


def owned(entity, identifier):
    item = repo(entity).get(**{entity.keys[0]: identifier})
    if item is None:
        raise ApiError(404, "Entry not found")
    if item.user_id != g.user_id:
        raise ApiError(403, "This entry belongs to another user")
    return item


def ordered_fields(value):
    value = decode(value)
    if not isinstance(value, list):
        return None
    if any(not isinstance(field, dict) or type(field.get("data_order")) is not int for field in value):
        return None
    if len({field["data_order"] for field in value}) != len(value):
        return None
    return sorted(value, key=lambda field: field["data_order"])


def migrate_custom_values(old, new):
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


def touch_report(report_id):
    report = owned(Report, report_id)
    report.update_time = now()
    repo(Report).update(report)


def entity_data(entity, data):
    writable = {field.name for field in fields(entity)} - {
        "user_id", entity.keys[0], "create_time", "update_time",
    }
    result = {}
    for key in writable & data.keys():
        value = data[key]
        if key in JSON_FIELDS:
            value = json.dumps(value, ensure_ascii=False)
        elif key in {"amount", "effective_rate"}:
            if type(value) not in (int, float) or not math.isfinite(value):
                raise ApiError(400, f"{key} must be a finite number")
            value = float(value)
        elif not isinstance(value, str):
            raise ApiError(400, f"{key} must be a string")
        if key == "content":
            value = value.replace("\r\n", "\n").replace("\r", "\n")
        result[key] = value
    return result


def create_app(config, web_dir=None):
    if not hasattr(uuid, "uuid7"):
        raise RuntimeError("Fortuna requires Python 3.14+ with builtin uuid.uuid7")
    initialize(config.database.db_file)
    app = Flask(__name__, static_folder=None)
    app.json.ensure_ascii = False
    tokens = TokenStore(config.web.user.session.fortuna_token_expire_time_seconds)
    events = deletion_events()
    app.extensions["fortuna_tokens"] = tokens
    public = {("GET", "/api/ping"), ("POST", "/api/account"), ("POST", "/api/login")}

    @app.before_request
    def prepare():
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

    @app.after_request
    def finish(response):
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
    def close(_error):
        if hasattr(g, "db"):
            g.db.close()

    @app.errorhandler(ApiError)
    def api_error(error):
        app.logger.warning("%s %s: %s %s", request.method, request.path, error.code, error.msg)
        return IResponse.error(error.code, error.msg)

    @app.errorhandler(sqlite3.IntegrityError)
    def conflict(_error):
        return IResponse.error(409, "Duplicate entry or an entry still in use")

    @app.errorhandler(HTTPException)
    def http_error(error):
        return IResponse.error(error.code, error.description)

    @app.errorhandler(Exception)
    def unexpected(error):
        app.logger.exception("Request failed", exc_info=error)
        return IResponse.error(500, "Server could not complete the request")

    @app.get("/api/ping")
    def ping():
        return IResponse.ok({"app": "Fortuna", "version": VERSION_TAG})

    @app.post("/api/account")
    def register():
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
    def login():
        data = payload()
        user = repo(UserAccount).get(username=text(data, "username", True).strip())
        password = text(data, "password", True)
        if user is None or not password_matches(user.user_password, password):
            raise ApiError(401, "Incorrect username or password")
        user.last_login_time = now()
        repo(UserAccount).update(user)
        return IResponse.ok({"account": serialize(user), "token": tokens.create(user.user_id)})

    @app.post("/api/logout")
    def logout():
        tokens.revoke(request.headers.get("Fortuna-Auth", ""))
        return IResponse.ok()

    @app.route("/api/account", methods=["GET", "PATCH", "DELETE"])
    def account():
        user = repo(UserAccount).get(user_id=g.user_id)
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
    def settings():
        item = repo(UserSettings).get(user_id=g.user_id)
        if item is None:
            item = repo(UserSettings).insert(UserSettings(g.user_id))
        if request.method == "PUT":
            item.settings = json.dumps(payload().get("settings"), ensure_ascii=False)
            repo(UserSettings).update(item)
        return IResponse.ok(serialize(item))

    @app.get("/api/metadata")
    def metadata():
        return IResponse.ok({
            "currencies": [serialize(item) for item in repo(Currency).list(user_id=g.user_id)],
            "institutions": [serialize(item) for item in repo(Institution).list(user_id=g.user_id)],
            "asset_types": [serialize(item) for item in repo(AssetType).list(user_id=g.user_id)],
            "settings": decode(item.settings) if (item := repo(UserSettings).get(user_id=g.user_id)) else {},
        })

    @app.route("/api/reports/<report_id>/exchange-rates", methods=["GET", "PUT", "DELETE"])
    def exchange_rates(report_id):
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
        if numerator == denominator or type(rate) not in (int, float) or not math.isfinite(rate) or rate <= 0:
            raise ApiError(400, "Choose different currencies and a positive finite exchange rate")
        item = CurrencyExchangeRate(**keys, exchange_rate=float(rate))
        if repo(CurrencyExchangeRate).get(**keys):
            repo(CurrencyExchangeRate).update(item)
        else:
            repo(CurrencyExchangeRate).insert(item)
        touch_report(report_id)
        return IResponse.ok(serialize(item))

    @app.route("/api/<resource>", methods=["GET", "POST"])
    def collection(resource):
        entity = RESOURCES.get(resource)
        if entity is None:
            raise ApiError(404, "Unknown resource")
        if request.method == "GET":
            filters = {"user_id": g.user_id}
            if entity is ReportRecord and request.args.get("report_id"):
                filters["report_id"] = request.args["report_id"]
                owned(Report, filters["report_id"])
            if entity is Report:
                rates = {}
                for rate in repo(CurrencyExchangeRate).list(user_id=g.user_id):
                    rates.setdefault(rate.report_id, []).append(serialize(rate))
                items = [asdict(item) | {"exchange_rates": rates.get(item.report_id, [])}
                         for item in repo(Report).list(**filters)]
            else:
                items = [serialize(item) for item in repo(entity).list(**filters)]
            if entity is Report and request.args.get("include_totals") == "true":
                grouped = {}
                for row in g.db.execute(
                    "SELECT report_id, currency_id, SUM(amount) AS nominal, "
                    "SUM(amount * effective_rate) AS effective FROM report_record "
                    "WHERE user_id = ? GROUP BY report_id, currency_id", (g.user_id,)
                ):
                    grouped.setdefault(row["report_id"], []).append({
                        "currency_id": row["currency_id"],
                        "nominal": row["nominal"], "effective": row["effective"],
                    })
                for item in items:
                    item["currency_totals"] = grouped.get(item["report_id"], [])
            return IResponse.ok(items)
        data = entity_data(entity, payload())
        data.update(user_id=g.user_id, **{entity.keys[0]: str(uuid.uuid7())})
        if entity is Report:
            data.update(create_time=now(), update_time=now())
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
        if entity is ReportRecord:
            touch_report(item.report_id)
        return IResponse.ok(serialize(item))

    @app.route("/api/<resource>/<identifier>", methods=["GET", "PATCH", "DELETE"])
    def entry(resource, identifier):
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
                if isinstance(value, dict) and value.get("default_currency") == identifier:
                    value.pop("default_currency")
                    settings.settings = json.dumps(value, ensure_ascii=False)
                    repo(UserSettings).update(settings)
            if entity is Report:
                events.publish(OnReportDeletion(item), g.db)
            repo(entity).delete(**{entity.keys[0]: identifier})
            if entity is ReportRecord:
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
        if entity is AssetType:
            migrate_custom_values(item, updated)
        if entity is Report:
            updated.update_time = now()
        repo(entity).update(updated)
        if entity is ReportRecord:
            for report_id in {item.report_id, updated.report_id}:
                touch_report(report_id)
        return IResponse.ok(serialize(updated))

    if web_dir:
        root = Path(web_dir).resolve()

        @app.get("/")
        def index():
            return send_from_directory(root, "index.html")

        @app.get("/<path:filename>")
        def static_file(filename):
            return send_from_directory(root, filename)

    return app
