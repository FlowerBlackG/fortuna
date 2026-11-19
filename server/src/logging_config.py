# SPDX-License-Identifier: MulanPSL-2.0
import logging

from config import Config


def configure_logging(config: Config) -> None:
    if config.logging is None:
        handler = logging.StreamHandler()
    else:
        config.logging.file.parent.mkdir(parents=True, exist_ok=True)
        handler = logging.FileHandler(config.logging.file, encoding="utf-8")
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
        handlers=[handler],
        force=True,
    )
