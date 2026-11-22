# SPDX-License-Identifier: MulanPSL-2.0
"""Run the packaged UI against a disposable normal server and fresh Electron profile."""
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from threading import Thread

from waitress import create_server

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'server/src'))
from app import create_app
from config import Config

if __name__ == '__main__':
    with tempfile.TemporaryDirectory() as temp:
        config = Config.from_data({'database': {'db_file': 'remote.sqlite3'},
                                   'web': {'user': {'session': {'fortuna_token_expire_time_seconds': 600}}}}, Path(temp))
        server = create_server(create_app(config), host='127.0.0.1', port=0)
        Thread(target=server.run, daemon=True).start()
        subprocess.run([shutil.which('node'), ROOT / 'web/tests/e2e/desktop.mjs', *sys.argv[1:]], check=True,
                       env={**os.environ, 'FORTUNA_API': f'http://127.0.0.1:{server.effective_port}'})
