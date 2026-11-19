# SPDX-License-Identifier: MulanPSL-2.0
import argparse
import sys
import uuid


def main():
    if not hasattr(uuid, "uuid7"):
        sys.exit("Fortuna requires Python 3.14+ with builtin uuid.uuid7. Please upgrade Python.")
    from app import create_app
    from config import Config
    from logging_config import configure_logging

    parser = argparse.ArgumentParser(description="Fortuna personal asset settlement server")
    parser.add_argument("-c", "--config", required=True, help="Path to config.json")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=5000)
    parser.add_argument("--web-dir", help="Optional built frontend directory")
    args = parser.parse_args()
    try:
        config = Config.load(args.config)
        configure_logging(config)
    except (OSError, ValueError, KeyError, TypeError) as error:
        parser.error(f"Invalid configuration: {error}")
    create_app(config, args.web_dir).run(host=args.host, port=args.port)


if __name__ == "__main__":
    main()
