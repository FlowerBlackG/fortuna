# SPDX-License-Identifier: MulanPSL-2.0
import argparse
import platform
import sys
import uuid
from pathlib import Path

from version import VERSION_TAG


def main() -> None:
    if not hasattr(uuid, "uuid7"):
        sys.exit("Fortuna requires Python 3.14+ with builtin uuid.uuid7. Please upgrade Python.")
    from app import create_app
    from config import Config
    from logging_config import configure_logging
    from waitress import serve

    parser = argparse.ArgumentParser(description="Fortuna personal asset settlement server")
    parser.add_argument("-c", "--config", type=Path, required=True, help="Path to config.json")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=5000)
    parser.add_argument("--web-dir", help="Optional built frontend directory")
    args = parser.parse_args()
    try:
        config = Config.load(args.config)
        configure_logging(config)
    except (OSError, ValueError, KeyError, TypeError) as error:
        parser.error(f"Invalid configuration: {error}")
    print(f"Fortuna {VERSION_TAG} · Python {platform.python_version()} · Config: {args.config.resolve()}", flush=True)
    app = create_app(config, args.web_dir)
    if app.debug:
        app.run(host=args.host, port=args.port, debug=True, use_reloader=True)
    else:
        serve(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
