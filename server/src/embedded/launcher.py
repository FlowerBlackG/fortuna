# SPDX-License-Identifier: MulanPSL-2.0
"""Private Electron child. stdin owns the process lifetime; stdout carries framed replies."""
import argparse
import json
import logging
import os
import sqlite3
import sys
from contextlib import contextmanager
from pathlib import Path
from threading import Thread

from waitress import create_server

from app import create_app
from config import Config
from embedded.storage import backup
from logging_config import configure_logging


@contextmanager
def workspace_lock(filename: Path):
    with filename.open("a+b") as lock:
        try:
            if os.name == "nt":
                import msvcrt
                lock.seek(0)
                msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as error:
            raise RuntimeError("The local workspace is already open or cannot be locked") from error
        yield


def reply(kind: str, **fields) -> None:
    print("FORTUNA/1 " + json.dumps({"type": kind, **fields}), flush=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", required=True, type=Path)
    parser.add_argument("--database", type=Path, help="Existing user-selected database requiring account login")
    parser.add_argument("--create", action="store_true", help="Create the selected database exclusively")
    args = parser.parse_args()
    directory = args.data.resolve()
    directory.mkdir(parents=True, exist_ok=True)
    default = directory / "fortuna.sqlite3"
    database = default
    lock = directory / "workspace.lock"
    if args.database is not None:
        database = args.database.resolve(strict=not args.create)
        if database == default or (database.exists() and (not database.is_file() or (default.exists() and database.samefile(default)))):
            raise ValueError("Select a database file other than the built-in database")
        lock = database.with_name(database.name + '.fortuna.lock')
    config = Config.from_data({"environment": "production", "database": {"db_file": str(database)},
                               "web": {"user": {"session": {"fortuna_token_expire_time_seconds": 86400}}}}, directory)
    configure_logging(config)
    # Use UTF-8 regardless of the Windows console code page.
    secret = sys.stdin.buffer.readline(66).rstrip(b"\n").decode("ascii")
    with workspace_lock(lock):
        app = create_app(config, runtime_mode="embedded", secret=secret, selected_file=args.database is not None,
                         create_file=args.create)
        server = create_server(app, host="127.0.0.1", port=0, ipv6=False)
        host, port = server.socket.getsockname()
        if host != "127.0.0.1" or app.debug:
            raise RuntimeError("Invalid embedded server binding")
        Thread(target=server.run, daemon=True).start()
        reply("ready", host=host, port=port)
        try:
            for line in sys.stdin.buffer:
                command = json.loads(line)
                if command.get("type") != "backup" or args.database is not None:
                    raise ValueError("Unknown control message")
                try:
                    backup(database, Path(command["destination"]))
                    reply("backup", ok=True)
                except (ValueError, OSError, sqlite3.Error) as error:
                    reply("backup", ok=False, error=str(error))
        finally:
            server.task_dispatcher.shutdown(cancel_pending=False, timeout=4)
            server.close()


if __name__ == "__main__":
    try:
        main()
    except Exception:
        logging.exception("Could not run the local workspace")
        sys.exit(1)
