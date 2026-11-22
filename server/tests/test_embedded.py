# SPDX-License-Identifier: MulanPSL-2.0
import json
import secrets
import sqlite3
import subprocess
import sys
import tempfile
import unittest
import uuid
from contextlib import closing
from pathlib import Path

SRC = Path(__file__).resolve().parents[1] / 'src'
sys.path.insert(0, str(SRC))
from auth import BUILTIN_NAME, create_account
from app import create_app
from config import Config
from database import connect, initialize
from embedded.storage import backup


class EmbeddedTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name).resolve()
        self.config = Config.from_data({'database': {'db_file': 'fortuna.sqlite3'}, 'runtime_mode': 'embedded',
                                        'web': {'user': {'session': {'fortuna_token_expire_time_seconds': 1}}}}, self.directory)
        self.db = self.config.database.db_file
        self.secret = secrets.token_hex(32)
        self.headers = {'Fortuna-Desktop-Auth': self.secret}

    def embedded(self):
        return create_app(self.config, runtime_mode='embedded', secret=self.secret)

    def test_normal_server_ignores_desktop_configuration_and_headers(self):
        client = create_app(self.config).test_client()
        reply = client.get('/api/account?runtime_mode=embedded', headers=self.headers)
        self.assertEqual(reply.json['code'], 401)
        with closing(connect(self.db)) as db:
            self.assertEqual(db.execute('SELECT count(*) FROM user_account').fetchone()[0], 0)
        self.assertEqual(client.post('/api/account', json={'username': BUILTIN_NAME, 'password': 'x'}).json['code'], 409)

    def test_reject_invalid_launch_before_opening_database(self):
        for environment, secret in [('development', self.secret), ('staging', self.secret), ('production', ''), ('production', 'x' * 64)]:
            self.config.environment = environment
            with self.assertRaises(ValueError):
                create_app(self.config, runtime_mode='embedded', secret=secret)
        self.assertFalse(self.db.exists())
        result = subprocess.run([sys.executable, '-m', 'embedded.launcher', '--data', self.directory, '--host', '0.0.0.0'],
                                cwd=SRC, input=self.secret, text=True, capture_output=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('unrecognized arguments: --host', result.stderr)
        self.assertNotIn(self.secret, result.stderr + result.stdout)
        self.assertFalse(self.db.exists())

    def test_authentication_persistence_and_backup(self):
        app = self.embedded()
        self.assertFalse(app.debug)
        client = app.test_client()
        for path in ('/api/ping', '/api/settings', '/api/reports', '/api/metadata', '/api/account'):
            for headers in ({}, {'Fortuna-Auth': self.secret}, {'Fortuna-Desktop-Auth': 'incorrect'}):
                self.assertEqual(client.get(path, headers=headers).json['code'], 401)
        with self.assertLogs(app.logger, level='INFO') as logs:
            for method, path in [('POST', 'login'), ('POST', 'account'), ('PATCH', 'account'), ('DELETE', 'account'), ('POST', 'logout')]:
                result = client.open('/api/' + path, method=method, headers=self.headers, json={})
                self.assertEqual(result.json['code'], 403)
                self.assertNotIn(self.secret, result.text)
        self.assertNotIn(self.secret, str(logs.output))
        account = client.get('/api/account', headers=self.headers).json['data']
        identifier = account['user_id']
        self.assertEqual(uuid.UUID(identifier).version, 7)
        self.assertEqual(account['username'], BUILTIN_NAME)
        self.assertEqual(client.get('/api/settings', headers=self.headers).json['data']['settings'], {})
        report = client.post('/api/reports', headers=self.headers, json={'title': 'Local'}).json['data']
        self.assertEqual(report['user_id'], identifier)
        self.secret = secrets.token_hex(32)
        client = self.embedded().test_client()
        self.assertEqual(client.get('/api/reports', headers=self.headers).json['code'], 401)
        self.assertEqual(client.get('/api/reports', headers={'Fortuna-Desktop-Auth': self.secret}).json['data'], [report])
        destination = self.directory / 'backup.sqlite3'
        with closing(connect(self.db)) as live:
            live.execute('PRAGMA journal_mode=WAL')
            live.execute('UPDATE report SET title=?', ('WAL backup',))
            live.commit()
            backup(self.db, destination)
            with self.assertRaises(ValueError):
                backup(self.db, destination)
        with closing(connect(destination)) as db:
            self.assertEqual(db.execute('PRAGMA integrity_check').fetchone()[0], 'ok')
            self.assertEqual(db.execute('SELECT user_id FROM user_account WHERE username=?', (BUILTIN_NAME,)).fetchone()[0], identifier)
            self.assertEqual(db.execute('SELECT title FROM report').fetchone()[0], 'WAL backup')
            rows = db.execute('SELECT user_password FROM user_account').fetchall()
            self.assertEqual(len(rows), 1)
            self.assertTrue(rows[0][0].startswith('$argon2id$'))

    def test_builtin_reuses_account_by_username_without_changing_schema(self):
        initialize(self.db)
        with closing(connect(self.db)) as db, db:
            user = create_account(db, BUILTIN_NAME, 'legacy')
            schema = db.execute('SELECT * FROM sqlite_schema ORDER BY name').fetchall()
        client = self.embedded().test_client()
        self.assertEqual(client.get('/api/account', headers=self.headers).json['data']['user_id'], user.user_id)
        with closing(connect(self.db)) as db:
            self.assertEqual(db.execute('SELECT * FROM sqlite_schema ORDER BY name').fetchall(), schema)
            self.assertEqual(db.execute('SELECT count(*) FROM user_account').fetchone()[0], 1)
        credentials = {'username': BUILTIN_NAME, 'password': 'legacy'}
        self.assertEqual(client.post('/api/login', json=credentials, headers=self.headers).json['code'], 403)
        self.assertEqual(create_app(self.config).test_client().post('/api/login', json=credentials).json['code'], 200)

    def test_selected_database_requires_both_private_transport_and_account_session(self):
        # A copy of the default database still requires login when selected as a file.
        self.embedded().test_client().post('/api/reports', headers=self.headers, json={'title': 'Private'})
        file_app = create_app(self.config, runtime_mode='embedded', selected_file=True, secret=self.secret)
        client = file_app.test_client()
        credentials = {'username': 'alice', 'password': 'test password'}
        self.assertEqual(client.post('/api/account', json=credentials).json['code'], 401)
        self.assertEqual(client.get('/api/reports', headers=self.headers).json['code'], 401)
        self.assertEqual(client.post('/api/account', json=credentials, headers=self.headers).json['code'], 200)
        token = client.post('/api/login', json=credentials, headers=self.headers).json['data']['token']
        session = {'Fortuna-Auth': token}
        self.assertEqual(client.get('/api/reports', headers=session).json['code'], 401)
        self.assertEqual(client.get('/api/reports', headers=session | self.headers).json['data'], [])
        self.assertEqual(client.post('/api/logout', headers=session | self.headers).json['code'], 200)
        self.assertEqual(client.get('/api/account', headers=session | self.headers).json['code'], 401)

    def test_empty_selected_file_has_no_automatic_account_and_missing_file_is_not_recreated(self):
        with self.assertRaises(sqlite3.OperationalError):
            create_app(self.config, runtime_mode='embedded', selected_file=True, secret=self.secret)
        self.assertFalse(self.db.exists())
        create_app(self.config, runtime_mode='embedded', selected_file=True, create_file=True, secret=self.secret)
        with closing(connect(self.db)) as db:
            self.assertEqual(db.execute('SELECT count(*) FROM user_account').fetchone()[0], 0)

    def test_unrelated_sqlite_file_is_rejected_before_migration(self):
        with closing(connect(self.db)) as db:
            db.execute('CREATE TABLE other_data (value TEXT)')
        before = self.db.read_bytes()
        with self.assertRaisesRegex(ValueError, 'not a compatible Fortuna database'):
            create_app(self.config, runtime_mode='embedded', selected_file=True, secret=self.secret)
        self.assertEqual(self.db.read_bytes(), before)

    def test_open_populated_server_file_in_place_without_rewriting_it(self):
        server = create_app(self.config).test_client()
        credentials = {'username': 'existing', 'password': 'existing-password'}
        registration = server.post('/api/account', json=credentials).json['data']
        report = server.post('/api/reports', headers={'Fortuna-Auth': registration['token']},
                             json={'title': 'Already saved'}).json['data']
        with closing(connect(self.db)) as db:
            password_hash = db.execute('SELECT user_password FROM user_account').fetchone()[0]
        original = self.db.read_bytes()
        with self.assertRaises(FileExistsError):
            create_app(self.config, runtime_mode='embedded', selected_file=True, create_file=True, secret=self.secret)
        client = create_app(self.config, runtime_mode='embedded', selected_file=True, secret=self.secret).test_client()
        self.assertEqual(self.db.read_bytes(), original)
        login = client.post('/api/login', headers=self.headers, json=credentials).json['data']
        self.assertEqual(login['account']['user_id'], registration['account']['user_id'])
        self.assertEqual(client.get('/api/reports', headers=self.headers | {'Fortuna-Auth': login['token']}).json['data'], [report])
        with closing(connect(self.db)) as db:
            self.assertEqual(db.execute('SELECT user_password FROM user_account').fetchone()[0], password_hash)

    def test_embedded_rejects_incompatible_files_without_altering_them(self):
        self.embedded().test_client().post('/api/reports', headers=self.headers, json={'title':'Saved'})
        with closing(connect(self.db)) as db, db:
            db.execute('UPDATE system_info SET fortuna_server_version_code=99999')
        original = self.db.read_bytes()
        with self.assertRaisesRegex(ValueError, 'newer version'):
            create_app(self.config, runtime_mode='embedded', selected_file=True, secret=self.secret)
        self.assertEqual(original, self.db.read_bytes())
        with closing(connect(self.db)) as db, db:
            db.execute('UPDATE system_info SET fortuna_server_version_code=0')
            db.execute('ALTER TABLE report DROP COLUMN report_time')
        original = self.db.read_bytes()
        for selected_file in (False, True):
            with self.assertRaisesRegex(ValueError, 'not a compatible Fortuna database'):
                create_app(self.config, runtime_mode='embedded', selected_file=selected_file, secret=self.secret)
            self.assertEqual(original, self.db.read_bytes())

    def test_identity_creation_rolls_back_if_settings_fail(self):
        initialize(self.db)
        with closing(connect(self.db)) as db:
            db.execute("CREATE TRIGGER fail BEFORE INSERT ON user_settings BEGIN SELECT RAISE(ABORT, 'settings'); END")
        with self.assertRaises(sqlite3.IntegrityError):
            self.embedded()
        with closing(connect(self.db)) as db:
            self.assertEqual(db.execute('SELECT count(*) FROM user_account').fetchone()[0], 0)
