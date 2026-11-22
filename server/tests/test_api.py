# SPDX-License-Identifier: MulanPSL-2.0
import json
import sqlite3
import sys
import tempfile
import unittest
import uuid
from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from app import create_app
from auth import Session
from config import Config
from database import connect, initialize
from entities import Institution, Repository


class ApiTests(unittest.TestCase):
    def setUp(self):
        root = Path(__file__).resolve().parents[2] / "user-data"
        root.mkdir(exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=root, prefix="api-test-")
        config = Path(self.temp.name) / "config.json"
        config.write_text(json.dumps({
            "database": {"db_file": "test.db"},
            "web": {"user": {"session": {"fortuna_token_expire_time_seconds": 86400}}},
        }))
        self.config = Config.load(str(config))
        self.app = create_app(self.config)
        self.client = self.app.test_client()
        self.token = ""
        self.account = self.call("POST", "/account", {"username": "alice", "password": "secret"})
        self.token = self.account["token"]

    def tearDown(self):
        self.temp.cleanup()

    def call(self, method, path, data=None, code=200, token=None):
        response = self.client.open("/api" + path, method=method, json=data,
                                    headers={"Fortuna-Auth": self.token if token is None else token})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["code"], code, response.json)
        return response.json["data"]

    def fixture(self, custom_fields=None):
        currency = self.call("POST", "/currencies", {"name": "USD"})
        institution = self.call("POST", "/institutions", {"name": "Bank"})
        asset_type = self.call("POST", "/asset-types", {"name": "Deposit", "custom_fields": custom_fields or []})
        report = self.call("POST", "/reports", {})
        record = self.call("POST", "/records", {
            "report_id": report["report_id"], "currency_id": currency["currency_id"],
            "institution_id": institution["institution_id"], "asset_type_id": asset_type["asset_type_id"],
            "content": "first\r\nsecond\rthird", "amount": 100, "effective_rate": 0.7,
            "asset_custom_fields_data": ["first", 12, "last"] if custom_fields else [],
        })
        return currency, institution, asset_type, report, record

    def test_account_authentication_and_token_format(self):
        token = self.token.split(".")
        self.assertEqual(token[0], self.account["account"]["user_id"][:16])
        self.assertEqual(uuid.UUID(token[1]).version, 7)
        self.assertTrue(0x100000 <= int(token[2], 16) <= 0xFFFFFF)
        self.assertNotIn("user_password", self.account["account"])
        self.call("GET", "/reports", code=401, token="")
        self.call("POST", "/login", {"username": "alice", "password": "wrong"}, code=401)
        self.call("POST", "/account", {"username": " alice ", "password": "secret"}, code=409)
        self.call("POST", "/account", {"username": "Alice", "password": "secret"})
        session = self.app.extensions["fortuna_tokens"]
        session.tokens[self.token] = Session(self.account["account"]["user_id"], datetime.now(timezone.utc) - timedelta(seconds=1))
        self.call("GET", "/account", code=401)

    def test_ping_reports_environment_and_debug_matches_mode(self):
        for environment in ("development", "staging", "production"):
            with self.subTest(environment=environment):
                self.config.environment = environment
                app = create_app(self.config)
                self.assertEqual(app.debug, environment != "production")
                response = app.test_client().get("/api/ping")
                self.assertEqual(response.json["data"]["environment"], environment)

    def test_cross_account_access_and_foreign_references(self):
        currency, institution, asset_type, report, record = self.fixture()
        other = self.call("POST", "/account", {"username": "bob", "password": "secret"})
        self.token = other["token"]
        self.assertEqual(self.call("GET", "/records"), [])
        for resource, key, item in (("currencies", "currency_id", currency), ("institutions", "institution_id", institution),
                                    ("asset-types", "asset_type_id", asset_type), ("reports", "report_id", report), ("records", "record_id", record)):
            for method in ("GET", "PATCH", "DELETE"):
                self.call(method, f"/{resource}/{item[key]}", {} if method == "PATCH" else None, code=403)
        self.call("GET", f"/records?report_id={report['report_id']}", code=403)
        self.call("POST", "/records", record, code=403)
        own = self.call("POST", "/currencies", {"name": "EUR", "user_id": currency["user_id"]})
        self.assertEqual(own["user_id"], other["account"]["user_id"])
        own_report = self.call("POST", "/reports", {})
        self.call("PUT", f"/reports/{own_report['report_id']}/exchange-rates", {"numerator_currency_id": own["currency_id"], "denominator_currency_id": currency["currency_id"], "exchange_rate": 1}, code=403)

    def test_report_record_lifecycle_and_metadata_restriction(self):
        currency, institution, asset_type, report, record = self.fixture()
        self.assertEqual(record["content"], "first\nsecond\nthird")
        self.assertEqual(uuid.UUID(record["record_id"]).version, 7)
        for resource, key, item in (("currencies", "currency_id", currency), ("institutions", "institution_id", institution), ("asset-types", "asset_type_id", asset_type)):
            self.call("DELETE", f"/{resource}/{item[key]}", code=409)
        self.call("PATCH", f"/records/{record['record_id']}", {"amount": 200})
        updated = self.call("GET", f"/reports/{report['report_id']}")
        self.assertGreater(updated["update_time"], report["update_time"])
        self.call("DELETE", f"/reports/{report['report_id']}")
        self.assertEqual(self.call("GET", "/records"), [])
        self.call("DELETE", f"/currencies/{currency['currency_id']}")

    def test_atomic_custom_field_position_migration(self):
        fields = [{"data_order": order, "display_order": order, "field_name": str(order), "type": "str", "nullable": True, "prefix": "", "postfix": ""} for order in (2, 7, 9)]
        _, _, asset_type, _, record = self.fixture(fields)
        endpoint = f"/asset-types/{asset_type['asset_type_id']}"
        self.call("PATCH", endpoint, {"custom_fields": [fields[2], fields[0]]})
        changed = self.call("GET", f"/records/{record['record_id']}")
        self.assertEqual(changed["asset_custom_fields_data"], ["first", "last"])
        extra = dict(fields[1], data_order=15, display_order=0)
        self.call("PATCH", endpoint, {"custom_fields": [extra, fields[2], fields[0]]})
        changed = self.call("GET", f"/records/{record['record_id']}")
        self.assertEqual(changed["asset_custom_fields_data"], ["first", "last", None])

    def test_backdated_reports_use_snapshot_time_not_audit_times(self) -> None:
        current = self.call("POST", "/reports", {})
        self.assertEqual(current["report_time"], current["create_time"])
        timestamp = "2020-01-01T00:30:00+01:00"
        older = self.call("POST", "/reports", {
            "report_time": timestamp, "create_time": timestamp, "update_time": timestamp,
        })
        self.assertEqual(older["report_time"], "2019-12-31T23:30:00+00:00")
        self.assertGreater(older["create_time"], current["create_time"])
        self.assertEqual([r["report_id"] for r in self.call("GET", "/reports")],
                         [current["report_id"], older["report_id"]])
        endpoint = f"/reports/{older['report_id']}"
        changed = self.call("PATCH", endpoint, {"report_time": "2021-01-01T12:00:00Z", "create_time": timestamp})
        self.assertEqual(changed["create_time"], older["create_time"])
        self.assertGreater(changed["update_time"], older["update_time"])
        self.assertEqual(changed["report_time"], "2021-01-01T12:00:00+00:00")
        self.call("PATCH", endpoint, {"report_time": "invalid"}, code=400)
        self.assertEqual(self.call("GET", endpoint)["report_time"], changed["report_time"])

    def test_migrate_existing_reports_once(self) -> None:
        _, _, _, report, record = self.fixture()
        with closing(sqlite3.connect(self.config.database.db_file)) as connection:
            connection.execute("ALTER TABLE report DROP COLUMN report_time")
        initialize(self.config.database.db_file)
        endpoint = f"/reports/{report['report_id']}"
        self.assertEqual(self.call("GET", endpoint)["report_time"], report["create_time"])
        changed = self.call("PATCH", endpoint, {"report_time": "2018-06-01T00:00:00Z"})
        initialize(self.config.database.db_file)
        self.assertEqual(self.call("GET", endpoint)["report_time"], changed["report_time"])
        self.assertEqual(self.call("GET", "/records"), [record])

    def test_repository_binds_values_and_rejects_unknown_columns(self) -> None:
        name = "O'Brien :branch?"
        bank = self.call("POST", "/institutions", {"name": name})
        with closing(connect(self.config.database.db_file)) as db:
            banks = Repository(db, Institution)
            self.assertEqual([b.institution_id for b in banks.list(name=name)], [bank["institution_id"]])
            with self.assertRaises(ValueError):
                banks.delete(branch=name)
            self.assertEqual(banks.get(institution_id=bank["institution_id"]).name, name)

    def test_deleting_unused_currency_cleans_rates_and_default(self):
        one = self.call("POST", "/currencies", {"name": "USD"})
        two = self.call("POST", "/currencies", {"name": "CNY"})
        report = self.call("POST", "/reports", {})
        endpoint = f"/reports/{report['report_id']}/exchange-rates"
        self.call("PUT", "/settings", {"settings": {"default_currency": one["currency_id"], "other": "keep"}})
        rate = {"numerator_currency_id": two["currency_id"], "denominator_currency_id": one["currency_id"], "exchange_rate": 6.7}
        self.call("PUT", endpoint, rate)
        self.call("PUT", endpoint, dict(rate, exchange_rate=0), code=400)
        self.call("DELETE", f"/currencies/{one['currency_id']}")
        self.assertEqual(self.call("GET", endpoint), [])
        self.assertEqual(self.call("GET", "/settings")["settings"], {"other": "keep"})

    def test_account_deletion_cascades_without_harming_other_user(self):
        currency, _, _, report, _ = self.fixture()
        second = self.call("POST", "/currencies", {"name": "CNY"})
        self.call("PUT", f"/reports/{report['report_id']}/exchange-rates", {
            "numerator_currency_id": currency["currency_id"],
            "denominator_currency_id": second["currency_id"], "exchange_rate": 6,
        })
        other = self.call("POST", "/account", {"username": "bob", "password": "secret"})
        self.call("DELETE", "/account", {"password": "secret"})
        self.call("GET", "/account", code=401)
        self.call("GET", "/account", token=other["token"])
        with closing(sqlite3.connect(self.config.database.db_file)) as connection:
            for table in ("user_settings", "currency", "currency_exchange_rate", "institution", "asset_type", "report", "report_record"):
                count = connection.execute(f"SELECT COUNT(*) FROM {table} WHERE user_id = ?", (self.account["account"]["user_id"],)).fetchone()[0]
                self.assertEqual(count, 0, table)

    def test_password_change_revokes_other_sessions(self):
        old = self.call("POST", "/login", {"username": "alice", "password": "secret"})["token"]
        result = self.call("PATCH", "/account", {"password": "secret", "new_password": "updated"})
        self.call("GET", "/account", code=401, token=old)
        self.call("GET", "/account", token=result["token"])
        self.call("POST", "/login", {"username": "alice", "password": "updated"})

    def test_missing_tables_are_recreated_and_data_survives_restart(self):
        currency = self.call("POST", "/currencies", {"name": "USD"})
        with closing(sqlite3.connect(self.config.database.db_file)) as connection:
            connection.execute("DROP TABLE system_info")
            connection.execute("DROP TABLE user_settings")
        initialize(self.config.database.db_file)
        self.assertEqual(self.call("GET", "/currencies")[0]["currency_id"], currency["currency_id"])
        self.assertEqual(self.call("GET", "/settings")["settings"], {})
        with closing(sqlite3.connect(self.config.database.db_file)) as connection:
            self.assertEqual(connection.execute("SELECT count(*) FROM system_info").fetchone()[0], 1)

    def test_error_envelope_and_cors(self):
        self.call("POST", "/records", {}, code=400)
        self.call("PATCH", "/reports/missing", {}, code=404)
        response = self.client.post("/api/login", data="not json", content_type="application/json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["code"], 400)
        response = self.client.options("/api/reports", headers={"Origin": "https://example.test", "Access-Control-Request-Headers": "Fortuna-Auth"})
        self.assertEqual(response.status_code, 200)
        self.assertIn("Fortuna-Auth", response.headers["Access-Control-Allow-Headers"])

    def test_malformed_user_json_is_preserved_for_frontend_repair(self):
        self.call("PUT", "/settings", {"settings": ["malformed"]})
        self.assertEqual(self.call("GET", "/metadata")["settings"], ["malformed"])
        self.call("PUT", "/settings", {"settings": {}})
        asset_type = self.call("POST", "/asset-types", {"name": "Malformed", "custom_fields": "broken"})
        self.call("PATCH", f"/asset-types/{asset_type['asset_type_id']}", {"custom_fields": []})

    def test_report_currency_totals_are_optional_raw_and_user_scoped(self):
        currency, _, _, report, record = self.fixture()
        other_currency = self.call("POST", "/currencies", {"name": "CNY"})
        self.call("POST", "/records", dict(record, currency_id=other_currency["currency_id"], amount=60, effective_rate=0.5))
        self.call("POST", "/records", dict(record, amount=10, effective_rate=1))
        empty = self.call("POST", "/reports", {})
        self.assertNotIn("currency_totals", self.call("GET", "/reports")[0])
        result = {item["report_id"]: item for item in self.call("GET", "/reports?include_totals=true")}
        sums = {item["currency_id"]: item for item in result[report["report_id"]]["currency_totals"]}
        self.assertEqual(sums[currency["currency_id"]], {"currency_id": currency["currency_id"], "nominal": 110, "effective": 80})
        self.assertEqual(sums[other_currency["currency_id"]]["effective"], 30)
        self.assertEqual(result[empty["report_id"]]["currency_totals"], [])
        self.token = self.call("POST", "/account", {"username": "bob", "password": "secret"})["token"]
        own = self.call("POST", "/reports", {})
        result = self.call("GET", "/reports?include_totals=true")
        self.assertEqual([item["report_id"] for item in result], [own["report_id"]])
        self.assertEqual(result[0]["currency_totals"], [])

    def test_exchange_rates_are_independent_persistent_and_deleted_with_report(self):
        one = self.call("POST", "/currencies", {"name": "USD"})
        two = self.call("POST", "/currencies", {"name": "CNY"})
        first = self.call("POST", "/reports", {})
        second = self.call("POST", "/reports", {})
        first_url = f"/reports/{first['report_id']}/exchange-rates"
        second_url = f"/reports/{second['report_id']}/exchange-rates"
        rate = {"numerator_currency_id": one["currency_id"], "denominator_currency_id": two["currency_id"], "exchange_rate": 6}
        self.assertEqual(first["exchange_rates"], [])
        self.assertNotIn("exchange_rates", self.call("GET", "/metadata"))
        self.call("GET", "/exchange-rates", code=404)
        saved = self.call("PUT", first_url, dict(rate, report_id=second["report_id"], user_id="forged"))
        self.assertEqual(saved["report_id"], first["report_id"])
        self.assertEqual(saved["user_id"], self.account["account"]["user_id"])
        self.assertEqual(self.call("GET", second_url), [])
        self.call("PUT", second_url, dict(rate, exchange_rate=8))
        self.call("PUT", first_url, dict(rate, exchange_rate=7))
        initialize(self.config.database.db_file)
        self.assertEqual(self.call("GET", first_url)[0]["exchange_rate"], 7)
        self.assertEqual(self.call("GET", second_url)[0]["exchange_rate"], 8)
        listing = {item["report_id"]: item for item in self.call("GET", "/reports?include_totals=true")}
        self.assertEqual(listing[first["report_id"]]["exchange_rates"][0]["exchange_rate"], 7)
        self.assertEqual(listing[second["report_id"]]["exchange_rates"][0]["exchange_rate"], 8)
        changed = self.call("GET", f"/reports/{first['report_id']}")
        self.assertGreater(changed["update_time"], first["update_time"])
        self.assertEqual(changed["exchange_rates"][0]["exchange_rate"], 7)
        self.assertEqual(self.call("POST", "/reports", {})["exchange_rates"], [])
        self.call("DELETE", first_url, rate)
        self.assertEqual(self.call("GET", first_url), [])
        self.assertEqual(self.call("GET", second_url)[0]["exchange_rate"], 8)
        self.call("PUT", first_url, rate)
        self.call("DELETE", f"/reports/{first['report_id']}")
        with closing(sqlite3.connect(self.config.database.db_file)) as connection:
            self.assertEqual(connection.execute("SELECT count(*) FROM currency_exchange_rate WHERE report_id = ?", (first["report_id"],)).fetchone()[0], 0)
            self.assertEqual(connection.execute("PRAGMA foreign_key_check").fetchall(), [])
        self.assertEqual(self.call("GET", second_url)[0]["exchange_rate"], 8)

    def test_exchange_rate_report_ownership_and_foreign_keys(self):
        one = self.call("POST", "/currencies", {"name": "USD"})
        two = self.call("POST", "/currencies", {"name": "CNY"})
        report = self.call("POST", "/reports", {})
        endpoint = f"/reports/{report['report_id']}/exchange-rates"
        rate = {"numerator_currency_id": one["currency_id"], "denominator_currency_id": two["currency_id"], "exchange_rate": 6}
        self.call("PUT", endpoint, rate)
        self.token = self.call("POST", "/account", {"username": "bob", "password": "secret"})["token"]
        for method in ("GET", "PUT", "DELETE"):
            self.call(method, endpoint, rate if method != "GET" else None, code=403)
            self.call(method, "/reports/missing/exchange-rates", rate if method != "GET" else None, code=404)
        own_report = self.call("POST", "/reports", {})
        own_endpoint = f"/reports/{own_report['report_id']}/exchange-rates"
        self.call("PUT", own_endpoint, rate, code=403)
        self.assertEqual(self.call("GET", own_endpoint), [])
        self.assertEqual(self.call("GET", "/reports")[0]["exchange_rates"], [])
        with closing(sqlite3.connect(self.config.database.db_file)) as connection:
            connection.execute("PRAGMA foreign_keys = ON")
            with self.assertRaises(sqlite3.IntegrityError):
                connection.execute("INSERT INTO currency_exchange_rate VALUES (?, ?, ?, ?, ?)",
                    (self.account["account"]["user_id"], own_report["report_id"], one["currency_id"], two["currency_id"], 6))


if __name__ == "__main__":
    unittest.main()
