# SPDX-License-Identifier: MulanPSL-2.0
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from config import Config


class ConfigTests(unittest.TestCase):
    def setUp(self):
        root = Path(__file__).resolve().parents[2] / "user-data"
        self.temp = tempfile.TemporaryDirectory(dir=root, prefix="config-test-")
        self.path = Path(self.temp.name) / "config.json"
        self.data = {"database": {"db_file": "nested/test.db"},
                     "web": {"user": {"session": {"fortuna_token_expire_time_seconds": 60}}}}

    def tearDown(self):
        self.temp.cleanup()

    def load(self):
        self.path.write_text(json.dumps(self.data), encoding="utf-8")
        return Config.load(str(self.path))

    def test_schema_decodes_nested_values_defaults_and_paths(self):
        config = self.load()
        self.assertEqual(config.environment, "production")
        self.assertEqual(config.database.db_file, self.path.parent / "nested/test.db")
        self.assertEqual(config.web.user.session.fortuna_token_expire_time_seconds, 60)
        self.assertIsNone(config.logging)
        self.data["logging"] = {"file": "logs/fortuna.log"}
        self.assertEqual(self.load().logging.file, self.path.parent / "logs/fortuna.log")
        self.data["logging"] = None
        self.assertIsNone(self.load().logging)

    def test_schema_rejects_invalid_config_with_field_location(self):
        self.data["environment"] = "debug"
        with self.assertRaisesRegex(ValueError, "environment"):
            self.load()
        del self.data["environment"]
        for value in (0, -1, True, "60"):
            self.data["web"]["user"]["session"]["fortuna_token_expire_time_seconds"] = value
            with self.assertRaisesRegex(ValueError, "web.user.session.fortuna_token_expire_time_seconds"):
                self.load()
        self.data["web"]["user"]["session"]["fortuna_token_expire_time_seconds"] = 60
        self.data["database"]["db_file"] = "   "
        with self.assertRaisesRegex(ValueError, "database.db_file"):
            self.load()
        self.data["database"]["db_file"] = "test.db"
        self.data["logging"] = {"file": ""}
        with self.assertRaisesRegex(ValueError, "logging"):
            self.load()

    def test_logging_file_and_stderr_include_api_status_without_credentials(self):
        source = Path(__file__).resolve().parents[1] / "src"
        code = """
import sys
from app import create_app
from config import Config
from logging_config import configure_logging
config = Config.load(sys.argv[1])
configure_logging(config)
client = create_app(config).test_client()
client.get('/api/ping')
client.get('/api/reports', headers={'Fortuna-Auth': 'private-token'})
client.post('/api/login', json={'username': 'missing', 'password': 'private-password'})
"""
        for logging in (None, {"file": "logs/server.log"}):
            self.data["logging"] = logging
            config = self.load()
            result = subprocess.run([sys.executable, "-c", code, str(self.path)], cwd=source, capture_output=True, text=True, check=True)
            output = config.logging.file.read_text() if logging else result.stderr
            self.assertIn("GET /api/ping http=200 api=200", output)
            self.assertIn("api=401", output)
            self.assertNotIn("private-token", output)
            self.assertNotIn("private-password", output)
            if logging:
                self.assertEqual(result.stderr, "")
